# OpenSlides

OpenSlides 是一个本地优先的 AI 演示文稿工作台，用于创建和编辑 `reveal.js` 幻灯片。你可以从提示词、上传资料、网页搜索和数据分析生成演示稿，然后在可视化编辑器或 HTML 代码视图中继续修改。

[English Version](./README.md)

## 演示

浏览器演示：

[PIRA-Bench: Proactive GUI Agents](https://yuxiangchai.github.io/OpenSlides/index.html)

这个演示稿由 PIRA-Bench 论文 PDF 和两张论文图片生成。

## 安装

环境要求：

- [nvm](https://github.com/nvm-sh/nvm)，用于安装和管理 Node.js
- 通过 nvm 安装 Node.js 18+；npm 会随 Node.js 一起安装
- 可选：[uv](https://docs.astral.sh/uv/getting-started/installation/)，如果要使用数据分析 Agent，需要安装它，因为分析脚本会通过 `uv run --script` 在本地运行

使用 nvm 的示例：

```bash
nvm install node
node --version
npm --version
```

安装依赖：

```bash
npm install
```

## 运行

启动开发模式：

```bash
npm run dev
```

默认会启动：

- 前端：`http://localhost:5173`
- 后端：`http://localhost:3001`

构建生产版本：

```bash
npm run build
```

运行生产服务：

```bash
npm run start
```

后端会优先使用 `PORT` 环境变量，否则默认使用 `3001`。

## 基本使用

1. 打开应用并创建项目。
2. 在 Settings 中配置 AI Provider。
3. 按需上传资料，例如 PDF、图片、Markdown、文本、CSV、Excel 或代码文件。
4. 在聊天面板中让 OpenSlides 生成或修改演示稿。
5. 在预览中直接编辑文字，或切换到代码视图完整控制 HTML/CSS。
6. 保存版本、在浏览器中演示，或下载独立 HTML 文件。

## 支持的 Provider

OpenSlides 支持原生接口和 OpenAI 兼容接口：

| Provider | 接入方式 |
| --- | --- |
| Gemini | 原生 Gemini API |
| Claude | 原生 Anthropic API |
| OpenAI | 原生 OpenAI API；使用自定义 Base URL 时可作为 OpenAI 兼容模式 |
| Kimi Coding | OpenAI 兼容 Chat Completions |
| GLM Coding | OpenAI 兼容 Chat Completions |
| Qwen Coding | OpenAI 兼容 Chat Completions |
| MiniMax | OpenAI 兼容 Chat Completions |
| OpenRouter | OpenAI 兼容 Chat Completions |

Provider 设置在应用内 Settings 面板中配置。每个 Provider 都可以单独设置 API Key、Base URL 和模型名称。项目也可以记住自己选择的 Provider。

## 支持的 Agent

OpenSlides 在主幻灯片生成器周围使用了几个内部 Agent：

| Agent | 功能 |
| --- | --- |
| Planning Agent | 判断当前请求是否需要保存过的上下文、网页搜索或数据分析。即使没有 Tavily API Key，它也会继续规划，只是跳过网页搜索。 |
| Search Agent | 在配置 Tavily API Key 后执行网页搜索，并保存有用的搜索上下文供后续对话复用。 |
| Data Analytics Agent | 检查上传的 CSV/XLS/XLSX 文件，生成并运行本地 Python 分析脚本，然后把精简后的表格、图表和洞察交给幻灯片生成器。 |
| Generation Agent | 根据用户提示、项目上下文、上传资料引用、搜索结果和分析结果生成或修改 `reveal.js` 演示稿。 |

原始数据文件不会作为普通上下文直接发送给 Generation Agent。Data Analytics Agent 会先生成摘要结果，再把结果传给生成模型。

## 资料文件

Sources 面板支持文件选择器上传、拖拽上传和剪贴板粘贴。常见资料类型可以在应用内预览：

| 类型 | 示例 |
| --- | --- |
| 图片 | `.png`、`.jpg`、`.jpeg`、`.svg` |
| PDF | `.pdf` |
| 文本和 Markdown | `.txt`、`.md` |
| 表格 | `.csv`、`.xls`、`.xlsx` |
| 代码 | `.py`、`.sh` |

上传文件会保存在项目目录下的 `projects/<project>/assets/`。

## 演示快捷键

| 按键 | 功能 |
| --- | --- |
| `F` | 切换全屏 |
| `O` / `Esc` | 切换幻灯片总览 |
| `S` | 打开演讲者备注 |
| `Space` | 暂停或恢复自动播放 |
| 方向键 | 切换幻灯片 |
| `Home` / `End` | 跳到第一页或最后一页 |
| `B` / `.` | 黑屏 |

## 开发

常用命令：

```bash
npm run dev
npm run build
npm run start
npm run preview
```

项目数据保存在本地 `projects/` 目录下，包括上传文件、保存的幻灯片状态、聊天记录和数据分析产物。

## 致谢

OpenSlides 使用 [reveal.js](https://revealjs.com/) 作为演示引擎。

感谢 [ryanbbrown/revealjs-skill](https://github.com/ryanbbrown/revealjs-skill) 提供的 Reveal.js 工作流启发。
