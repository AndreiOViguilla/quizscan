const slidingWindows = new Map();
function checkRateLimit(ip, max = 5, windowMs = 60000) {
  const now = Date.now();
  const recent = (slidingWindows.get(ip) || []).filter(t => now - t < windowMs);
  recent.push(now); slidingWindows.set(ip, recent);
  if (slidingWindows.size > 1000) for (const [k, v] of slidingWindows) { if (v.every(t => now - t >= windowMs)) slidingWindows.delete(k); }
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

  const { text, hasImage, page } = req.body || {};
  if (!text && !hasImage) return res.status(400).json({ error: "Empty report" });

  const RESEND_KEY = process.env.RESEND_API_KEY;
  const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
  const FROM = process.env.RESEND_FROM || "onboarding@resend.dev";

  if (!RESEND_KEY || !ADMIN_EMAIL) return res.status(200).json({ ok: true });

  const time = new Date().toLocaleString("en-US", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" });

  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_KEY}` },
      body: JSON.stringify({
        from: `QuizScan Reports <${FROM}>`,
        to: [ADMIN_EMAIL],
        subject: `New report — QuizScan`,
        html: `
<div style="background:#0d0d0d;color:#fff;font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;border-radius:12px;overflow:hidden;">
  <div style="background:#18181b;padding:20px 28px;border-bottom:1px solid #27272a;">
    <span style="font-weight:700;font-size:16px;letter-spacing:-0.3px;">QuizScan</span>
    <span style="margin-left:10px;font-size:12px;color:#71717a;">Report Notification</span>
  </div>
  <div style="padding:28px;">
    <p style="margin:0 0 6px;font-size:12px;color:#71717a;">${time}${page ? ` · ${page}` : ""}</p>
    <h2 style="margin:0 0 16px;font-size:18px;font-weight:700;">New report submitted</h2>
    ${text ? `
    <div style="background:#18181b;border:1px solid #27272a;border-radius:8px;padding:16px;margin-bottom:16px;">
      <p style="margin:0;font-size:14px;line-height:1.6;color:#d4d4d8;">${text.replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>")}</p>
    </div>` : ""}
    ${hasImage ? `<p style="margin:0 0 16px;font-size:13px;color:#a1a1aa;">📎 Image attached — check Firebase for the full image.</p>` : ""}
    <p style="margin:0;font-size:12px;color:#52525b;">View all reports in your Firebase Realtime Database under <code style="color:#a1a1aa;">/feedback</code>.</p>
  </div>
</div>`,
      }),
    });
  } catch {}

  return res.status(200).json({ ok: true });
};
