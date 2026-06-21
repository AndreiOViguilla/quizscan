// Sliding window rate limit: 15 requests per 60s per IP
const slidingWindows = new Map();
function checkRateLimit(ip, max = 15, windowMs = 60000) {
  const now = Date.now();
  const recent = (slidingWindows.get(ip) || []).filter(t => now - t < windowMs);
  recent.push(now);
  slidingWindows.set(ip, recent);
  if (slidingWindows.size > 1000) {
    for (const [k, v] of slidingWindows) {
      if (v.every(t => now - t >= windowMs)) slidingWindows.delete(k);
    }
  }
  return recent.length <= max;
}

async function verifyTurnstile(token) {
  const secret = process.env.TURNSTILE_SECRET;
  if (!secret || !token) return true;
  try {
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, response: token }),
    });
    const d = await r.json();
    return d.success === true;
  } catch { return true; }
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
  } catch {
    return { flagged: false };
  }
}

module.exports = async function handler(req, res) {
  const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "";
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || "unknown";
  if (!checkRateLimit(ip)) return res.status(429).json({ error: "Too many requests. Please wait a minute." });

  const { messages, model = "llama-3.3-70b-versatile", maxTokens = 8000, cfToken } = req.body;
  if (!messages?.length) return res.status(400).json({ error: "Missing messages" });



  const keys = [
    process.env.REACT_APP_GROQ_KEY,
    process.env.REACT_APP_GROQ_KEY_2,
    process.env.REACT_APP_GROQ_KEY_3,
    process.env.REACT_APP_GROQ_KEY_4,
  ].filter(Boolean);

  if (!keys.length) return res.status(500).json({ error: "No Groq API key configured" });

  // OpenAI moderation on input
  const inputText = messages.map(m => (typeof m.content === "string" ? m.content : JSON.stringify(m.content))).join("\n");
  const inputMod = await moderateText(inputText);
  if (inputMod.flagged) return res.status(400).json({ error: "Content not allowed." });

  let lastError = "";
  for (const key of keys) {
    try {
      const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, max_tokens: maxTokens, messages }),
      });
      const data = await groqRes.json();
      if (data.error) {
        const msg = data.error.message || "";
        const isRateLimit = groqRes.status === 429 || msg.toLowerCase().includes("rate_limit");
        lastError = msg;
        if (isRateLimit) continue; // try next key
        return res.status(502).json({ error: msg });
      }
      const content = data.choices?.[0]?.message?.content || "";
      if (!content) { lastError = "Empty response"; continue; }
      const outMod = await moderateText(content);
      if (outMod.flagged) return res.status(400).json({ error: "Generated content was flagged. Try a different topic." });
      return res.status(200).json({ content });
    } catch (err) {
      lastError = err.message;
    }
  }

  return res.status(429).json({ error: lastError || "All Groq keys are rate limited. Try again in a minute." });
};
