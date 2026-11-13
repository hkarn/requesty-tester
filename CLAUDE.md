# Requesty Tester

A small web UI for testing Requesty router endpoints. Live at https://hkarn.github.io/requesty-tester/.

- Run: `node server.js` (Node 18+, no dependencies), then open http://127.0.0.1:3000. Docker: `docker compose up`.
- `server.js` serves `public/` and proxies `/api/*` to `REQUESTY_BASE_URL` (default `https://router.requesty.ai/v1`).
- Without `server.js` (GitHub Pages), `app.js` finds no `config` and calls Requesty directly, which allows CORS. Keep every path in `public/` relative so it works from the `/requesty-tester/` subfolder.
- Workflows: `docker.yml` pushes `ghcr.io/hkarn/requesty-tester` on `main`; `pages.yml` publishes `public/` to Pages.
- The UI is plain JS in `public/app.js`, with one handler per tab in `handlers`.
- The API source of truth is `docs/requesty-inference-openapi.json`. Check request and response formats there before changing a handler.
- Keep it dependency-free: no build step and no npm packages.
- Assign every pull request you open to `hkarn`, so it shows up in the owner's GitHub views: `gh pr create --assignee hkarn`, or `gh pr edit <N> --add-assignee hkarn` for a pull request opened another way (a GitHub MCP tool, or a draft the environment opened).
- Open pull requests as drafts; the owner marks them ready for review.
- Review comments, from Copilot or a person: check each claim against the code first, fix what is real in a new commit, and reply on the thread with what you found and what changed (or why nothing did). Never resolve a conversation; the owner does.
- Never merge, approve or enable auto-merge on a pull request; the owner's merge is the approval.
- Claude Code signs everything it posts on GitHub (pull request descriptions, issues, comments and review replies) with a last line `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. This line is Claude Code's alone: Copilot and other reviewers or agents reading this file don't add it.

## Where the live API differs from the spec
Found by testing with a real key; keep handling both shapes.
- Decision `score` answers: `probabilities` is an object keyed by index (`"0"`…), with a `legend` mapping index → label. `score` is the expected index.
- Only chat models have `input_price`/`output_price`/`context_window`. Others have a `pricing` object of per-unit keys (`input_character`, `input_second`, `output_image`, …). Chat `pricing` is an array of tiers.
- Speech: non-OpenAI models (e.g. DeepInfra MiMo) return `500 [provider]` for OpenAI voice names like `alloy`. Leaving the voice out works. `/models/all` has no voice names, so `SPEECH_VOICES` in `app.js` lists them per model, taken from each provider's docs. Update it when Requesty adds speech models.
- Transcriptions also return `language`, `duration` and `segments`. DeepInfra models can take about a minute on a cold start.
