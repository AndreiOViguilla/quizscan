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
  const [showSettings, setShowSettings] = useState(false);
  const [showMp, setShowMp] = useState(false);
  const [manualQ, setManualQ] = useState("");
  const [manualA, setManualA] = useState("");
  const [manualList, setManualList] = useState([]);
  const [ytStatus, setYtStatus] = useState(""); // shows inline under YT input

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

  const startQuiz = async (qs) => {
    ctx.setQuestions(qs);
    ctx.resetQuizState();
    ctx.quizStartTime.current = Date.now();
    if (ctx.mode === "study") { ctx.navigate("study"); return; }
    if (ctx.mode === "flashcard") { ctx.navigate("flashcard"); return; }
    if (ctx.mpAfterGenerate) {
      // Auto-create a room immediately
      const code = Math.random().toString(36).substring(2, 6).toUpperCase();
      const name = ctx.playerName || "Host";
      ctx.setMyMpName(name);
      ctx.setMpStatus("Creating room...");
      try {
        await sbFetch("/rooms", "POST", { id: code, questions: qs, host: name });
        const player = await sbFetch("/room_players", "POST", { room_id: code, name, score: 0, current_q: 0 });
        if (player?.[0]?.id) ctx.myPlayerIdRef.current = player[0].id;
        ctx.setMpCode(code);
        ctx.setMpPlayers([{ name, score: 0, isHost: true }]);
        ctx.setMpMode("host");
        ctx.setMpStatus("Waiting for players...");
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
            const players = await sbFetch(`/room_players?room_id=eq.${code}&select=name,score,current_q`);
            if (players) ctx.setMpPlayers(players.map((p, i) => ({ ...p, isHost: i === 0 })));
          } catch {}
        }, 3000);
        setTimeout(() => clearInterval(poll), 300000);
        ctx.navigate("multiplayer");
      } catch (e) {
        ctx.setMpError(`Failed to create room: ${e.message}`);
        ctx.navigate("edit");
      }
      return;
    }
    ctx.navigate("edit");
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
        // Actually fetch the URL content via a CORS proxy
        let pageText = null;
        const proxies = [
          `https://api.allorigins.win/get?url=${encodeURIComponent(urlVal)}`,
          `https://corsproxy.io/?${encodeURIComponent(urlVal)}`,
        ];
        for (const proxyUrl of proxies) {
          try {
            const res = await fetch(proxyUrl);
            let html = "";
            const ct = res.headers.get("content-type") || "";
            if (ct.includes("json")) {
              const data = await res.json();
              html = data?.contents || "";
            } else {
              html = await res.text();
            }
            if (html && html.length > 200) {
              pageText = html
                .replace(/<script[\s\S]*?<\/script>/gi, "")
                .replace(/<style[\s\S]*?<\/style>/gi, "")
                .replace(/<[^>]+>/g, " ")
                .replace(/\s+/g, " ")
                .trim()
                .substring(0, 4000);
              break;
            }
          } catch { continue; }
        }
        const urlPrompt = pageText
          ? "Generate exactly " + numQ + " quiz questions from this webpage content:\n\n" + pageText + "\n\n" + typeInstr + " " + langNote + " " + jsonInstr
          : "Generate exactly " + numQ + " quiz questions about the topic of this URL: " + urlVal + ". Use your knowledge about what this page likely contains. " + typeInstr + " " + langNote + " " + jsonInstr;
        const raw = await groq([{ role: "user", content: urlPrompt }]);
        await startQuiz(parseQuestions(raw)); return;
      } else if (tab === "youtube") {
        const videoId = ytVal.match(/(?:v=|youtu\.be\/|embed\/)([a-zA-Z0-9_-]{11})/)?.[1];
        if (!videoId) throw new Error("Could not extract video ID. Make sure it is a valid YouTube link.");

        let transcriptText = null;
        let debugLog = [];
        const log = (msg) => { debugLog.push(msg); setYtStatus([...debugLog].join("\n")); };

        // Try fetching transcript - works on Vercel, shows error on localhost
        log(`Host: ${window.location.hostname}`);
        log(`VideoID: ${videoId}`);

        try {
          log("Trying /api/transcript...");
          const res = await fetch(`/api/transcript?videoId=${videoId}`);
          log(`API status: ${res.status}`);
          const data = await res.json();
          log(`API response keys: ${Object.keys(data).join(", ")}`);
          if (data.text && data.text.length > 100) {
            transcriptText = data.text;
            log(`Got transcript: ${data.text.length} chars`);
          } else if (data.error) {
            log(`API error: ${data.error}`);
          } else {
            log("API returned no text and no error");
          }
        } catch (e) {
          log(`API exception: ${e.message} (on localhost this is expected - deploy to Vercel for transcripts)`);
        }

        // If transcript failed or local, use multiple proxies to fetch YouTube page
        if (!transcriptText) {
          const proxiesToTry = [
            `https://api.allorigins.win/get?url=${encodeURIComponent("https://www.youtube.com/watch?v=" + videoId)}`,
            `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent("https://www.youtube.com/watch?v=" + videoId)}`,
          ];
          for (const proxyUrl of proxiesToTry) {
            try {
              log(`Trying proxy: ${proxyUrl.substring(0, 50)}...`);
              const proxyRes = await fetch(proxyUrl);
              log(`Proxy status: ${proxyRes.status}`);
              let html = "";
              const ct = proxyRes.headers.get("content-type") || "";
              if (ct.includes("json")) {
                const proxyData = await proxyRes.json();
                html = proxyData?.contents || proxyData?.data || "";
              } else {
                html = await proxyRes.text();
              }
              log(`HTML length: ${html.length}`);
              if (html.length > 500) {
                const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
                const metaDesc = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{20,500})["']/i);
                const ytDesc = html.match(/"shortDescription":"([^"]{20,1000})"/);
                const title = (titleMatch?.[1] || "").replace(/\s*[-|]\s*YouTube\s*$/, "").trim();
                const desc = metaDesc?.[1] || ytDesc?.[1] || "";
                log(`Title found: ${title}`);
                log(`Desc found: ${desc.substring(0, 80)}`);
                if (title.length > 3) {
                  transcriptText = `Video title: "${title}". ${desc ? "Content description: " + desc.substring(0, 500) : ""}`;
                  break;
                }
              }
            } catch (e) {
              log(`Proxy exception: ${e.message}`);
            }
          }
        }

        // Update final status
        setYtStatus(debugLog.join("\n"));

        let ytPrompt;
        if (transcriptText && transcriptText.length > 100) {
          ytPrompt = "Generate exactly " + numQ + " quiz questions STRICTLY based on the actual content described here:\n\n" + transcriptText.substring(0, 6000) + "\n\n" + typeInstr + " " + langNote + " " + jsonInstr + "\n\nCRITICAL: Questions must be about the SPECIFIC content shown above. NEVER ask generic unrelated questions. NEVER mention video IDs.";
        } else {
          ytPrompt = "Generate exactly " + numQ + " quiz questions about this YouTube video URL: " + ytVal + ". The video ID is " + videoId + ". Generate questions specifically about what this exact video covers — its topic, content, people involved. Do NOT generate generic unrelated questions. " + typeInstr + " " + langNote + " " + jsonInstr;
        }

        const raw = await groq([{ role: "user", content: ytPrompt }]);
        await startQuiz(parseQuestions(raw)); return;
      } else if (tab === "topic") {
        const raw = await groq([{ role: "user", content: `Generate exactly ${numQ} quiz questions about: ${topicVal}\n${typeInstr} ${langNote} ${jsonInstr}` }], "llama-3.3-70b-versatile", numQ > 25 ? 8000 : 4000);
        await startQuiz(parseQuestions(raw)); return;
      } else {
        messages = [{ role: "user", content: `Quiz generator. Generate exactly ${numQ} questions from:\n\n${text.trim().substring(0, 4000)}\n\n${typeInstr} ${langNote} ${jsonInstr}` }];
      }

      const raw = await groq(messages, model);
      await startQuiz(parseQuestions(raw));
    } catch (e) {
      console.error("Generate error:", e);
      const msg = e.message || "Something went wrong. Please try again.";
      // If it was a youtube error, also update ytStatus
      if (ctx.tab === "youtube") {
        setYtStatus(prev => prev + "\nFATAL ERROR: " + msg);
      }
      // Don't navigate away — stay on home and show error
      ctx.setError(msg);
      ctx.navigate("home");
    }
  };

  const hostGame = async () => {
    if (!ctx.questions.length) return; // button is disabled so this shouldn't trigger
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
    <div className="page" style={{ maxWidth: 620 }}>

      {!showSettings ? (
        /* ── PAGE 1: INPUT ── */
        <>
          <div className="home-hero">
            <h1 className="home-title">Turn any content<br />into a quiz.</h1>
            <p className="home-sub">PDF · image · text · URL · YouTube · topic</p>
          </div>

          {/* Mode selector */}
          <div className="home-modes">
            {MODES.map(m => (
              <div key={m.id} className={`mode-card ${ctx.mode === m.id ? "active" : ""}`} onClick={() => ctx.setMode(m.id)}>
                <div className="mode-card-title">{m.label}</div>
                <div className="mode-card-desc">{m.desc}</div>
              </div>
            ))}
          </div>

          {/* Input tabs */}
          <div className="tabs" style={{ marginBottom: 16 }}>
            {TABS.map(([t, label]) => (
              <button key={t} className={`tab-btn ${ctx.tab === t ? "active" : ""}`}
                onClick={() => { ctx.setTab(t); ctx.setFile(null); }}>
                {label}
              </button>
            ))}
          </div>

          {/* Input area */}
          {(ctx.tab === "pdf" || ctx.tab === "image") && (
            <div className={`drop-zone ${drag ? "drag-over" : ""}`}
              onDragOver={e => { e.preventDefault(); setDrag(true); }}
              onDragLeave={() => setDrag(false)}
              onDrop={e => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files[0]) ctx.setFile(e.dataTransfer.files[0]); }}>
              <input type="file" accept={ctx.tab === "pdf" ? ".pdf" : "image/*"} onChange={e => e.target.files[0] && ctx.setFile(e.target.files[0])} />
              <div className="drop-label">Drop your {ctx.tab === "pdf" ? "PDF" : "image"} here</div>
              <div className="drop-hint">or click to browse</div>
              {ctx.file && <div className="drop-file-name">{ctx.file.name}</div>}
            </div>
          )}
          {ctx.tab === "text" && (
            <textarea className="text-area" placeholder="Paste your notes, article, or any text here..."
              value={ctx.text} onChange={e => ctx.setText(e.target.value)} />
          )}
          {ctx.tab === "url" && (
            <input className="field-input" placeholder="https://example.com/article"
              value={ctx.urlVal} onChange={e => ctx.setUrlVal(e.target.value)} />
          )}
          {ctx.tab === "youtube" && (
            <input className="field-input" placeholder="https://youtube.com/watch?v=..."
              value={ctx.ytVal} onChange={e => { ctx.setYtVal(e.target.value); setYtStatus(""); }} />
          )}
          {ctx.tab === "topic" && (
            <input className="field-input" style={{ fontSize: 15, padding: "13px 16px" }}
              placeholder="e.g. World War 2, Photosynthesis, Python basics..."
              value={ctx.topicVal} onChange={e => ctx.setTopicVal(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !genDisabled && setShowSettings(true)} />
          )}

          {ctx.error && <div className="alert-error" style={{ marginTop: 16 }}>{ctx.error}</div>}

          {/* Action buttons */}
          <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
            <button
              className="btn-primary"
              style={{ flex: 1, padding: "13px" }}
              onClick={() => { ctx.setError(""); if (!genDisabled) setShowSettings(true); }}
              disabled={genDisabled}
            >
              Continue
            </button>
            <button
              className="btn-secondary"
              style={{ padding: "13px 18px" }}
              onClick={() => { ctx.setError(""); if (!genDisabled) generate(); }}
              disabled={genDisabled}
              title="Generate with current settings"
            >
              Quick Generate
            </button>
          </div>

          <p style={{ fontSize: 11, opacity: 0.35, textAlign: "center", marginTop: 10 }}>
            Continue to set questions, type, language · or Quick Generate with defaults
          </p>
        </>
      ) : (
        /* ── PAGE 2: SETTINGS ── */
        <>
          <button className="back-btn" onClick={() => setShowSettings(false)}>
            Back
          </button>

          <div className="page-heading">Settings</div>
          <div className="page-sub">Customize your {ctx.mode === "study" ? "study guide" : ctx.mode === "flashcard" ? "flashcards" : "quiz"}</div>

          <div className="card">
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
              <div>
                <label className="field-label">Questions</label>
                <select className="field-select" value={ctx.numQ} onChange={e => ctx.setNumQ(Number(e.target.value))}>
                  {[5, 10, 15, 20, 25, 30, 40, 50, 75, 100, 150].map(n => <option key={n} value={n}>{n}</option>)}
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
                <input className="field-input" style={{ width: 140 }} placeholder="e.g. Alex"
                  value={ctx.playerName} onChange={e => ctx.setPlayerName(e.target.value)} />
              </div>
            </div>

            {ctx.mode === "quiz" && (
              <div className="toggles-row">
                <Toggle on={ctx.useTimer} onChange={ctx.setUseTimer} label="Timer (30s)" />
                <Toggle on={ctx.useStreak} onChange={ctx.setUseStreak} label="Streak" />
                <Toggle on={ctx.useSounds} onChange={ctx.setUseSounds} label="Sounds" />
                {ctx.tab === "topic" && <Toggle on={ctx.autoDiff} onChange={ctx.setAutoDiff} label="Auto-difficulty" />}
                <Toggle on={ctx.mpAfterGenerate} onChange={ctx.setMpAfterGenerate} label="Host room after generate" />
              </div>
            )}
          </div>

          {ctx.error && <div className="alert-error">{ctx.error}</div>}

          <button className="btn-primary" style={{ width: "100%", padding: "14px", marginTop: 8 }} onClick={generate}>
            Generate {ctx.mode === "study" ? "Study Guide" : ctx.mode === "flashcard" ? "Flashcards" : "Quiz"}
          </button>

          <hr className="section-divider" />

          {/* Multiplayer */}
          <div className="card" style={{ marginBottom: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Multiplayer</div>
            <div style={{ fontSize: 12, opacity: 0.5, marginBottom: 16 }}>Play with others using a shared room code</div>
            {ctx.mpError && <div className="alert-error" style={{ marginBottom: 12 }}>{ctx.mpError}</div>}
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 180 }}>
                <label className="field-label">Host a game</label>
                <button
                  className="btn-secondary"
                  style={{ width: "100%", opacity: ctx.questions.length > 0 ? 1 : 0.4 }}
                  onClick={ctx.questions.length > 0 ? hostGame : () => ctx.setError("Generate a quiz first.")}
                  disabled={ctx.questions.length === 0}
                >
                  {ctx.questions.length > 0 ? `Create Room (${ctx.questions.length}q)` : "Generate a quiz first"}
                </button>
              </div>
              <div style={{ flex: 1, minWidth: 180 }}>
                <label className="field-label">Join a game</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input className="field-input" placeholder="CODE" maxLength={4}
                    value={ctx.mpJoinCode} onChange={e => ctx.setMpJoinCode(e.target.value.toUpperCase())}
                    style={{ letterSpacing: 4, fontWeight: 700, textAlign: "center" }} />
                  <button className="btn-primary" onClick={joinGame}>Join</button>
                </div>
              </div>
            </div>
          </div>

          {/* Manual Questions */}
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{
              padding: "14px 20px", fontSize: 14, fontWeight: 700,
              borderBottom: showManual ? "1px solid var(--bdr,#3e3e3e)" : "none",
              cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center"
            }} onClick={() => setShowManual(m => !m)}>
              Manual Questions
              <span style={{ opacity: 0.4, fontSize: 12 }}>{showManual ? "▲" : "▼"}</span>
            </div>
            {showManual && (
              <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
                <input className="field-input" placeholder="Question" value={manualQ} onChange={e => setManualQ(e.target.value)} />
                <div style={{ display: "flex", gap: 8 }}>
                  <input className="field-input" placeholder="Answer" value={manualA} onChange={e => setManualA(e.target.value)} />
                  <button className="btn-secondary" style={{ whiteSpace: "nowrap" }} onClick={() => {
                    if (!manualQ.trim() || !manualA.trim()) return;
                    setManualList(l => [...l, { type: "fill", question: manualQ.trim(), answer: manualA.trim(), explanation: "" }]);
                    setManualQ(""); setManualA("");
                  }}>Add</button>
                </div>
                {manualList.map((mq, i) => (
                  <div key={i} className="card-sm" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{mq.question}</div>
                      <div style={{ fontSize: 11, opacity: 0.5, marginTop: 3 }}>{mq.answer}</div>
                    </div>
                    <button style={{ background: "transparent", border: "none", color: "#ef4444", cursor: "pointer", fontSize: 16, opacity: 0.7 }}
                      onClick={() => setManualList(l => l.filter((_, j) => j !== i))}>x</button>
                  </div>
                ))}
                {manualList.length > 0 && (
                  <button className="btn-primary" onClick={() => startQuiz(manualList)}>
                    Start with {manualList.length} question{manualList.length !== 1 ? "s" : ""}
                  </button>
                )}
              </div>
            )}
          </div>
        </>
      )}

    </div>
  );
}