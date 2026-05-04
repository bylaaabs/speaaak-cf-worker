// Speaaak — self-hosted backend on Cloudflare Workers AI.
//
// Three OpenAI-compatible endpoints, all gated by a Bearer token the
// user configured at deploy time (`SPEAAAK_TOKEN` secret):
//
//   GET  /health                   → 200 if token valid, 401 otherwise.
//   POST /audio/transcriptions     → multipart with `file` field, runs
//                                    Whisper, returns { "text": "..." }.
//   POST /chat/completions         → JSON with messages, runs Llama,
//                                    returns OpenAI-shape choices array.
//
// Everything runs on the user's own CF account. Free tier gives 10k
// neurons/day which is plenty for normal dictation use (a power user
// dictating ~4 hours/day burns ~5k neurons).
//
// Hot-swappable model preferences with documented fallbacks: when CF
// retires a model, the next-best is used automatically without a
// worker redeploy.

const TRANSCRIPTION_MODELS = [
  "@cf/openai/whisper-large-v3-turbo",
  "@cf/openai/whisper",
];

const CLEANUP_MODELS = [
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "@cf/meta/llama-3.1-8b-instruct",
];

export default {
  async fetch(request, env) {
    // Auth gate — every endpoint requires a valid Bearer token.
    const auth = request.headers.get("authorization") || "";
    const expected = `Bearer ${env.SPEAAAK_TOKEN || ""}`;
    if (!env.SPEAAAK_TOKEN || auth !== expected) {
      return jsonError(401, "missing or invalid Bearer token");
    }

    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({
        status: "ok",
        worker: "speaaak-cf-worker",
        transcription_models: TRANSCRIPTION_MODELS,
        cleanup_models: CLEANUP_MODELS,
      });
    }

    if (request.method === "POST" && url.pathname === "/audio/transcriptions") {
      return handleTranscribe(request, env);
    }

    if (request.method === "POST" && url.pathname === "/chat/completions") {
      return handleChatCompletions(request, env);
    }

    return jsonError(404, "unknown endpoint");
  },
};

// ---------- /audio/transcriptions ----------

async function handleTranscribe(request, env) {
  // OpenAI Whisper accepts `multipart/form-data` with a `file` part.
  // Speaaak's `OpenAICompatibleRecognizer` builds the same shape.
  let form;
  try {
    form = await request.formData();
  } catch (e) {
    return jsonError(400, `bad multipart body: ${e.message}`);
  }
  const file = form.get("file");
  if (!(file instanceof File) && !(file instanceof Blob)) {
    return jsonError(400, "missing 'file' field");
  }
  const language = (form.get("language") || "").toString() || undefined;
  const modelOverride = (form.get("model") || "").toString() || undefined;

  // Workers AI's whisper binding wants a Uint8Array of audio bytes.
  const audioBytes = new Uint8Array(await file.arrayBuffer());

  const candidates = modelOverride
    ? [modelOverride, ...TRANSCRIPTION_MODELS]
    : TRANSCRIPTION_MODELS;

  let lastError;
  for (const model of candidates) {
    try {
      const result = await env.AI.run(model, {
        audio: [...audioBytes],   // CF expects an array of bytes
        ...(language ? { language } : {}),
      });
      // CF returns { text, word_count, words?, vtt? }. Speaaak only
      // needs `text` to match the OpenAI shape.
      const text = (result && result.text) || "";
      return Response.json({ text, model_used: model });
    } catch (e) {
      lastError = e;
      // Try next fallback.
    }
  }
  return jsonError(502, `all transcription models failed: ${lastError?.message || "unknown"}`);
}

// ---------- /chat/completions ----------

async function handleChatCompletions(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonError(400, `bad JSON body: ${e.message}`);
  }
  const messages = Array.isArray(body.messages) ? body.messages : null;
  if (!messages || messages.length === 0) {
    return jsonError(400, "missing 'messages' array");
  }
  const modelOverride = body.model || undefined;
  const temperature = typeof body.temperature === "number" ? body.temperature : 0.2;
  const maxTokens = body.max_tokens || 1024;

  const candidates = modelOverride
    ? [modelOverride, ...CLEANUP_MODELS]
    : CLEANUP_MODELS;

  let lastError;
  for (const model of candidates) {
    try {
      const result = await env.AI.run(model, {
        messages,
        temperature,
        max_tokens: maxTokens,
      });
      // CF returns { response: "..." }. Wrap into OpenAI shape so the
      // Swift client doesn't need a CF-specific parser.
      const content = (result && (result.response || result.text || "")) || "";
      return Response.json({
        id: `cf-${crypto.randomUUID()}`,
        object: "chat.completion",
        model,
        choices: [
          {
            index: 0,
            message: { role: "assistant", content },
            finish_reason: "stop",
          },
        ],
      });
    } catch (e) {
      lastError = e;
    }
  }
  return jsonError(502, `all cleanup models failed: ${lastError?.message || "unknown"}`);
}

// ---------- helpers ----------

function jsonError(status, message) {
  return Response.json({ error: { message, type: "invalid_request_error" } }, { status });
}
