const slidingWindows = new Map();
function checkRateLimit(ip, max = 15, windowMs = 60000) {
  const now = Date.now();
  const recent = (slidingWindows.get(ip) || []).filter(t => now - t < windowMs);
  recent.push(now); slidingWindows.set(ip, recent);
  if (slidingWindows.size > 1000) for (const [k, v] of slidingWindows) { if (v.every(t => now - t >= windowMs)) slidingWindows.delete(k); }
  return recent.length <= max;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || "unknown";
  if (!checkRateLimit(ip)) return res.status(429).json({ error: "Too many requests." });

  const { sentences } = req.body || {};
  if (!sentences || !Array.isArray(sentences) || sentences.length === 0)
    return res.status(400).json({ error: "Missing sentences array" });
  if (sentences.length > 50)
    return res.status(400).json({ error: "Max 50 sentences per request" });

  const token = process.env.HF_TOKEN;
  if (!token) return res.status(503).json({ error: "Embeddings not configured" });

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 10000);
  try {
    const r = await fetch(
      "https://api-inference.huggingface.co/models/sentence-transformers/all-MiniLM-L6-v2",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ inputs: sentences }),
        signal: ac.signal,
      }
    );
    clearTimeout(timer);
    if (!r.ok) return res.status(502).json({ error: "Embedding model unavailable" });
    const embeddings = await r.json();
    if (!Array.isArray(embeddings)) return res.status(502).json({ error: "Unexpected response" });
    return res.status(200).json({ embeddings });
  } catch {
    clearTimeout(timer);
    return res.status(502).json({ error: "Embedding request failed" });
  }
};
