# ApiSpecProbe

## Run locally

From this folder, start the Python backend:

```sh
npm run dev:backend
```

In a second terminal, start React:

```sh
npm run dev
```

Open the URL Vite prints (usually http://localhost:5173). Both terminals must stay running. Vite forwards `/api` requests to FastAPI on port 8787.

Put local  `GEMINI_API_KEY` values in `.dev.vars`. This file is ignored by Git. A Gemini key is required for generating probes, but not for loading the target configuration. Local development uses Uvicorn so it does not require Cloudflare's native runtime or macOS 13.5+.

## Deploy

```sh
npm run build
.venv/bin/uv run pywrangler deploy
```

https://apispecprobe.bd-demo.workers.dev
