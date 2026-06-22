module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const query = new URLSearchParams(req.query).toString();
  if (!query) return res.status(400).json({ error: "Missing query params" });

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 3000);
  try {
    const r = await fetch(`https://api.datamuse.com/words?${query}`, { signal: ac.signal });
    clearTimeout(timer);
    if (!r.ok) return res.status(r.status).json({ error: "Datamuse error" });
    const data = await r.json();
    res.setHeader("Cache-Control", "public, max-age=86400");
    return res.status(200).json(data);
  } catch {
    clearTimeout(timer);
    return res.status(502).json({ error: "Datamuse request failed" });
  }
};
