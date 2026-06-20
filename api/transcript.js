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

  const { videoId, url, debug } = req.query;
  let id = videoId;
  if (!id && url) {
    const match = url.match(/(?:v=|youtu\.be\/|embed\/)([a-zA-Z0-9_-]{11})/);
    id = match?.[1];
  }
  if (!id) return res.status(400).json({ error: "Missing videoId or url" });

  const log = [];

  // Method 1: youtube-transcript library
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
      log.push(`yt-lib(${lang}): ok but empty`);
    } catch (e) { log.push(`yt-lib(${lang}): ${e.message?.slice(0, 80)}`); }
  }

  // Method 2: timedtext API
  const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
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
      log.push(`timedtext(${lang}): ok but ${events.length} events`);
    } catch (e) { log.push(`timedtext(${lang}): ${e.message?.slice(0, 80)}`); }
  }

  // Method 3: Invidious public instances
  const INVIDIOUS = [
    "https://inv.nadeko.net",
    "https://yewtu.be",
    "https://invidious.nerdvpn.de",
    "https://iv.ggtyler.dev",
    "https://invidious.privacyredirect.com",
  ];
  for (const instance of INVIDIOUS) {
    try {
      const listRes = await fetch(`${instance}/api/v1/captions/${id}`, {
        headers: { "User-Agent": UA },
        signal: AbortSignal.timeout(6000),
      });
      if (!listRes.ok) { log.push(`invidious(${instance}): list HTTP ${listRes.status}`); continue; }
      const { captions } = await listRes.json();
      if (!captions?.length) { log.push(`invidious(${instance}): no captions`); continue; }
      const track =
        captions.find(c => c.languageCode?.startsWith("en")) ||
        captions.find(c => c.languageCode?.startsWith("fil")) ||
        captions[0];
      if (!track?.url) { log.push(`invidious(${instance}): no url`); continue; }
      const captionRes = await fetch(`${instance}${track.url}`, {
        headers: { "User-Agent": UA },
        signal: AbortSignal.timeout(6000),
      });
      if (!captionRes.ok) { log.push(`invidious(${instance}): caption HTTP ${captionRes.status}`); continue; }
      const raw = await captionRes.text();
      log.push(`invidious(${instance}): raw ${raw.length} chars, starts: ${raw.slice(0, 80).replace(/\n/g, " ")}`);

      const htmlDecode = s => s
        .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
        .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\n/g, " ");

      let text = "";
      // JSON3
      try {
        const data = JSON.parse(raw);
        const events = (data?.events || []).filter(e => e.segs);
        if (events.length > 5)
          text = events.map(e => e.segs.map(s => s.utf8 || "").join("")).join(" ").replace(/\s+/g, " ").trim();
      } catch {}
      // SRV/XML: <text ...>content</text>
      if (!text) {
        const m = [...raw.matchAll(/<text[^>]*>([^<]*)<\/text>/g)];
        if (m.length > 5) text = m.map(x => htmlDecode(x[1])).join(" ").replace(/\s+/g, " ").trim();
      }
      // TTML: <p ...>content</p>
      if (!text) {
        const m = [...raw.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)];
        if (m.length > 5) text = m.map(x => htmlDecode(x[1].replace(/<[^>]+>/g, ""))).join(" ").replace(/\s+/g, " ").trim();
      }
      // VTT/SRT: plain text lines
      if (!text) {
        const lines = raw.split("\n")
          .filter(l => l.trim() && !/^\d+$/.test(l.trim()) && !l.includes("-->") && !/^WEBVTT/.test(l.trim()));
        if (lines.length > 5) text = lines.join(" ").replace(/\s+/g, " ").trim();
      }

      if (text.length > 200) {
        return res.status(200).json({
          videoId: id, text, lang: track.languageCode,
          wordCount: text.split(" ").length, method: "invidious",
        });
      }
      log.push(`invidious(${instance}): parsed text too short (${text.length} chars)`);
    } catch (e) { log.push(`invidious(${instance}): ${e.message?.slice(0, 80)}`); }
  }

  // Method 4: Cloudflare Worker proxy
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
        log.push(`cf-worker: ok but empty`);
      } else {
        log.push(`cf-worker: HTTP ${r.status}`);
      }
    } catch (e) { log.push(`cf-worker: ${e.message?.slice(0, 80)}`); }
  } else {
    log.push("cf-worker: CF_WORKER_URL not set");
  }

  return res.status(404).json({
    error: "No transcript found for this video. It may not have captions enabled.",
    ...(debug === "1" && { debug: log }),
  });
};
