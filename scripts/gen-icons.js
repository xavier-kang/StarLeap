/**
 * 应用图标生成 v2
 * - 读取用户设计的像素风 Logo（/Users/kang/Downloads/StarLeap.png）
 * - 裁掉留白、加 macOS 圆角遮罩 → resources/icon.png (1024)
 * - sips 生成全尺寸 iconset → iconutil 打包 icon.icns
 * - 托盘：配套的像素流星剪影（黑色模板图）
 */
const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");
const { execSync } = require("child_process");

const SOURCE = process.argv[2] || path.join(__dirname, "..", "resources", "logo-source.png");
const ROOT = path.join(__dirname, "..");
const RES = path.join(ROOT, "resources");
fs.mkdirSync(RES, { recursive: true });

/* ---------- 1. 读源图，裁剪留白，加圆角 ---------- */
const src = PNG.sync.read(fs.readFileSync(SOURCE));
const { width: W, height: H, data: sd } = src;

// 自动裁剪非白色边界（天空是白色，主体含彩色）
function boundingBox() {
  let minX = W, minY = H, maxX = -1, maxY = -1;
  const isWhiteish = (i) => sd[i] > 245 && sd[i + 1] > 245 && sd[i + 2] > 245;
  // 网格采样加速
  const step = 4;
  for (let y = 0; y < H; y += step) {
    for (let x = 0; x < W; x += step) {
      const i = (y * W + x) * 4;
      if (!isWhiteish(i)) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  // 放宽一点边界 + 排除误采样的孤立点
  const pad = 12;
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
  maxX = Math.min(W - 1, maxX + pad); maxY = Math.min(H - 1, maxY + pad);
  return { minX, minY, maxX, maxY };
}
const bb = boundingBox();
const bw = bb.maxX - bb.minX + 1;
const bh = bb.maxY - bb.minY + 1;
// 取正方形（居中）
const side = Math.max(bw, bh);
const cx0 = bb.minX + Math.floor(bw / 2) - Math.floor(side / 2);
const cy0 = bb.minY + Math.floor(bh / 2) - Math.floor(side / 2);
console.log("bbox", JSON.stringify(bb), "→ side", side);

// 缩放到 1024 并加圆角（macOS 图标圆角比例 ~22.37%）
const OUT = 1024;
const out = new PNG({ width: OUT, height: OUT });
const radius = Math.round(OUT * 0.2237);
const inRadius2Min = (radius - 1.5) * (radius - 1.5);
const inRadius2Max = (radius + 1.5) * (radius + 1.5);
for (let y = 0; y < OUT; y++) {
  for (let x = 0; x < OUT; x++) {
    const i = (y * OUT + x) * 4;
    // 源图坐标
    const sx = cx0 + Math.floor((x / OUT) * side);
    const sy = cy0 + Math.floor((y / OUT) * side);
    const si = (Math.max(0, Math.min(H - 1, sy)) * W + Math.max(0, Math.min(W - 1, sx))) * 4;
    out.data[i] = sd[si];
    out.data[i + 1] = sd[si + 1];
    out.data[i + 2] = sd[si + 2];
    // 圆角遮罩（1.5px 羽化）
    let alpha = 255;
    const dx = x < radius ? radius - x : x >= OUT - radius ? x - (OUT - radius - 1) : 0;
    const dy = y < radius ? radius - y : y >= OUT - radius ? y - (OUT - radius - 1) : 0;
    if (dx > 0 && dy > 0) {
      const d2 = dx * dx + dy * dy;
      if (d2 >= inRadius2Max) alpha = 0;
      else if (d2 > inRadius2Min) alpha = Math.round(255 * (inRadius2Max - d2) / (inRadius2Max - inRadius2Min));
    }
    out.data[i + 3] = alpha;
  }
}
fs.writeFileSync(path.join(RES, "icon.png"), PNG.sync.write(out));
console.log("icon.png (1024, 圆角) 完成");

/* ---------- 2. iconset → icns ---------- */
const iconset = path.join(ROOT, "build-helper", "StarLeap.iconset");
fs.rmSync(iconset, { recursive: true, force: true });
fs.mkdirSync(iconset, { recursive: true });
const sizes = [16, 32, 64, 128, 256, 512, 1024];
for (const s of sizes) {
  execSync(`sips -z ${s} ${s} "${path.join(RES, "icon.png")}" --out "${path.join(iconset, `icon_${s}x${s}.png`)}"`, { stdio: "ignore" });
  if (s <= 512) {
    const half = s / 2;
    execSync(`sips -z ${s} ${s} "${path.join(RES, "icon.png")}" --out "${path.join(iconset, `icon_${half}x${half}@2x.png`)}"`, { stdio: "ignore" });
  }
}
execSync(`iconutil -c icns "${iconset}" -o "${path.join(RES, "icon.icns")}"`);
console.log("icon.icns 完成");

/* ---------- 3. 托盘像素流星剪影（黑色模板图，配合 Logo 风格） ---------- */
// 像素星（对角线朝右下的五角星，块状阶梯边缘）+ 两道拖尾
function drawTray(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const u = size / 18; // 18 逻辑格
  const px = (gx, gy, a = 255) => {
    for (let yy = Math.floor(gy * u); yy < Math.floor((gy + 1) * u); yy++)
      for (let xx = Math.floor(gx * u); xx < Math.floor((gx + 1) * u); xx++) {
        if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue;
        const i = (yy * size + xx) * 4;
        rgba[i] = 0; rgba[i + 1] = 0; rgba[i + 2] = 0; rgba[i + 3] = Math.max(rgba[i + 3], a);
      }
  };
  // 星星主体（像素五角星，占右上 10x10 区域）
  const star = [
    "....X.....",
    "....XX....",
    "...XXXX...",
    "XXXXXXXXX.",
    ".XXXXXXXXX",
    "..XXXXXXXX",
    "...XXXXXX.",
    "...XXXXX..",
    "..XX..XX..",
    ".XX....X..",
  ];
  star.forEach((row, ry) => {
    [...row].forEach((c, rx) => { if (c === "X") px(8 + rx, 1 + ry); });
  });
  // 拖尾（三道斜向短线，向左下）
  const trails = [
    [0, 10, 6], [1, 12, 4], [0, 14, 3],
  ];
  for (const [tx, ty, len] of trails) {
    for (let k = 0; k < len; k++) px(tx + k, ty - k, 230);
  }
  return encodePNG(size, size, rgba);
}

/* ---------- PNG 编码（同 v1） ---------- */
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
  ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}
const zlib = require("zlib");

fs.writeFileSync(path.join(RES, "trayTemplate.png"), drawTray(18));
fs.writeFileSync(path.join(RES, "trayTemplate@2x.png"), drawTray(36));
console.log("托盘图标完成");
