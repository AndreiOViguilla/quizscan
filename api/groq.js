// Simple per-IP rate limit: 15 requests/minute per instance
const rateLimits = new Map();
function checkRateLimit(ip, max = 15, windowMs = 60000) {
  const now = Date.now();
  const entry = rateLimits.get(ip) || { count: 0, reset: now + windowMs };
  if (now > entry.reset) { entry.count = 0; entry.reset = now + windowMs; }
  entry.count++;
  rateLimits.set(ip, entry);
  if (rateLimits.size > 500) {
    for (const [k, v] of rateLimits) { if (now > v.reset) rateLimits.delete(k); }
  }
  return entry.count <= max;
}

module.exports = async function handler(req, res) {
  const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "";
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (ALLOWED_ORIGIN) {
    const origin = req.headers["origin"] || req.headers["referer"] || "";
    if (origin && !origin.startsWith(ALLOWED_ORIGIN)) {
      return res.status(403).json({ error: "Forbidden" });
    }
  }

  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || "unknown";
  if (!checkRateLimit(ip)) return res.status(429).json({ error: "Too many requests. Please wait a minute." });

  const { messages, model = "llama-3.3-70b-versatile", maxTokens = 8000 } = req.body;
  if (!messages?.length) return res.status(400).json({ error: "Missing messages" });

  const GROQ_KEY = process.env.GROQ_KEY;
  if (!GROQ_KEY) return res.status(500).json({ error: "GROQ_KEY not configured" });

  try {
    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${GROQ_KEY}` },
      body: JSON.stringify({ model, max_tokens: maxTokens, messages }),
    });
    const data = await groqRes.json();
    if (data.error) return res.status(502).json({ error: data.error.message });
    const content = data.choices?.[0]?.message?.content || "";
    if (!content) return res.status(502).json({ error: "Empty response from Groq" });
    return res.status(200).json({ content });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
