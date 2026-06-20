// api/transcript.js
const { YoutubeTranscript } = require("youtube-transcript");

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

  // Block cross-origin requests from unknown origins in production
  if (ALLOWED_ORIGIN) {
    const origin = req.headers["origin"] || req.headers["referer"] || "";
    if (origin && !origin.startsWith(ALLOWED_ORIGIN)) {
      return res.status(403).json({ error: "Forbidden" });
    }
  }

  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || "unknown";
  if (!checkRateLimit(ip)) return res.status(429).json({ error: "Too many requests. Please wait a minute." });

  const { videoId, url } = req.query;
  let id = videoId;
  if (!id && url) {
    const match = url.match(/(?:v=|youtu\.be\/|embed\/)([a-zA-Z0-9_-]{11})/);
    id = match?.[1];
  }
  if (!id) return res.status(400).json({ error: "Missing videoId or url" });

  const YT_KEY = process.env.YOUTUBE_API_KEY;
  const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

  try {
    // Step 1: Try youtube-transcript library (fastest, no API key needed)
    try {
      const segments = await YoutubeTranscript.fetchTranscript(id, { lang: "en" });
      if (segments?.length > 5) {
        const text = segments.map(s => s.text).join(" ").replace(/\s+/g, " ").trim();
        if (text.length > 200) {
          return res.status(200).json({ videoId: id, text, lang: "en", wordCount: text.split(" ").length, method: "youtube-transcript" });
        }
      }
    } catch {}

    // Step 2: Get video info from YouTube Data API
    let videoTitle = "";
    let videoDesc = "";
    if (YT_KEY) {
      try {
        const infoRes = await fetch(
          `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${id}&key=${YT_KEY}`
        );
        const infoData = await infoRes.json();
        const snippet = infoData?.items?.[0]?.snippet;
        if (snippet) {
          videoTitle = snippet.title || "";
          videoDesc = (snippet.description || "").substring(0, 500);
        }
      } catch {}
    }

    // Step 2: Try to get captions list via YouTube Data API
    let captionTracks = [];
    if (YT_KEY) {
      try {
        const capListRes = await fetch(
          `https://www.googleapis.com/youtube/v3/captions?part=snippet&videoId=${id}&key=${YT_KEY}`
        );
        const capListData = await capListRes.json();
        captionTracks = capListData?.items || [];
      } catch {}
    }

    // Step 3: Try timedtext API with multiple language attempts
    const langsToTry = ["en", "en-US", "en-GB", "fil", "tl"];
    
    for (const lang of langsToTry) {
      try {
        // Try json3 format first
        const ttRes = await fetch(
          `https://www.youtube.com/api/timedtext?v=${id}&lang=${lang}&fmt=json3&xorb=2&xobt=3&xovt=3`,
          { headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" } }
        );
        if (ttRes.ok) {
          const ttData = await ttRes.json();
          const events = ttData?.events?.filter(e => e.segs);
          if (events?.length > 5) {
            const text = events
              .map(e => e.segs.map(s => s.utf8 || "").join(""))
              .join(" ")
              .replace(/\n/g, " ")
              .replace(/\s+/g, " ")
              .trim();
            if (text.length > 200) {
              return res.status(200).json({
                videoId: id, text, lang, wordCount: text.split(" ").length,
                method: "timedtext-json3", title: videoTitle
              });
            }
          }
        }
      } catch {}

      try {
        // Try XML format
        const ttRes = await fetch(
          `https://www.youtube.com/api/timedtext?v=${id}&lang=${lang}`,
          { headers: { "User-Agent": UA } }
        );
        if (ttRes.ok) {
          const xml = await ttRes.text();
          if (xml.includes("<text")) {
            const segments = [];
            const regex = /<text[^>]*>([\s\S]*?)<\/text>/g;
            let m;
            while ((m = regex.exec(xml)) !== null) {
              const t = m[1]
                .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
                .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
                .replace(/<[^>]*>/g, "").trim();
              if (t) segments.push(t);
            }
            if (segments.length > 5) {
              const text = segments.join(" ").replace(/\s+/g, " ").trim();
              if (text.length > 200) {
                return res.status(200).json({
                  videoId: id, text, lang, wordCount: text.split(" ").length,
                  method: "timedtext-xml", title: videoTitle
                });
              }
            }
          }
        }
      } catch {}
    }

    // Step 4: Try fetching YouTube page directly for caption URLs
    try {
      const pageRes = await fetch(`https://www.youtube.com/watch?v=${id}&hl=en`, {
        headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" }
      });
      if (pageRes.ok) {
        const html = await pageRes.text();
        
        // Extract caption tracks from page
        const captionMatch = html.match(/"captionTracks":(\[.*?\])/s);
        if (captionMatch) {
          try {
            const tracks = JSON.parse(captionMatch[1]);
            const track = 
              tracks.find(t => t.languageCode === "en" && t.kind !== "asr") ||
              tracks.find(t => t.languageCode === "en") ||
              tracks.find(t => t.languageCode?.startsWith("en")) ||
              tracks.find(t => t.kind === "asr") ||
              tracks[0];

            if (track?.baseUrl) {
              const capRes = await fetch(track.baseUrl, { headers: { "User-Agent": UA } });
              if (capRes.ok) {
                const xml = await capRes.text();
                const segments = [];
                const regex = /<text[^>]*>([\s\S]*?)<\/text>/g;
                let m;
                while ((m = regex.exec(xml)) !== null) {
                  const t = m[1]
                    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
                    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
                    .replace(/<[^>]*>/g, "").trim();
                  if (t) segments.push(t);
                }
                if (segments.length > 0) {
                  const text = segments.join(" ").replace(/\s+/g, " ").trim();
                  return res.status(200).json({
                    videoId: id, text, lang: track.languageCode,
                    wordCount: text.split(" ").length,
                    method: "page-captionTracks", title: videoTitle
                  });
                }
              }
            }
          } catch {}
        }

        // Extract title/description from page as fallback
        if (!videoTitle) {
          const titleMatch = html.match(/<title>([^<]+)<\/title>/);
          videoTitle = (titleMatch?.[1] || "").replace(" - YouTube", "").trim();
          const descMatch = html.match(/"shortDescription":"((?:[^"\\]|\\.)*)"/);
          videoDesc = (descMatch?.[1] || "").replace(/\\n/g, " ").replace(/\\"/g, '"').substring(0, 500);
        }
      }
    } catch {}

    // Step 5: Fall back to title + description
    if (videoTitle) {
      return res.status(200).json({
        videoId: id,
        text: `${videoTitle}. ${videoDesc}`,
        lang: "en", wordCount: 0,
        method: "metadata-only",
        warning: "No transcript found — used video title and description only",
        title: videoTitle
      });
    }

    return res.status(404).json({ error: "Could not retrieve transcript or metadata for this video." });

  } catch (err) {
    return res.status(500).json({ error: `Failed: ${err.message}` });
  }
};