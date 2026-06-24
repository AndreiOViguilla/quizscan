// Unified AI provider proxy. Send { provider, messages, model?, maxTokens? } in the POST body.
// provider: "groq" | "gemini" | "mistral" | "openrouter"
const slidingWindows = new Map();
function checkRateLimit(ip, max = 15, windowMs = 60000) {
  const now = Date.now();
  const recent = (slidingWindows.get(ip) || []).filter(t => now - t < windowMs);
  recent.push(now); slidingWindows.set(ip, recent);
  if (slidingWindows.size > 1000) for (const [k, v] of slidingWindows) { if (v.every(t => now - t >= windowMs)) slidingWindows.delete(k); }
  return recent.length <= max;
}

async function moderateText(text) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { flagged: false };
  try {
    const r = await fetch("https://api.openai.com/v1/moderations", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: "omni-moderation-latest", input: text }),
    });
    if (!r.ok) return { flagged: false };
    const d = await r.json();
    return d.results?.[0] ?? { flagged: false };
  } catch { return { flagged: false }; }
}

const PROVIDERS = {
  groq: {
    url: "https://api.groq.com/openai/v1/chat/completions",
    defaultModel: "llama-3.3-70b-versatile",
    keys: () => [
      process.env.REACT_APP_GROQ_KEY,
      process.env.REACT_APP_GROQ_KEY_2,
      process.env.REACT_APP_GROQ_KEY_3,
      process.env.REACT_APP_GROQ_KEY_4,
    ].filter(Boolean),
    multiKey: true,
  },
  gemini: {
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    defaultModel: "gemini-2.0-flash",
    keys: () => [process.env.GEMINI_API_KEY].filter(Boolean),
  },
  mistral: {
    url: "https://api.mistral.ai/v1/chat/completions",
    defaultModel: "mistral-small-latest",
    keys: () => [process.env.MISTRAL_API_KEY].filter(Boolean),
  },
  openrouter: {
    url: "https://openrouter.ai/api/v1/chat/completions",
    defaultModel: "meta-llama/llama-3.1-8b-instruct:free",
    keys: () => [process.env.OPENROUTER_API_KEY].filter(Boolean),
    extraHeaders: {
      "HTTP-Referer": "https://quizscan-flame.vercel.app",
      "X-Title": "QuizScan",
    },
  },
};

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || "unknown";
  if (!checkRateLimit(ip)) return res.status(429).json({ error: "Too many requests." });

  const { provider = "groq", messages, model, maxTokens = 8000 } = req.body || {};
  const cfg = PROVIDERS[provider];
  if (!cfg) return res.status(400).json({ error: `Unknown provider: ${provider}` });
  if (!messages?.length) return res.status(400).json({ error: "Missing messages" });

  const totalLength = messages.reduce((s, m) => s + (typeof m.content === "string" ? m.content : JSON.stringify(m.content)).length, 0);
  if (totalLength > 12000) return res.status(400).json({ error: "Content too large" });

  const keys = cfg.keys();
  if (!keys.length) return res.status(503).json({ error: `${provider} not configured` });

  const inputText = messages.map(m => (typeof m.content === "string" ? m.content : JSON.stringify(m.content))).join("\n");
  const inputMod = await moderateText(inputText);
  if (inputMod.flagged) return res.status(400).json({ error: "Content not allowed." });

  const chosenModel = model || cfg.defaultModel;
  const extraHeaders = cfg.extraHeaders || {};
  let lastError = "";

  for (const key of keys) {
    try {
      const r = await fetch(cfg.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, ...extraHeaders },
        body: JSON.stringify({ model: chosenModel, max_tokens: maxTokens, messages }),
      });
      const data = await r.json();
      if (data.error) {
        const msg = data.error.message || "";
        const isRateLimit = r.status === 429 || msg.toLowerCase().includes("rate_limit");
        lastError = msg;
        if (isRateLimit && cfg.multiKey) continue;
        return res.status(502).json({ error: msg });
      }
      const content = data.choices?.[0]?.message?.content || "";
      if (!content) { lastError = "Empty response"; if (cfg.multiKey) continue; break; }
      const outMod = await moderateText(content);
      if (outMod.flagged) return res.status(400).json({ error: "Generated content was flagged. Try a different topic." });
      return res.status(200).json({ content });
    } catch (err) {
      lastError = err.message;
      if (!cfg.multiKey) break;
    }
  }

  const isRateLimit = lastError?.toLowerCase().includes("rate_limit") || lastError?.includes("429");
  return res.status(isRateLimit ? 429 : 502).json({ error: lastError || `${provider} request failed` });
};
