const crypto = require("crypto");

const FB_URL = "https://quizscan-94acb-default-rtdb.asia-southeast1.firebasedatabase.app";

function emailToKey(email) {
  return email.toLowerCase().replace(/[.#$[\]@]/g, "_");
}
async function fbGet(path) {
  try { const r = await fetch(`${FB_URL}${path}.json`); return r.ok ? r.json() : null; } catch { return null; }
}
async function fbSet(path, data) {
  await fetch(`${FB_URL}${path}.json`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
}
async function fbDelete(path) {
  await fetch(`${FB_URL}${path}.json`, { method: "DELETE" });
}

const slidingWindows = new Map();
function checkRateLimit(ip, max = 10, windowMs = 60000) {
  const now = Date.now();
  const recent = (slidingWindows.get(ip) || []).filter(t => now - t < windowMs);
  recent.push(now); slidingWindows.set(ip, recent);
  if (slidingWindows.size > 1000) for (const [k, v] of slidingWindows) { if (v.every(t => now - t >= windowMs)) slidingWindows.delete(k); }
  return recent.length <= max;
}

async function handleSend(email, res) {
  const key = emailToKey(email);
  const now = Date.now();
  const existing = await fbGet(`/otps/${key}`);
  if (existing) {
    const windowExpiry = (existing.windowStart || 0) + 15 * 60 * 1000;
    if (now < windowExpiry && (existing.sendCount || 0) >= 3) {
      const mins = Math.ceil((windowExpiry - now) / 60000);
      return res.status(429).json({ error: `Too many requests. Try again in ${mins} minute${mins !== 1 ? "s" : ""}.` });
    }
  }
  const otp = crypto.randomInt(100000, 999999).toString();
  const hash = crypto.createHash("sha256").update(otp).digest("hex");
  const inWindow = existing && now < (existing.windowStart || 0) + 15 * 60 * 1000;
  await fbSet(`/otps/${key}`, {
    hash, expiresAt: now + 10 * 60 * 1000, attempts: 0,
    sendCount: inWindow ? (existing.sendCount || 0) + 1 : 1,
    windowStart: inWindow ? existing.windowStart : now,
  });

  const RESEND_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_KEY) { console.log(`[DEV] OTP for ${email}: ${otp}`); return res.status(200).json({ ok: true }); }

  const FROM = process.env.RESEND_FROM || "onboarding@resend.dev";
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_KEY}` },
      body: JSON.stringify({
        from: `QuizScan <${FROM}>`, to: [email],
        subject: `${otp} — your QuizScan reset code`,
        html: `<div style="background:#0d0d0d;color:#fff;font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;border-radius:12px;overflow:hidden;">
  <div style="background:#18181b;padding:24px 32px;border-bottom:1px solid #27272a;"><span style="font-weight:700;font-size:18px;letter-spacing:-0.5px;">QuizScan</span></div>
  <div style="padding:32px;">
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;">Reset your password</h2>
    <p style="margin:0 0 28px;color:#a1a1aa;font-size:14px;line-height:1.5;">Enter this code in the app to continue. It expires in <strong style="color:#fff;">10 minutes</strong> and can only be used once.</p>
    <div style="background:#18181b;border:1px solid #27272a;border-radius:10px;padding:24px 0;text-align:center;margin-bottom:28px;">
      <span style="font-size:40px;font-weight:700;letter-spacing:14px;font-family:monospace;">${otp}</span>
    </div>
    <div style="text-align:center;margin-bottom:28px;">
      <a href="${process.env.APP_URL || "https://quizscan.vercel.app"}?reset=1" style="display:inline-block;background:#fff;color:#000;font-weight:700;font-size:14px;padding:12px 32px;border-radius:8px;text-decoration:none;letter-spacing:-0.2px;">Go to QuizScan →</a>
    </div>
    <p style="margin:0;color:#52525b;font-size:12px;">If you didn't request a password reset, you can safely ignore this email.</p>
  </div>
</div>`,
      }),
    });
    // Always return success — never reveal if email exists or send failed
    return res.status(200).json({ ok: true });
  } catch { return res.status(200).json({ ok: true }); }
}

async function handleVerify(email, otp, res) {
  const key = emailToKey(email);
  const now = Date.now();
  const stored = await fbGet(`/otps/${key}`);
  if (!stored) return res.status(400).json({ error: "No reset code found. Request a new one." });
  if (now > stored.expiresAt) { await fbDelete(`/otps/${key}`); return res.status(400).json({ error: "Code expired. Request a new one." }); }
  const MAX_ATTEMPTS = 5;
  const attempts = (stored.attempts || 0) + 1;
  if (attempts > MAX_ATTEMPTS) { await fbDelete(`/otps/${key}`); return res.status(400).json({ error: "Too many failed attempts. Request a new code." }); }
  const inputHash = crypto.createHash("sha256").update(otp.trim()).digest("hex");
  if (inputHash !== stored.hash) {
    await fbSet(`/otps/${key}`, { ...stored, attempts });
    const left = MAX_ATTEMPTS - attempts;
    return res.status(400).json({ error: left > 0 ? `Incorrect code. ${left} attempt${left !== 1 ? "s" : ""} left.` : "Too many failed attempts. Request a new code." });
  }
  await fbDelete(`/otps/${key}`);
  return res.status(200).json({ ok: true });
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || "unknown";
  if (!checkRateLimit(ip)) return res.status(429).json({ error: "Too many requests." });

  const { action, email, otp } = req.body || {};
  if (!email || typeof email !== "string" || email.length > 254 || !email.includes("@")) {
    return res.status(400).json({ error: "Valid email required." });
  }

  if (action === "send") return handleSend(email, res);
  if (action === "verify") {
    if (!otp) return res.status(400).json({ error: "Code is required." });
    return handleVerify(email, otp, res);
  }
  return res.status(400).json({ error: "Invalid action." });
};
