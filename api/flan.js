const slidingWindows = new Map();
function checkRateLimit(ip, max = 8, windowMs = 60000) {
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
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || "unknown";
  if (!checkRateLimit(ip)) return res.status(429).json({ error: "Too many requests." });

  const { items } = req.body || {};
  if (!items || !Array.isArray(items) || items.length === 0)
    return res.status(400).json({ error: "Missing items array" });
  if (items.length > 8)
    return res.status(400).json({ error: "Max 8 items per request" });

  const token = process.env.HF_TOKEN;
  if (!token) return res.status(503).json({ error: "Not configured" });

  // valhalla/t5-base-qg-hl prompt format:
  // "generate question: <hl> {answer_span} <hl> {full_sentence}"
  // The model was fine-tuned on SQuAD and generates natural questions about the highlighted span.
  const inputs = items.map(({ sentence, answer }) =>
    `generate question: <hl> ${answer} <hl> ${sentence.slice(0, 400)}`
  );

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 15000);
  try {
    const r = await fetch(
      "https://api-inference.huggingface.co/models/valhalla/t5-base-qg-hl",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          inputs,
          parameters: { max_new_tokens: 64, do_sample: false },
        }),
        signal: ac.signal,
      }
    );
    clearTimeout(timer);

    // 503 = model loading on HF free tier — return empty rather than blocking
    if (r.status === 503) return res.status(200).json({ questions: [] });

    const data = await r.json().catch(() => null);
    if (!r.ok || !Array.isArray(data)) return res.status(200).json({ questions: [] });

    const questions = data.map((item, i) => {
      const question = (item?.generated_text || "").trim();
      if (!question.endsWith("?") || question.length < 10) return null;
      return {
        question,
        answer: items[i].answer,
        sentence: items[i].sentence,
      };
    }).filter(Boolean);

    return res.status(200).json({ questions });
  } catch {
    clearTimeout(timer);
    return res.status(200).json({ questions: [] });
  }
};
