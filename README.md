<div align="center">

<img src="build/icon.png" alt="SuchMusic Icon" width="128">

## SuchMusic 社区版（Android）

**基于 [SuchMusic-NG](https://github.com/Enzymeym/SuchMusic-NG)（PC 版）移植的安卓移动端**
**An Android port of [SuchMusic-NG](https://github.com/Enzymeym/SuchMusic-NG) (PC edition)**

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-red.svg)](./LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Android-green.svg)]()
[![Vue 3](https://img.shields.io/badge/Vue-3.x-4FC68D.svg)]()
[![Capacitor](https://img.shields.io/badge/Capacitor-8.x-119EFF.svg)]()

**简体中文** ｜ [English](#english)

</div>

---

# 简体中文

## ⚖️ 开源协议与版权声明（必读）

本项目是 **[SuchMusic-NG](https://github.com/Enzymeym/SuchMusic-NG)**（作者：**酶游明 / [@Enzymeym](https://github.com/Enzymeym)**）的**衍生作品**，
遵循原项目协议，同样以 **[GNU AGPL-3.0](./LICENSE)** 开源。

- 完整保留原项目的版权与许可信息，详见 [NOTICE](./NOTICE)
- 原项目地址：<https://github.com/Enzymeym/SuchMusic-NG>
- 安卓社区版作者：**柠檬桶 / [@LJT-YTWH](https://github.com/LJT-YTWH)**
- 依据 AGPL-3.0：任何修改、分发或衍生项目**必须同样采用 AGPL-3.0**，并提供完整源代码

> **二次开发请勿移除程序内的原项目信息与版权声明，可另行添加二开作者信息。**

## ✨ 简介

将原 Electron 桌面版完整移植到 Android 平台（Capacitor 8 + WebView），在保留原项目
插件化音源、播放器、歌词等能力的基础上，新增：

- 📱 **移动端界面**：竖屏 / 横屏双布局、全屏播放页（上下滑动开关）、手势切页
  - 竖屏：5 槽位毛玻璃胶囊底栏（首页 / 广场 / 中央圆形封面 / 本地 / 我的），点封面横向弹簧展开音乐控制面板
  - 横屏：左侧图标胶囊导航（首页 / 广场 / 搜索 / 最近播放 / 本地 / 我的）+ 独立圆形封面，点击后自左向右展开音乐控制胶囊
  - 支持浅色 / 深色主题，弹层统一为「从按钮长成卡片」的动画
- 🎤 **逐字歌词生成**：基于音频强制对齐（V3 / V4 两套算法，纯 DSP + 动态规划），
  将逐行 LRC 转换为逐字卡拉 OK 歌词，支持翻译行与词间空格保留
- 🎛 **逐字歌词管理**：开关、自动生成、生成时机、生成完后播放位置、
  算法选择；生成文件持久化于应用私有目录，支持在设置页批量删除
- 🤖 **AI 歌词翻译**：调用讯飞星火 `spark-x2.5-1.7b`（关闭思考）逐行翻译，
  可填写歌曲背景与翻译要求；已有逐字歌词时可选择重新生成或直接追加译文
- 💾 **歌曲下载**：音频文件 / 歌词 / AI 译文 / 逐字歌词可选，通过系统目录选择器
  自由选择保存位置，导出音频自动写入标题、歌手、专辑与封面标签
- 🎚 **播放增强**：均衡器、响度均衡、变速、声像/立体声扩展、人声消除等
- 🖼 **横屏 Cover Flow**：3D 封面流浏览（拖拽 / 惯性 / 滚轮 / 拖动条 / 方向键 / 环境光 / 倒影），
  支持我的歌单、歌单广场、排行榜、本地音乐（按专辑聚合）、最近播放与歌单详情
- 🌐 **插件化音源**：沿用原项目的落雪插件体系，支持用户自配音源
- ⚡ **性能优化**：长列表虚拟滚动、Cover Flow 虚拟化与封面预加载、进度条 / 歌词行拆分渲染、
  歌词布局缓存 + 二分查找、纯合成层动画

## 📲 下载安装

前往 [Releases](https://github.com/LJT-YTWH/SuchMusic-NG-Mobile/releases) 下载最新 APK：

- 最新：`SuchMusic-1.5.2-android.apk`（versionName 1.5.2 / versionCode 8）
- 系统要求：Android 7.0（API 24）及以上
- 使用同一个社区版签名，可直接覆盖安装旧版本；签名不一致时会安装失败

### 版本历史

| 版本 | 说明 |
| --- | --- |
| **v1.5.2** | 1.5 系列完整更新：底栏胶囊 UI、横屏 Cover Flow、AI 歌词翻译、歌曲下载、浅色模式适配、横屏界面重做（1.5.0 / 1.5.1 的改动一并包含；1.4.0 未单独发布，内容也已并入本版本） |
| v1.3.1 | 本地歌单增强、横屏抽屉修复、逐字歌词生成时机修复、通知栏封面 |
| v1.3 | 首个安卓社区版：移动端移植 + 逐字歌词 |

## 🧱 技术栈

| 层 | 技术 |
| --- | --- |
| 渲染层 | Vue 3 + TypeScript + Vite + Naive UI |
| 移动端容器 | Capacitor 8（Android） |
| 音频 | Web Audio API（解码 / 处理 / 播放） |
| 歌词 | AMLL 歌词组件 + 自研逐字对齐算法 |
| 桌面端 | Electron（保留原项目桌面端代码） |

## 📦 构建（Android）

环境要求：Node.js ≥ 20、JDK 21、Android SDK（compileSdk 36）。

```bash
# 1. 安装依赖
npm install

# 2. 构建移动端 Web 资源（内存紧张时关闭压缩并限制 Node 堆，见下方说明）
NODE_OPTIONS="--max-old-space-size=1280 --max-semi-space-size=32" \
  node node_modules/vite/bin/vite.js build --config vite.config.mobile.ts --minify false

# 3. 同步到 Android 工程（无插件变更时用 cap copy 更快）
npx cap copy android

# 4. 打包（release 已通过 keystore.properties 配置签名时可覆盖安装）
cd android && ./gradlew assembleRelease --no-daemon
```

产物：`android/app/build/outputs/apk/release/app-release.apk`

> 打包前建议先 `cd android && ./gradlew --stop` 停掉闲置的 Gradle 守护进程。
> 默认压缩（minify=true）在内存受限环境中容易被 OOM Kill，此时请保留 `--minify false`。
>
> AI 歌词翻译需要讯飞星火 API Key：在仓库根目录新建 `.env.local` 写入
> `VITE_SPARK_API_KEY=ak-xxxx`（该文件已被 `.gitignore` 忽略，不会入库）；未配置时仅该功能不可用。

### 关于签名

签名密钥与密码**不会随源码发布**。如需产出可覆盖安装的正式包：

1. 将你的 keystore 放到 `android/app/suchmusic-release.keystore`
2. 在 `android/keystore.properties` 填写：

```properties
storeFile=suchmusic-release.keystore
storePassword=你的密码
keyAlias=你的别名
keyPassword=你的密码
```

未提供该文件时，构建产出**未签名**的 release 包（仅用于调试）。

> 内存受限环境（如 4GB 容器）构建注意事项见 [构建内存限制问题排查记录](构建内存限制问题排查记录.md)。

## 📁 目录结构（移动端相关）

```
├── android/                        # Capacitor Android 工程
├── src/renderer/src/mobile/
│   ├── components/                 # 底栏、侧栏、Cover Flow、跑马灯、卡片弹层等组件
│   ├── composables/                # 横屏判定、浏览方式、虚拟滚动、弹层原点等组合式函数
│   ├── views/                      # 首页 / 广场 / 本地 / 我的 / 播放页 / 设置页
│   └── theme.css                   # 移动端主题令牌（深色 / 浅色）
├── src/renderer/src/platform/      # 平台桥接（移动端 IPC / 文件 / 原生能力）
├── src/renderer/src/utils/karaoke/ # 逐字歌词算法（V3/V4）与存储管理
├── src/renderer/src/utils/aiLyric/ # AI 歌词翻译（星火）与译文存储
├── src/renderer/src/utils/export/  # 歌曲 / 歌词导出（SAF 目录写入、音频标签）
├── vite.config.mobile.ts           # 移动端构建配置
├── capacitor.config.ts             # Capacitor 配置
└── README-PC.md                    # 原项目（PC 版）README 存档
```

## 👥 开发者

- **酶游明** ([@Enzymeym](https://github.com/Enzymeym)) — 原项目 SuchMusic-NG（PC 版）：插件系统、音频系统、UI 设计/开发
- **柠檬桶** ([@LJT-YTWH](https://github.com/LJT-YTWH)) — 安卓社区版：移动端移植、逐字歌词算法移植与功能开发

## 📄 开源协议

[GNU AGPL-3.0](./LICENSE)（与原项目一致）。分发或修改本项目的衍生作品必须同样以 AGPL-3.0 开源。

## 🙏 致谢

- [SuchMusic-NG](https://github.com/Enzymeym/SuchMusic-NG) — 原项目
- [AMLL](https://github.com/amll-dev/applemusic-like-lyrics) — 歌词与流体背景组件
- [Naive UI](https://www.naiveui.com) — Vue 3 组件库
- [Capacitor](https://capacitorjs.com) — 移动端容器
- [Electron](https://www.electronjs.org) — 桌面端框架

## ⚠️ 免责声明

本应用仅提供音乐搜索与播放工具，不存储任何版权音乐内容。所有音源均来自用户自行配置的
插件与公开接口，请于下载后 24 小时内删除相关内容，支持正版音乐。

---

# English

## ⚖️ License & Copyright Notice (Read First)

This project is a **derivative work** of **[SuchMusic-NG](https://github.com/Enzymeym/SuchMusic-NG)**
by **酶游明 / [@Enzymeym](https://github.com/Enzymeym)**, and is released under the same
**[GNU AGPL-3.0](./LICENSE)** license.

- All original copyright and license notices are preserved — see [NOTICE](./NOTICE)
- Original project: <https://github.com/Enzymeym/SuchMusic-NG>
- Android Community Edition author: **柠檬桶 (lemon bucket) / [@LJT-YTWH](https://github.com/LJT-YTWH)**
- Under AGPL-3.0, any modification, distribution or derivative work **must also be licensed
  under AGPL-3.0** and provide the complete source code

> **Do not remove the original project information or copyright notices. You may add your own
> attribution as a secondary developer.**

## ✨ Introduction

A full port of the original Electron desktop app to Android (Capacitor 8 + WebView).
While keeping the original plugin-based music sources, player and lyric capabilities,
it adds:

- 📱 **Mobile UI** — portrait & landscape layouts, full-screen player page (swipe up/down to
  open/close), gesture paging
  - Portrait: 5-slot frosted-glass dock (Home / Square / center cover / Local / Mine); tapping
    the cover expands the music control panel sideways with a spring animation
  - Landscape: icon-only capsule navigation on the left (Home / Square / Search / Recently
    played / Local / Mine) plus a standalone circular cover that expands a control capsule
    left-to-right when tapped
  - Light & dark themes; every sheet morphs out of the button that triggered it
- 🎤 **Word-by-word lyric generation** — forced alignment on the audio track (V3 / V4 algorithms,
  pure DSP + dynamic programming) that converts line-level LRC into karaoke-style word-level
  lyrics, preserving translation lines and inter-word spaces
- 🎛 **Karaoke lyric management** — enable/disable, auto-generation, generation timing,
  playback position after generation, algorithm selection; generated files are stored in the
  app's private directory and can be batch-deleted in Settings
- 🤖 **AI lyric translation** — line-by-line translation via iFlytek Spark `spark-x2.5-1.7b`
  (thinking disabled), with optional song background / requirements; when karaoke lyrics already
  exist you can regenerate them or merge the translations in place
- 💾 **Song export** — pick audio / lyrics / AI translation / karaoke lyrics, choose any folder
  through the system directory picker, and exported audio gets title, artist, album and cover
  tags written in
- 🎚 **Playback enhancements** — equalizer, loudness normalization, speed control,
  stereo/balance adjustments, vocal removal, etc.
- 🖼 **Landscape Cover Flow** — 3D cover browsing (drag / inertia / wheel / slider / arrow keys /
  ambient light / reflections) for playlists, the playlist square, toplists, local music
  (grouped by album), recently played and playlist details
- 🌐 **Plugin-based music sources** — inherits the original Snowdrop plugin system
- ⚡ **Performance** — list virtualization, Cover Flow virtualization with cover preloading,
  split rendering for the progress bar and lyric lines, cached lyric layout with binary search,
  compositor-only animations

## 📲 Download & Install

Get the latest APK from [Releases](https://github.com/LJT-YTWH/SuchMusic-NG-Mobile/releases):

- Latest: `SuchMusic-1.5.2-android.apk` (versionName 1.5.2 / versionCode 8)
- Requires Android 7.0 (API 24) or above
- Signed with the same community key, so it installs over older versions directly; a different
  signing key will be rejected

### Version history

| Version | Summary |
| --- | --- |
| **v1.5.2** | Full 1.5.x line: dock capsule UI, landscape Cover Flow, AI lyric translation, song export, light theme support, landscape UI overhaul (includes 1.5.0 / 1.5.1; 1.4.0 was never released separately — its changes are included too) |
| v1.3.1 | Local playlist improvements, landscape drawer fixes, karaoke generation timing fix, notification cover art |
| v1.3 | First Android community edition: mobile port + karaoke lyrics |

## 🧱 Tech Stack

| Layer | Technology |
| --- | --- |
| Rendering | Vue 3 + TypeScript + Vite + Naive UI |
| Mobile runtime | Capacitor 8 (Android) |
| Audio | Web Audio API (decode / process / playback) |
| Lyrics | AMLL lyric components + in-house forced-alignment algorithms |
| Desktop | Electron (original desktop code preserved) |

## 📦 Build (Android)

Requirements: Node.js ≥ 20, JDK 21, Android SDK (compileSdk 36).

```bash
# 1. Install dependencies
npm install

# 2. Build mobile web assets (disable minify and cap the Node heap on small machines)
NODE_OPTIONS="--max-old-space-size=1280 --max-semi-space-size=32" \
  node node_modules/vite/bin/vite.js build --config vite.config.mobile.ts --minify false

# 3. Sync to the Android project (cap copy is faster when no plugin changed)
npx cap copy android

# 4. Build the APK (signing is picked up from keystore.properties)
cd android && ./gradlew assembleRelease --no-daemon
```

Output: `android/app/build/outputs/apk/release/app-release.apk`

> Run `cd android && ./gradlew --stop` before building to release an idle Gradle daemon.
> The default minifier (minify=true) tends to be OOM-killed on memory-constrained machines;
> keep `--minify false` there.
>
> AI lyric translation needs an iFlytek Spark API key: create `.env.local` in the repository root
> with `VITE_SPARK_API_KEY=ak-xxxx` (the file is git-ignored); without it only that feature is
> unavailable.

### Signing

The signing keystore and passwords are **not included in this repository**. To produce an
upgradable release build:

1. Put your keystore at `android/app/suchmusic-release.keystore`
2. Fill in `android/keystore.properties`:

```properties
storeFile=suchmusic-release.keystore
storePassword=your_password
keyAlias=your_alias
keyPassword=your_password
```

Without this file the build produces an **unsigned** release APK (debug use only).

> For building in memory-constrained environments (e.g. a 4 GB container), see
> [build memory troubleshooting notes](构建内存限制问题排查记录.md).

## 📁 Project Layout (mobile-related)

```
├── android/                        # Capacitor Android project
├── src/renderer/src/mobile/
│   ├── components/                 # Dock, side nav, Cover Flow, marquee, card sheets
│   ├── composables/                # Landscape detection, layout mode, virtual rows, morph origin
│   ├── views/                      # Home / Square / Local / Playlists / Player / Settings
│   └── theme.css                   # Mobile theme tokens (dark / light)
├── src/renderer/src/platform/      # Platform bridge (mobile IPC / files / native)
├── src/renderer/src/utils/karaoke/ # Karaoke algorithms (V3/V4) and storage management
├── src/renderer/src/utils/aiLyric/ # AI lyric translation (Spark) and storage
├── src/renderer/src/utils/export/  # Song / lyric export (SAF writes, audio tags)
├── vite.config.mobile.ts           # Mobile build config
├── capacitor.config.ts             # Capacitor config
└── README-PC.md                    # Archived README of the original PC project
```

## 👥 Authors

- **酶游明** ([@Enzymeym](https://github.com/Enzymeym)) — original SuchMusic-NG (PC): plugin
  system, audio system, UI design & development
- **柠檬桶 / lemon bucket** ([@LJT-YTWH](https://github.com/LJT-YTWH)) — Android Community
  Edition: mobile port, karaoke algorithm port and feature development

## 📄 License

[GNU AGPL-3.0](./LICENSE), same as the original project. Any derivative work must also be
released under AGPL-3.0.

## 🙏 Acknowledgements

- [SuchMusic-NG](https://github.com/Enzymeym/SuchMusic-NG) — original project
- [AMLL](https://github.com/amll-dev/applemusic-like-lyrics) — lyric & fluid background components
- [Naive UI](https://www.naiveui.com) — Vue 3 component library
- [Capacitor](https://capacitorjs.com) — mobile runtime
- [Electron](https://www.electronjs.org) — desktop framework

## ⚠️ Disclaimer

This application is only a music search and playback tool. It does not store or distribute any
copyrighted music. All audio sources come from user-configured plugins and public APIs. Please
comply with local laws and support the official releases.
