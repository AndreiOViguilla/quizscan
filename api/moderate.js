const BLOCKED = [
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
  /\bsex\b/i,
  /\bnude[s]?\b/i,
  /\bnaked\b/i,
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
  /\btite\b/i,
  /\bpuke\b/i,
  /\bpekpek\b/i,
  /\bbobo\b/i,
  /\btanga\b/i,
  /\bgago\b/i,
  /\bputa\b/i,
  /\bsuso\b/i,
  /\bulol\b/i,
  /\binutile\b/i,
  /\bbwisit\b/i,
  /\bpwet\b/i,
];

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { text, imageBase64 } = req.body;
  if (!text && !imageBase64) return res.status(400).json({ error: "Missing content" });
  if (text && typeof text !== "string") return res.status(400).json({ error: "Invalid text" });
  if (text && text.length > 1000) return res.status(400).json({ error: "Text too long" });

  // Regex layer on text
  if (text && BLOCKED.some(pat => pat.test(text))) {
    return res.status(200).json({ flagged: true });
  }

  const key = process.env.OPENAI_API_KEY;
  if (!key) return res.status(200).json({ flagged: false });

  try {
    let input;
    if (imageBase64 && text) {
      input = [
        { type: "text", text: text.trim() },
        { type: "image_url", image_url: { url: imageBase64 } },
      ];
    } else if (imageBase64) {
      input = [{ type: "image_url", image_url: { url: imageBase64 } }];
    } else {
      input = text.trim();
    }

    const r = await fetch("https://api.openai.com/v1/moderations", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: "omni-moderation-latest", input }),
    });
    if (!r.ok) return res.status(200).json({ flagged: false });
    const d = await r.json();
    const result = d.results?.[0] ?? { flagged: false };
    return res.status(200).json({ flagged: result.flagged, categories: result.categories });
  } catch {
    return res.status(200).json({ flagged: false });
  }
};
