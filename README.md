# OpenSlides

OpenSlides is a local-first AI workspace for creating and editing `reveal.js` presentations. It lets you generate slides from prompts, uploaded sources, web search, and data analysis, then refine the deck in a visual editor or raw HTML view.

[中文版 Readme](./README.zh-CN.md)

## Demo

Try the browser demo:

[PIRA-Bench: Proactive GUI Agents](https://yuxiangchai.github.io/OpenSlides/index.html)

The demo deck was generated from the PIRA-Bench paper PDF plus two paper images.

## Installation

Requirements:

- [nvm](https://github.com/nvm-sh/nvm) for installing and managing Node.js
- Node.js 18+ installed through nvm; npm is included with Node.js
- Optional: [uv](https://docs.astral.sh/uv/getting-started/installation/) if you want to use the data analytics agent, because analysis scripts run locally through `uv run --script`

Example with nvm:

```bash
nvm install node
node --version
npm --version
```

Install dependencies:

```bash
npm install
```

## Run

Start the development app:

```bash
npm run dev
```

This starts:

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:3001`

Build for production:

```bash
npm run build
```

Run the production server:

```bash
npm run start
```

The backend uses `PORT` if provided, otherwise it defaults to `3001`.

## Basic Usage

1. Open the app and create a project.
2. Open Settings and configure an AI provider.
3. Upload source files if needed, such as PDFs, images, Markdown, text, CSV, Excel, or code files.
4. Ask the chat panel to generate or revise a presentation.
5. Edit text directly in the preview, or switch to code view for full HTML/CSS control.
6. Save versions, present in the browser, or download the deck as standalone HTML.

## Supported Providers

OpenSlides supports native and OpenAI-compatible providers:

| Provider | Integration |
| --- | --- |
| Gemini | Native Gemini API |
| Claude | Native Anthropic API |
| OpenAI | Native OpenAI API, or OpenAI-compatible mode when using a custom base URL |
| Kimi Coding | OpenAI-compatible chat completions |
| GLM Coding | OpenAI-compatible chat completions |
| Qwen Coding | OpenAI-compatible chat completions |
| MiniMax | OpenAI-compatible chat completions |
| OpenRouter | OpenAI-compatible chat completions |

Settings are configured from the in-app Settings panel. Each provider can have its own API key, base URL, and model name. Projects can also remember their selected provider.

## Supported Agents

OpenSlides uses several internal agents around the main slide generator:

| Agent | What it does |
| --- | --- |
| Planning agent | Decides whether the request needs saved context, web search, or data analysis before generation. It still works without Tavily; it simply skips web search. |
| Search agent | Uses Tavily when a Tavily API key is configured, then saves useful search context for later turns. |
| Data analytics agent | Inspects uploaded CSV/XLS/XLSX files, generates and runs a local Python analysis script, and passes compact tables, charts, and insights to the slide generator. |
| Generation agent | Creates or edits the `reveal.js` deck using the user prompt, selected project context, uploaded source references, and analytics/search results. |

Raw data files are not sent directly to the generation agent as normal context. The analytics agent sends summarized results instead.

## Source Files

The Sources panel supports file picker upload, drag-and-drop, and clipboard paste. It can preview common source types inside the app:

| Type | Examples |
| --- | --- |
| Images | `.png`, `.jpg`, `.jpeg`, `.svg` |
| PDF | `.pdf` |
| Text and Markdown | `.txt`, `.md` |
| Tables | `.csv`, `.xls`, `.xlsx` |
| Code | `.py`, `.sh` |

Uploaded files are stored under the project folder in `projects/<project>/assets/`.

## Presentation Shortcuts

| Key | Action |
| --- | --- |
| `F` | Toggle fullscreen |
| `O` / `Esc` | Toggle slide overview |
| `S` | Open speaker notes |
| `Space` | Pause or resume auto-play |
| Arrow keys | Navigate slides |
| `Home` / `End` | Jump to first or last slide |
| `B` / `.` | Black out the screen |

## Development

Useful commands:

```bash
npm run dev
npm run build
npm run start
npm run preview
```

Project data is stored locally under `projects/`, including uploaded files, saved slide states, chat history, and analytics artifacts.

## Acknowledgements

OpenSlides uses [reveal.js](https://revealjs.com/) as the presentation engine.

Thanks to [ryanbbrown/revealjs-skill](https://github.com/ryanbbrown/revealjs-skill) for Reveal.js workflow inspiration.
