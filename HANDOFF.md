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
- **Not yet done:** testing against the real API with a real key, and building the Docker image (the sandbox had no Docker daemon).

## Suggested next steps
1. `node server.js`, open http://127.0.0.1:3000, paste a key, and check each tab against the real API. Watch for differences from the spec, e.g. what `/models/all` returns for this organization, image response fields, and the transcription usage shape.
2. `docker compose up --build` (after switching to `build: .`) to check the image.
3. Merge to `main` so the workflow publishes `ghcr.io/hkarn/requesty-tester`. Then make the GHCR package public, or `docker login ghcr.io`.
4. Optional: streaming for chat (SSE), an image-edits tab, and `/v1/messages` or `/v1/responses` tabs.
