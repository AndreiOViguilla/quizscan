import { HF_KEY, SUPABASE_URL, SUPABASE_KEY } from "./constants";

// ─── HUGGING FACE (via OpenAI-compatible endpoint — CORS friendly) ─────────────
const HF_BASE = "https://router.huggingface.co/novita/v3/openai";
const HF_MODEL = "mistralai/mistral-7b-instruct";

export async function groq(messages, _model, maxTokens = 3000) {
  // Filter out any vision content (image_url blocks) — text only for this model
  const textMessages = messages.map(m => {
    if (Array.isArray(m.content)) {
      const textPart = m.content.find(c => c.type === "text");
      return { role: m.role, content: textPart?.text || "" };
    }
    return m;
  });

  const res = await fetch(`${HF_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${HF_KEY}`,
    },
    body: JSON.stringify({
      model: HF_MODEL,
      max_tokens: maxTokens,
      messages: textMessages,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`HF API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  if (data.error) throw new Error(data.error.message || data.error);
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

// ─── SUPABASE ─────────────────────────────────────────────────────────────────
export async function sbFetch(path, method = "GET", body = null) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Prefer": method === "POST" ? "return=representation" : "return=minimal",
    },
    body: body ? JSON.stringify(body) : null,
  });
  if (!res.ok) throw new Error(await res.text());
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export class SupabaseRealtime {
  constructor(roomId, onMessage) {
    this.roomId = roomId;
    this.onMessage = onMessage;
    this.ws = null;
    this.heartbeat = null;
  }
  connect() {
    const wsUrl = `${SUPABASE_URL.replace("https://", "wss://")}/realtime/v1/websocket?apikey=${SUPABASE_KEY}&vsn=1.0.0`;
    this.ws = new WebSocket(wsUrl);
    this.ws.onopen = () => {
      this.ws.send(JSON.stringify({ topic: `realtime:public:room_players:room_id=eq.${this.roomId}`, event: "phx_join", payload: {}, ref: "1" }));
      this.heartbeat = setInterval(() => {
        if (this.ws?.readyState === 1)
          this.ws.send(JSON.stringify({ topic: "phoenix", event: "heartbeat", payload: {}, ref: "hb" }));
      }, 20000);
    };
    this.ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.event === "INSERT" || msg.event === "UPDATE") this.onMessage(msg.payload?.record || msg.payload?.new);
      } catch {}
    };
    this.ws.onerror = () => {};
    this.ws.onclose = () => clearInterval(this.heartbeat);
  }
  disconnect() { clearInterval(this.heartbeat); this.ws?.close(); this.ws = null; }
}

export function encodeQuiz(questions) {
  try { return btoa(unescape(encodeURIComponent(JSON.stringify(questions)))).replace(/=/g, ""); }
  catch { return null; }
}
export function decodeQuiz(str) {
  try { return JSON.parse(decodeURIComponent(escape(atob(str)))); }
  catch { return null; }
}