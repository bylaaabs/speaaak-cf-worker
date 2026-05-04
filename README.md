# speaaak-cf-worker

Self-hosted backend for [Speaaak](https://github.com/bylaaabs/speaaak), the privacy-first native macOS dictation app. Runs Whisper (transcription) and Llama (cleanup) on **your own free Cloudflare account** — audio leaves your Mac but only to infrastructure you control.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/bylaaabs/speaaak-cf-worker)

## What this is

Speaaak supports three privacy tiers:

| Tier | Where it runs | Privacy |
|---|---|---|
| **On-device** | Your Mac (WhisperKit + MLX) | Architectural — audio never leaves your machine |
| **Self-hosted** ← *this repo* | Your own CF Worker / Ollama / VPS | Contractual — audio goes to infra you control |
| **Public API** | Groq / OpenAI / OpenRouter | Contractual at best — audio goes to a public provider |

This worker is the easiest "Self-hosted" option: one click, three minutes, **free**, and you never need to manage a server.

## Free tier math

Cloudflare's free Workers AI plan gives you **10,000 neurons per day**. For dictation:

- Whisper transcription: ~5–10 neurons per minute of audio
- Llama 70B cleanup: ~10–20 neurons per cleanup call

That covers ~3–4 hours of active dictation per day comfortably. A power user dictating ~30,000 words per day uses around half the daily limit.

## Endpoints

The worker exposes three OpenAI-compatible endpoints, all gated by a Bearer token:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Token + model availability check |
| `POST` | `/audio/transcriptions` | Whisper transcription (multipart `file` field) |
| `POST` | `/chat/completions` | Llama cleanup pass (OpenAI chat shape) |

Default models with documented fallbacks:

- **Transcription**: `@cf/openai/whisper-large-v3-turbo` → `@cf/openai/whisper`
- **Cleanup**: `@cf/meta/llama-3.3-70b-instruct-fp8-fast` → `@cf/meta/llama-3.1-8b-instruct`

If CF retires a primary model, the worker auto-falls-back without a redeploy.

## Setup (3 minutes)

### 1. Click the Deploy button above

It opens Cloudflare's deploy page. You'll need a free Cloudflare account if you don't have one.

### 2. Choose a strong token

Cloudflare will ask for the `SPEAAAK_TOKEN` secret. Generate one with:

```bash
openssl rand -base64 32
```

Paste it into the Cloudflare deploy form. **Copy it somewhere safe** — you'll need it again in the next step.

### 3. Wait for deploy

Cloudflare deploys in ~30 seconds and gives you a URL like:

```
https://speaaak-<your-account>.<random>.workers.dev
```

Copy that URL too.

### 4. Open Speaaak → Settings → AI Provider → Self-hosted

Paste:
- **Worker URL**: the URL from step 3
- **Token**: the same `SPEAAAK_TOKEN` from step 2

Click **Validate**. If green, you're set — Speaaak now sends your dictations through your own worker.

## Local development

```bash
git clone https://github.com/bylaaabs/speaaak-cf-worker
cd speaaak-cf-worker
npm install
cp .dev.vars.example .dev.vars
# Edit .dev.vars and replace the placeholder token

npm run dev    # runs `wrangler dev` on http://localhost:8787
```

Test the worker:

```bash
TOKEN=$(grep SPEAAAK_TOKEN .dev.vars | cut -d'=' -f2)
curl -H "Authorization: Bearer $TOKEN" http://localhost:8787/health
# → {"status":"ok","worker":"speaaak-cf-worker",...}
```

## Privacy

This worker runs on **your** Cloudflare account. Cloudflare's [Workers AI Terms](https://www.cloudflare.com/service-specific-terms-developer-platform/#developer-platform-terms) state they do **not** train models on your inputs.

Your token lives:
- On your Cloudflare side as a Worker secret (encrypted at rest by Cloudflare).
- On your Mac in macOS Keychain (encrypted at rest by macOS).

Both are visible only to you.

## Why a separate repo

Keeping the worker outside the main Speaaak repo lets:
- The "Deploy to Cloudflare" button point at a clean root with a single `wrangler.toml`.
- Contributors fork just the worker without cloning the macOS app.
- The worker have its own release cadence (model fallbacks change, the macOS app does not need an update).

## FAQ

### Why does the Deploy button always create a copy in MY GitHub?

That's how Cloudflare's Deploy button works — and it's the right design. CF clones this source repo into **your** GitHub account so **you** own the worker source. The maintainers of Speaaak can never push code to your worker, change its endpoints, or read your token. CF wires up a GitHub Action in your fork that re-deploys whenever you push to `main`.

To pull in upstream changes (model fallbacks, fixes), use GitHub's "Sync fork" button on your fork, or add this repo as an `upstream` remote and `git pull --rebase upstream main` when a new release ships.

### Can my fork (the deployed copy) be private?

Yes. After deploy, go to your GitHub fork → Settings → "Change visibility" → Private. The CF→GitHub Action installed at deploy time uses an OAuth token tied to your account, so it keeps redeploying on push to a private repo just fine.

The only repo that has to stay public is **this one** (`bylaaabs/speaaak-cf-worker`) — the Deploy button needs to be able to read it to clone for the next visitor.

### Can I run my own modified worker.js?

Absolutely. After you've forked / deployed, edit `src/worker.js` in your account, push, and the CF Action redeploys. Common reasons to fork: adding rate limits, swapping in a different transcription model, putting the worker behind a custom domain, adding HTTP signature checks on top of the Bearer token.

## Contributing

PRs welcome. Especially appreciated:
- Better fallback model lists when CF adds new ones.
- Streaming responses (SSE) for `chat/completions` to reduce perceived latency.
- Optional Vertex AI / Bedrock variants for users who prefer those providers.

## License

Apache 2.0 — see [LICENSE](LICENSE).
