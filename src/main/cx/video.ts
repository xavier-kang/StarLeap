import * as crypto from "crypto";
import { cx, VIDEO_REFERER, AUDIO_REFERER } from "./client";
import { Course, CardAttachment } from "./courses";
import { logger } from "../logger";

export type VideoMode = "safe" | "standard" | "flash";

export interface VideoProgress {
  seconds: number;
  duration: number;
  message: string;
}

export interface VideoJobInput {
  course: Course;
  knowledgeId: number;
  defaults: Record<string, any>;
  att: CardAttachment;
  mode: VideoMode;
  speed: number;
  onProgress: (p: VideoProgress) => void;
  shouldAbort: () => boolean;
}

export interface VideoJobResult {
  ok: boolean;
  passed: boolean;
  /** 视频总时长（秒），用于统计"节省的时间" */
  durationSeconds: number;
  message: string;
}

const md5 = (s: string) => crypto.createHash("md5").update(s).digest("hex");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** enc 签名（与官方播放器一致，已交叉验证） */
export function videoEnc(
  clazzId: number | string,
  userid: string,
  jobid: string,
  objectId: string,
  playingTime: number,
  duration: number,
): string {
  return md5(
    `[${clazzId}][${userid}][${jobid}][${objectId}][${Math.round(playingTime) * 1000}][d_yHJ!$pdA~5][${Math.round(duration) * 1000}][0_${Math.round(duration)}]`,
  );
}

function extractRt(otherInfo?: string): string {
  const m = /-rt_([1d])/.exec(otherInfo || "");
  if (!m) return "";
  return m[1] === "d" ? "0.9" : "1";
}

export class VideoRunner {
  /** 执行一个视频任务；返回是否通过 */
  async run(input: VideoJobInput): Promise<VideoJobResult> {
    const { course, defaults, att } = input;
    const objectId = att.objectId;
    const jobid = att.jobid;
    if (!objectId || !jobid) {
      return { ok: false, passed: false, durationSeconds: 0, message: "任务点缺少 objectId/jobid" };
    }
    const isAudio = String(att.property?.type || "").includes(".mp3");
    const referer = isAudio ? AUDIO_REFERER : VIDEO_REFERER;
    const dtype = isAudio ? "Audio" : "Video";
    const userid = String(defaults.userid || (await cx.getUid()) || "");
    const fid = String(defaults.fid || (await cx.getFid()) || "");
    const clazzId = course.clazzId;
    const reportBase =
      typeof defaults.reportUrl === "string" && defaults.reportUrl.startsWith("http")
        ? defaults.reportUrl.replace(/\/$/, "")
        : `https://mooc1.chaoxing.com/mooc-ans/multimedia/log/a/${course.cpi}`;

    let dtoken = "";
    let duration = 0;
    let serverPlayTime = 0;

    const refreshMeta = async (): Promise<boolean> => {
      try {
        const res = await cx.fetch(
          `https://mooc1.chaoxing.com/ananas/status/${objectId}?k=${fid}&flag=normal&_dc=${Date.now()}`,
          { headers: { Referer: referer } },
        );
        if (res.status !== 200) return false;
        const data = await res.json();
        if (data?.status !== "success") return false;
        dtoken = String(data.dtoken || "");
        duration = Math.round(Number(data.duration || 0));
        serverPlayTime = Math.round(Number(data.playTime || 0) / 1000);
        return !!(dtoken && duration > 0);
      } catch {
        return false;
      }
    };

    if (!(await refreshMeta())) {
      return { ok: false, passed: false, durationSeconds: 0, message: "获取视频信息失败（ananas/status）" };
    }

    const doReport = async (
      playingTime: number,
      isdrag: number,
    ): Promise<{ status: number; passed: boolean; riskText: boolean }> => {
      const enc = videoEnc(clazzId, userid, jobid, objectId, playingTime, duration);
      // 关键：与官方播放器一致，查询串用字符串拼接——otherInfo 内部的 "&courseId=..." 保持裸格式
      // （用 URLSearchParams 会把 & 编码成 %26，服务端反爬直接 403 code=6）
      const kv: [string, string][] = [
        ["clazzId", String(clazzId)],
        ["playingTime", String(Math.round(playingTime))],
        ["duration", String(Math.round(duration))],
        ["clipTime", `0_${Math.round(duration)}`],
        ["objectId", objectId],
        ["otherInfo", att.otherInfo || ""], // 原样保留内部 &（其中含 courseId）
        ["jobid", jobid],
        ["userid", userid],
        ["isdrag", String(isdrag)],
        ["view", "pc"],
        ["enc", enc],
        ["rt", extractRt(att.otherInfo) || "0.9"],
        ["videoFaceCaptureEnc", att.videoFaceCaptureEnc ?? ""],
        ["dtype", dtype],
        ["_t", String(Date.now())],
      ];
      if (att.attDuration !== undefined) kv.push(["attDuration", String(att.attDuration)]);
      if (att.attDurationEnc) kv.push(["attDurationEnc", att.attDurationEnc]);
      kv.push(["courseEngineInfo", "false"]);
      const qs = kv.map(([k, v]) => `${k}=${v}`).join("&");
      const url = `${reportBase}/${dtoken}?${qs}`;
      const res = await cx.fetchVideo(url, { headers: { Referer: referer, "Content-Type": "application/json" } });
      let passed = false;
      let riskText = false;
      if (res.status === 200) {
        try {
          const body = await res.text();
          riskText = /验证码|validate|antispider/.test(body);
          passed = !riskText && JSON.parse(body)?.isPassed === true;
        } catch {
          passed = false;
        }
      }
      return { status: res.status, passed, riskText };
    };

    const flashFirst = input.mode === "flash";
    if (flashFirst) {
      input.onProgress({ seconds: duration, duration, message: "尝试直接完成上报…" });
      const r = await doReport(duration, 4);
      if (r.passed) {
        logger.success("video", `秒过成功: ${att.title}`);
        return { ok: true, passed: true, durationSeconds: duration, message: "已完成（直接上报）" };
      }
      if (input.mode === "flash") {
        // 极速模式允许再试一次（换 dtoken）
        if (await refreshMeta()) {
          const r2 = await doReport(duration, 4);
          if (r2.passed) {
            return { ok: true, passed: true, durationSeconds: duration, message: "已完成（直接上报）" };
          }
        }
        return { ok: false, passed: false, durationSeconds: duration, message: "直接上报未通过，可改用标准模式" };
      }
      logger.info("video", `秒过未通过，转入心跳模式: ${att.title}`);
    }

    // 心跳模式：播放进度按真实时间 × speed 推进
    let playTime = Math.max(0, serverPlayTime);
    let lastLogTime = playTime;
    let lastWall = Date.now();
    let waitSec = 30 + Math.floor(Math.random() * 40); // 30-70s
    let forbiddenRetry = 0;
    let lastProgressEmit = 0;

    while (playTime < duration) {
      if (input.shouldAbort()) {
        return { ok: false, passed: false, durationSeconds: duration, message: "已手动停止" };
      }
      await sleep(1000);
      const now = Date.now();
      const delta = ((now - lastWall) / 1000) * Math.max(1, Math.min(8, input.speed));
      lastWall = now;
      playTime = Math.min(duration, playTime + delta);

      if (now - lastProgressEmit > 3000) {
        lastProgressEmit = now;
        input.onProgress({
          seconds: Math.round(playTime),
          duration,
          message: `播放进度 ${Math.round(playTime)}/${duration}s`,
        });
      }

      const due = playTime - lastLogTime >= waitSec || playTime >= duration;
      if (!due) continue;

      const isFinal = playTime >= duration;
      const r = await doReport(Math.round(playTime), isFinal ? 4 : 3);
      if (r.passed) {
        return { ok: true, passed: true, durationSeconds: duration, message: "已完成（心跳上报）" };
      }
      if (r.status === 403 || r.riskText) {
        forbiddenRetry++;
        if (forbiddenRetry > 2) {
          return { ok: false, passed: false, durationSeconds: duration, message: "触发风控(403)，需要人工过验证码" };
        }
        logger.warn("video", "上报被拦截，刷新会话后重试");
        await sleep(2000 + Math.random() * 2000);
        if (await refreshMeta()) {
          playTime = Math.max(playTime, serverPlayTime);
          lastLogTime = playTime;
          continue;
        }
        continue;
      }
      lastLogTime = playTime;
      waitSec = 30 + Math.floor(Math.random() * 40);
    }

    // 收尾上报（个别需要多发几次）
    for (let i = 0; i < 3; i++) {
      const r = await doReport(duration, 4);
      if (r.passed) return { ok: true, passed: true, durationSeconds: duration, message: "已完成（收尾上报）" };
      await sleep(3000);
    }
    return { ok: false, passed: false, durationSeconds: duration, message: "心跳结束但未确认通过" };
  }
}

export const videoRunner = new VideoRunner();
