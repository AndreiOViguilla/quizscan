// api/transcript.js
// Vercel Serverless Function — fetches YouTube transcript server-side
// No CORS issues, no API key needed, completely free
// Deploy to Vercel and call from frontend as /api/transcript?videoId=xxx

const { YoutubeTranscript } = require("youtube-transcript");

module.exports = async function handler(req, res) {
  // Allow CORS for local dev and production
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const { videoId, url } = req.query;

  // Extract video ID from URL if provided
  let id = videoId;
  if (!id && url) {
    const match = url.match(/(?:v=|youtu\.be\/|embed\/)([a-zA-Z0-9_-]{11})/);
    id = match?.[1];
  }

  if (!id) {
    return res.status(400).json({ error: "Missing videoId or url parameter" });
  }

  try {
    const transcript = await YoutubeTranscript.fetchTranscript(id, { lang: "en" });

    if (!transcript || transcript.length === 0) {
      return res.status(404).json({ error: "No transcript found for this video. The video may not have captions enabled." });
    }

    // Join all transcript segments into plain text
    const text = transcript
      .map(t => t.text.trim())
      .filter(Boolean)
      .join(" ")
      .replace(/\[.*?\]/g, "") // remove [Music] [Applause] etc
      .replace(/\s+/g, " ")
      .trim();

    return res.status(200).json({
      videoId: id,
      text,
      segments: transcript.length,
      wordCount: text.split(" ").length,
    });
  } catch (err) {
    // If English transcript fails, try without language preference
    try {
      const transcript = await YoutubeTranscript.fetchTranscript(id);
      const text = transcript.map(t => t.text.trim()).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
      return res.status(200).json({ videoId: id, text, segments: transcript.length, wordCount: text.split(" ").length });
    } catch (err2) {
      return res.status(500).json({
        error: `Could not fetch transcript: ${err2.message}. The video may be private, age-restricted, or have no captions.`
      });
    }
  }
};
