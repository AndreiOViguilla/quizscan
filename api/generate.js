const crypto = require("crypto");

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

async function verifyTurnstile(token) {
  const secret = process.env.TURNSTILE_SECRET;
  if (!secret || !token) return true;
  try {
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, response: token }),
    });
    const d = await r.json();
    return d.success === true;
  } catch { return true; }
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

const INAPPROPRIATE_PATTERNS = [
  /\bf[\W_]*u[\W_]*c[\W_]*k/i,
  /\bs[\W_]*h[\W_]*i[\W_]*t/i,
  /\ba[\W_]*s[\W_]*s[\W_]*h[\W_]*o[\W_]*l[\W_]*e/i,
  /\bb[\W_]*i[\W_]*t[\W_]*c[\W_]*h/i,
  /\bc[\W_]*u[\W_]*n[\W_]*t\b/i,
  /\bn[\W_]*i[\W_]*g[\W_]*g[\W_]*[ae]/i,
  /\bf[\W_]*a[\W_]*g[\W_]*g/i,
  /\bporn(ograph\w*)?/i,
  /\bxxx\b/i,
  /\bhentai\b/i,
  /\bsex\s+tape\b/i,
  /\bnude[s]?\b/i,
  /\bchild\s+(porn|sex|nude|naked)\b/i,
  /\bhow\s+to\s+(make|build|synthesize|create)\s+(bomb|drug|meth|cocaine|explosiv)/i,
  /\bhow\s+to\s+(kill|murder|poison|assault)\s+(a\s+)?(person|someone|people|human)/i,
  /\bsuicide\s+(method|instruction|how\s+to|step)/i,
  // Tagalog profanity
  /\bputa[ng\s]+ina\b/i,
  /putangina/i,
  /\bputcha\b/i,
  /\bpucha\b/i,
  /\bkingina\b/i,
  /\bkupal\b/i,
  /\btarantado\b/i,
  /\bhinayupak\b/i,
  /pakshet/i,
  /pakingshet/i,
  /\bpakyu\b/i,
  /\bhindot\b/i,
  /\bkantot\b/i,
  /\bjakol\b/i,
  /\bbilat\b/i,
  /\byawa\b/i,
  /\bputragis\b/i,
];
function containsInappropriate(messages) {
  return messages.some(m => {
    const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
    return INAPPROPRIATE_PATTERNS.some(pat => pat.test(content));
  });
}

async function moderateText(text) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { flagged: false };
  try {
    const r = await fetch("https://api.openai.com/v1/moderations", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: "omni-moderation-latest", input: text }),
    });
    if (!r.ok) return { flagged: false };
    const d = await r.json();
    return d.results?.[0] ?? { flagged: false };
  } catch {
    return { flagged: false };
  }
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

  const { messages, model = "Qwen/Qwen2.5-72B-Instruct", maxTokens = 8000, cfToken } = req.body;
  if (!messages?.length) return res.status(400).json({ error: "Missing messages" });


  // Server-side size limits
  if (messages.length > MAX_MESSAGES) return res.status(400).json({ error: "Too many messages" });
  const totalLength = messages.reduce((sum, m) => {
    const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
    return sum + content.length;
  }, 0);
  if (totalLength > MAX_CONTENT_LENGTH) return res.status(400).json({ error: "Content too large" });

  if (containsInappropriate(messages)) {
    return res.status(400).json({ error: "Content not allowed." });
  }

  // OpenAI moderation on input
  const inputText = messages.map(m => (typeof m.content === "string" ? m.content : JSON.stringify(m.content))).join("\n");
  const inputMod = await moderateText(inputText);
  if (inputMod.flagged) {
    return res.status(400).json({ error: "Content not allowed." });
  }

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
        if (content) {
          const outMod = await moderateText(content);
          if (outMod.flagged) return res.status(400).json({ error: "Generated content was flagged. Try a different topic." });
          return res.status(200).json({ content, provider: "hf-serverless" });
        }
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
        if (content) {
          const outMod = await moderateText(content);
          if (outMod.flagged) return res.status(400).json({ error: "Generated content was flagged. Try a different topic." });
          return res.status(200).json({ content, provider: "hf-space" });
        }
      }
    } catch {}
  }

  // Both HF options failed — tell frontend to fall back to Groq
  return res.status(503).json({ error: "HF unavailable" });
};
