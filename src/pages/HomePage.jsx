import { useState } from "react";
import { useApp } from "../context/AppContext";
import { Toggle } from "../components/Layout";
import { groq, parseQuestions, sbFetch, SupabaseRealtime, decodeQuiz } from "../utils/api";
import { LANGUAGES } from "../utils/constants";

const TABS = [
  ["pdf", "PDF"], ["image", "IMAGE"], ["text", "TEXT"],
  ["url", "URL"], ["youtube", "YT"], ["topic", "TOPIC"],
];
const MODES = [
  { id: "quiz", label: "QUIZ", desc: "Test yourself with questions" },
  { id: "study", label: "STUDY", desc: "Read Q&A side by side" },
  { id: "flashcard", label: "CARDS", desc: "Flip cards to memorize" },
];

export default function HomePage() {
  const ctx = useApp();
  const [drag, setDrag] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [showMp, setShowMp] = useState(false);
  const [manualQ, setManualQ] = useState("");
  const [manualA, setManualA] = useState("");
  const [manualList, setManualList] = useState([]);

  // Check URL for shared quiz on mount
  useState(() => {
    const params = new URLSearchParams(window.location.search);
    const qdata = params.get("q");
    if (qdata) {
      const qs = decodeQuiz(qdata);
      if (qs?.length) startQuiz(qs);
    }
  });

  const readB64 = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = e => res(e.target.result); r.onerror = rej; r.readAsDataURL(f); });
  const readBuf = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = e => res(e.target.result); r.onerror = rej; r.readAsArrayBuffer(f); });

  const loadPdfJs = () => new Promise((res, rej) => {
    if (window.pdfjsLib) { res(window.pdfjsLib); return; }
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"; res(window.pdfjsLib); };
    s.onerror = rej; document.head.appendChild(s);
  });

  const pdfToImages = async f => {
    const lib = await loadPdfJs();
    const pdf = await lib.getDocument({ data: await readBuf(f) }).promise;
    const pages = [];
    for (let i = 1; i <= Math.min(pdf.numPages, 5); i++) {
      const page = await pdf.getPage(i);
      const vp = page.getViewport({ scale: 1.5 });
      const canvas = document.createElement("canvas");
      canvas.width = vp.width; canvas.height = vp.height;
      await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
      pages.push(canvas.toDataURL("image/jpeg", 0.85).split(",")[1]);
    }
    return pages;
  };

  const startQuiz = (qs) => {
    ctx.setQuestions(qs);
    ctx.resetQuizState();
    ctx.quizStartTime.current = Date.now();
    if (ctx.mode === "study") ctx.navigate("study");
    else if (ctx.mode === "flashcard") ctx.navigate("flashcard");
    else ctx.navigate("edit");
  };

  const generate = async () => {
    ctx.setError("");
    const { tab, file, text, urlVal, ytVal, topicVal, numQ, qType, lang } = ctx;
    if (tab === "pdf" && !file) { ctx.setError("Please upload a PDF first."); return; }
    if (tab === "image" && !file) { ctx.setError("Please upload an image first."); return; }
    if (tab === "text" && !text.trim()) { ctx.setError("Please paste some text first."); return; }
    if (tab === "url" && !urlVal.trim()) { ctx.setError("Please enter a URL first."); return; }
    if (tab === "youtube" && !ytVal.trim()) { ctx.setError("Please enter a YouTube URL first."); return; }
    if (tab === "topic" && !topicVal.trim()) { ctx.setError("Please enter a topic first."); return; }

    ctx.navigate("loading");

    try {
      const typeInstr = qType === "mixed" ? "Mix of multiple-choice (4 options), true/false, and fill-in-the-blank."
        : qType === "mcq" ? "Only multiple-choice with 4 options (A/B/C/D)."
        : qType === "tf" ? "Only true/false questions."
        : "Only fill-in-the-blank questions.";
      const langNote = lang !== "English" ? `All questions and answers must be in ${lang}.` : "";
      const jsonInstr = `Respond ONLY with a valid JSON array. No markdown, no backticks.\nEach item: {"type":"mcq"|"tf"|"fill","question":string,"choices":[4 strings mcq only],"answer":0-3 for mcq|"True"/"False" for tf|string for fill,"explanation":string}`;

      let messages, model = "llama-3.3-70b-versatile";

      if (tab === "image" && file) {
        model = "meta-llama/llama-4-scout-17b-16e-instruct";
        const b64 = (await readB64(file)).split(",")[1];
        messages = [{ role: "user", content: [
          { type: "image_url", image_url: { url: `data:${file.type || "image/jpeg"};base64,${b64}` } },
          { type: "text", text: `Quiz generator. Read ALL text in image. Generate exactly ${numQ} questions. ${typeInstr} ${langNote} ${jsonInstr}` }
        ]}];
      } else if (tab === "pdf" && file) {
        model = "meta-llama/llama-4-scout-17b-16e-instruct";
        const imgs = await pdfToImages(file);
        const blocks = imgs.map(b => ({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${b}` } }));
        blocks.push({ type: "text", text: `Quiz generator. Read ALL text in PDF. Generate exactly ${numQ} questions. ${typeInstr} ${langNote} ${jsonInstr}` });
        messages = [{ role: "user", content: blocks }];
      } else if (tab === "url") {
        const raw = await groq([{ role: "user", content: `Fetch content from: ${urlVal}\nGenerate exactly ${numQ} quiz questions from it.\n${typeInstr} ${langNote} ${jsonInstr}` }]);
        startQuiz(parseQuestions(raw)); return;
      } else if (tab === "youtube") {
        const videoId = ytVal.match(/(?:v=|youtu\.be\/|embed\/)([a-zA-Z0-9_-]{11})/)?.[1];
        if (!videoId) throw new Error("Could not extract video ID. Make sure it's a valid YouTube link like youtube.com/watch?v=xxx or youtu.be/xxx");

        // Try to fetch real transcript from our Vercel API function
        let transcriptText = null;
        let transcriptError = null;

        // Only try the API if we're on Vercel (not localhost)
        const isVercel = window.location.hostname !== "localhost" && !window.location.hostname.startsWith("127.");

        if (isVercel) {
          try {
            const transcriptRes = await fetch(`/api/transcript?videoId=${videoId}`);
            const transcriptData = await transcriptRes.json();
            if (transcriptData.error) {
              transcriptError = transcriptData.error;
            } else if (transcriptData.text) {
              transcriptText = transcriptData.text;
            }
          } catch (e) {
            transcriptError = e.message;
          }
        } else {
          transcriptError = "local_dev";
        }

        let prompt;
        if (transcriptText) {
          // We have a real transcript — use it
          prompt = `Generate exactly ${numQ} quiz questions based on this YouTube video transcript:\n\n${transcriptText.substring(0, 4000)}\n\n${typeInstr} ${langNote} ${jsonInstr}`;
        } else if (transcriptError === "local_dev") {
          // Running locally — explain the limitation clearly
          throw new Error("YouTube transcript fetching only works when deployed to Vercel. For local testing, use the Topic tab instead and type the video topic manually.");
        } else {
          // Transcript failed — fall back to topic-based quiz using video URL as context
          console.warn("Transcript failed, using fallback:", transcriptError);
          const raw = await groq([{ role: "user", content: `Generate exactly ${numQ} quiz questions about the topic of this YouTube video: ${ytVal}. Based on the video URL, generate educational questions about what this video likely covers. Do NOT mention the video ID or URL in the questions. ${typeInstr} ${langNote} ${jsonInstr}` }]);
          startQuiz(parseQuestions(raw)); return;
        }

        const raw = await groq([{ role: "user", content: prompt }]);
        startQuiz(parseQuestions(raw)); return;
      } else if (tab === "topic") {
        const raw = await groq([{ role: "user", content: `Generate exactly ${numQ} quiz questions about: ${topicVal}\n${typeInstr} ${langNote} ${jsonInstr}` }]);
        startQuiz(parseQuestions(raw)); return;
      } else {
        messages = [{ role: "user", content: `Quiz generator. Generate exactly ${numQ} questions from:\n\n${text.trim().substring(0, 4000)}\n\n${typeInstr} ${langNote} ${jsonInstr}` }];
      }

      const raw = await groq(messages, model);
      startQuiz(parseQuestions(raw));
    } catch (e) {
      console.error("Generate error:", e);
      ctx.setError(e.message || "Something went wrong. Please try again.");
      ctx.navigate("home");
    }
  };

  const hostGame = async () => {
    if (!ctx.questions.length) { ctx.setError("Generate a quiz first, then create the room."); return; }
    ctx.setMpError("");
    const code = Math.random().toString(36).substring(2, 6).toUpperCase();
    const name = ctx.playerName || "Host";
    ctx.setMyMpName(name);
    ctx.setMpStatus("Creating room...");
    try {
      await sbFetch("/rooms", "POST", { id: code, questions: ctx.questions, host: name });
      const player = await sbFetch("/room_players", "POST", { room_id: code, name, score: 0, current_q: 0 });
      if (player?.[0]?.id) ctx.myPlayerIdRef.current = player[0].id;
      ctx.setMpCode(code);
      ctx.setMpPlayers([{ name, score: 0, isHost: true }]);
      ctx.setMpMode("host");
      ctx.setMpStatus("Waiting for players...");
      const rt = new SupabaseRealtime(code, (record) => {
        if (record?.name) ctx.setMpPlayers(prev => {
          const ex = prev.find(p => p.name === record.name);
          return ex ? prev.map(p => p.name === record.name ? { ...p, score: record.score, current_q: record.current_q } : p)
            : [...prev, { name: record.name, score: record.score || 0 }];
        });
      });
      rt.connect();
      ctx.mpRealtimeRef.current = rt;
      const poll = setInterval(async () => {
        try {
          const players = await sbFetch(`/room_players?room_id=eq.${code}&select=name,score,current_q`);
          if (players) ctx.setMpPlayers(players.map((p, i) => ({ ...p, isHost: i === 0 })));
        } catch {}
      }, 3000);
      setTimeout(() => clearInterval(poll), 300000);
      ctx.navigate("multiplayer");
    } catch (e) {
      ctx.setMpError(`Failed to create room: ${e.message}`);
      ctx.setMpStatus("");
    }
  };

  const joinGame = async () => {
    const code = ctx.mpJoinCode.toUpperCase().trim();
    if (!code) { ctx.setMpError("Enter a room code."); return; }
    ctx.setMpError("");
    const name = ctx.playerName || `Player${Math.floor(Math.random() * 99) + 2}`;
    ctx.setMyMpName(name);
    ctx.setMpStatus("Joining...");
    try {
      const rooms = await sbFetch(`/rooms?id=eq.${code}&select=*`);
      if (!rooms?.length) { ctx.setMpError("Room not found. Check the code."); ctx.setMpStatus(""); return; }
      ctx.setQuestions(rooms[0].questions);
      ctx.resetQuizState();
      const player = await sbFetch("/room_players", "POST", { room_id: code, name, score: 0, current_q: 0 });
      if (player?.[0]?.id) ctx.myPlayerIdRef.current = player[0].id;
      const players = await sbFetch(`/room_players?room_id=eq.${code}&select=name,score,current_q`);
      ctx.setMpPlayers(players || [{ name, score: 0 }]);
      ctx.setMpCode(code);
      ctx.setMpMode("join");
      ctx.setMpStatus("Connected!");
      const rt = new SupabaseRealtime(code, (record) => {
        if (record?.name) ctx.setMpPlayers(prev => {
          const ex = prev.find(p => p.name === record.name);
          return ex ? prev.map(p => p.name === record.name ? { ...p, score: record.score } : p)
            : [...prev, { name: record.name, score: record.score || 0 }];
        });
      });
      rt.connect();
      ctx.mpRealtimeRef.current = rt;
      const poll = setInterval(async () => {
        try {
          const ps = await sbFetch(`/room_players?room_id=eq.${code}&select=name,score,current_q`);
          if (ps) ctx.setMpPlayers(ps);
        } catch {}
      }, 2000);
      setTimeout(() => clearInterval(poll), 300000);
      ctx.navigate("multiplayer");
    } catch (e) {
      ctx.setMpError(`Failed to join: ${e.message}`);
      ctx.setMpStatus("");
    }
  };

  const genDisabled = ["pdf", "image"].includes(ctx.tab) && !ctx.file;

  return (
    <div className="page">
      <div className="home-hero">
        <h1 className="home-title">Turn any content<br />into a <span className="green">quiz.</span></h1>
        <p className="home-sub">// PDF &middot; image &middot; text &middot; URL &middot; YouTube &middot; topic &rarr; instant quiz</p>
      </div>

      {/* Mode selector */}
      <div className="home-modes">
        {MODES.map(m => (
          <div key={m.id} className={`mode-card ${ctx.mode === m.id ? "active" : ""}`} onClick={() => ctx.setMode(m.id)}>
            <div className="mode-card-icon">[{m.label[0]}]</div>
            <div className="mode-card-title">{m.label}</div>
            <div className="mode-card-desc">{m.desc}</div>
          </div>
        ))}
      </div>

      {/* Input tabs */}
      <div className="tabs" style={{ marginBottom: 20 }}>
        {TABS.map(([t, label]) => (
          <button key={t} className={`tab-btn ${ctx.tab === t ? "active" : ""}`}
            onClick={() => { ctx.setTab(t); ctx.setFile(null); }}>
            {label}
          </button>
        ))}
      </div>

      {(ctx.tab === "pdf" || ctx.tab === "image") && (
        <div className={`drop-zone ${drag ? "drag-over" : ""}`}
          onDragOver={e => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={e => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files[0]) ctx.setFile(e.dataTransfer.files[0]); }}>
          <input type="file" accept={ctx.tab === "pdf" ? ".pdf" : "image/*"} onChange={e => e.target.files[0] && ctx.setFile(e.target.files[0])} />
          <div className="drop-label">Drop your {ctx.tab === "pdf" ? "PDF" : "image"} here</div>
          <div className="drop-hint">or click to browse</div>
          {ctx.file && <div className="drop-file-name">+ {ctx.file.name}</div>}
        </div>
      )}
      {ctx.tab === "text" && (
        <textarea className="text-area" placeholder="Paste your notes, article, or any text here..."
          value={ctx.text} onChange={e => ctx.setText(e.target.value)} />
      )}
      {ctx.tab === "url" && (
        <div>
          <input className="field-input" placeholder="https://example.com/article"
            value={ctx.urlVal} onChange={e => ctx.setUrlVal(e.target.value)} />
          <div className="alert-info" style={{ marginTop: 10 }}>Paste any article or Wikipedia page URL. The AI reads the content and generates questions.</div>
        </div>
      )}
      {ctx.tab === "youtube" && (
        <div>
          <input className="field-input" placeholder="https://youtube.com/watch?v=..."
            value={ctx.ytVal} onChange={e => ctx.setYtVal(e.target.value)} />
          <div className="alert-info" style={{ marginTop: 10 }}>
            Paste a YouTube video URL. The app fetches the real transcript and generates questions from what was actually said.
            <br /><br />
            <strong>Note:</strong> Transcript fetching requires deployment to Vercel. Running locally? Use the <strong>Topic</strong> tab and type the video subject instead.
          </div>
        </div>
      )}
      {ctx.tab === "topic" && (
        <div>
          <input className="field-input" style={{ fontSize: 16, fontWeight: 600, padding: "14px 16px" }}
            placeholder="e.g. World War 2, Photosynthesis, Python basics..."
            value={ctx.topicVal} onChange={e => ctx.setTopicVal(e.target.value)}
            onKeyDown={e => e.key === "Enter" && generate()} />
          <div className="alert-info" style={{ marginTop: 10 }}>Type any topic — AI generates a quiz from its knowledge, no file needed.</div>
        </div>
      )}

      {/* Options */}
      <div className="input-row">
        <div>
          <label className="field-label">Questions</label>
          <select className="field-select" value={ctx.numQ} onChange={e => ctx.setNumQ(Number(e.target.value))}>
            {[5, 10, 15, 20, 25].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        {ctx.mode !== "study" && (
          <div>
            <label className="field-label">Type</label>
            <select className="field-select" value={ctx.qType} onChange={e => ctx.setQType(e.target.value)}>
              <option value="mixed">Mixed</option>
              <option value="mcq">Multiple Choice</option>
              <option value="tf">True / False</option>
              <option value="fill">Fill in Blank</option>
            </select>
          </div>
        )}
        <div>
          <label className="field-label">Language</label>
          <select className="field-select" value={ctx.lang} onChange={e => ctx.setLang(e.target.value)}>
            {LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
        <div>
          <label className="field-label">Your Name</label>
          <input className="field-input" style={{ width: 160 }} placeholder="e.g. Alex"
            value={ctx.playerName} onChange={e => ctx.setPlayerName(e.target.value)} />
        </div>
      </div>

      {ctx.mode === "quiz" && (
        <div className="toggles-row">
          <Toggle on={ctx.useTimer} onChange={ctx.setUseTimer} label="Timer (30s)" />
          <Toggle on={ctx.useStreak} onChange={ctx.setUseStreak} label="Streak" />
          <Toggle on={ctx.useSounds} onChange={ctx.setUseSounds} label="Sounds" />
          {ctx.tab === "topic" && <Toggle on={ctx.autoDiff} onChange={ctx.setAutoDiff} label="Auto-difficulty" />}
        </div>
      )}

      {ctx.error && <div className="alert-error">! {ctx.error}</div>}

      <button className="btn-primary" style={{ marginTop: 28 }} onClick={generate} disabled={genDisabled}>
        Generate {ctx.mode === "study" ? "Study Guide" : ctx.mode === "flashcard" ? "Flashcards" : "Quiz"} &rarr;
      </button>

      <hr className="section-divider" />

      {/* Multiplayer */}
      <div className="collapsible">
        <div className="collapsible-header" onClick={() => setShowMp(m => !m)}>
          MULTIPLAYER (Supabase — works across devices) {showMp ? "^" : "v"}
        </div>
        {showMp && (
          <div className="collapsible-body">
            {ctx.mpError && <div className="alert-error">! {ctx.mpError}</div>}
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              <div style={{ flex: 1 }}>
                <label className="field-label">Host a room</label>
                <button className="btn-secondary" style={{ width: "100%" }} onClick={hostGame}>Create Room</button>
              </div>
              <div style={{ flex: 1 }}>
                <label className="field-label">Join a room</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input className="field-input" placeholder="Room code" maxLength={4}
                    value={ctx.mpJoinCode} onChange={e => ctx.setMpJoinCode(e.target.value.toUpperCase())}
                    style={{ letterSpacing: 4, fontWeight: 700, textAlign: "center" }} />
                  <button className="btn-secondary" onClick={joinGame}>Join</button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Manual creator */}
      <div className="collapsible" style={{ marginTop: 12 }}>
        <div className="collapsible-header" onClick={() => setShowManual(m => !m)}>
          MANUAL QUESTION CREATOR {showManual ? "^" : "v"}
        </div>
        {showManual && (
          <div className="collapsible-body">
            <input className="field-input" placeholder="Question" value={manualQ} onChange={e => setManualQ(e.target.value)} />
            <div style={{ display: "flex", gap: 8 }}>
              <input className="field-input" placeholder="Answer" value={manualA} onChange={e => setManualA(e.target.value)} />
              <button className="btn-secondary" style={{ whiteSpace: "nowrap" }} onClick={() => {
                if (!manualQ.trim() || !manualA.trim()) return;
                setManualList(l => [...l, { type: "fill", question: manualQ.trim(), answer: manualA.trim(), explanation: "" }]);
                setManualQ(""); setManualA("");
              }}>+ Add</button>
            </div>
            {manualList.map((mq, i) => (
              <div key={i} className="card-sm" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{mq.question}</div>
                  <div style={{ fontSize: 11, color: "#4caf50", fontFamily: "'Space Mono',monospace", marginTop: 3 }}>&rarr; {mq.answer}</div>
                </div>
                <button style={{ background: "transparent", border: "none", color: "#c62828", cursor: "pointer", fontSize: 16 }}
                  onClick={() => setManualList(l => l.filter((_, j) => j !== i))}>x</button>
              </div>
            ))}
            {manualList.length > 0 && (
              <button className="btn-primary" onClick={() => startQuiz(manualList)}>
                Start with {manualList.length} question{manualList.length !== 1 ? "s" : ""} &rarr;
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
