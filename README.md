<div align="center">

<img src="build/icon.png" alt="SuchMusic Icon" width="128">

## SuchMusic 社区版（Android）

**基于 [SuchMusic-NG](https://github.com/Enzymeym/SuchMusic-NG)（PC 版）移植的安卓移动端**

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-red.svg)](./LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Android-green.svg)]()
[![Vue 3](https://img.shields.io/badge/Vue-3.x-4FC68D.svg)]()
[![Capacitor](https://img.shields.io/badge/Capacitor-8.x-119EFF.svg)]()

</div>

---

## ⚖️ 开源协议与版权声明（必读）

本项目是 **[SuchMusic-NG](https://github.com/Enzymeym/SuchMusic-NG)**（作者：**酶游明 / [@Enzymeym](https://github.com/Enzymeym)**）的**衍生作品**，
遵循原项目协议，同样以 **[GNU AGPL-3.0](./LICENSE)** 开源。

- 完整保留原项目的版权与许可信息，详见 [NOTICE](./NOTICE)
- 原项目地址：<https://github.com/Enzymeym/SuchMusic-NG>
- 安卓社区版作者：**柠檬桶 / [@LJT-YTWH](https://github.com/LJT-YTWH)**
- 依据 AGPL-3.0：任何修改、分发或衍生项目**必须同样采用 AGPL-3.0**，并提供完整源代码

> **二次开发请勿移除程序内的原项目信息与版权声明，可另行添加二开作者信息。**

---

## ✨ 简介

将原 Electron 桌面版完整移植到 Android 平台（Capacitor 8 + WebView），在保留原项目
插件化音源、播放器、歌词等能力的基础上，新增：

- 📱 **移动端界面**：竖屏 / 横屏双布局，全屏播放页、手势切页、迷你播放条
- 🎤 **逐字歌词生成**：基于音频强制对齐（V3 / V4 两套算法，纯 DSP + 动态规划），
  将逐行 LRC 转换为逐字卡拉 OK 歌词，支持翻译行与词间空格保留
- 🎛 **逐字歌词管理**：开关、自动生成、生成时机、生成完后播放位置、
  算法选择；生成文件持久化于应用私有目录，支持在设置页批量删除
- 🎚 **播放增强**：均衡器、响度均衡、变速、声像/立体声扩展、人声消除等
- 🌐 **插件化音源**：沿用原项目的落雪插件体系，支持用户自配音源

---

## 🧱 技术栈

| 层 | 技术 |
| --- | --- |
| 渲染层 | Vue 3 + TypeScript + Vite + Naive UI |
| 移动端容器 | Capacitor 8（Android） |
| 音频 | Web Audio API（解码 / 处理 / 播放） |
| 歌词 | AMLL 歌词组件 + 自研逐字对齐算法 |
| 桌面端 | Electron（保留原项目桌面端代码） |

---

## 📦 构建（Android）

环境要求：Node.js ≥ 20、JDK 21、Android SDK（compileSdk 36）。

```bash
# 1. 安装依赖
npm install

# 2. 构建移动端 Web 资源
NODE_OPTIONS=--max-old-space-size=1536 npx vite build --config vite.config.mobile.ts

# 3. 同步到 Android 工程
npx cap sync android

# 4. 打包
cd android && ./gradlew assembleRelease
```

产物：`android/app/build/outputs/apk/release/app-release.apk`

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

---

## 📁 目录结构（移动端相关）

```
├── android/                       # Capacitor Android 工程
├── src/renderer/src/mobile/       # 移动端界面（播放页、设置、组件）
├── src/renderer/src/platform/     # 平台桥接（移动端 IPC / 文件 / 原生能力）
├── src/renderer/src/utils/karaoke/# 逐字歌词算法（V3/V4）与存储管理
├── vite.config.mobile.ts          # 移动端构建配置
├── capacitor.config.ts            # Capacitor 配置
└── README-PC.md                   # 原项目（PC 版）README 存档
```

---

## 👥 开发者

- **酶游明** ([@Enzymeym](https://github.com/Enzymeym)) — 原项目 SuchMusic-NG（PC 版）：插件系统、音频系统、UI 设计/开发
- **柠檬桶** ([@LJT-YTWH](https://github.com/LJT-YTWH)) — 安卓社区版：移动端移植、逐字歌词算法移植与功能开发

---

## 📄 开源协议

[GNU AGPL-3.0](./LICENSE)（与原项目一致）。分发或修改本项目的衍生作品必须同样以 AGPL-3.0 开源。

---

## 🙏 致谢

- [SuchMusic-NG](https://github.com/Enzymeym/SuchMusic-NG) — 原项目
- [AMLL](https://github.com/amll-dev/applemusic-like-lyrics) — 歌词与流体背景组件
- [Naive UI](https://www.naiveui.com) — Vue 3 组件库
- [Capacitor](https://capacitorjs.com) — 移动端容器
- [Electron](https://www.electronjs.org) — 桌面端框架

---

## ⚠️ 免责声明

本应用仅提供音乐搜索与播放工具，不存储任何版权音乐内容。所有音源均来自用户自行配置的
插件与公开接口，请于下载后 24 小时内删除相关内容，支持正版音乐。
