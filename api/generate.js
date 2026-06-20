const crypto = require("crypto");

// Simple per-IP rate limit: 10 requests/minute per instance
const rateLimits = new Map();
function checkRateLimit(ip, max = 10, windowMs = 60000) {
  const now = Date.now();
  const entry = rateLimits.get(ip) || { count: 0, reset: now + windowMs };
  if (now > entry.reset) { entry.count = 0; entry.reset = now + windowMs; }
  entry.count++;
  rateLimits.set(ip, entry);
  if (rateLimits.size > 500) {
    for (const [k, v] of rateLimits) { if (now > v.reset) rateLimits.delete(k); }
  }
  return entry.count <= max;
}

function verifySignature(bodyStr, ts, sig) {
  const secret = process.env.GENERATE_SECRET;
  if (!secret) return true; // skip check if secret not configured
  if (!ts || !sig) return false;
  const age = Math.abs(Date.now() - parseInt(ts));
  if (age > 30000) return false; // reject requests older than 30s
  const expected = crypto.createHmac("sha256", secret).update(ts + bodyStr).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"));
  } catch { return false; }
}

const MAX_MESSAGES = 12;
const MAX_CONTENT_LENGTH = 12000; // chars across all messages

module.exports = async function handler(req, res) {
  const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "";
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Timestamp, X-Signature");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (ALLOWED_ORIGIN) {
    const origin = req.headers["origin"] || req.headers["referer"] || "";
    if (origin && !origin.startsWith(ALLOWED_ORIGIN)) {
      return res.status(403).json({ error: "Forbidden" });
    }
  }

  // Rate limit by IP
  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || "unknown";
  if (!checkRateLimit(ip)) return res.status(429).json({ error: "Too many requests. Please wait a minute." });

  // Verify HMAC signature
  const bodyStr = JSON.stringify(req.body);
  const ts = req.headers["x-timestamp"];
  const sig = req.headers["x-signature"];
  if (!verifySignature(bodyStr, ts, sig)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { messages, model = "Qwen/Qwen2.5-72B-Instruct", maxTokens = 8000 } = req.body;
  if (!messages?.length) return res.status(400).json({ error: "Missing messages" });

  // Server-side size limits
  if (messages.length > MAX_MESSAGES) return res.status(400).json({ error: "Too many messages" });
  const totalLength = messages.reduce((sum, m) => {
    const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
    return sum + content.length;
  }, 0);
  if (totalLength > MAX_CONTENT_LENGTH) return res.status(400).json({ error: "Content too large" });

  const HF_TOKEN = process.env.HF_TOKEN;
  const HF_SPACE_URL = process.env.HF_SPACE_URL; // e.g. https://yourusername-quizscan-model.hf.space

  // 1. Try HF Serverless API (large model, best quality)
  if (HF_TOKEN) {
    try {
      const hfRes = await fetch(
        `https://api-inference.huggingface.co/models/${model}/v1/chat/completions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${HF_TOKEN}` },
          body: JSON.stringify({ model, messages, max_tokens: maxTokens }),
        }
      );
      if (hfRes.ok) {
        const data = await hfRes.json();
        const content = data.choices?.[0]?.message?.content || "";
        if (content) return res.status(200).json({ content, provider: "hf-serverless" });
      }
      // 429 = rate limited, 503 = model overloaded — fall through to Space
    } catch {}
  }

  // 2. Try HF Space (small model, your own Space — free CPU fallback)
  if (HF_SPACE_URL) {
    try {
      const spaceRes = await fetch(`${HF_SPACE_URL}/api/predict`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: [JSON.stringify(messages), maxTokens] }),
      });
      if (spaceRes.ok) {
        const data = await spaceRes.json();
        const content = data.data?.[0] || "";
        if (content) return res.status(200).json({ content, provider: "hf-space" });
      }
    } catch {}
  }

  // Both HF options failed — tell frontend to fall back to Groq
  return res.status(503).json({ error: "HF unavailable" });
};
