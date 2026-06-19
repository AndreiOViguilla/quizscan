module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { messages, model = "llama-3.3-70b-versatile", maxTokens = 8000 } = req.body;
  if (!messages?.length) return res.status(400).json({ error: "Missing messages" });

  const GROQ_KEY = process.env.GROQ_KEY;
  if (!GROQ_KEY) return res.status(500).json({ error: "GROQ_KEY not configured" });

  try {
    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${GROQ_KEY}` },
      body: JSON.stringify({ model, max_tokens: maxTokens, messages }),
    });
    const data = await groqRes.json();
    if (data.error) return res.status(502).json({ error: data.error.message });
    const content = data.choices?.[0]?.message?.content || "";
    if (!content) return res.status(502).json({ error: "Empty response from Groq" });
    return res.status(200).json({ content });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
