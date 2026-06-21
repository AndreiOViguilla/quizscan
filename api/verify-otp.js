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

async function fbDelete(path) {
  await fetch(`${FB_URL}${path}.json`, { method: "DELETE" });
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).end();

  const { email, otp } = req.body || {};
  if (!email || !otp) {
    return res.status(400).json({ error: "Email and code are required." });
  }

  const key = emailToKey(email);
  const now = Date.now();

  const stored = await fbGet(`/otps/${key}`);
  if (!stored) {
    return res.status(400).json({ error: "No reset code found. Request a new one." });
  }
  if (now > stored.expiresAt) {
    await fbDelete(`/otps/${key}`);
    return res.status(400).json({ error: "Code expired. Request a new one." });
  }

  const MAX_ATTEMPTS = 5;
  const attempts = (stored.attempts || 0) + 1;

  if (attempts > MAX_ATTEMPTS) {
    await fbDelete(`/otps/${key}`);
    return res.status(400).json({ error: "Too many failed attempts. Request a new code." });
  }

  const inputHash = crypto.createHash("sha256").update(otp.trim()).digest("hex");
  if (inputHash !== stored.hash) {
    await fbSet(`/otps/${key}`, { ...stored, attempts });
    const left = MAX_ATTEMPTS - attempts;
    return res.status(400).json({
      error: left > 0
        ? `Incorrect code. ${left} attempt${left !== 1 ? "s" : ""} left.`
        : "Too many failed attempts. Request a new code.",
    });
  }

  // Correct — delete so it can't be reused
  await fbDelete(`/otps/${key}`);
  return res.status(200).json({ ok: true });
};
