import { GROQ_KEY } from "./constants";

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
    questions, host: hostName || "Host", status: "waiting", createdAt: Date.now(),
    players: { [hostName || "Host"]: { name: hostName || "Host", score: 0, answer: null, ready: true } }
  });
  return code;
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

export async function sbFetch() { return null; }
export class SupabaseRealtime { connect() {} disconnect() {} }