# Handoff: Requesty Tester

Status at handoff (2026-10-31) for picking this up in a local session, such as VS Code with Claude.

## Goal (from the user)
A simple web tester for sending requests to Requesty in each category: Chat, Decision, Embeddings, Image, Speech and Transcriptions. Each tab has a model picker filled from what the provided API key exposes, a simple form to build the request, and a view of the full response. It should be containerised: GitHub Actions builds a Docker image that can easily be run locally with `docker compose`.

## What exists
| File | Purpose |
| --- | --- |
| `server.js` | Node 18+ server with no dependencies. Serves `public/` and forwards `/api/*` to `REQUESTY_BASE_URL` (default `https://router.requesty.ai/v1`), passing the body through byte-for-byte to avoid CORS. Adds `HTTP-Referer` and `X-Title`. Uses `REQUESTY_API_KEY` when the browser sends no key. `GET /config` reports the upstream URL and whether an env key is set. |
| `public/index.html`, `app.js`, `style.css` | Plain JS UI with a tab per category, an "All models" table, and a raw/request/headers/cURL view for every response. |
| `Dockerfile`, `docker-compose.yml`, `.dockerignore` | `node:22-alpine`, runs as a non-root user, port 3000, health check on `/config`. Compose pulls `ghcr.io/hkarn/requesty-tester:latest`; switch to `build: .` to build locally. |
| `.github/workflows/docker.yml` | Multi-arch (amd64 and arm64) build with buildx. Pushes to GHCR on `main` and `v*` tags; pull requests build only. |
| `docs/requesty-inference-openapi.json` | Requesty inference OpenAPI spec, the source of truth for request and response formats. |

## API facts used (from the OpenAPI spec)
- Models: `GET /v1/models/all` returns every modality, and each entry has `api` ∈ `chat | decision | embedding | image | speech | transcription`. There are per-modality lists at `/v1/models/{api}`. Plain `/v1/models` is chat only. With a key, the lists contain only models approved for that organization.
- Decision: `POST /v1/decisions` takes `{model, state, questions:{id:{type: noul|choice|score, instructions, criteria}}}`. For `choice`, `criteria` is an object mapping option → description; for `score`, it's a list of labels from lowest to highest. The response is `answers[id]` with `noul` (a probability), or `choice` + `confidence` + `probabilities`, or `score` + `confidence` + `probabilities[{value, probability}]`, or `type: "refusal"`. Images go inside `state` as `{type: "image_url", image_url: {url: dataURL}}`, on models that accept images only.
- Speech: `POST /v1/audio/speech` returns raw audio bytes. Voices: alloy, ash, ballad, coral, echo, fable, onyx, nova, sage, shimmer, verse. `instructions` works only with `openai/gpt-4o-mini-tts`. `stream_format: sse` is not used.
- Transcriptions: `POST /v1/audio/transcriptions` takes multipart `file` (≤ 32 MB) and `model`, plus optional `language`. Returns `{text, usage}`.
- Images: `POST /v1/images/generations`, OpenAI-compatible (e.g. `azure/openai/gpt-image-1`). Supports `quality: auto`, `background`, `output_format`. `/v1/images/edits` exists but is not implemented here.
- Errors: `{error: {origin: router|provider, message}}`. The UI shows `[origin] message`.
- Other endpoints not used: `/v1/messages` (Anthropic format), `/v1/responses` (OpenAI Responses), `/v1/systemone`, `/v1/models/managed`.

## Testing so far
- Tested only against a mock upstream that returns the documented response formats, because the cloud sandbox couldn't reach requesty.ai. All six tabs plus model loading passed end-to-end in headless Chromium with no console errors.
- Local session (2026-10-31, Windows, Docker Desktop, no Node on the host): `docker build` works, and the container serves the UI and reports `healthy`. Against the real API without a key, `/models/all` returns 878 models whose `api` values are exactly the six documented ones. Errors come back as `{error:{origin:"router", message}}` (401 with no key, 403 with a bad key), as the spec says.
- Real-data difference found and fixed: non-chat models have no `input_price`/`output_price`/`context_window`. Their `pricing` is an object of per-unit keys (embedding `input_text`/`input_image`/…, image `output_image`, speech `input_character`, transcription `input_second`; decision uses `input`/`output`). Chat models' `pricing` is an array of tiers. The model info line now shows the per-unit prices.
- Real-key test (2026-10-31), all through the proxy, all 200 unless noted:
  - Chat: `azure/gpt-5-nano`, `bedrock/claude-haiku-5-5`.
  - Embeddings: all 3 approved models.
  - Decision: all 4 approved models. The `score` answer differs from the spec: `probabilities` is an object keyed by index (`"0"`…) with a `legend` mapping index → label, and `score` is the expected index. The UI handles both shapes.
  - Image: `vertex/google/gemini-2.5-flash-image` returns `data[].b64_json` plus token `usage`.
  - Speech: `deepinfra/XiaomiMiMo/MiMo-V2.5-tts` gives `500 [provider]` for unknown voices such as `alloy`. It works with `mimo_default`, with `Chloe`, or with no voice at all. It returns WAV by default and MP3 when asked. The voice field is now optional free text.
  - Transcriptions: all 3 DeepInfra models accept WAV, WebM/Opus and Ogg. The response also has `language`, `duration` and `segments`. The first Qwen3-ASR call took 56 s (likely a cold start).
  - Unapproved models give a 403 from the router with a clear message.
- End-to-end in headless Chromium (Playwright, with a WAV file as a fake mic): Embeddings, Image, Speech and Transcriptions all render results. Transcriptions was tested with the sample clip, a mic recording and a file upload. Embeddings, Image and Speech now start with example values, and Transcriptions has a "Use sample clip" button (`public/sample.ogg`, generated with MiMo TTS).
- With the user's real mic, `deepinfra/nvidia/Nemotron-…` returned no text, though it handles the English test clips. It was selected only because it sorts first. There are no preferred models any more, because the models a key exposes vary too much: each picker keeps the current choice and otherwise selects the first model.

## Static mode (GitHub Pages)
- `app.js` requests `config` (relative) on load. If `server.js` answers, calls go through `api/…`. Otherwise they go straight to `https://router.requesty.ai/v1`, with `HTTP-Referer` and `X-Title` set in the browser. Requesty answers preflights with `Access-Control-Allow-Origin: *` and allows these headers.
- `.github/workflows/pages.yml` publishes `public/` to Pages. Tested in headless Chromium against nginx serving `public/` from `/requesty-tester/`: all six tabs work.

## Suggested next steps
1. `node server.js`, open http://127.0.0.1:3000, paste a key, and check each tab against the real API. Watch for differences from the spec, e.g. what `/models/all` returns for this organization, image response fields, and the transcription usage shape.
2. `docker compose up --build` (after switching to `build: .`) to check the image.
3. Merge to `main` so the workflow publishes `ghcr.io/hkarn/requesty-tester`. Then make the GHCR package public, or `docker login ghcr.io`.
4. Optional: streaming for chat (SSE), an image-edits tab, and `/v1/messages` or `/v1/responses` tabs.
