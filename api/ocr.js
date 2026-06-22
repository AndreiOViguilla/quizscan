const slidingWindows = new Map();
function checkRateLimit(ip, max = 10, windowMs = 60000) {
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

  const { imageBase64, mimeType } = req.body || {};
  if (!imageBase64) return res.status(400).json({ error: "Missing imageBase64" });

  const token = process.env.HF_TOKEN;
  if (!token) return res.status(503).json({ error: "OCR not configured" });

  const buffer = Buffer.from(imageBase64, "base64");
  const contentType = mimeType || "image/jpeg";

  // Try printed model first, fall back to base
  const models = [
    "microsoft/trocr-large-printed",
    "microsoft/trocr-base-printed",
  ];

  for (const model of models) {
    try {
      const r = await fetch(`https://api-inference.huggingface.co/models/${model}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
        body: buffer,
      });
      if (!r.ok) continue;
      const data = await r.json();
      if (data.error) continue;
      const text = Array.isArray(data)
        ? data.map(d => d.generated_text || "").filter(Boolean).join("\n")
        : (data.generated_text || "");
      if (text.trim().length > 10) return res.status(200).json({ text: text.trim() });
    } catch {}
  }

  return res.status(502).json({ error: "OCR failed. Try a clearer image or use the Text tab instead." });
};
