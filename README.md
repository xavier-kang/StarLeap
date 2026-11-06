# 星跃 StarLeap · 学习通章节自动学习助手（macOS）

> 把网课的时间还给自己的项目。星跃在你自己的账号上，以保守节奏自动完成学习通「章节」里的任务点：**视频、文档/PPT/PDF、图书阅读、章节测验**，全程可视化、可暂停、可审计。

## ✨ 功能

- **扫码登录**：应用内渲染二维码，手机学习通扫一扫即登录；也支持账号密码（AES 加密传输，本机不保存密码）。会话持久化，重启不用重登。
- **课程中心**：课程封面网格 → 章节树（每个章节显示任务点完成度进度条），按类型勾选入队（视频/文档/图书/测验）。
- **刷课引擎**：
  - 视频：三档模式（标准=先尝试直接完成、失败转心跳 / 稳妥=纯心跳模拟真实观看 / 极速=仅直接上报），心跳 30–70s 随机间隔 + 全局限流抖动，`enc` 签名与官方播放器一致
  - 文档/PDF/PPT：阅读完成上报
  - 章节测验：自动取题 → 题库（tikuAdapter 兼容 + 内置免费源）+ AI（OpenAI 兼容）双通道出答案 → **答题中心人工确认后提交**（默认；可切换全自动/仅参考）
- **答题中心**：逐题查看题干、选项、答案来源与置信度，可改答案、单题重答、仅保存不提交
- **风控保守设计**：请求限流+随机抖动、可选运行时段、403 验证码自动暂停并通知 → 内嵌浏览器人工过闸（不自动破解验证码）
- **macOS 原生集成**：菜单栏托盘启停、Dock 进度条与角标、系统通知、开机自启、深色模式跟随

## 📦 安装与运行

### 开发运行

```bash
# 需要 Node.js 18+（本机若无：见下方"安装 Node"）
npm install
npm start
```

### 打包 DMG

```bash
npm run dist
# 产物在 release/StarLeap-1.0.0-arm64.dmg
```

### 安装 Node（本机没有时）

```bash
mkdir -p ~/.local && cd /tmp
curl -LO https://nodejs.org/dist/v22.23.4/node-v22.23.4-darwin-arm64.tar.xz
tar -xJf node-v22.23.4-darwin-arm64.tar.xz -C ~/.local
mv ~/.local/node-v22.23.4-darwin-arm64 ~/.local/node
echo 'export PATH="$HOME/.local/node/bin:$PATH"' >> ~/.zshrc
```

## ⚠️ 首次打开（未公证应用）

本应用为 ad-hoc 签名（无开发者证书），首次打开若提示"已损坏"或"无法验证开发者"：

```bash
xattr -cr /Applications/StarLeap.app
```

然后正常打开即可。

## 🚀 使用流程

1. 启动星跃 → 手机学习通扫码登录
2. 「课程中心」→ 点课程卡片 → 勾选章节（可按任务点类型筛选）→「加入队列」
3. 顶栏「启动刷课」→「任务队列」看实时进度与日志
4. 刷到章节测验时，到「答题中心」核对答案 → 「确认并提交」（默认策略）
5. 弹出风控验证时：系统通知 → 「辅助浏览器」完成滑块 → 顶栏「继续」

## ⚠️ 风险声明（必读）

- 自动化使用学习通**违反其用户协议，也可能违反所在学校校规**，可能面临任务进度清零、成绩无效、账号限制等后果
- 请仅用于**本人账号**；星跃默认保守频率，但不承诺零风险
- 不自动破解验证码；**正式考试不做自动作答/提交**（可在辅助浏览器中人工完成）
- 本项目仅供学习研究，请勿商用

## 🏗️ 技术架构

```
starleap/
├── src/main/            # Electron 主进程 (TypeScript)
│   ├── main.ts          # 窗口/托盘/菜单/Dock
│   ├── ipc.ts           # IPC 通道 + 内嵌浏览器(WebContentsView)
│   ├── store.ts         # 配置/统计/答卷持久化 (userData/data/*.json)
│   └── cx/
│       ├── client.ts    # HTTP 引擎: persist:chaoxing 会话 + 限流 + 风控检测
│       ├── auth.ts      # 扫码/密码登录 (AES-CBC) + 会话校验
│       ├── courses.ts   # 课程/章节/任务卡片解析 (mArg)
│       ├── video.ts     # 视频心跳引擎 (enc=MD5 签名, 403 自愈)
│       ├── document.ts  # 文档/阅读/图书上报
│       ├── quiz.ts      # 测验取题/解析/提交 (pyFlag 保存/提交)
│       ├── tiku.ts      # 题库(tikuAdapter/icodef) + AI(OpenAI 兼容) + MD5 缓存
│       └── queue.ts     # 任务队列: 并发/暂停/时段/风控联动
└── src/renderer/        # 渲染层 (原生 HTML/CSS/ES Modules, 无框架)
```

- HTTP 走 Electron `session.fromPartition('persist:chaoxing')`：cookie 持久化、真实 Chromium TLS 指纹、与内嵌浏览器共享登录态
- 协议细节（enc 算法、心跳参数、测验接口）经三开源项目交叉验证 + 真实账号实测
