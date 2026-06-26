// Proxy for Wordnik API — protects the API key from the browser.
// GET /api/wordnik?word={word}&type=related   → { words: [{word, rel}] }
// GET /api/wordnik?word={word}&type=definitions → { definitions: [{text, pos}] }

const _responseCache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000;

function getCached(key) {
  const e = _responseCache.get(key);
  if (!e) return null;
  if (Date.now() - e.ts > CACHE_TTL) { _responseCache.delete(key); return null; }
  return e.data;
}
function setCache(key, data) {
  if (_responseCache.size >= 2000) _responseCache.delete(_responseCache.keys().next().value);
  _responseCache.set(key, { data, ts: Date.now() });
}

const slidingWindows = new Map();
function checkRateLimit(ip, max = 60, windowMs = 60000) {
  const now = Date.now();
  const recent = (slidingWindows.get(ip) || []).filter(t => now - t < windowMs);
  recent.push(now);
  slidingWindows.set(ip, recent);
  if (slidingWindows.size > 1000) {
    for (const [k, v] of slidingWindows)
      if (v.every(t => now - t >= windowMs)) slidingWindows.delete(k);
  }
  return recent.length <= max;
}

const EMPTY = { words: [], definitions: [] };

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const { word, type } = req.query;
  if (!word || word.length > 60 || /\s/.test(word))
    return res.status(400).json({ error: "Invalid word" });
  if (type !== "related" && type !== "definitions")
    return res.status(400).json({ error: "type must be 'related' or 'definitions'" });

  const apiKey = process.env.WORDNIK_API_KEY;
  if (!apiKey) return res.status(200).json(EMPTY);

  const cacheKey = `${type}:${word.toLowerCase()}`;
  const cached = getCached(cacheKey);
  if (cached) {
    res.setHeader("X-Cache", "HIT");
    return res.status(200).json(cached);
  }

  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || "unknown";
  if (!checkRateLimit(ip)) return res.status(429).json({ error: "Too many requests" });

  const encoded = encodeURIComponent(word.toLowerCase());
  const url = type === "related"
    ? `https://api.wordnik.com/v4/word.json/${encoded}/relatedWords?useCanonical=true&relationshipTypes=synonym,antonym,hyponym,hypernym,similar-to&limitPerRelationshipType=12&api_key=${apiKey}`
    : `https://api.wordnik.com/v4/word.json/${encoded}/definitions?limit=4&includeRelated=false&useCanonical=true&includeTags=false&api_key=${apiKey}`;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 4000);
  try {
    const r = await fetch(url, { signal: ac.signal });
    clearTimeout(timer);
    if (r.status === 404) { setCache(cacheKey, EMPTY); return res.status(200).json(EMPTY); }
    if (!r.ok) return res.status(200).json(EMPTY);
    const data = await r.json();

    let result;
    if (type === "related") {
      const words = (Array.isArray(data) ? data : [])
        .flatMap(group => (group.words || []).map(w => ({ word: w, rel: group.relationshipType })))
        .filter(({ word: w }) => w && !w.includes(" ") && w.length >= 3 && w.length <= 30);
      result = { words };
    } else {
      const definitions = (Array.isArray(data) ? data : [])
        .filter(d => d.text && d.partOfSpeech)
        .map(d => ({
          text: d.text.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(),
          pos: d.partOfSpeech,
        }))
        .filter(d => d.text.length >= 15 && d.text.length <= 220);
      result = { definitions };
    }

    setCache(cacheKey, result);
    res.setHeader("X-Cache", "MISS");
    return res.status(200).json(result);
  } catch {
    clearTimeout(timer);
    return res.status(200).json(EMPTY);
  }
};
