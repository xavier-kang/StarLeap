/**
 * cxsecret 混淆字体运行时解密
 * 原理: 学习通每个测验页面内嵌一个小型 TrueType 字体（~50 字），把明文字形映射到乱码码位。
 * 流程: 提取字体 → 隐藏窗口用该字体渲染字符栅格 → Swift Vision OCR 识别 → 乱码→明文 映射（按字体 MD5 缓存）。
 */
import { BrowserWindow, app } from "electron";
import { spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as crypto from "crypto";
import { logger } from "../logger";

let ocrWindow: BrowserWindow | null = null;
/** fontMd5 → 映射表 */
const memoryCache = new Map<string, Record<string, string>>();
let diskCache: Record<string, Record<string, string>> | null = null;

function cacheFile(): string {
  return path.join(app.getPath("userData"), "data", "fontmaps.json");
}

function loadDiskCache(): Record<string, Record<string, string>> {
  if (diskCache) return diskCache;
  try {
    diskCache = JSON.parse(fs.readFileSync(cacheFile(), "utf-8")) as Record<string, Record<string, string>>;
  } catch {
    diskCache = {};
  }
  return diskCache ?? {};
}

function saveDiskCache(): void {
  try {
    fs.writeFileSync(cacheFile(), JSON.stringify(diskCache || {}), "utf-8");
  } catch {
    /* ignore */
  }
}

/** OCR 助手二进制路径（开发: build-helper/；打包: Resources/）—— 仅 macOS */
export function ocrBinaryPath(): string {
  const dev = path.join(app.getAppPath(), "build-helper", "vision-ocr");
  if (fs.existsSync(dev)) return dev;
  return path.join(process.resourcesPath || "", "vision-ocr");
}

function tesseractPath(): string | null {
  for (const p of ["/usr/bin/tesseract", "/usr/local/bin/tesseract"]) {
    try { fs.accessSync(p, fs.constants.X_OK); return p; } catch { /* next */ }
  }
  return null;
}

export function ocrAvailable(): boolean {
  if (process.platform === "darwin") return fs.existsSync(ocrBinaryPath());
  if (process.platform === "linux") return tesseractPath() !== null;
  return false;
}

/** 解析字体 cmap，返回确定顺序（按码点排序）的字符列表 */
function fontCharacters(fontBuf: Buffer): string[] {
  try {
    // 动态引入 fontkit（纯 JS）
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fontkit = require("fontkit");
    const font = fontkit.create(fontBuf);
    const codes = [...(font.characterSet || [])].sort((a: number, b: number) => a - b);
    return codes.map((c: number) => String.fromCodePoint(c)).filter((c) => c && c !== "\uFFFF");
  } catch (e: any) {
    logger.warn("fontmap", `字体解析失败: ${e?.message || e}`);
    return [];
  }
}

async function renderGridPng(fontB64: string, chars: string[]): Promise<{ png: Buffer; rowChars: string[] }> {
  if (!ocrWindow || ocrWindow.isDestroyed()) {
    ocrWindow = new BrowserWindow({
      show: false,
      x: -4000,
      y: 0,
      width: 2400,
      height: 800,
      webPreferences: { offscreen: true, backgroundThrottling: false },
    });
  }
  // 连续文本行渲染（Vision 对连续文本识别率远高于孤立单字）
  const perRow = Math.min(12, Math.max(4, Math.ceil(chars.length / Math.ceil(chars.length / 10))));
  const rowChars: string[] = [];
  for (let i = 0; i < chars.length; i += perRow) rowChars.push(chars.slice(i, i + perRow).join(""));
  const fontSize = 110;
  const lineH = 190;
  const canvasW = Math.max(...rowChars.map((r) => r.length)) * fontSize + 200;
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    @font-face{font-family:'cxsec';src:url(data:application/font-ttf;base64,${fontB64}) format('truetype');}
    body{margin:0;background:#fff;overflow:hidden;}
  </style></head><body><canvas id="c" width="${canvasW}" height="${rowChars.length * lineH + 60}"></canvas>
  <script>
    const rows = ${JSON.stringify(rowChars)};
    const c = document.getElementById('c');
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0,0,c.width,c.height);
    ctx.fillStyle = '#000'; ctx.textBaseline = 'middle';
    document.fonts.load('110px "cxsec"', '永').then(() => {
      ctx.font = '110px "cxsec"';
      rows.forEach((r, i) => ctx.fillText(r, 60, i * ${lineH} + ${lineH / 2}));
      window.__done = true;
    });
  </script></body></html>`;
  await ocrWindow.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
  // 等待字体加载并绘制完成（最多 6 秒）
  const ready = await ocrWindow.webContents.executeJavaScript(
    `new Promise((resolve) => {
      if (window.__done) return resolve(true);
      const t = setInterval(() => { if (window.__done) { clearInterval(t); resolve(true); } }, 100);
      setTimeout(() => { clearInterval(t); resolve(false); }, 6000);
    })`,
  );
  if (!ready) logger.warn("fontmap", "栅格绘制超时（字体可能未加载）");
  await new Promise((r) => setTimeout(r, 300));
  const img = await ocrWindow.webContents.capturePage({
    x: 0,
    y: 0,
    width: canvasW,
    height: rowChars.length * lineH + 60,
  });
  const png = img.toPNG();
  if (process.env.STARLEAP_DEBUG_FONT) {
    try { fs.writeFileSync("/tmp/cxgrid-debug.png", png); } catch { /* ignore */ }
  }
  return { png, rowChars };
}

/** 用 OCR 建立某字体的 乱码→明文 映射 */
export async function buildFontMapByOcr(fontBuf: Buffer): Promise<Record<string, string>> {
  const md5 = crypto.createHash("md5").update(fontBuf).digest("hex");
  const mem = memoryCache.get(md5);
  if (mem) return mem;
  const disk = loadDiskCache()[md5];
  if (disk && Object.keys(disk).length > 0) {
    memoryCache.set(md5, disk);
    return disk;
  }
  const chars = fontCharacters(fontBuf);
  if (chars.length === 0) return {};
  if (!ocrAvailable()) {
    logger.warn("fontmap", "OCR 助手不可用，无法解密混淆字体");
    return {};
  }
  const { png, rowChars } = await renderGridPng(fontBuf.toString("base64"), chars);
  const tmpPng = path.join(os.tmpdir(), `cxgrid-${Date.now()}.png`);
  fs.writeFileSync(tmpPng, png);
  try {
    let recognized = "";
    if (process.platform === "darwin") {
      // macOS: vision-ocr（Swift Vision），返回带坐标的 JSON
      const out = await new Promise<string>((resolve, reject) => {
        const p = spawn(ocrBinaryPath(), [tmpPng]);
        let s2 = "";
        p.stdout.on("data", (d) => (s2 += d));
        p.stderr.on("data", () => undefined);
        p.on("close", () => resolve(s2));
        p.on("error", reject);
      });
      const boxes = JSON.parse(out.trim().split("\n").filter(Boolean).pop() || "[]");
      // 按行 y 排序后拼接，与 rowChars 逐位对齐
      boxes.sort((a: any, b: any) => a.y - b.y);
      recognized = boxes.map((b: any) => String(b.text || "").replace(/\s/g, "")).join("");
    } else {
      // Linux: tesseract（连续文本行渲染，chi_sim 识别良好）
      const out = await new Promise<string>((resolve, reject) => {
        const p = spawn(tesseractPath()!, [tmpPng, "stdout", "-l", "chi_sim", "--psm", "6"]);
        let s2 = "";
        p.stdout.on("data", (d) => (s2 += d));
        p.stderr.on("data", () => undefined);
        p.on("close", () => resolve(s2));
        p.on("error", reject);
      });
      recognized = out.replace(/\s/g, "");
    }
    const result: Record<string, string> = {};
    if (recognized.length === chars.length) {
      for (let i = 0; i < chars.length; i++) result[chars[i]] = recognized[i];
    } else {
      logger.warn("fontmap", `OCR 长度不匹配: 识别 ${recognized.length} / 实际 ${chars.length}（"${recognized.slice(0, 20)}…"），本页字体保持乱码`);
    }
    logger.info("fontmap", `字体 ${md5.slice(0, 8)} OCR 映射 ${Object.keys(result).length}/${chars.length}`);
    memoryCache.set(md5, result);
    const dc = loadDiskCache();
    dc[md5] = result;
    saveDiskCache();
    return result;
  } finally {
    try { fs.unlinkSync(tmpPng); } catch { /* ignore */ }
  }
}
