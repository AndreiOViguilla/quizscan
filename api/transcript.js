// api/transcript.js
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { videoId, url } = req.query;
  let id = videoId;
  if (!id && url) {
    const match = url.match(/(?:v=|youtu\.be\/|embed\/)([a-zA-Z0-9_-]{11})/);
    id = match?.[1];
  }
  if (!id) return res.status(400).json({ error: "Missing videoId or url" });

  const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

  try {
    // Fetch YouTube watch page
    const pageRes = await fetch(`https://www.youtube.com/watch?v=${id}&hl=en`, {
      headers: {
        "User-Agent": UA,
        "Accept-Language": "en-US,en;q=0.9",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      }
    });
    if (!pageRes.ok) throw new Error(`YouTube returned ${pageRes.status}`);
    const html = await pageRes.text();

    // Try method 1: ytInitialPlayerResponse (standard)
    let captions = null;
    const playerMatch = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\})\s*;/s);
    if (playerMatch) {
      try {
        const playerData = JSON.parse(playerMatch[1]);
        captions = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      } catch {}
    }

    // Try method 2: look for caption tracks directly in HTML
    if (!captions || captions.length === 0) {
      const captionMatch = html.match(/"captionTracks":(\[.*?\])/s);
      if (captionMatch) {
        try {
          captions = JSON.parse(captionMatch[1]);
        } catch {}
      }
    }

    // Try method 3: timedtext API directly
    if (!captions || captions.length === 0) {
      const timedTextUrl = `https://www.youtube.com/api/timedtext?v=${id}&lang=en&fmt=json3`;
      try {
        const ttRes = await fetch(timedTextUrl, { headers: { "User-Agent": UA } });
        if (ttRes.ok) {
          const ttData = await ttRes.json();
          const events = ttData?.events?.filter(e => e.segs);
          if (events?.length) {
            const text = events
              .map(e => e.segs.map(s => s.utf8).join(""))
              .join(" ")
              .replace(/\s+/g, " ")
              .trim();
            if (text.length > 100) {
              return res.status(200).json({ videoId: id, text, lang: "en", wordCount: text.split(" ").length, method: "timedtext" });
            }
          }
        }
      } catch {}
    }

    // Try method 4: youtube-transcript style — get list first
    if (!captions || captions.length === 0) {
      const listUrl = `https://www.youtube.com/api/timedtext?v=${id}&type=list`;
      try {
        const listRes = await fetch(listUrl, { headers: { "User-Agent": UA } });
        if (listRes.ok) {
          const listXml = await listRes.text();
          const langMatch = listXml.match(/lang_code="([^"]+)"/);
          if (langMatch) {
            const lang = langMatch[1];
            const ttRes = await fetch(`https://www.youtube.com/api/timedtext?v=${id}&lang=${lang}&fmt=json3`, {
              headers: { "User-Agent": UA }
            });
            if (ttRes.ok) {
              const ttData = await ttRes.json();
              const events = ttData?.events?.filter(e => e.segs);
              if (events?.length) {
                const text = events.map(e => e.segs.map(s => s.utf8).join("")).join(" ").replace(/\s+/g, " ").trim();
                if (text.length > 100) {
                  return res.status(200).json({ videoId: id, text, lang, wordCount: text.split(" ").length, method: "timedtext-list" });
                }
              }
            }
          }
        }
      } catch {}
    }

    if (!captions || captions.length === 0) {
      // Last resort: return page metadata
      const titleMatch = html.match(/<title>([^<]+)<\/title>/);
      const title = (titleMatch?.[1] || "").replace(" - YouTube", "").trim();
      const descMatch = html.match(/"shortDescription":"((?:[^"\\]|\\.)*)"/);
      const desc = descMatch?.[1]?.replace(/\\n/g, " ").replace(/\\"/g, '"').substring(0, 1000) || "";
      if (title) {
        return res.status(200).json({ videoId: id, text: `${title}. ${desc}`, lang: "en", wordCount: 0, method: "metadata-only", warning: "No captions found, used title/description only" });
      }
      return res.status(404).json({ error: "No captions available for this video." });
    }

    // Pick best track
    const track =
      captions.find(t => t.languageCode === "en" && t.kind !== "asr") ||
      captions.find(t => t.languageCode === "en") ||
      captions.find(t => t.languageCode?.startsWith("en")) ||
      captions.find(t => t.kind === "asr") ||
      captions[0];

    if (!track?.baseUrl) throw new Error("No valid caption URL found");

    const captionRes = await fetch(track.baseUrl, { headers: { "User-Agent": UA } });
    if (!captionRes.ok) throw new Error(`Caption fetch failed: ${captionRes.status}`);
    const xml = await captionRes.text();

    const segments = [];
    const regex = /<text[^>]*>([\s\S]*?)<\/text>/g;
    let match;
    while ((match = regex.exec(xml)) !== null) {
      const text = match[1]
        .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
        .replace(/<[^>]*>/g, "").trim();
      if (text) segments.push(text);
    }

    if (!segments.length) throw new Error("No caption text found in XML");

    const text = segments.join(" ").replace(/\[.*?\]/g, "").replace(/\s+/g, " ").trim();
    return res.status(200).json({ videoId: id, text, lang: track.languageCode, wordCount: text.split(" ").length, method: "captionTracks" });

  } catch (err) {
    return res.status(500).json({ error: `Failed: ${err.message}` });
  }
};