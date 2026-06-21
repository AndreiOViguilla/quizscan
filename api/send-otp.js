const crypto = require("crypto");

const FB_URL = "https://quizscan-94acb-default-rtdb.asia-southeast1.firebasedatabase.app";

function emailToKey(email) {
  return email.toLowerCase().replace(/[.#$[\]@]/g, "_");
}

async function fbGet(path) {
  try {
    const r = await fetch(`${FB_URL}${path}.json`);
    if (!r.ok) return null;
    return r.json();
  } catch { return null; }
}

async function fbSet(path, data) {
  await fetch(`${FB_URL}${path}.json`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).end();

  const { email } = req.body || {};
  if (!email || !email.includes("@")) {
    return res.status(400).json({ error: "Valid email required." });
  }

  const key = emailToKey(email);
  const now = Date.now();

  // Rate limit: max 3 codes per email per 15 minutes
  const existing = await fbGet(`/otps/${key}`);
  if (existing) {
    const windowExpiry = (existing.windowStart || 0) + 15 * 60 * 1000;
    if (now < windowExpiry && (existing.sendCount || 0) >= 3) {
      const mins = Math.ceil((windowExpiry - now) / 60000);
      return res.status(429).json({ error: `Too many requests. Try again in ${mins} minute${mins !== 1 ? "s" : ""}.` });
    }
  }

  // Generate 6-digit OTP and store hash (never store the raw code)
  const otp = crypto.randomInt(100000, 999999).toString();
  const hash = crypto.createHash("sha256").update(otp).digest("hex");

  const inWindow = existing && now < (existing.windowStart || 0) + 15 * 60 * 1000;
  await fbSet(`/otps/${key}`, {
    hash,
    expiresAt: now + 10 * 60 * 1000,
    attempts: 0,
    sendCount: inWindow ? (existing.sendCount || 0) + 1 : 1,
    windowStart: inWindow ? existing.windowStart : now,
  });

  const RESEND_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_KEY) {
    // Dev fallback: print to server logs
    console.log(`[DEV] OTP for ${email}: ${otp}`);
    return res.status(200).json({ ok: true });
  }

  // RESEND_FROM must be a Resend-verified sending domain (e.g. noreply@yourdomain.com)
  const FROM = process.env.RESEND_FROM || "onboarding@resend.dev";

  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_KEY}`,
      },
      body: JSON.stringify({
        from: `QuizScan <${FROM}>`,
        to: [email],
        subject: `${otp} — your QuizScan reset code`,
        html: `
<div style="background:#0d0d0d;color:#fff;font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;border-radius:12px;overflow:hidden;">
  <div style="background:#18181b;padding:24px 32px;border-bottom:1px solid #27272a;">
    <span style="font-weight:700;font-size:18px;letter-spacing:-0.5px;">QuizScan</span>
  </div>
  <div style="padding:32px;">
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;">Reset your password</h2>
    <p style="margin:0 0 28px;color:#a1a1aa;font-size:14px;line-height:1.5;">
      Enter this code in the app to continue. It expires in
      <strong style="color:#fff;">10 minutes</strong> and can only be used once.
    </p>
    <div style="background:#18181b;border:1px solid #27272a;border-radius:10px;padding:24px 0;text-align:center;margin-bottom:28px;">
      <span style="font-size:40px;font-weight:700;letter-spacing:14px;font-family:monospace;">${otp}</span>
    </div>
    <p style="margin:0;color:#52525b;font-size:12px;line-height:1.5;">
      If you didn't request a password reset, you can safely ignore this email.
    </p>
  </div>
</div>`,
      }),
    });

    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      console.error("Resend error:", err);
      return res.status(500).json({ error: "Failed to send email. Try again later." });
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("send-otp error:", e);
    return res.status(500).json({ error: "Failed to send email." });
  }
};
