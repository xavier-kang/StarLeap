import * as crypto from "crypto";
import { cx, UA } from "./client";
import { logger } from "../logger";
import { UserAccount } from "../store";

const PASSPORT = "https://passport2.chaoxing.com";
const AES_KEY = "u2oh6Vu^HWe4_AES";

function aesEncrypt(plain: string): string {
  const cipher = crypto.createCipheriv("aes-128-cbc", AES_KEY, AES_KEY);
  const enc = Buffer.concat([cipher.update(plain, "utf-8"), cipher.final()]);
  return enc.toString("base64");
}

export interface QrSession {
  uuid: string;
  enc: string;
  qrDataUrl: string;
}

export type QrPollResult =
  | { status: "waiting" }
  | { status: "scanned"; nickname?: string }
  | { status: "expired" }
  | { status: "error"; message: string }
  | { status: "success"; user: UserAccount };

export class Auth {
  private qr: QrSession | null = null;

  /** 发起扫码登录：返回二维码（dataURL） */
  async startQrLogin(): Promise<QrSession> {
    const html = await cx.fetchText(`${PASSPORT}/login`, {
      headers: { "User-Agent": UA, Referer: "https://i.chaoxing.com/" },
    });
    const extractHidden = (id: string): string => {
      const tag =
        new RegExp(`<input[^>]*id="${id}"[^>]*>`).exec(html)?.[0] ||
        new RegExp(`<input[^>]*name="${id}"[^>]*>`).exec(html)?.[0] || "";
      return /value="([^"]*)"/.exec(tag)?.[1] || /value='([^']*)'/.exec(tag)?.[1] || "";
    };
    const uuid = extractHidden("uuid");
    const enc = extractHidden("enc");
    if (!uuid || !enc) throw new Error("登录页解析失败（uuid/enc 缺失）");
    const imgRes = await cx.fetch(`${PASSPORT}/createqr?uuid=${uuid}&fid=-1`, { raw: true });
    const buf = Buffer.from(await imgRes.arrayBuffer());
    this.qr = { uuid, enc, qrDataUrl: `data:image/png;base64,${buf.toString("base64")}` };
    logger.info("auth", "二维码已获取，等待手机扫码");
    return this.qr;
  }

  /** 轮询扫码状态（每秒调用一次） */
  async pollQrLogin(): Promise<QrPollResult> {
    if (!this.qr) return { status: "error", message: "尚未发起扫码登录" };
    const { uuid, enc } = this.qr;
    const body = new URLSearchParams({ enc, uuid });
    let data: any;
    try {
      data = await cx.fetchJson(`${PASSPORT}/getauthstatus`, {
        method: "POST",
        body,
        headers: { Referer: `${PASSPORT}/login` },
      });
    } catch (e: any) {
      return { status: "error", message: String(e?.message || e) };
    }
    if (data?.status === true) {
      const user = await this.fetchUserInfo();
      this.qr = null;
      return user
        ? { status: "success", user }
        : { status: "error", message: "登录成功但获取用户信息失败" };
    }
    if (data?.type === "4") return { status: "scanned", nickname: data?.nickname };
    if (data?.type === "2") {
      this.qr = null;
      return { status: "expired" };
    }
    if (data?.type === "1") return { status: "error", message: "二维码校验失败，请重新获取" };
    return { status: "waiting" };
  }

  /** 账号密码登录 */
  async loginPassword(uname: string, password: string): Promise<UserAccount> {
    const body = new URLSearchParams({
      fid: "-1",
      uname: aesEncrypt(uname),
      password: aesEncrypt(password),
      refer: "https://i.chaoxing.com",
      t: "true",
      forbidotherlogin: "0",
      validate: "",
      doubleFactorLogin: "0",
      independentId: "0",
    });
    const res = await cx.fetchJson<any>(`${PASSPORT}/fanyalogin`, {
      method: "POST",
      body,
      headers: { Referer: `${PASSPORT}/login` },
    });
    if (res?.status !== true) {
      throw new Error(res?.msg2 || "登录失败，请检查账号密码");
    }
    logger.info("auth", "密码登录成功");
    const user = await this.fetchUserInfo();
    if (!user) throw new Error("登录成功但获取用户信息失败");
    return user;
  }

  /** 获取当前登录用户信息（同时也是登录态校验） */
  async fetchUserInfo(): Promise<UserAccount | null> {
    try {
      const data = await cx.fetchJson<any>(
        "https://sso.chaoxing.com/apis/login/userLogin4Uname.do",
        { headers: { Referer: "https://i.chaoxing.com/" } },
      );
      if (data?.result !== 1 || !data?.msg) return null;
      const uid = String(data.msg.puid || "");
      const fid = (await cx.getFid()) || "";
      return {
        uid,
        name: String(data.msg.name || data.msg.uname || ""),
        schoolname: String(data.msg.schoolname || ""),
        uname: String(data.msg.uname || ""),
        fid,
      };
    } catch (e: any) {
      logger.warn("auth", `获取用户信息失败: ${e?.message || e}`);
      return null;
    }
  }

  cancelQr(): void {
    this.qr = null;
  }
}

export const auth = new Auth();
