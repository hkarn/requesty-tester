# Requesty Tester

A small web UI for testing Requesty router endpoints. Live at https://hkarn.github.io/requesty-tester/.

- Run: `node server.js` (Node 18+, no dependencies), then open http://127.0.0.1:3000. Docker: `docker compose up`.
- `server.js` serves `public/` and proxies `/api/*` to `REQUESTY_BASE_URL` (default `https://router.requesty.ai/v1`).
- Without `server.js` (GitHub Pages), `app.js` finds no `config` and calls Requesty directly, which allows CORS. Keep every path in `public/` relative so it works from the `/requesty-tester/` subfolder.
- Workflows: `docker.yml` pushes `ghcr.io/hkarn/requesty-tester` on `main`; `pages.yml` publishes `public/` to Pages.
- The UI is plain JS in `public/app.js`, with one handler per tab in `handlers`.
- The API source of truth is `docs/requesty-inference-openapi.json`. Check request and response formats there before changing a handler.
- Keep it dependency-free: no build step and no npm packages.

## Where the live API differs from the spec
Found by testing with a real key; keep handling both shapes.
- Decision `score` answers: `probabilities` is an object keyed by index (`"0"`…), with a `legend` mapping index → label. `score` is the expected index.
- Only chat models have `input_price`/`output_price`/`context_window`. Others have a `pricing` object of per-unit keys (`input_character`, `input_second`, `output_image`, …). Chat `pricing` is an array of tiers.
- Speech: non-OpenAI models (e.g. DeepInfra MiMo) return `500 [provider]` for OpenAI voice names like `alloy`. Leaving the voice out works.
- Transcriptions also return `language`, `duration` and `segments`. DeepInfra models can take about a minute on a cold start.
