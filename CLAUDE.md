# Requesty Tester

A small web UI for testing Requesty router endpoints. Read `HANDOFF.md` for current status and next steps.

- Run: `node server.js` (Node 18+, no dependencies), then open http://127.0.0.1:3000. Docker: `docker compose up`.
- `server.js` serves `public/` and proxies `/api/*` to `REQUESTY_BASE_URL` (default `https://router.requesty.ai/v1`).
- The UI is plain JS in `public/app.js`, with one handler per tab in `handlers`.
- The API source of truth is `docs/requesty-inference-openapi.json`. Check request and response formats there before changing a handler.
- Keep it dependency-free: no build step and no npm packages.
