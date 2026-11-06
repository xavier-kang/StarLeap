import * as crypto from "crypto";
import { app } from "electron";
import * as fs from "fs";
import * as path from "path";
import { cx, UA } from "./client";
import { Settings } from "../store";
import { logger } from "../logger";

/** 题型码：0单选 1多选 2填空 3判断 4简答（与学习通一致） */
export interface TikuQuery {
  title: string;
  options: string[];
  typeCode: number;
}

export interface TikuResult {
  /** 统一格式：选择题为字母串数组（如 ["A","C"]），填空/简答为文本（多空 # 分隔），判断为 ["正确"|"错误"] */
  values: string[];
  answerText: string;
  source: string;
  confidence: number;
}

const TYPE_NAME = ["单选题", "多选题", "填空题", "判断题", "简答题"];

interface CacheEntry {
  answerText: string;
  values: string[];
  source: string;
  ts: number;
}

class AnswerCache {
  private file: string;
  private map: Record<string, CacheEntry> = {};

  constructor() {
    const dir = path.join(app.getPath("userData"), "data");
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, "answer-cache.json");
    try {
      this.map = JSON.parse(fs.readFileSync(this.file, "utf-8"));
    } catch {
      this.map = {};
    }
  }

  private key(title: string, typeCode: number): string {
    return crypto.createHash("md5").update(`${typeCode}|${title.replace(/\s+/g, "")}`).digest("hex");
  }

  get(title: string, typeCode: number): CacheEntry | null {
    return this.map[this.key(title, typeCode)] || null;
  }

  put(title: string, typeCode: number, entry: Omit<CacheEntry, "ts">): void {
    this.map[this.key(title, typeCode)] = { ...entry, ts: Date.now() };
    this.scheduleSave();
  }

  get size(): number {
    return Object.keys(this.map).length;
  }

  private saveTimer: NodeJS.Timeout | null = null;
  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      try {
        fs.writeFileSync(this.file, JSON.stringify(this.map, null, 0), "utf-8");
      } catch {
        /* ignore */
      }
    }, 2000);
  }
}

const cache = new AnswerCache();

function normalizeText(s: string): string {
  return String(s || "")
    .replace(/<[^>]*>/g, "")
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[\s。，、；：""''（）【】.·,;:'"()[\]—-]/g, "")
    .toLowerCase();
}

/** 把题库返回的原始答案文本归一为选项字母数组（选择题） */
function toLetters(raw: string, options: string[]): string[] {
  const cleaned = String(raw || "")
    .replace(/<[^>]*>/g, "")
    .trim();
  if (!cleaned) return [];
  // 形如 "A" / "A#B" / "AB" / "A,B"
  const letterish = cleaned.replace(/#/g, "").replace(/[,，、\s]/g, "");
  if (/^[A-Ta-t]{1,10}$/.test(letterish) && options.length > 0) {
    const letters = letterish.toUpperCase().split("");
    const valid = letters.every((l) => l.charCodeAt(0) - 65 < Math.max(options.length, 4));
    if (valid) return letters;
  }
  // 选项文本匹配（支持 # 分隔多选）
  const parts = cleaned.split(/[#；;]|(?:\s{2,})/).map((p) => normalizeText(p)).filter(Boolean);
  const hits: string[] = [];
  options.forEach((opt, idx) => {
    const nOpt = normalizeText(opt);
    if (parts.some((p) => p === nOpt || (nOpt.includes(p) && p.length >= 4))) {
      hits.push(String.fromCharCode(65 + idx));
    }
  });
  return hits;
}

export function judgeNormalize(raw: string): "正确" | "错误" | "" {
  const t = normalizeText(raw);
  if (/^(正确|对|√|yes|true|t)$/.test(t)) return "正确";
  if (/^(错误|不对|错|×|x|no|false|f)$/.test(t)) return "错误";
  if (/(^|[^不错])正确|是对的|正确说法/.test(normalizeText(raw))) return "正确";
  if (/错误|不正确|是错的/.test(normalizeText(raw))) return "错误";
  return "";
}

/** tikuAdapter 兼容端点（含言溪/自建适配器等） */
async function queryAdapter(query: TikuQuery, endpoint: string, token: string): Promise<TikuResult | null> {
  const url = `${endpoint.replace(/\/$/, "")}/adapter-service/search`;
  const body = JSON.stringify({
    question: query.title,
    options: query.options,
    type: query.typeCode,
  });
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": UA,
  };
  const params = new URLSearchParams();
  if (token) params.set("token", token);
  const full = params.toString() ? `${url}?${params.toString()}` : url;
  const res = await cx.fetch(full, { method: "POST", body, headers });
  if (res.status !== 200) return null;
  const data = await res.json();
  const ans = data?.answer || data?.data?.answer;
  const text = String(ans?.answerText || ans?.answerKeyText || ans?.bestAnswer || "");
  if (!text) return null;
  return { values: [], answerText: text, source: "tiku", confidence: 0.9 };
}

/** icodef 免费题库 */
async function queryIcodef(query: TikuQuery): Promise<TikuResult | null> {
  const body = new URLSearchParams({ question: query.title });
  let res: Response;
  try {
    res = await cx.fetch("https://cx.icodef.com/wyn-nb?v=4", {
      method: "POST",
      body,
      headers: { "User-Agent": UA, Referer: "https://cx.icodef.com/" },
    });
  } catch (e: any) {
    logger.warn("tiku", `icodef 请求异常: ${e?.message || e}`);
    return null;
  }
  if (res.status !== 200) {
    logger.warn("tiku", `icodef HTTP ${res.status}`);
    return null;
  }
  const text = await res.text();
  let data: any;
  try { data = JSON.parse(text); } catch { data = null; }
  if (!data || data?.code !== 1 || !data?.data) {
    logger.warn("tiku", `icodef 未命中: ${text.slice(0, 120)}`);
    return null;
  }
  return { values: [], answerText: String(data.data), source: "tiku", confidence: 0.85 };
}

/** OpenAI 兼容 AI */
export async function queryAI(query: TikuQuery, settings: Settings): Promise<TikuResult | null> {
  if (!settings.aiBaseUrl || !settings.aiApiKey || !settings.aiModel) return null;
  const typeCode = query.typeCode;
  const optionLines = query.options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`).join("\n");
  let userContent = "";
  let system =
    "你是一个答题助手。只输出答案本身，不要解释，不要标点。";
  if (typeCode === 0) {
    system += "这是单选题，只输出一个选项字母，例如：B";
    userContent = `题目：${query.title}\n选项：\n${optionLines}\n只输出一个字母。`;
  } else if (typeCode === 1) {
    system += "这是多选题，只输出选项字母，多个字母直接连着写，例如：AC";
    userContent = `题目：${query.title}\n选项：\n${optionLines}\n只输出字母。`;
  } else if (typeCode === 3) {
    system += "这是判断题，只输出「正确」或「错误」。";
    userContent = `题目：${query.title}\n只输出「正确」或「错误」。`;
  } else if (typeCode === 2) {
    system += "这是填空题，多个空用#分隔，只输出答案文本。";
    userContent = `题目：${query.title}\n只输出各空答案，用#分隔。`;
  } else {
    system += "这是简答题，输出简洁的答案要点（80字内）。";
    userContent = `题目：${query.title}`;
  }
  const base = settings.aiBaseUrl.replace(/\/$/, "");
  const url = base.endsWith("/chat/completions") ? base : `${base}/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.aiApiKey}`,
    },
    body: JSON.stringify({
      model: settings.aiModel,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userContent },
      ],
      temperature: 0.2,
      max_tokens: 300,
    }),
  });
  if (!res.ok) {
    logger.warn("ai", `AI 请求失败 HTTP ${res.status}`);
    return null;
  }
  const data = await res.json();
  const content = String(data?.choices?.[0]?.message?.content || "").trim();
  if (!content) return null;
  return { values: [], answerText: content, source: "ai", confidence: 0.6 };
}

export interface TikuContext {
  settings: Settings;
  /** 学科上下文（课程名），帮助 AI 判断 */
  subject?: string;
}

/**
 * 查询一题：缓存 → 题库 → AI。
 * 返回归一化结果：选择题 values 为字母数组；判断为 ["正确"|"错误"]；填空/简答 values=[文本]。
 */
export async function queryAnswer(query: TikuQuery, ctx: TikuContext): Promise<TikuResult | null> {
  const cached = cache.get(query.title, query.typeCode);
  if (cached) {
    return { values: cached.values, answerText: cached.answerText, source: "cache", confidence: 0.99 };
  }

  let result: TikuResult | null = null;
  if (ctx.settings.tikuEndpoint) {
    try {
      result = await queryAdapter(query, ctx.settings.tikuEndpoint, ctx.settings.tikuToken);
    } catch (e: any) {
      logger.warn("tiku", `题库查询失败: ${e?.message || e}`);
    }
  }
  if (!result && query.typeCode <= 3) {
    try {
      result = await queryIcodef(query);
    } catch {
      /* ignore */
    }
  }

  // 题库结果归一化
  if (result) {
    const normalized = normalizeResult(query, result.answerText);
    if (normalized) {
      result.values = normalized.values;
      if (!normalized.valid) result = null; // 题库给的答案无法对应到选项，降级走 AI
      else {
        cache.put(query.title, query.typeCode, {
          answerText: result.answerText,
          values: result.values,
          source: result.source,
        });
        return result;
      }
    } else {
      result = null;
    }
  }

  try {
    const ai = await queryAI(query, ctx.settings);
    if (ai) {
      const normalized = normalizeResult(query, ai.answerText);
      if (normalized && normalized.valid) {
        ai.values = normalized.values;
        cache.put(query.title, query.typeCode, {
          answerText: ai.answerText,
          values: ai.values,
          source: "ai",
        });
        return ai;
      }
      // AI 输出非法：单选/判断可蒙一个
      if (ctx.settings.aiGuessOnMiss && (query.typeCode === 0 || query.typeCode === 3)) {
        const guess = query.typeCode === 0 ? ["A"] : ["正确"];
        return { values: guess, answerText: guess.join(""), source: "guess", confidence: 0.25 };
      }
    }
  } catch (e: any) {
    logger.warn("ai", `AI 查询异常: ${e?.message || e}`);
  }
  return null;
}

function normalizeResult(query: TikuQuery, raw: string): { values: string[]; valid: boolean } | null {
  const typeCode = query.typeCode;
  if (typeCode === 0 || typeCode === 1) {
    const letters = toLetters(raw, query.options);
    if (letters.length === 0) return { values: [], valid: false };
    if (typeCode === 0 && letters.length > 1) return { values: letters.slice(0, 1), valid: true };
    return { values: letters, valid: true };
  }
  if (typeCode === 3) {
    const j = judgeNormalize(raw);
    return j ? { values: [j], valid: true } : { values: [], valid: false };
  }
  const text = String(raw || "").replace(/<[^>]*>/g, "").trim();
  if (!text) return { values: [], valid: false };
  return { values: text.split(/[#]/).map((s) => s.trim()).filter(Boolean), valid: true };
}

export function cacheSize(): number {
  return cache.size;
}
