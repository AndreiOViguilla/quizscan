import { HF_KEY, SUPABASE_URL, SUPABASE_KEY } from "./constants";

// ─── HUGGING FACE ─────────────────────────────────────────────────────────────
// Uses Hugging Face Inference API with a capable open model
const HF_MODEL = "mistralai/Mixtral-8x7B-Instruct-v0.1";
const HF_URL = `https://api-inference.huggingface.co/models/${HF_MODEL}`;

export async function groq(messages, _model, maxTokens = 4096) {
  // Convert OpenAI-style messages to a single prompt string (Mixtral instruct format)
  const prompt = messages.map(m => {
    if (m.role === "system") return `[INST] <<SYS>>\n${m.content}\n<</SYS>>\n\n`;
    if (m.role === "user") {
      // Handle vision content arrays (image + text)
      if (Array.isArray(m.content)) {
        const textPart = m.content.find(c => c.type === "text");
        return `[INST] ${textPart?.text || ""} [/INST]`;
      }
      return `[INST] ${m.content} [/INST]`;
    }
    if (m.role === "assistant") return m.content;
    return "";
  }).join("\n");

  const res = await fetch(HF_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${HF_KEY}`,
    },
    body: JSON.stringify({
      inputs: prompt,
      parameters: {
        max_new_tokens: maxTokens,
        temperature: 0.7,
        top_p: 0.95,
        do_sample: true,
        return_full_text: false,
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    // Model loading — retry after delay
    if (res.status === 503) {
      await new Promise(r => setTimeout(r, 8000));
      return groq(messages, _model, maxTokens);
    }
    throw new Error(`HF API error ${res.status}: ${err}`);
  }

  const data = await res.json();

  // HF returns array of { generated_text }
  if (Array.isArray(data) && data[0]?.generated_text !== undefined) {
    return data[0].generated_text;
  }
  if (data.generated_text) return data.generated_text;
  if (data.error) throw new Error(data.error);

  throw new Error("Unexpected HF response: " + JSON.stringify(data));
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

// ─── SHARE ────────────────────────────────────────────────────────────────────
export function encodeQuiz(questions) {
  try { return btoa(unescape(encodeURIComponent(JSON.stringify(questions)))).replace(/=/g, ""); }
  catch { return null; }
}
export function decodeQuiz(str) {
  try { return JSON.parse(decodeURIComponent(escape(atob(str)))); }
  catch { return null; }
}
