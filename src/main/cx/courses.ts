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
  /** 服务端记录的观看位置（毫秒）——断点续刷用 */
  playTime?: number;
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
    const strip = (x: string) => decodeEntities(x.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();

    // ---- 2026 版: <div class="chapter_item" id="cur..." title="..."> + span.catalog_sbar 编号 + knowledgeJobCount
    const itemRe = /<div[^>]*class="[^"]*chapter_item[^"]*"[^>]*id="cur(\d+)"[^>]*>/gi;
    const matches: { id: string; tag: string; index: number; end: number }[] = [];
    let m: RegExpExecArray | null;
    while ((m = itemRe.exec(html))) {
      matches.push({ id: m[1], tag: m[0], index: m.index, end: m.index + m[0].length });
    }
    if (matches.length > 0) {
      for (let i = 0; i < matches.length; i++) {
        const segEnd = i + 1 < matches.length ? matches[i + 1].index : Math.min(html.length, matches[i].end + 6000);
        const seg = html.slice(matches[i].end, segEnd);
        const titleAttr = / title="([^"]*)"/.exec(matches[i].tag)?.[1] || "";
        const sbar = /class="catalog_sbar"[^>]*>([^<]*)</.exec(seg)?.[1]?.trim() || "";
        const clickTitle = /class="clicktitle"[^>]*>([\s\S]*?)<\/a>/.exec(seg)?.[1] || "";
        let title = decodeEntities(titleAttr).trim();
        if (!title) title = strip(clickTitle.replace(/<span[^>]*class="catalog_sbar"[^>]*>[\s\S]*?<\/span>/i, ""));
        const jobTag = /<input[^>]*knowledgeJobCount[^>]*>/.exec(seg)?.[0] || "";
        const job = /value="(\d+)"/.exec(jobTag)?.[1] || /class="[^"]*knowledgeJobCount[^"]*"[^>]*value="(\d+)"/.exec(seg)?.[1];
        const locked = /(?<!un)lock/.test(seg.slice(0, 2500)) && !/已完成/.test(seg.slice(0, 2500));
        const unitNo = sbar.split(/[.．]/)[0] || "";
        out.push({
          knowledgeId: Number(matches[i].id),
          title: title || "(未命名章节)",
          unit: unitNo ? `第 ${unitNo} 单元` : "章节",
          jobCount: job ? Number(job) : null,
          locked,
        });
      }
      logger.info("courses", `解析到 ${out.length} 个章节节点（2026 版结构）`);
      return out;
    }

    // ---- 旧版: <li id="cur..."> 结构
    const liRe = /<li[^>]*\bid="cur(\d+)"[^>]*>([\s\S]*?)<\/li>/gi;
    while ((m = liRe.exec(html))) {
      const inner = m[2];
      const tm = /<a[^>]*class="[^"]*clicktitle[^"]*"[^>]*>([\s\S]*?)<\/a>/i.exec(inner);
      const jm = /class="[^"]*knowledgeJobCount[^"]*"[^>]*value="(\d+)"/i.exec(inner);
      const locked = /未解锁|解锁条件/i.test(inner) && !/已完成/.test(inner);
      out.push({
        knowledgeId: Number(m[1]),
        title: tm ? strip(tm[1]) : "(未命名章节)",
        unit: "章节",
        jobCount: jm ? Number(jm[1]) : null,
        locked,
      });
    }
    logger.info("courses", `解析到 ${out.length} 个章节节点（旧版结构）`);
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
        playTime: typeof a.playTime === "number" ? a.playTime : undefined,
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

  /** 章节任务点完成度（totalcount/finishcount，GET 形式已实测） */
  async getJobsFinishedMap(course: Course, chapterIds: number[]): Promise<Record<number, { total: number; finished: number; locked: boolean }>> {
    if (chapterIds.length === 0) return {};
    const uid = await cx.getUid();
    const qs = new URLSearchParams({
      view: "json",
      nodes: chapterIds.join(","),
      time: String(Date.now()),
      clazzid: String(course.clazzId),
      userid: uid,
      cpi: String(course.cpi),
      courseid: String(course.courseId),
    });
    const data = await cx.fetchJson<any>(
      `https://mooc1-api.chaoxing.com/job/myjobsnodesmap?${qs.toString()}`,
      { headers: { Referer: "https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/studentcourse" } },
    );
    const mapSrc = data?.data || data || {};
    const out: Record<number, { total: number; finished: number; locked: boolean }> = {};
    for (const [k, v] of Object.entries<any>(mapSrc)) {
      if (!/^\d+$/.test(k)) continue;
      out[Number(k)] = {
        total: Number(v?.totalcount ?? v?.jobcount ?? 0),
        finished: Number(v?.finishcount ?? v?.finishtcount ?? 0),
        locked: Number(v?.openlock ?? 0) === 1,
      };
    }
    return out;
  }
}

export const courseApi = new CourseApi();
