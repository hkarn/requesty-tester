# Requesty Tester

A small web UI for sending test requests to [Requesty](https://requesty.ai)'s router and inspecting what comes back.

| Tab | Endpoint | What you get |
| --- | --- | --- |
| **Chat** | `POST /v1/chat/completions` | Multi-turn message builder (system + user/assistant), temperature/max_tokens/top_p, extra JSON fields |
| **Decision** | `POST /v1/decisions` | Content (`state`, optionally with an image) plus typed questions (`noul` yes/no, `choice`, `score`), with calibrated answers and probability bars |
| **Embeddings** | `POST /v1/embeddings` | One input per line, shows vector previews and a cosine-similarity matrix |
| **Image** | `POST /v1/images/generations` | Size, n, quality, background and output format. Renders the returned images |
| **Speech** | `POST /v1/audio/speech` | Plays the audio in the browser and lets you download it |
| **Transcriptions** | `POST /v1/audio/transcriptions` | Upload a file (≤ 32 MB) or record from your mic, with optional language |
| **All models** | `GET /v1/models/all` | Searchable table plus the raw response |

Paste your API key and click **Load models**. Models come from `GET /v1/models/all`, which only returns the models approved for your key's organization. Each tab's dropdown is filtered by the model's `api` field (`chat`, `decision`, `embedding`, `image`, `speech`, `transcription`). Tick **show all** or type any model ID to override that.

Every response shows the status, latency, rendered output, raw response, request body, response headers and a ready-to-run `curl` command.

## Run with Docker (recommended)

The GitHub Actions workflow publishes a multi-arch image (amd64 and arm64) to `ghcr.io/hkarn/requesty-tester`.

```bash
docker compose up -d
```

Then open http://localhost:3000.

Or, without compose:

```bash
docker run --rm -p 127.0.0.1:3000:3000 ghcr.io/hkarn/requesty-tester:latest
```

Optional: copy `.env.example` to `.env` and set `REQUESTY_API_KEY=sk-...` so you don't have to type the key. A key typed in the UI always takes precedence.

To build from source, switch `image:` to `build: .` in `docker-compose.yml`, or run:

```bash
docker build -t requesty-tester . && docker run --rm -p 3000:3000 requesty-tester
```

> **Note:** If the GHCR package is private (the default for a new package), either run `docker login ghcr.io` first, or make the package public under **GitHub → Packages → requesty-tester → Package settings**.

## Run without Docker

Needs Node 18 or later. There are no dependencies.

```bash
node server.js
```

## Configuration

| Env var | Default | Purpose |
| --- | --- | --- |
| `REQUESTY_API_KEY` | – | Key used when the browser doesn't send one |
| `REQUESTY_BASE_URL` | `https://router.requesty.ai/v1` | Upstream API (e.g. a regional endpoint) |
| `PORT` | `3000` | Listen port |
| `HOST` | `127.0.0.1` (`0.0.0.0` in Docker) | Listen address |

## Hosting it publicly

Any host that runs Node 18 or later works. Upload `server.js`, `package.json` and `public/`, and set the start file to `server.js`. `PORT` can be a port number or a pipe/socket path, as some hosts (iisnode, Passenger) provide. If the host connects to the app over TCP from another machine, set `HOST=0.0.0.0`.

**Don't set `REQUESTY_API_KEY` on a public site.** Anyone who opens it could then send requests billed to your key. Without it, every visitor uses their own key, which stays in their browser and passes through the server per request. Request bodies are capped at 40 MB.

## GitHub Pages (static, no server)

Requesty allows CORS from any origin, so `public/` also works as a static site. When the page finds no `server.js` (its `config` request fails), it calls `https://router.requesty.ai/v1` directly from the browser. All paths are relative, so it works from a subfolder such as `https://<owner>.github.io/requesty-tester/`.

The `GitHub Pages` workflow publishes `public/` on every push to `main` that changes it. Enable it once under **Settings → Pages → Source: GitHub Actions**.

Compared with running `server.js`: there is no server-side `REQUESTY_API_KEY`, so each visitor pastes their own key. Browsers also only expose a few response headers on cross-origin calls, so the response-headers view is shorter and there's no upstream timing.

## How it works

`server.js` serves the static UI from `public/` and forwards `/api/*` to the Requesty router. It passes the request body through byte-for-byte, so JSON, multipart audio uploads and binary audio responses all work, and it avoids browser CORS problems. The server never stores your key. If you tick **Remember**, the key is kept in your browser's `localStorage`.
