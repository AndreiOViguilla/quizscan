// Cloudflare Worker: YouTube Transcript Fetcher
// Deploy at: Workers & Pages → Create Worker → paste this → Deploy
// Then add the Worker URL as CF_WORKER_URL in Vercel env vars

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
        },
      });
    }

    const url = new URL(request.url);
    const videoId = url.searchParams.get("videoId");

    if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
      return json({ error: "Invalid videoId" }, 400);
    }

    const UA =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

    for (const lang of ["en", "en-US", "en-GB", "fil", "tl"]) {
      try {
        const r = await fetch(
          `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${lang}&fmt=json3`,
          { headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" } }
        );
        if (!r.ok) continue;
        const data = await r.json();
        const events = (data?.events || []).filter((e) => e.segs);
        if (events.length > 5) {
          const text = events
            .map((e) => e.segs.map((s) => s.utf8 || "").join(""))
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();
          if (text.length > 200)
            return json({ videoId, text, lang, wordCount: text.split(" ").length, method: "cf-worker" });
        }
      } catch {
        continue;
      }
    }

    return json({ error: "No transcript found" }, 404);
  },
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
