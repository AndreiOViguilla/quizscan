module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { messages, model = "Qwen/Qwen2.5-72B-Instruct", maxTokens = 8000 } = req.body;
  if (!messages?.length) return res.status(400).json({ error: "Missing messages" });

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
