/**
 * 启动最早期：统一 userData 目录
 * 开发模式(npm start)与打包版使用同一个数据目录（登录态/配置/统计共用），
 * 并自动迁移旧目录 "starleap" 的数据。
 * 注意：本模块必须在其它模块之前 import（它们在构造时就读取 userData 路径）。
 */
import * as fs from "fs";
import * as path from "path";
import { app } from "electron";

const appData = app.getPath("appData");
const newUserData = path.join(appData, "StarLeap");
const legacyUserData = path.join(appData, "starleap");

try {
  if (!fs.existsSync(newUserData) && fs.existsSync(legacyUserData)) {
    fs.cpSync(legacyUserData, newUserData, { recursive: true });
  }
} catch {
  // 迁移失败则继续用默认目录（最多要求重新扫码）
}
app.setPath("userData", newUserData);
