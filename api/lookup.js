// Combined proxy for public lookup APIs (no auth required).
// Usage:
//   GET /api/lookup?service=datamuse&rel_ant=hot&max=4
//   GET /api/lookup?service=conceptnet&concept=photosynthesis&limit=20

// ── Server-side response cache ────────────────────────────────────────────────
// Shared across requests on the same Vercel function instance.
// Cache hits are served without hitting the upstream or counting against rate limits.
const _responseCache = new Map(); // url → { data, ts }
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours — Datamuse/ConceptNet results are stable

function getCached(url) {
  const entry = _responseCache.get(url);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) { _responseCache.delete(url); return null; }
  return entry.data;
}
function setCache(url, data) {
  // LRU eviction at 3000 entries
  if (_responseCache.size >= 3000) _responseCache.delete(_responseCache.keys().next().value);
  _responseCache.set(url, { data, ts: Date.now() });
}

// ── Per-IP sliding-window rate limiter ────────────────────────────────────────
// Only applies to cache misses (upstream requests). Cache hits are free.
// Limit raised to 120/min to accommodate pre-warm + per-question Datamuse batches.
const slidingWindows = new Map();
function checkRateLimit(ip, max = 120, windowMs = 60000) {
  const now = Date.now();
  const recent = (slidingWindows.get(ip) || []).filter(t => now - t < windowMs);
  recent.push(now);
  slidingWindows.set(ip, recent);
  // Prune stale IPs to avoid unbounded growth
  if (slidingWindows.size > 1000) {
    for (const [k, v] of slidingWindows) {
      if (v.every(t => now - t >= windowMs)) slidingWindows.delete(k);
    }
  }
  return recent.length <= max;
}

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
  } else if (service === "wordnet") {
    // en-word.net blocks CORS from browsers — proxy the full lemma+synset expansion server-side.
    const { word, pos } = req.query;
    if (!word || /\s/.test(word) || word.length > 40)
      return res.status(400).json({ error: "Missing or invalid word param" });
    const posMap = { NOUN: "n", VERB: "v", ADJ: "a", ADV: "r" };
    const targetPos = posMap[(pos || "NOUN").toUpperCase()] || "n";
    const lemmaUrl = `https://en-word.net/json/lemma/${encodeURIComponent(word)}`;
    const lemCached = getCached(lemmaUrl);
    let lemData = lemCached;
    if (!lemData) {
      const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || "unknown";
      if (!checkRateLimit(ip)) return res.status(429).json({ error: "Too many requests." });
      const ac2 = new AbortController();
      const t2 = setTimeout(() => ac2.abort(), 3000);
      try {
        const lr = await fetch(lemmaUrl, { signal: ac2.signal, headers: { Accept: "application/json" } });
        clearTimeout(t2);
        if (!lr.ok) return res.status(200).json({ words: [] });
        lemData = await lr.json();
        setCache(lemmaUrl, lemData);
      } catch { clearTimeout(t2); return res.status(200).json({ words: [] }); }
    }
    const synsets = (lemData.results || []).filter(s => s.pos === targetPos).slice(0, 3);
    const relIds = [...new Set(
      synsets.flatMap(syn => (syn.relations || [])
        .filter(r => ["also","similar","hypernym","hyponym"].includes(r.type))
        .map(r => r.id))
    )].slice(0, 8);
    const relResults = await Promise.all(relIds.map(async id => {
      const synUrl = `https://en-word.net/json/synset/${id}`;
      const cached = getCached(synUrl);
      if (cached) return (cached.lemmas || []).map(l => l.toLowerCase());
      try {
        const sr = await fetch(synUrl, { signal: AbortSignal.timeout ? AbortSignal.timeout(2000) : undefined, headers: { Accept: "application/json" } });
        if (!sr.ok) return [];
        const d = await sr.json();
        setCache(synUrl, d);
        return (d.lemmas || []).map(l => l.toLowerCase());
      } catch { return []; }
    }));
    const words = [...new Set(relResults.flat())]
      .filter(w => w !== word.toLowerCase() && !w.includes(" ") && w.length >= 3);
    return res.status(200).json({ words });
  } else {
    return res.status(400).json({ error: "Unknown service. Use service=datamuse, service=conceptnet, or service=wordnet" });
  }

  // Cache hit — serve immediately, no rate limit consumed
  const cached = getCached(upstreamUrl);
  if (cached) {
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.setHeader("X-Cache", "HIT");
    return res.status(200).json(cached);
  }

  // Cache miss — check rate limit before hitting upstream
  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || "unknown";
  if (!checkRateLimit(ip)) return res.status(429).json({ error: "Too many requests." });

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(upstreamUrl, { signal: ac.signal, headers: { Accept: "application/json" } });
    clearTimeout(timer);
    if (!r.ok) return res.status(r.status).json({ error: `${service} error` });
    const data = await r.json();
    setCache(upstreamUrl, data);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.setHeader("X-Cache", "MISS");
    return res.status(200).json(data);
  } catch {
    clearTimeout(timer);
    return res.status(502).json({ error: `${service} request failed` });
  }
};
