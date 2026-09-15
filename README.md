# ApiSpecProbe

Small interview project: React calls `GET /api/message` on a Python FastAPI backend. The backend reads a Cloudflare Worker secret and returns JSON confirming success. The secret value stays on the server.

## Local development

Requires Node.js 22.12+ and uv.

```sh
npm install
npm run build
cp .dev.vars.example .dev.vars
uv run pywrangler dev
```

Open http://localhost:8787. For React hot reload, run `npm run dev` in another terminal. Local secrets come from `.dev.vars`.

## Deploy

```sh
uv run pywrangler login
npm run build
uv run pywrangler deploy
uv run pywrangler secret put APP_SECRET
```

Website: https://apispecprobe.bd-demo.workers.dev

## Test

```sh
uv run python -m pytest
```

`src/main.jsx` contains the frontend; `backend/app.py` contains the API; `backend/entry.py` adapts FastAPI to Cloudflare. `wrangler.jsonc` configures the Worker and static assets. Missing secrets return HTTP 503. Python Workers are beta.
