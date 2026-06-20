// api/transcript.js

// Sliding window rate limit: 10 requests per 60s per IP
const slidingWindows = new Map();
function checkRateLimit(ip, max = 10, windowMs = 60000) {
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

module.exports = async function handler(req, res) {
  const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "";
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || "unknown";
  if (!checkRateLimit(ip)) return res.status(429).json({ error: "Too many requests. Please wait a minute." });

  const { videoId, url } = req.query;
  let id = videoId;
  if (!id && url) {
    const match = url.match(/(?:v=|youtu\.be\/|embed\/)([a-zA-Z0-9_-]{11})/);
    id = match?.[1];
  }
  if (!id) return res.status(400).json({ error: "Missing videoId or url" });

  for (const lang of ["en", "en-US", "fil", null]) {
    try {
      const { YoutubeTranscript } = require("youtube-transcript");
      const opts = lang ? { lang } : {};
      const segments = await YoutubeTranscript.fetchTranscript(id, opts);
      if (segments?.length > 5) {
        const text = segments.map(s => s.text).join(" ").replace(/\s+/g, " ").trim();
        if (text.length > 200) {
          return res.status(200).json({
            videoId: id, text, lang: lang || "auto",
            wordCount: text.split(" ").length, method: "youtube-transcript",
          });
        }
      }
    } catch { continue; }
  }

  // Fallback: timedtext API
  const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
  for (const lang of ["en", "en-US", "en-GB", "fil", "tl"]) {
    try {
      const r = await fetch(`https://www.youtube.com/api/timedtext?v=${id}&lang=${lang}&fmt=json3`, {
        headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" }
      });
      if (!r.ok) continue;
      const data = await r.json();
      const events = (data?.events || []).filter(e => e.segs);
      if (events.length > 5) {
        const text = events.map(e => e.segs.map(s => s.utf8 || "").join("")).join(" ").replace(/\s+/g, " ").trim();
        if (text.length > 200) return res.status(200).json({ videoId: id, text, lang, wordCount: text.split(" ").length, method: "timedtext" });
      }
    } catch { continue; }
  }

  // Method 3: Invidious public instances
  const INVIDIOUS = [
    "https://inv.nadeko.net",
    "https://invidious.nerdvpn.de",
    "https://iv.ggtyler.dev",
  ];
  for (const instance of INVIDIOUS) {
    try {
      const listRes = await fetch(`${instance}/api/v1/captions/${id}`, {
        headers: { "User-Agent": UA },
        signal: AbortSignal.timeout(6000),
      });
      if (!listRes.ok) continue;
      const { captions } = await listRes.json();
      if (!captions?.length) continue;
      const track =
        captions.find(c => c.languageCode?.startsWith("en")) ||
        captions.find(c => c.languageCode?.startsWith("fil")) ||
        captions[0];
      if (!track?.url) continue;
      const captionRes = await fetch(`${instance}${track.url}`, {
        headers: { "User-Agent": UA },
        signal: AbortSignal.timeout(6000),
      });
      if (!captionRes.ok) continue;
      const xml = await captionRes.text();
      const texts = [...xml.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map(m =>
        m[1]
          .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
          .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\n/g, " ")
      );
      if (texts.length > 5) {
        const text = texts.join(" ").replace(/\s+/g, " ").trim();
        if (text.length > 200) {
          return res.status(200).json({
            videoId: id, text, lang: track.languageCode,
            wordCount: text.split(" ").length, method: "invidious",
          });
        }
      }
    } catch { continue; }
  }

  return res.status(404).json({ error: "No transcript found for this video. It may not have captions enabled." });
};
