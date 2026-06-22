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
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: "omni-moderation-latest", input: text }),
    });
    if (!r.ok) return { flagged: false };
    const d = await r.json(); return d.results?.[0] ?? { flagged: false };
  } catch { return { flagged: false }; }
}
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || "unknown";
  if (!checkRateLimit(ip)) return res.status(429).json({ error: "Too many requests." });

  const { messages, maxTokens = 8000 } = req.body;
  if (!messages?.length) return res.status(400).json({ error: "Missing messages" });

  const key = process.env.MISTRAL_API_KEY;
  if (!key) return res.status(503).json({ error: "Mistral not configured" });

  const inputText = messages.map(m => typeof m.content === "string" ? m.content : JSON.stringify(m.content)).join("\n");
  const inputMod = await moderateText(inputText);
  if (inputMod.flagged) return res.status(400).json({ error: "Content not allowed." });

  try {
    const r = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: "mistral-small-latest", max_tokens: maxTokens, messages }),
    });
    const data = await r.json();
    if (data.error) return res.status(502).json({ error: data.error.message || "Mistral error" });
    const content = data.choices?.[0]?.message?.content || "";
    if (!content) return res.status(502).json({ error: "Empty response from Mistral" });
    const outMod = await moderateText(content);
    if (outMod.flagged) return res.status(400).json({ error: "Generated content was flagged. Try a different topic." });
    return res.status(200).json({ content });
  } catch (err) {
    return res.status(502).json({ error: err.message || "Mistral unreachable" });
  }
};
