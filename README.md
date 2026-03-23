# OpenSlides

AI-powered presentation generator using reveal.js. Supports Gemini, Claude, and GPT via any OpenAI-compatible API proxy.

## Features

- Generate reveal.js presentations from text prompts or uploaded documents
- Multi-provider support: Gemini, Claude, GPT
- Prompt caching for reduced API costs (automatic for Gemini/GPT, explicit for Claude)
- Inline text editing — click any text in the preview to edit directly
- Diff-based editing — AI outputs only the changes, saving output tokens
- Version control with auto-save and manual snapshots
- File uploads: images, PDFs, text, CSV, markdown
- Overflow detection with one-click AI fix
- Code editor with syntax highlighting
- Export and present directly in browser
- Bilingual UI (English / Chinese)
- All data stored locally in the `projects/` folder

## Quick Start

```bash
npm install
npm run dev
```

This starts both the Vite dev server (port 5173) and the Express API server (port 3001).

Open http://localhost:5173 and configure your API settings (provider, API key, base URL) in the settings panel.

## Production

```bash
npm run start
```

Builds the frontend and starts the Express server on port 3001 (configurable via `PORT` env var).

## Configuration

Click the gear icon in the top-right corner to configure:

| Setting | Description |
|---------|-------------|
| Provider | Gemini, Claude, or GPT |
| Base URL | Your API proxy endpoint (e.g. `https://aihubmix.com`) |
| API Key | Your API key for the proxy |
| Model | Model name (leave empty for default) |

Settings are saved to `settings.json` and persist across sessions.

## Project Structure

```
OpenSlides/
├── server.js              # Express server (API proxy + file storage)
├── settings.json          # API configuration (gitignored)
├── projects/              # Project data storage (gitignored)
│   └── {projectId}/
│       ├── info.json      # Version history
│       ├── files.json     # Uploaded files
│       └── states/        # Saved states (HTML + chat)
├── src/
│   ├── components/        # React UI components
│   ├── lib/
│   │   ├── ai.ts          # Multi-provider AI client
│   │   ├── versionControl.ts
│   │   └── injectInlineEditor.ts
│   ├── types/             # TypeScript types
│   ├── i18n/              # Translations
│   ├── contexts/          # React contexts
│   └── hooks/             # Custom hooks
├── vite.config.js
└── package.json
```

## Caching

| Provider | Method | Savings |
|----------|--------|---------|
| Gemini | Automatic (repeat same prefix) | Cached tokens at 25% input price |
| Claude | Explicit `cache_control` on system prompt | Cache reads at 10% input price |
| GPT | Automatic (1024+ token prefix) | Cache reads at 25-50% input price |

## License

MIT
