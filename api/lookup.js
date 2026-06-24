// Combined proxy for public lookup APIs (no auth required).
// Usage:
//   GET /api/lookup?service=datamuse&rel_ant=hot&max=4
//   GET /api/lookup?service=conceptnet&concept=photosynthesis&limit=20
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const { service, concept, limit, ...rest } = req.query;

  let upstreamUrl;
  let timeoutMs = 4000;

  if (service === "datamuse") {
    const query = new URLSearchParams(rest).toString();
    if (!query) return res.status(400).json({ error: "Missing query params" });
    upstreamUrl = `https://api.datamuse.com/words?${query}`;
    timeoutMs = 3000;
  } else if (service === "conceptnet") {
    if (!concept) return res.status(400).json({ error: "Missing concept param" });
    const encoded = encodeURIComponent(concept.toLowerCase().replace(/\s+/g, "_"));
    const n = parseInt(limit, 10) || 20;
    upstreamUrl = `https://api.conceptnet.io/c/en/${encoded}?limit=${n}`;
  } else {
    return res.status(400).json({ error: "Unknown service. Use service=datamuse or service=conceptnet" });
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(upstreamUrl, { signal: ac.signal, headers: { Accept: "application/json" } });
    clearTimeout(timer);
    if (!r.ok) return res.status(r.status).json({ error: `${service} error` });
    const data = await r.json();
    res.setHeader("Cache-Control", "public, max-age=86400");
    return res.status(200).json(data);
  } catch {
    clearTimeout(timer);
    return res.status(502).json({ error: `${service} request failed` });
  }
};
