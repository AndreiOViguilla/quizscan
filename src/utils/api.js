import { GROQ_KEY } from "./constants";

// ─── REQUEST SIGNING (HMAC-SHA256) ────────────────────────────────────────────
const GENERATE_SECRET = process.env.REACT_APP_GENERATE_SECRET || "";

async function signRequest(bodyStr) {
  if (!GENERATE_SECRET) return {};
  const ts = Date.now().toString();
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(GENERATE_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(ts + bodyStr));
  const sigHex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
  return { "X-Timestamp": ts, "X-Signature": sigHex };
}

// ─── GROQ ─────────────────────────────────────────────────────────────────────
export async function groq(messages, model = "llama-3.3-70b-versatile", maxTokens = 8000) {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${GROQ_KEY}` },
    body: JSON.stringify({ model, max_tokens: maxTokens, messages }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.choices?.[0]?.message?.content || "";
}

// ─── HUGGING FACE → GROQ FALLBACK ────────────────────────────────────────────
// Text-only tasks: try HF (Qwen2.5-72B) first, fall back to Groq on any failure.
const HF_MODEL = "Qwen/Qwen2.5-72B-Instruct";

export async function generateText(messages, maxTokens = 8000) {
  const failures = [];

  // 1. Try HF (serverless → Space fallback handled in backend)
  try {
    const bodyStr = JSON.stringify({ messages, model: HF_MODEL, maxTokens });
    const sigHeaders = await signRequest(bodyStr);
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...sigHeaders },
      body: bodyStr,
    });
    const data = await res.json();
    if (res.ok && data.content) return data.content;
    failures.push(data.error || `HF returned ${res.status}`);
  } catch (e) {
    failures.push("HF unreachable");
  }

  // 2. Fall back to Groq (via backend proxy to avoid CORS)
  try {
    const res = await fetch("/api/groq", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, model: "llama-3.3-70b-versatile", maxTokens }),
    });
    const data = await res.json();
    if (res.ok && data.content) return data.content;
    const msg = data.error || "";
    if (msg.toLowerCase().includes("rate_limit") || res.status === 429) {
      failures.push("Groq rate limit reached — try again in a few minutes");
    } else {
      failures.push(msg || "Groq failed");
    }
  } catch (e) {
    failures.push(e.message || "Groq unreachable");
  }

  // All providers failed
  const isRateLimit = failures.some(f => f.includes("rate limit") || f.includes("429"));
  throw new Error(
    isRateLimit
      ? "You've reached the AI usage limit. Please wait a few minutes and try again."
      : "All AI providers are currently unavailable. Check your connection and try again."
  );
}

export function parseQuestions(raw) {
  let cleaned = raw.replace(/```json|```/g, "").trim();
  const s = cleaned.indexOf("["), e = cleaned.lastIndexOf("]");
  if (s !== -1 && e !== -1) cleaned = cleaned.substring(s, e + 1);
  cleaned = cleaned
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\n/g, " ")
    .replace(/\t/g, " ");
  try { return JSON.parse(cleaned); }
  catch {
    const objs = []; const rx = /\{[^{}]*"question"[^{}]*\}/gs; let m;
    while ((m = rx.exec(cleaned)) !== null) { try { objs.push(JSON.parse(m[0])); } catch {} }
    if (!objs.length) throw new Error("Could not parse questions.");
    return objs;
  }
}

// ─── FIREBASE REALTIME DATABASE ───────────────────────────────────────────────
const FB_URL = "https://quizscan-94acb-default-rtdb.asia-southeast1.firebasedatabase.app";

async function fbGet(path) {
  const res = await fetch(`${FB_URL}${path}.json`);
  if (!res.ok) throw new Error(`Firebase GET failed: ${res.status}`);
  return res.json();
}

async function fbSet(path, data) {
  const res = await fetch(`${FB_URL}${path}.json`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Firebase SET failed: ${res.status}`);
  return res.json();
}

async function fbUpdate(path, data) {
  const res = await fetch(`${FB_URL}${path}.json`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Firebase PATCH failed: ${res.status}`);
  return res.json();
}

async function fbDelete(path) {
  await fetch(`${FB_URL}${path}.json`, { method: "DELETE" });
}

function genCode() {
  return Math.random().toString(36).substring(2, 6).toUpperCase();
}

export async function createRoom(questions, hostName) {
  let code = genCode();
  let existing = await fbGet(`/rooms/${code}`);
  while (existing) { code = genCode(); existing = await fbGet(`/rooms/${code}`); }
  await fbSet(`/rooms/${code}`, {
    questions, host: hostName || "Host", status: "waiting",
    createdAt: Date.now(), lastActivity: Date.now(),
    expiresAt: Date.now() + 60 * 60 * 1000, // 1 hour from now
    players: { [hostName || "Host"]: { name: hostName || "Host", score: 0, answer: null, ready: true } }
  });
  // Schedule cleanup after 1 hour
  setTimeout(() => deleteRoom(code).catch(() => {}), 60 * 60 * 1000);
  return code;
}

export async function pingRoom(code) {
  try {
    await fbUpdate(`/rooms/${code}`, { lastActivity: Date.now() });
  } catch {}
}

export async function cleanupExpiredRooms() {
  try {
    const rooms = await fbGet("/rooms");
    if (!rooms) return;
    const now = Date.now();
    for (const [code, room] of Object.entries(rooms)) {
      const lastActivity = room.lastActivity || room.createdAt || 0;
      if (now - lastActivity > 60 * 60 * 1000) {
        await deleteRoom(code).catch(() => {});
      }
    }
  } catch {}
}

export async function joinRoom(code, playerName) {
  const room = await fbGet(`/rooms/${code}`);
  if (!room) throw new Error("Room not found. Check the code and try again.");
  if (room.status === "finished") throw new Error("This game has already ended.");
  // Make name unique by appending number if already taken
  const existing = room.players ? Object.keys(room.players) : [];
  let uniqueName = playerName;
  let counter = 2;
  while (existing.includes(uniqueName)) {
    uniqueName = `${playerName}${counter}`;
    counter++;
  }
  await fbUpdate(`/rooms/${code}/players/${uniqueName}`, { name: uniqueName, score: 0, answer: null, ready: true });
  // Return room with the unique name so caller knows what name was assigned
  return { ...room, assignedName: uniqueName };
}

export async function deleteRoom(code) { await fbDelete(`/rooms/${code}`); }

// ─── FIREBASE REALTIME LISTENER ───────────────────────────────────────────────
export class FirebaseListener {
  constructor(path, onData) {
    this.path = path;
    this.onData = onData;
    this.es = null;
    this.interval = null;
    this.lastHash = null;
  }

  connect() {
    this._startSSE();
    this._startPoll();
  }

  _startSSE() {
    try {
      this.es = new EventSource(`${FB_URL}${this.path}.json`);
      this.es.addEventListener("put", (e) => {
        try { const msg = JSON.parse(e.data); if (msg.data !== undefined) this._emit(msg.data); } catch {}
      });
      this.es.addEventListener("patch", (e) => {
        try { const msg = JSON.parse(e.data); if (msg.data) this._emit(msg.data); } catch {}
      });
      this.es.onerror = () => { this.es?.close(); this.es = null; };
    } catch {}
  }

  _startPoll() {
    this.interval = setInterval(async () => {
      try { const data = await fbGet(this.path); this._emit(data); } catch {}
    }, 1500);
  }

  _emit(data) {
    const hash = JSON.stringify(data);
    if (hash !== this.lastHash) { this.lastHash = hash; this.onData(data); }
  }

  disconnect() {
    this.es?.close(); this.es = null;
    if (this.interval) { clearInterval(this.interval); this.interval = null; }
  }
}

// ─── SHARE ────────────────────────────────────────────────────────────────────
export function encodeQuiz(questions) {
  try { return btoa(unescape(encodeURIComponent(JSON.stringify(questions)))).replace(/=/g, ""); }
  catch { return null; }
}
export function decodeQuiz(str) {
  try { return JSON.parse(decodeURIComponent(escape(atob(str)))); }
  catch { return null; }
}

export async function updateMpScore(code, playerName, score, currentQ) {
  await fbUpdate(`/rooms/${code}/players/${playerName}`, {
    score,
    current_q: currentQ,
    updated_at: new Date().toISOString(),
  });
}