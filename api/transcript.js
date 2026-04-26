// api/transcript.js
// Fetches YouTube transcript directly — no npm packages needed

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

  try {
    // Fetch YouTube watch page
    const pageRes = await fetch(`https://www.youtube.com/watch?v=${id}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      }
    });
    if (!pageRes.ok) throw new Error(`YouTube returned ${pageRes.status}`);
    const html = await pageRes.text();

    // Extract player data
    const playerMatch = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\})\s*;/s);
    if (!playerMatch) throw new Error("Could not find player data on page");

    const playerData = JSON.parse(playerMatch[1]);
    const captions = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

    if (!captions || captions.length === 0) {
      return res.status(404).json({ error: "No captions available for this video. Try a video with subtitles enabled." });
    }

    // Prefer English, then auto-generated, then first available
    const track =
      captions.find(t => t.languageCode === "en") ||
      captions.find(t => t.languageCode?.startsWith("en")) ||
      captions.find(t => t.kind === "asr") ||
      captions[0];

    if (!track?.baseUrl) throw new Error("No valid caption URL found");

    // Fetch the caption XML
    const captionRes = await fetch(track.baseUrl, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });
    if (!captionRes.ok) throw new Error(`Caption fetch failed: ${captionRes.status}`);
    const xml = await captionRes.text();

    // Parse XML: <text start="x" dur="y">content</text>
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

    if (!segments.length) throw new Error("No caption text found");

    const text = segments.join(" ")
      .replace(/\[.*?\]/g, "")
      .replace(/\s+/g, " ")
      .trim();

    return res.status(200).json({ videoId: id, text, lang: track.languageCode, wordCount: text.split(" ").length });

  } catch (err) {
    return res.status(500).json({ error: `Failed: ${err.message}` });
  }
};
