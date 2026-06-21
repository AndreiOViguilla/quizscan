import { GROQ_KEY } from "./constants";
import { fbGet, fbSet, fbUpdate, fbDelete } from "./db";

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
const HF_MODEL = "Qwen/Qwen2.5-72B-Instruct";

export async function generateText(messages, maxTokens = 8000, cfToken = null) {
  const failures = [];

  // 1. Try HF (serverless → Space fallback handled in backend)
  try {
    const bodyStr = JSON.stringify({ messages, model: HF_MODEL, maxTokens, cfToken });
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
      body: JSON.stringify({ messages, model: "llama-3.3-70b-versatile", maxTokens, cfToken }),
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

  const isRateLimit = failures.some(f => f.includes("rate limit") || f.includes("429"));
  throw new Error(
    isRateLimit
      ? "You've reached the AI usage limit. Please wait a few minutes and try again."
      : "All AI providers are currently unavailable. Check your connection and try again."
  );
}

// ─── JSON PARSER ──────────────────────────────────────────────────────────────
// Extracts all top-level JSON objects from a string, handling nested braces.
function extractJsonObjects(str) {
  const results = [];
  let depth = 0, start = -1;
  for (let i = 0; i < str.length; i++) {
    if (str[i] === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (str[i] === "}") {
      depth--;
      if (depth === 0 && start !== -1) {
        try { results.push(JSON.parse(str.slice(start, i + 1))); } catch {}
        start = -1;
      }
    }
  }
  return results;
}

export function parseQuestions(raw) {
  let cleaned = raw.replace(/```json|```/g, "").trim();
  const s = cleaned.indexOf("["), e = cleaned.lastIndexOf("]");
  if (s !== -1 && e !== -1) cleaned = cleaned.substring(s, e + 1);
  cleaned = cleaned
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\n/g, " ")
    .replace(/\t/g, " ");
  try { return JSON.parse(cleaned); }
  catch {
    const objs = extractJsonObjects(cleaned).filter(o => o.question);
    if (!objs.length) throw new Error("Could not parse questions.");
    return objs;
  }
}

// ─── FIREBASE REALTIME DATABASE ───────────────────────────────────────────────
const FB_URL = "https://quizscan-94acb-default-rtdb.asia-southeast1.firebasedatabase.app";

function genCode() {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return arr[0].toString(36).substring(0, 4).toUpperCase().padEnd(4, "0");
}

function sanitizeFbKey(name) {
  return String(name || "").replace(/[.#$[\]/]/g, "_").trim().substring(0, 32) || "Player";
}

export async function createRoom(questions, hostName) {
  const safeHost = sanitizeFbKey(hostName) || "Host";
  let code = genCode();
  let existing = await fbGet(`/rooms/${code}`);
  while (existing) { code = genCode(); existing = await fbGet(`/rooms/${code}`); }
  await fbSet(`/rooms/${code}`, {
    questions, host: safeHost, status: "waiting",
    createdAt: Date.now(), lastActivity: Date.now(),
    expiresAt: Date.now() + 60 * 60 * 1000,
    players: { [safeHost]: { name: safeHost, score: 0, answer: null, ready: true, isHost: true } }
  });
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

const MAX_PLAYERS = 50;

export async function joinRoom(code, playerName, sessionKey) {
  const room = await fbGet(`/rooms/${code}`);
  if (!room) throw new Error("Room not found. Check the code and try again.");
  if (room.status === "finished") throw new Error("This game has already ended.");
  if (room.status === "playing") throw new Error("This game is already in progress.");

  const players = room.players || {};
  const existing = Object.keys(players);

  // Reconnection: match by sessionKey
  if (sessionKey) {
    for (const [key, player] of Object.entries(players)) {
      if (player.sessionKey === sessionKey) {
        await fbUpdate(`/rooms/${code}/players/${key}`, { disconnected: false });
        return { ...room, assignedName: key, sessionKey };
      }
    }
  }

  if (existing.length >= MAX_PLAYERS) throw new Error(`Room is full (max ${MAX_PLAYERS} players).`);

  const safeBase = sanitizeFbKey(playerName);
  let uniqueName = safeBase;
  let counter = 2;
  while (existing.includes(uniqueName)) { uniqueName = `${safeBase}${counter}`; counter++; }

  const newKey = crypto.getRandomValues(new Uint32Array(2)).reduce((s, n) => s + n.toString(36), "");
  await fbUpdate(`/rooms/${code}/players/${uniqueName}`, {
    name: uniqueName, score: 0, answer: null, ready: true, sessionKey: newKey,
  });
  return { ...room, assignedName: uniqueName, sessionKey: newKey };
}

export async function removePlayerFromRoom(code, playerName) {
  await fbDelete(`/rooms/${code}/players/${playerName}`);
}

export async function setRoomStatus(code, status) {
  await fbUpdate(`/rooms/${code}`, { status });
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
    this._state = undefined;
  }

  connect() {
    this._startSSE();
    this._startPoll();
  }

  _startSSE() {
    try {
      this.es = new EventSource(`${FB_URL}${this.path}.json`);

      this.es.addEventListener("put", (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (!msg) return;
          const isRoot = !msg.path || msg.path === "/";
          if (isRoot) {
            this._state = msg.data;
          } else {
            const key = msg.path.replace(/^\//, "");
            if (this._state && typeof this._state === "object") {
              if (msg.data === null) delete this._state[key];
              else this._state[key] = msg.data;
            } else {
              return;
            }
          }
          this._emit(this._state);
        } catch {}
      });

      this.es.addEventListener("patch", (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (!msg || !msg.data || typeof msg.data !== "object") return;
          if (!this._state || typeof this._state !== "object") return;
          const key = (msg.path || "").replace(/^\//, "");
          if (!key) {
            Object.assign(this._state, msg.data);
          } else if (this._state[key] && typeof this._state[key] === "object") {
            Object.assign(this._state[key], msg.data);
          } else {
            this._state[key] = msg.data;
          }
          this._emit(this._state);
        } catch {}
      });

      this.es.onerror = () => { this.es?.close(); this.es = null; };
    } catch {}
  }

  _startPoll() {
    this.interval = setInterval(async () => {
      if (this.es && this.es.readyState === 1) return; // SSE open — skip poll
      try {
        const data = await fbGet(this.path);
        this._state = data;
        this._emit(data);
      } catch {}
    }, 3000);
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

export async function setRoomCurrentQ(code, q) {
  await fbUpdate(`/rooms/${code}`, { currentQ: q });
}

export async function setRoomSyncMode(code, syncMode) {
  await fbUpdate(`/rooms/${code}`, { syncMode });
}

export async function updateMpScore(code, playerName, score, currentQ) {
  await fbUpdate(`/rooms/${code}/players/${playerName}`, {
    score,
    current_q: currentQ,
    updated_at: Date.now(),
  });
}
