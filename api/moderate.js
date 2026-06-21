module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { text } = req.body;
  if (!text || typeof text !== "string") return res.status(400).json({ error: "Missing text" });
  if (text.length > 1000) return res.status(400).json({ error: "Text too long" });

  const key = process.env.OPENAI_API_KEY;
  if (!key) return res.status(200).json({ flagged: false });

  try {
    const r = await fetch("https://api.openai.com/v1/moderations", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: "omni-moderation-latest", input: text.trim() }),
    });
    if (!r.ok) return res.status(200).json({ flagged: false });
    const d = await r.json();
    const result = d.results?.[0] ?? { flagged: false };
    return res.status(200).json({ flagged: result.flagged, categories: result.categories });
  } catch {
    return res.status(200).json({ flagged: false });
  }
};
