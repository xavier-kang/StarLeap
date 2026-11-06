/**
 * 生成应用图标（纯 JS PNG 编码，无外部依赖）
 * - resources/trayTemplate.png / @2x  : 菜单栏模板图标（黑色+透明）
 * - resources/icon.png                : Dock/DMG 图标（圆角底+五角星）
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256).map((_, n) => {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      return c;
    });
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

/** 判断点是否在五角星内（中心 cx,cy，外接半径 R） */
function inStar(x, y, cx, cy, R, rot = -Math.PI / 2) {
  const dx = x - cx;
  const dy = y - cy;
  const r = Math.sqrt(dx * dx + dy * dy);
  if (r > R) return false;
  const theta = Math.atan2(dy, dx) - rot;
  // 五角星极坐标方程: r_max(θ) 交替
  const k = ((theta % ((Math.PI * 2) / 5)) + Math.PI * 2 / 5) % (Math.PI * 2 / 5);
  const innerRatio = Math.cos(Math.PI / 5) / Math.cos(Math.PI / 5 - Math.PI / 10) / Math.cos(k - Math.PI / 10) * Math.cos(Math.PI / 10) * 2;
  // 简化：标准五角星半径函数
  const angle = Math.abs((((theta + Math.PI) % (Math.PI * 2)) - Math.PI));
  const sector = (Math.PI * 2) / 10;
  const a = angle % sector;
  const rMax = a < sector / 2 ? R * (Math.cos(sector / 2) / Math.cos(a - sector / 2)) : R;
  return r <= rMax;
}

function drawTray(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const cxp = size / 2;
  const cyp = size / 2 + size * 0.02;
  const R = size * 0.44;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // 2x2 超采样抗锯齿
      let hit = 0;
      for (const [ox, oy] of [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]]) {
        if (inStar(x + ox, y + oy, cxp, cyp, R)) hit++;
      }
      const alpha = Math.round((hit / 4) * 255);
      const i = (y * size + x) * 4;
      rgba[i] = 0;
      rgba[i + 1] = 0;
      rgba[i + 2] = 0;
      rgba[i + 3] = alpha;
    }
  }
  return encodePNG(size, size, rgba);
}

function drawAppIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const S = size;
  const r = S * 0.22; // 圆角
  const grad = (t) => {
    // 深蓝 → 紫渐变
    const c1 = [64, 96, 255];
    const c2 = [130, 72, 255];
    return c1.map((v, i) => Math.round(v + (c2[i] - v) * t));
  };
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      // 圆角矩形
      const dx = Math.max(r - x, x - (S - 1 - r), 0);
      const dy = Math.max(r - y, y - (S - 1 - r), 0);
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > r) {
        rgba[i + 3] = 0;
        continue;
      }
      const t = (x + y) / (2 * S);
      const [cr, cg, cb] = grad(t);
      rgba[i] = cr;
      rgba[i + 1] = cg;
      rgba[i + 2] = cb;
      rgba[i + 3] = 255;
      // 白色五角星
      let hit = 0;
      for (const [ox, oy] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) {
        if (inStar(x + ox, y + oy, S / 2, S / 2 + S * 0.02, S * 0.33)) hit++;
      }
      if (hit > 0) {
        const a = hit / 4;
        rgba[i] = Math.round(cr * (1 - a) + 255 * a);
        rgba[i + 1] = Math.round(cg * (1 - a) + 255 * a);
        rgba[i + 2] = Math.round(cb * (1 - a) + 255 * a);
        rgba[i + 3] = 255;
      }
    }
  }
  return encodePNG(S, S, rgba);
}

const root = path.join(__dirname, "..", "resources");
fs.mkdirSync(root, { recursive: true });
fs.writeFileSync(path.join(root, "trayTemplate.png"), drawTray(18));
fs.writeFileSync(path.join(root, "trayTemplate@2x.png"), drawTray(36));
fs.writeFileSync(path.join(root, "icon.png"), drawAppIcon(512));
console.log("icons written to", root);
