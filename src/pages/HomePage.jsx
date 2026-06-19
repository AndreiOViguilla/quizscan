import { useState } from "react";
import { useApp } from "../context/AppContext";
import { Toggle } from "../components/Layout";
import { groq, generateText, parseQuestions, createRoom, joinRoom, FirebaseListener, decodeQuiz } from "../utils/api";
import { shareQuizPublicly } from "./FindPage";
import { useAuth } from "../context/AuthContext";
import { LANGUAGES } from "../utils/constants";

const TABS = [
  ["pdf", "PDF"], ["image", "IMAGE"], ["text", "TEXT"],
  ["url", "URL"], ["youtube", "YT"], ["topic", "TOPIC"],
];
const MODES = [
  {
    id: "quiz",
    desc: "Test yourself with questions",
    icon: (
      <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" width="36" height="36">
        <rect x="6" y="6" width="28" height="28" rx="4" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M20 17c0-1.657 1.343-3 3-3s3 1.343 3 3c0 1.5-1.5 2.5-2.5 3.5V22" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <circle cx="23.5" cy="25" r="1" fill="currentColor"/>
        <path d="M10 18h6M10 22h4M10 26h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
    label: "Quiz"
  },
  {
    id: "study",
    desc: "Read Q&A side by side",
    icon: (
      <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" width="36" height="36">
        <rect x="6" y="8" width="12" height="24" rx="2" stroke="currentColor" strokeWidth="1.5"/>
        <rect x="22" y="8" width="12" height="24" rx="2" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M9 14h6M9 18h6M9 22h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <path d="M25 14h6M25 18h6M25 22h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
    label: "Study"
  },
  {
    id: "flashcard",
    desc: "Flip cards to memorize",
    icon: (
      <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" width="36" height="36">
        <rect x="4" y="12" width="24" height="16" rx="3" stroke="currentColor" strokeWidth="1.5"/>
        <rect x="12" y="8" width="24" height="16" rx="3" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 2"/>
        <path d="M10 20h12M10 24h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
    label: "Cards"
  },
];

export default function HomePage() {
  const ctx = useApp();
  const [drag, setDrag] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [generated, setGenerated] = useState(null); // holds questions after generate
  const [quickJoin, setQuickJoin] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const { user } = useAuth();
  const [shared, setShared] = useState(false);
  const [showMp, setShowMp] = useState(false);
  const [manualQ, setManualQ] = useState("");
  const [manualA, setManualA] = useState("");
  const [manualList, setManualList] = useState([]);
  const [ytStatus, setYtStatus] = useState("");
  const [genStatus, setGenStatus] = useState("");

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
    // Stay on settings page — just mark as generated so Start Quiz lights up
    setGenerated(qs);
    setIsGenerating(false);
    setShowSettings(true);
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

    setIsGenerating(true);
    setGenStatus("Generating...");
    const warmupTimer = setTimeout(() => setGenStatus("Warming up AI model — this may take up to 30s..."), 8000);
    const slowTimer = setTimeout(() => setGenStatus("Still working, almost there..."), 22000);

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
        const raw = await generateText([{ role: "user", content: urlPrompt }]);
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

        const raw = await generateText([{ role: "user", content: ytPrompt }]);
        await startQuiz(parseQuestions(raw)); return;
      } else if (tab === "topic") {
        const raw = await generateText([{ role: "user", content: `Generate exactly ${numQ} quiz questions about: ${topicVal}\n${typeInstr} ${langNote} ${jsonInstr}` }], numQ > 25 ? 8000 : 4000);
        await startQuiz(parseQuestions(raw)); return;
      } else {
        // text tab — use HF with Groq fallback
        const raw = await generateText([{ role: "user", content: `Quiz generator. Generate exactly ${numQ} questions from:\n\n${text.trim().substring(0, 4000)}\n\n${typeInstr} ${langNote} ${jsonInstr}` }]);
        await startQuiz(parseQuestions(raw)); return;
      }

      // image / pdf — vision model, Groq only
      const raw = await groq(messages, model);
      await startQuiz(parseQuestions(raw));
    } catch (e) {
      console.error("Generate error:", e);
      const msg = e.message || "Something went wrong. Please try again.";
      if (ctx.tab === "youtube") setYtStatus(prev => prev + "\nFATAL ERROR: " + msg);
      ctx.setError(msg);
      setIsGenerating(false);
      setShowSettings(true);
    } finally {
      clearTimeout(warmupTimer);
      clearTimeout(slowTimer);
      setGenStatus("");
    }
  };

  const hostGame = async () => {
    const name = ctx.playerName?.trim() || "Host";
    try {
      ctx.setMpError("");
      const code = await createRoom(ctx.questions, name);
      const listener = new FirebaseListener(`/rooms/${code}/players`, (players) => {
        if (players && typeof players === "object") {
          const arr = Object.values(players).sort((a, b) => (b.score || 0) - (a.score || 0));
          ctx.setMpPlayers(arr);
        }
      });
      listener.connect();
      ctx.mpRealtimeRef.current = listener;
      ctx.setMpCode(code);
      ctx.setMpMode("host");
      ctx.setMpPlayers([{ name, score: 0 }]);
      ctx.setMyMpName(name);
      ctx.navigate("multiplayer");
    } catch (e) {
      ctx.setMpError("Failed to create room: " + e.message);
    }
  };

  const joinGame = async () => {
    const code = ctx.mpJoinCode?.trim().toUpperCase();
    const name = ctx.playerName?.trim() || "Player";
    if (!code || code.length !== 4) return ctx.setMpError("Enter a valid 4-letter room code.");
    try {
      ctx.setMpError("");
      const room = await joinRoom(code, name);
      const assignedName = room.assignedName || name;
      const players = room.players ? Object.values(room.players) : [];
      if (room.questions?.length) ctx.setQuestions(room.questions);
      const listener = new FirebaseListener(`/rooms/${code}/players`, (ps) => {
        if (ps && typeof ps === "object") {
          const arr = Object.values(ps).sort((a, b) => (b.score || 0) - (a.score || 0));
          ctx.setMpPlayers(arr);
        }
      });
      listener.connect();
      ctx.mpRealtimeRef.current = listener;
      ctx.setMpCode(code);
      ctx.setMpMode("join");
      ctx.setMpPlayers(players);
      ctx.setMyMpName(assignedName);
      ctx.navigate("multiplayer");
    } catch (e) {
      ctx.setMpError("Failed to join: " + e.message);
    }
  }
  const genDisabled = ["pdf", "image"].includes(ctx.tab) && !ctx.file;

  return (
    <div className="page" style={{ maxWidth: 620, paddingTop: 72 }}>

      {/* ── SUCCESS SCREEN ── */}
      {generated && !showSettings ? (
        <>
          <div style={{ textAlign: "center", padding: "60px 0 40px" }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>
              <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" width="64" height="64" style={{ margin: "0 auto", display: "block" }}>
                <circle cx="32" cy="32" r="30" stroke="currentColor" strokeWidth="1.5" opacity="0.3"/>
                <path d="M20 32l8 8 16-16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <h2 style={{ fontSize: 26, fontWeight: 700, marginBottom: 8 }}>Quiz generated!</h2>
            <p style={{ opacity: 0.5, fontSize: 14, marginBottom: 32 }}>{generated.length} questions ready</p>
            <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
              <button className="btn-primary" style={{ padding: "12px 32px", fontSize: 15 }}
                onClick={() => { ctx.navigate("edit"); }}>
                Review & Start
              </button>
              <button className="btn-secondary" style={{ padding: "12px 20px" }}
                onClick={() => { setGenerated(null); setShowSettings(false); }}>
                Generate again
              </button>
              <button className="btn-secondary" style={{ padding: "12px 20px" }}
                onClick={async () => {
                  const topic = ctx.topicVal || ctx.file?.name || ctx.urlVal || ctx.ytVal || "Shared Quiz";
                  await shareQuizPublicly(generated, topic, ctx.playerName || "Anonymous");
                  setShared(true);
                }}>
                {shared ? "Shared!" : "Share Publicly"}
              </button>
            </div>
          </div>

          <hr className="section-divider" />

          {/* Quick join on success screen too */}
          <div className="card">
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Join a game</div>
            <div style={{ fontSize: 12, opacity: 0.5, marginBottom: 12 }}>Enter a room code to join a friend</div>
            <div style={{ display: "flex", gap: 8 }}>
              <input className="field-input" placeholder="Enter code" maxLength={4}
                value={ctx.mpJoinCode} onChange={e => ctx.setMpJoinCode(e.target.value.toUpperCase())}
                style={{ letterSpacing: 4, fontWeight: 700, textAlign: "center", flex: 1 }} />
              <button className="btn-primary" onClick={joinGame}>Join</button>
            </div>
            {ctx.mpError && <div className="alert-error" style={{ marginTop: 10 }}>{ctx.mpError}</div>}
          </div>
        </>

      ) : !showSettings ? (
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
                <div style={{ marginBottom: 10, opacity: ctx.mode === m.id ? 1 : 0.5 }}>{m.icon}</div>
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
            <button className="btn-primary" style={{ flex: 1, padding: "13px" }}
              onClick={() => { ctx.setError(""); if (!genDisabled) setShowSettings(true); }}
              disabled={genDisabled}>
              Continue
            </button>
            <button className="btn-secondary" style={{ padding: "13px 18px" }}
              onClick={() => { ctx.setError(""); if (!genDisabled) generate(); }}
              disabled={genDisabled} title="Generate with current settings">
              Quick Generate
            </button>
          </div>
          <p style={{ fontSize: 11, opacity: 0.35, textAlign: "center", marginTop: 10 }}>
            Continue to set questions, type, language · or Quick Generate with defaults
          </p>

          <hr className="section-divider" />

          {/* Join a game — on landing page */}
          <div className="card">
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Join a game</div>
            <div style={{ fontSize: 12, opacity: 0.5, marginBottom: 12 }}>Enter a room code from your host</div>
            <div style={{ display: "flex", gap: 8 }}>
              <input className="field-input" placeholder="Enter code" maxLength={4}
                value={ctx.mpJoinCode} onChange={e => ctx.setMpJoinCode(e.target.value.toUpperCase())}
                style={{ letterSpacing: 4, fontWeight: 700, textAlign: "center", flex: 1 }} />
              <button className="btn-primary" onClick={joinGame}>Join</button>
            </div>
            {ctx.mpError && <div className="alert-error" style={{ marginTop: 10 }}>{ctx.mpError}</div>}
          </div>
        </>

      ) : (
        /* ── PAGE 2: SETTINGS ── */
        <>
          <button className="back-btn" onClick={() => setShowSettings(false)}>Back</button>
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

          {/* Two action buttons side by side */}
          <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
            {/* Generate */}
            <div style={{
              flex: 1, border: "1px solid var(--bdr,#3e3e3e)", borderRadius: 10,
              padding: "16px", display: "flex", flexDirection: "column", gap: 10,
              background: "var(--bg2)"
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {generated ? (
                  <svg viewBox="0 0 20 20" fill="none" width="18" height="18">
                    <circle cx="10" cy="10" r="9" stroke="currentColor" strokeWidth="1.5" opacity="0.4"/>
                    <path d="M6 10l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                ) : (
                  <svg viewBox="0 0 20 20" fill="none" width="18" height="18">
                    <circle cx="10" cy="10" r="9" stroke="currentColor" strokeWidth="1.5" opacity="0.3"/>
                    <path d="M10 6v4M10 14h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                )}
                <span style={{ fontWeight: 600, fontSize: 13 }}>
                  {generated ? `${generated.length} questions ready` : "Generate Quiz"}
                </span>
              </div>
              <p style={{ fontSize: 11, opacity: 0.45, margin: 0 }}>
                {generated ? "Quiz generated successfully" : "AI will create questions from your content"}
              </p>
              <button className={generated ? "btn-secondary" : "btn-primary"} style={{ width: "100%", padding: "10px" }} onClick={generate} disabled={isGenerating}>
                {isGenerating ? "Generating..." : generated ? "Regenerate" : "Generate"}
              </button>
              {genStatus && <div className="alert-info" style={{ marginTop: 8, fontSize: 12 }}>{genStatus}</div>}
              {generated && (
                <button className="btn-secondary" style={{ width: "100%", padding: "8px", fontSize: 12 }}
                  onClick={async () => {
                    const topic = ctx.topicVal || ctx.file?.name || ctx.urlVal || ctx.ytVal || "Shared Quiz";
                    await shareQuizPublicly(generated, topic, ctx.playerName || "Anonymous");
                    setShared(true);
                  }}>
                  {shared ? "Shared!" : "Share to Find Page"}
                </button>
              )}
            </div>

            {/* Start */}
            <div style={{
              flex: 1, border: `1px solid ${generated ? "var(--bdr2,#686868)" : "var(--bdr,#3e3e3e)"}`, borderRadius: 10,
              padding: "16px", display: "flex", flexDirection: "column", gap: 10,
              background: "var(--bg2)", opacity: generated ? 1 : 0.5
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <svg viewBox="0 0 20 20" fill="none" width="18" height="18">
                  <circle cx="10" cy="10" r="9" stroke="currentColor" strokeWidth="1.5" opacity="0.3"/>
                  <path d="M8 7l5 3-5 3V7z" fill="currentColor" opacity="0.7"/>
                </svg>
                <span style={{ fontWeight: 600, fontSize: 13 }}>Start Quiz</span>
              </div>
              <p style={{ fontSize: 11, opacity: 0.45, margin: 0 }}>
                Review and edit questions before starting
              </p>
              <button className="btn-primary" style={{ width: "100%", padding: "10px" }}
                disabled={!generated}
                onClick={() => { if (generated) ctx.navigate("edit"); }}>
                Review & Start
              </button>
            </div>
          </div>

          {/* Share Publicly button — shown after generating */}
          {generated && (
            <button
              className="btn-secondary"
              style={{ width: "100%", marginTop: 10, padding: "11px" }}
              onClick={async () => {
                if (!user) { ctx.setError("Please sign in to share quizzes publicly."); return; }
                const topic = ctx.topicVal || ctx.file?.name || ctx.urlVal || ctx.ytVal || "Shared Quiz";
                await shareQuizPublicly(generated, topic, user.displayName || user.email?.split("@")[0] || "Anonymous");
                setShared(true);
              }}
            >
              {shared ? "Shared to Find Page!" : "Share Publicly"}
            </button>
          )}

          <hr className="section-divider" />

          {/* Multiplayer — host */}
          <div className="card" style={{ marginBottom: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Host a game</div>
            <div style={{ fontSize: 12, opacity: 0.5, marginBottom: 12 }}>Generate a quiz first, then create a room for others to join</div>
            {ctx.mpError && <div className="alert-error" style={{ marginBottom: 12 }}>{ctx.mpError}</div>}
            <button className="btn-secondary" style={{ width: "100%", opacity: ctx.questions.length > 0 ? 1 : 0.4 }}
              onClick={ctx.questions.length > 0 ? hostGame : () => ctx.setError("Generate a quiz first.")}
              disabled={ctx.questions.length === 0}>
              {ctx.questions.length > 0 ? `Create Room (${ctx.questions.length} questions)` : "Generate a quiz first"}
            </button>
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
