import { cx } from "./client";
import { logger } from "../logger";

export interface Course {
  courseId: number;
  clazzId: number;
  cpi: number;
  key: number;
  name: string;
  teacher: string;
  image: string | null;
  state: number;
}

export interface Chapter {
  knowledgeId: number;
  title: string;
  unit: string;
  jobCount: number | null;
  locked: boolean;
}

export interface CardAttachment {
  aid?: number;
  type: string | null;
  module?: string;
  job: boolean;
  isPassed?: boolean;
  jobid: string;
  objectId?: string;
  otherInfo?: string;
  jtoken?: string;
  enc?: string;
  attDuration?: number;
  attDurationEnc?: string;
  videoFaceCaptureEnc?: string;
  property: Record<string, any>;
  title: string;
}

export interface CardInfo {
  num: number;
  cardid: number | null;
  defaults: Record<string, any>;
  attachments: CardAttachment[];
}

export interface ChapterDetail {
  knowledgeId: number;
  cards: CardInfo[];
}

const CARDS_HOST = "https://mooc1.chaoxing.com";

/** 从 HTML 中提取 `name = {...};` 形式的 JSON 赋值（括号配对、字符串感知） */
export function extractJsonAssignment(html: string, name: string): any | null {
  const re = new RegExp(`${name}\\s*=\\s*\\{`);
  const m = re.exec(html);
  if (!m) return null;
  const start = html.indexOf("{", m.index);
  let depth = 0;
  let inStr = false;
  let quote = "";
  let escaped = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inStr) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === quote) inStr = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = true;
      quote = ch;
    } else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

export class CourseApi {
  /** 我的课程列表 */
  async listCourses(): Promise<Course[]> {
    const url = "https://mooc1-api.chaoxing.com/mycourse/backclazzdata?view=json&rss=1";
    const data = await cx.fetchJson<any>(url, {
      headers: { Referer: "https://i.chaoxing.com/" },
    });
    const out: Course[] = [];
    for (const ch of data?.channelList || []) {
      const content = ch?.content || {};
      const cd = content?.course?.data?.[0];
      if (!cd) continue;
      let teacher = "";
      const tf = cd.teacherfactor;
      if (Array.isArray(tf)) teacher = tf.map((t: any) => t?.name).filter(Boolean).join("、");
      else if (typeof tf?.name === "string") teacher = tf.name;
      else if (typeof cd.teacher === "string") teacher = cd.teacher;
      out.push({
        courseId: Number(cd.id),
        clazzId: Number(content.id),
        cpi: Number(ch.cpi),
        key: Number(ch.key),
        name: String(cd.name || "未命名课程"),
        teacher,
        image: cd.image ? String(cd.image) : null,
        state: Number(content.state ?? 0),
      });
    }
    logger.info("courses", `获取到 ${out.length} 门课程`);
    return out;
  }

  /** 章节树（解析 studentcourse 页面） */
  async listChapters(course: Course): Promise<Chapter[]> {
    const url =
      `https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/studentcourse` +
      `?courseid=${course.courseId}&clazzid=${course.clazzId}&cpi=${course.cpi}&ut=s&mooc2=1`;
    const html = await cx.fetchText(url, {
      headers: { Referer: "https://i.chaoxing.com/" },
    });
    return this.parseChapters(html);
  }

  parseChapters(html: string): Chapter[] {
    const out: Chapter[] = [];
    // 单元结构: div.chapter_unit 包含标题与若干 li[id^=cur]
    const unitBlocks = html.split(/<div[^>]+class="[^"]*chapter_unit[^"]*"[^>]*>/i).slice(1);
    const liRe = /<li[^>]*\bid="cur(\d+)"[^>]*>([\s\S]*?)<\/li>/gi;
    const titleRe = /<a[^>]*class="[^"]*clicktitle[^"]*"[^>]*>([\s\S]*?)<\/a>/i;
    const jobRe = /class="[^"]*knowledgeJobCount[^"]*"[^>]*value="(\d+)"/i;
    const stripTags = (s: string) => decodeEntities(s.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();

    const handleLi = (unitTitle: string, inner: string) => {
      const idm = /^cur(\d+)$/.exec("");
      void idm;
      const tm = titleRe.exec(inner);
      const jm = jobRe.exec(inner);
      const locked = /未解锁|解锁条件|class="[^"]*(?:lock|unfinished)[^"]*"/i.test(inner) && !/已完成|已完成点/.test(inner);
      out.push({
        knowledgeId: 0,
        title: tm ? stripTags(tm[1]) : "(未命名章节)",
        unit: unitTitle,
        jobCount: jm ? Number(jm[1]) : null,
        locked,
      });
    };

    if (unitBlocks.length > 0) {
      for (const block of unitBlocks) {
        const headEnd = block.indexOf("<ul");
        const head = headEnd > 0 ? block.slice(0, headEnd) : block.slice(0, 400);
        const unitTitle = stripTags(head).slice(0, 60) || "章节";
        let m: RegExpExecArray | null;
        liRe.lastIndex = 0;
        const partial = block;
        while ((m = liRe.exec(partial))) {
          const id = Number(m[1]);
          const found = out.length;
          handleLi(unitTitle, m[2]);
          out[found].knowledgeId = id;
        }
      }
    } else {
      // 兜底：直接全局扫 li
      let m: RegExpExecArray | null;
      liRe.lastIndex = 0;
      while ((m = liRe.exec(html))) {
        const id = Number(m[1]);
        const found = out.length;
        handleLi("章节", m[2]);
        out[found].knowledgeId = id;
      }
    }
    logger.info("courses", `解析到 ${out.length} 个章节节点`);
    return out;
  }

  /** 章节任务卡片（num 0..6 枚举） */
  async getChapterCards(course: Course, knowledgeId: number): Promise<ChapterDetail> {
    const cards: CardInfo[] = [];
    let missStreak = 0;
    for (let num = 0; num <= 6; num++) {
      const url =
        `${CARDS_HOST}/mooc-ans/knowledge/cards?clazzid=${course.clazzId}&courseid=${course.courseId}` +
        `&knowledgeid=${knowledgeId}&num=${num}&ut=s&cpi=${course.cpi}&v=2025-0424-1038-3&mooc2=1`;
      let html: string;
      try {
        html = await cx.fetchText(url, {
          headers: {
            Referer:
              "https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/studentcourse",
          },
        });
      } catch {
        break;
      }
      const arg = extractJsonAssignment(html, "mArg");
      if (!arg) {
        missStreak++;
        if (cards.length > 0 && missStreak >= 2) break;
        if (cards.length === 0 && num >= 1) break;
        continue;
      }
      missStreak = 0;
      const attachments: CardAttachment[] = (arg.attachments || []).map((a: any) => ({
        aid: a.aid,
        type: a.type ?? null,
        module: a.property?.module,
        job: a.job === true,
        isPassed: a.isPassed,
        jobid: String(a.jobid || a.property?.jobid || a.property?._jobid || ""),
        objectId: a.objectId || a.property?.objectid || a.property?.objectId || undefined,
        otherInfo: a.otherInfo || undefined,
        jtoken: a.jtoken || undefined,
        enc: a.enc || undefined,
        attDuration: typeof a.attDuration === "number" ? a.attDuration : undefined,
        attDurationEnc: a.attDurationEnc || undefined,
        videoFaceCaptureEnc: a.videoFaceCaptureEnc || undefined,
        property: a.property || {},
        title: String(a.property?.title || a.property?.name || a.property?.bookname || ""),
      }));
      cards.push({ num, cardid: arg.defaults?.cardid ?? null, defaults: arg.defaults || {}, attachments });
    }
    return { knowledgeId, cards };
  }

  /** 章节任务点完成度（totalcount/finishcount） */
  async getJobsFinishedMap(course: Course, chapterIds: number[]): Promise<Record<number, { total: number; finished: number }>> {
    if (chapterIds.length === 0) return {};
    const uid = await cx.getUid();
    const body = new URLSearchParams({
      view: "json",
      nodes: chapterIds.join(","),
      time: String(Date.now()),
      clazzid: String(course.clazzId),
      userid: uid,
      cpi: String(course.cpi),
      courseid: String(course.courseId),
    });
    const data = await cx.fetchJson<any>("https://mooc1-api.chaoxing.com/job/myjobsnodesmap", {
      method: "POST",
      body,
      headers: { Referer: "https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/studentcourse" },
    });
    const mapSrc = data?.data || data || {};
    const out: Record<number, { total: number; finished: number }> = {};
    for (const [k, v] of Object.entries<any>(mapSrc)) {
      if (!/^\d+$/.test(k)) continue;
      out[Number(k)] = {
        total: Number(v?.totalcount ?? v?.jobcount ?? 0),
        finished: Number(v?.finishcount ?? v?.finishtcount ?? 0),
      };
    }
    return out;
  }
}

export const courseApi = new CourseApi();
