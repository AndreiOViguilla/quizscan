// api/transcript.js

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

  const { videoId, url, debug } = req.query;
  const debugAllowed = process.env.DEBUG_SECRET && debug === process.env.DEBUG_SECRET;
  let id = videoId;
  if (!id && url) {
    const match = url.match(/(?:v=|youtu\.be\/|embed\/)([a-zA-Z0-9_-]{11})/);
    id = match?.[1];
  }
  if (!id) return res.status(400).json({ error: "Missing videoId or url" });

  const log = [];
  const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

  // Method 1: youtube-transcript library
  for (const lang of ["en", "en-US", "fil", null]) {
    try {
      const { YoutubeTranscript } = require("youtube-transcript");
      const segments = await YoutubeTranscript.fetchTranscript(id, lang ? { lang } : {});
      if (segments?.length > 5) {
        const text = segments.map(s => s.text).join(" ").replace(/\s+/g, " ").trim();
        if (text.length > 200) {
          return res.status(200).json({ videoId: id, text, lang: lang || "auto", wordCount: text.split(" ").length, method: "youtube-transcript" });
        }
      }
      log.push(`yt-lib(${lang}): ok but empty`);
    } catch (e) { log.push(`yt-lib(${lang}): ${e.message?.slice(0, 60)}`); }
  }

  // Method 2: timedtext API
  for (const lang of ["en", "en-US", "en-GB", "fil", "tl"]) {
    try {
      const r = await fetch(`https://www.youtube.com/api/timedtext?v=${id}&lang=${lang}&fmt=json3`, {
        headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" }
      });
      if (!r.ok) { log.push(`timedtext(${lang}): HTTP ${r.status}`); continue; }
      const data = await r.json();
      const events = (data?.events || []).filter(e => e.segs);
      if (events.length > 5) {
        const text = events.map(e => e.segs.map(s => s.utf8 || "").join("")).join(" ").replace(/\s+/g, " ").trim();
        if (text.length > 200) return res.status(200).json({ videoId: id, text, lang, wordCount: text.split(" ").length, method: "timedtext" });
      }
      log.push(`timedtext(${lang}): empty`);
    } catch (e) { log.push(`timedtext(${lang}): ${e.message?.slice(0, 60)}`); }
  }

  // Method 3: Cloudflare Worker proxy
  const CF_WORKER_URL = process.env.CF_WORKER_URL;
  if (CF_WORKER_URL) {
    try {
      const r = await fetch(`${CF_WORKER_URL}?videoId=${id}`, {
        headers: { "User-Agent": UA },
        signal: AbortSignal.timeout(10000),
      });
      if (r.ok) {
        const data = await r.json();
        if (data.text && data.text.length > 200) {
          return res.status(200).json({ ...data, videoId: id });
        }
        log.push(`cf-worker: empty`);
      } else {
        log.push(`cf-worker: HTTP ${r.status}`);
      }
    } catch (e) { log.push(`cf-worker: ${e.message?.slice(0, 60)}`); }
  }

  // Method 4: Supadata API
  const SUPADATA_KEY = process.env.SUPADATA_API_KEY;
  if (SUPADATA_KEY) {
    try {
      const ytUrl = encodeURIComponent(`https://www.youtube.com/watch?v=${id}`);
      const r = await fetch(`https://api.supadata.ai/v1/transcript?url=${ytUrl}`, {
        headers: { "x-api-key": SUPADATA_KEY },
        signal: AbortSignal.timeout(15000),
      });
      if (r.ok) {
        const data = await r.json();
        if (data.content?.length > 5) {
          const text = data.content.map(s => s.text).join(" ").replace(/\s+/g, " ").trim();
          if (text.length > 200) {
            return res.status(200).json({
              videoId: id, text, lang: data.content[0]?.lang || "en",
              wordCount: text.split(" ").length, method: "supadata",
            });
          }
          log.push(`supadata: text too short (${text.length} chars)`);
        } else if (data.jobId) {
          log.push(`supadata: returned jobId (async, video too large)`);
        } else {
          log.push(`supadata: empty content`);
        }
      } else {
        const err = await r.json().catch(() => ({}));
        log.push(`supadata: HTTP ${r.status} - ${err.message || ""}`);
      }
    } catch (e) { log.push(`supadata: ${e.message?.slice(0, 60)}`); }
  } else {
    log.push("supadata: SUPADATA_API_KEY not set");
  }

  return res.status(404).json({
    error: "No transcript found for this video. It may not have captions enabled.",
    ...(debugAllowed && { debug: log }),
  });
};
