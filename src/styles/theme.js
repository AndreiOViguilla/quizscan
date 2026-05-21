export function getTheme(dark) {
  return dark
    ? { bg: "#212121", bg2: "#2f2f2f", bg3: "#383838", bdr: "#4a4a4a", bdr2: "#686868", txt: "#ececec", txt2: "#b4b4b4", txt3: "#8e8ea0", dim: "#666" }
    : { bg: "#f9f9f9", bg2: "#ffffff", bg3: "#f0f0f0", bdr: "#e5e5e5", bdr2: "#c2c2c2", txt: "#0d0d0d", txt2: "#444444", txt3: "#6e6e6e", dim: "#999" };
}

export function makeGlobalStyles(dark) {
  const v = getTheme(dark);
  const acc = dark ? "#ececec" : "#0d0d0d"; // pure gray/white accent like ChatGPT
  const accHover = dark ? "#ffffff" : "#000000";
  const btnBg = dark ? "#2f2f2f" : "#f0f0f0";

  return `
    @import url('https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&display=swap');
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    --mp-bg: ${dark ? "#2a2a2a" : "#f5f5f5"};
    --mp-head: ${dark ? "#333" : "#ebebeb"};
    --mp-bdr: ${dark ? "#444" : "#e0e0e0"};
    --mp-txt: ${dark ? "#ccc" : "#333"};
    --mp-dim: ${dark ? "#888" : "#888"};
    }
    body { background: ${v.bg}; color: ${v.txt}; font-family: 'Instrument Sans', system-ui, sans-serif; transition: background .2s, color .2s; }
    a { color: ${v.txt2}; text-decoration: none; }
    :root {
      --mp-bg: \${dark ? "#2a2a2a" : "#f5f5f5"};
      --mp-head: \${dark ? "#333333" : "#ebebeb"};
      --mp-bdr: \${dark ? "#444444" : "#e0e0e0"};
      --mp-txt: \${dark ? "#cccccc" : "#333333"};
      --mp-dim: \${dark ? "#888888" : "#888888"};
    }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
    @keyframes bar-fill { 0%{width:0%} 100%{width:100%} }
    @keyframes slide-in { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
    @keyframes fade-in { from{opacity:0} to{opacity:1} }

    /* ── LAYOUT ── */
    html, body { height: 100%; margin: 0; padding: 0; }
    #root { height: 100%; }

    /* Fixed shell — header + footer locked, body scrolls */
    .app-shell {
      display: flex; flex-direction: column;
      height: 100vh; overflow: hidden;
      background: \${v.bg};
    }
    .app-body {
      flex: 1; overflow-y: auto; overflow-x: hidden;
      display: flex; flex-direction: column;
    }

    /* ChatGPT-style scrollbar — only on .app-body */
    .app-body::-webkit-scrollbar { width: 6px; }
    .app-body::-webkit-scrollbar-track { background: transparent; }
    .app-body::-webkit-scrollbar-thumb {
      background: \${dark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.12)"};
      border-radius: 3px;
    }
    .app-body::-webkit-scrollbar-thumb:hover {
      background: \${dark ? "rgba(255,255,255,0.22)" : "rgba(0,0,0,0.22)"};
    }
    /* Firefox */
    .app-body { scrollbar-width: thin; scrollbar-color: \${dark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.12)"} transparent; }

    .app { min-height: 100vh; background: \${v.bg}; display: flex; flex-direction: column; }
    .page { flex: 1; max-width: 760px; margin: 0 auto; width: 100%; padding: 48px 24px; animation: slide-in .2s ease; }

    /* ── NO HEADER - hidden ── */
    .header { display: none; }

    /* ── TOP BAR (minimal floating) ── */
    .topbar {
      position: fixed; top: 0; left: 0; right: 0; z-index: 100;
      display: flex; align-items: center; justify-content: space-between;
      padding: 12px 24px;
      background: ${v.bg};
      border-bottom: 1px solid ${v.bdr};
    }
    .topbar-logo { font-size: 15px; font-weight: 600; color: ${v.txt}; cursor: pointer; letter-spacing: -0.2px; }
    .topbar-right { display: flex; gap: 4px; align-items: center; }
    .topbar-btn {
      background: transparent; border: none; color: ${v.txt2};
      padding: 6px 12px; border-radius: 8px; cursor: pointer;
      font-size: 13px; font-family: 'Instrument Sans', sans-serif; font-weight: 500;
      transition: all .15s;
    }
    .topbar-btn:hover { background: ${v.bg3}; color: ${v.txt}; }
    .topbar-btn.active { background: ${v.bg3}; color: ${v.txt}; }
    .topbar-divider { width: 1px; height: 18px; background: ${v.bdr}; margin: 0 4px; }

    /* ── FOOTER ── */
    .footer {
      border-top: 1px solid ${v.bdr}; padding: 16px 24px;
      display: flex; align-items: center; justify-content: center;
      gap: 20px; background: ${v.bg};
    }
    .footer-left { font-size: 12px; color: ${v.dim}; }
    .footer-left span { color: ${v.txt2}; font-weight: 600; }
    .footer-right { display: flex; gap: 16px; }
    .footer-link { font-size: 12px; color: ${v.dim}; cursor: pointer; transition: color .15s; }
    .footer-link:hover { color: ${v.txt}; }

    /* ── BACK BUTTON ── */
    .back-btn {
      display: inline-flex; align-items: center; gap: 6px;
      background: transparent; border: 1px solid ${v.bdr}; color: ${v.txt2};
      padding: 7px 14px; border-radius: 8px; cursor: pointer;
      font-size: 13px; font-weight: 500; transition: all .15s; margin-bottom: 28px;
    }
    .back-btn:hover { border-color: ${v.bdr2}; color: ${v.txt}; }

    /* ── PAGE HEADER ── */
    .page-heading { font-size: 24px; font-weight: 600; color: ${v.txt}; margin-bottom: 6px; letter-spacing: -0.4px; }
    .page-sub { font-size: 13px; color: ${v.dim}; margin-bottom: 28px; }

    /* ── CARDS ── */
    .card { background: ${v.bg2}; border: 1px solid ${v.bdr}; border-radius: 12px; padding: 24px; margin-bottom: 16px; }
    .card-sm { background: ${v.bg2}; border: 1px solid ${v.bdr}; border-radius: 8px; padding: 14px 18px; margin-bottom: 10px; }

    /* ── BUTTONS ── */
    .btn-primary { background: ${acc}; color: ${dark ? "#212121" : "#ffffff"}; border: none; padding: 11px 24px; font-family: 'Instrument Sans', sans-serif; font-size: 14px; font-weight: 600; cursor: pointer; border-radius: 8px; transition: all .15s; white-space: nowrap; }
    .btn-primary:hover { background: ${accHover}; }
    .btn-primary:disabled { background: ${v.bdr}; color: ${v.dim}; cursor: not-allowed; }
    .btn-secondary { background: transparent; border: 1px solid ${v.bdr}; color: ${v.txt}; padding: 11px 24px; font-family: 'Instrument Sans', sans-serif; font-size: 14px; font-weight: 500; cursor: pointer; border-radius: 8px; transition: all .15s; white-space: nowrap; }
    .btn-secondary:hover { border-color: ${v.bdr2}; background: ${v.bg3}; }
    .btn-danger { background: transparent; border: 1px solid #ef4444; color: #ef4444; padding: 8px 16px; border-radius: 8px; cursor: pointer; font-size: 12px; font-weight: 500; transition: all .15s; }
    .btn-danger:hover { background: ${dark ? "#2d1b1b" : "#fef2f2"}; }

    /* ── FORM ── */
    .field-label { font-size: 11px; color: ${v.txt2}; font-weight: 600; letter-spacing: 0.5px; text-transform: uppercase; margin-bottom: 6px; display: block; }
    .field-input { background: ${v.bg2}; border: 1px solid ${v.bdr}; color: ${v.txt}; font-family: 'Instrument Sans', sans-serif; font-size: 14px; padding: 10px 12px; border-radius: 8px; outline: none; width: 100%; transition: border-color .15s; }
    .field-input:focus { border-color: ${v.bdr2}; }
    .field-input::placeholder { color: ${v.dim}; }
    .field-select { background: ${v.bg2}; border: 1px solid ${v.bdr}; color: ${v.txt}; font-family: 'Instrument Sans', sans-serif; font-size: 14px; font-weight: 500; padding: 10px 12px; border-radius: 8px; outline: none; cursor: pointer; }
    .field-select:focus { border-color: ${v.bdr2}; }

    /* ── ALERTS ── */
    .alert-error { background: ${dark ? "#2d1b1b" : "#fef2f2"}; border: 1px solid #ef4444; color: ${dark ? "#fca5a5" : "#dc2626"}; padding: 12px 16px; border-radius: 8px; font-size: 13px; margin: 12px 0; }
    .alert-info { background: ${v.bg3}; border: 1px solid ${v.bdr}; color: ${v.txt2}; padding: 12px 16px; border-radius: 8px; font-size: 13px; margin: 12px 0; line-height: 1.6; }

    /* ── TOGGLE ── */
    .toggle-item { display: flex; align-items: center; gap: 8px; cursor: pointer; user-select: none; }
    .toggle-track { width: 40px; height: 22px; background: ${v.bdr}; border-radius: 11px; position: relative; transition: background .2s; flex-shrink: 0; }
    .toggle-track.on { background: ${v.txt2}; }
    .toggle-thumb { width: 16px; height: 16px; background: #fff; border-radius: 50%; position: absolute; top: 3px; left: 3px; transition: left .2s; box-shadow: 0 1px 3px rgba(0,0,0,.2); }
    .toggle-track.on .toggle-thumb { left: 21px; }
    .toggle-label { font-size: 13px; color: ${v.txt2}; font-weight: 500; }

    /* ── TABS ── */
    .tabs { display: flex; background: ${v.bg3}; border-radius: 8px; padding: 3px; gap: 2px; width: fit-content; flex-wrap: wrap; }
    .tab-btn { padding: 7px 16px; background: transparent; border: none; color: ${v.dim}; font-family: 'Instrument Sans', sans-serif; font-size: 13px; font-weight: 500; cursor: pointer; transition: all .15s; border-radius: 6px; }
    .tab-btn.active { background: ${v.bg2}; color: ${v.txt}; font-weight: 600; box-shadow: 0 1px 3px rgba(0,0,0,.1); }
    .tab-btn:hover:not(.active) { color: ${v.txt}; }

    /* ── BADGE ── */
    .badge { display: inline-flex; align-items: center; gap: 5px; background: ${v.bg3}; border: 1px solid ${v.bdr}; color: ${v.txt2}; padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 600; }

    /* ── TABLE ── */
    .data-table { width: 100%; border-collapse: collapse; }
    .data-table th { font-size: 11px; font-weight: 600; letter-spacing: 0.5px; text-transform: uppercase; color: ${v.txt2}; text-align: left; padding: 10px 14px; border-bottom: 1px solid ${v.bdr}; }
    .data-table td { padding: 14px; border-bottom: 1px solid ${v.bdr}; font-size: 13px; color: ${v.txt}; }
    .data-table tr:hover td { background: ${v.bg3}; }
    .table-empty { text-align: center; padding: 60px; color: ${v.dim}; font-size: 13px; }

    /* ── SCORE RING ── */
    .score-ring { width: 150px; height: 150px; margin: 0 auto 24px; position: relative; }
    .score-ring svg { transform: rotate(-90deg); }
    .score-ring-center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
    .score-pct { font-size: 32px; font-weight: 700; color: ${v.txt}; line-height: 1; }
    .score-sub { font-size: 10px; color: ${v.txt2}; letter-spacing: 1px; text-transform: uppercase; font-weight: 600; margin-top: 3px; }

    /* ── QUIZ ── */
    .quiz-progress-bar { width: 100%; height: 2px; background: ${v.bdr}; border-radius: 2px; margin-bottom: 24px; overflow: hidden; }
    .quiz-progress-fill { height: 100%; background: ${v.txt2}; border-radius: 2px; transition: width .4s ease; }
    .timer-bar-wrap { width: 100%; height: 4px; background: ${dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)"}; border-radius: 3px; margin-bottom: 16px; overflow: hidden; }
    .timer-bar { height: 100%; border-radius: 3px; transition: width 1s linear, background 1s; }
    .q-type-label { font-size: 11px; color: ${v.dim}; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 14px; }
    .question-text { font-size: 19px; font-weight: 600; line-height: 1.5; color: ${v.txt}; margin-bottom: 22px; }
    .choices { display: flex; flex-direction: column; gap: 8px; }
    .choice-btn { background: ${v.bg2}; border: 1px solid ${v.bdr}; border-radius: 10px; padding: 14px 18px; color: ${v.txt}; font-family: 'Instrument Sans', sans-serif; font-size: 14px; font-weight: 500; cursor: pointer; text-align: left; transition: all .15s; display: flex; align-items: center; gap: 12px; }
    .choice-btn:hover:not(:disabled) { border-color: ${v.bdr2}; background: ${v.bg3}; }
    .choice-btn.selected { border-color: ${v.bdr2}; background: ${v.bg3}; }
    .choice-btn.correct { border-color: ${v.bdr2}; background: ${v.bg3}; font-weight: 600; }
    .choice-btn.wrong { border-color: #ef4444; background: ${dark ? "#2d1b1b" : "#fef2f2"}; color: ${dark ? "#fca5a5" : "#dc2626"}; }
    .choice-btn.eliminated { opacity: .3; cursor: not-allowed; text-decoration: line-through; }
    .choice-btn:disabled { cursor: default; }
    .choice-letter { width: 26px; height: 26px; border: 1.5px solid ${v.bdr}; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; flex-shrink: 0; color: ${v.txt2}; }
    .tf-choices { display: flex; gap: 12px; }
    .tf-btn { flex: 1; background: ${v.bg2}; border: 1px solid ${v.bdr}; border-radius: 10px; padding: 20px; color: ${v.txt}; font-size: 16px; font-weight: 600; cursor: pointer; transition: all .15s; }
    .tf-btn:hover:not(:disabled) { border-color: ${v.bdr2}; background: ${v.bg3}; }
    .tf-btn.correct { border-color: ${v.bdr2}; background: ${v.bg3}; }
    .tf-btn.wrong { border-color: #ef4444; background: ${dark ? "#2d1b1b" : "#fef2f2"}; color: ${dark ? "#fca5a5" : "#dc2626"}; }
    .tf-btn:disabled { cursor: default; }
    .fill-input-wrap { display: flex; gap: 10px; margin-top: 4px; }
    .fill-input { flex: 1; background: ${v.bg2}; border: 1.5px solid ${v.bdr}; border-radius: 8px; color: ${v.txt}; font-family: 'Instrument Sans', sans-serif; font-size: 15px; padding: 12px 16px; outline: none; transition: border-color .2s; }
    .fill-input:focus { border-color: ${v.bdr2}; }
    .fill-input.correct { border-color: ${v.bdr2}; }
    .fill-input.wrong { border-color: #ef4444; }
    .feedback { margin-top: 14px; padding: 14px 18px; border-radius: 10px; font-size: 13px; line-height: 1.6; }
    .feedback.correct-fb { background: ${v.bg3}; border: 1px solid ${v.bdr}; color: ${v.txt2}; }
    .feedback.wrong-fb { background: ${dark ? "#2d1b1b" : "#fef2f2"}; border: 1px solid #ef4444; color: ${dark ? "#fca5a5" : "#dc2626"}; }
    .hint-btn { background: transparent; border: 1px solid ${v.bdr}; color: ${v.txt2}; padding: 6px 14px; border-radius: 8px; font-size: 12px; font-weight: 500; cursor: pointer; margin-top: 14px; transition: all .15s; }
    .hint-btn:hover { border-color: ${v.bdr2}; color: ${v.txt}; }
    .hint-btn:disabled { opacity: .3; cursor: not-allowed; }
    .hint-text { margin-top: 8px; font-size: 12px; color: ${v.txt2}; background: ${v.bg3}; border: 1px solid ${v.bdr}; padding: 8px 14px; border-radius: 8px; }
    .diff-row { display: flex; gap: 8px; margin-top: 14px; align-items: center; flex-wrap: wrap; }
    .diff-label { font-size: 11px; color: ${v.txt2}; font-weight: 600; }
    .diff-btn { padding: 5px 12px; border-radius: 6px; font-size: 11px; cursor: pointer; border: 1px solid ${v.bdr}; background: transparent; color: ${v.dim}; font-weight: 500; transition: all .15s; }
    .diff-btn.sel.easy { background: ${v.bg3}; border-color: ${v.bdr2}; color: ${v.txt}; }
    .diff-btn.sel.medium { background: ${dark ? "#1f1400" : "#fffbeb"}; border-color: #f59e0b; color: #f59e0b; }
    .diff-btn.sel.hard { background: ${dark ? "#2d1b1b" : "#fef2f2"}; border-color: #ef4444; color: #ef4444; }
    .quiz-action-row { display: flex; justify-content: space-between; align-items: center; margin-top: 16px; }
    .next-btn { background: ${acc}; color: ${dark ? "#212121" : "#ffffff"}; border: none; padding: 11px 28px; font-size: 14px; font-weight: 600; cursor: pointer; border-radius: 8px; transition: all .15s; }
    .next-btn:hover { background: ${accHover}; }

    /* ── FLASHCARD ── */
    .fc-scene { width: 100%; max-width: 600px; height: 300px; perspective: 1200px; cursor: pointer; margin: 0 auto 24px; display: block; }
    .fc-card { width: 100%; height: 100%; position: relative; transform-style: preserve-3d; transition: transform .5s cubic-bezier(.4,.2,.2,1); }
    .fc-card.flipped { transform: rotateY(180deg); }
    .fc-face { position: absolute; inset: 0; border-radius: 16px; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 36px; backface-visibility: hidden; -webkit-backface-visibility: hidden; text-align: center; }
    .fc-front { background: ${v.bg2}; border: 1px solid ${v.bdr}; }
    .fc-back { background: ${v.bg3}; border: 1px solid ${v.bdr2}; transform: rotateY(180deg); }
    .fc-face-label { font-size: 10px; color: ${v.dim}; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 16px; font-weight: 600; }
    .fc-back .fc-face-label { color: ${v.txt2}; }
    .fc-face-question { font-size: 18px; font-weight: 600; color: ${v.txt}; line-height: 1.5; }
    .fc-face-answer { font-size: 20px; font-weight: 700; color: ${v.txt}; line-height: 1.4; }
    .fc-face-hint { margin-top: 12px; font-size: 11px; color: ${v.dim}; }
    .fc-dots { display: flex; gap: 5px; flex-wrap: wrap; justify-content: center; margin-bottom: 20px; }
    .fc-dot { width: 9px; height: 9px; border-radius: 50%; background: ${v.bdr}; border: 1px solid ${v.bdr}; transition: all .3s; }
    .fc-dot.known { background: ${v.txt2}; border-color: ${v.txt2}; }
    .fc-dot.cur { background: ${v.txt}; border-color: ${v.txt}; }

    /* ── STATS ROW ── */
    .stats-row { display: flex; gap: 12px; flex-wrap: wrap; }
    .stat-box { background: ${v.bg2}; border: 1px solid ${v.bdr}; border-radius: 12px; padding: 16px 24px; min-width: 80px; text-align: center; flex: 1; }
    .stat-num { font-size: 28px; font-weight: 700; color: ${v.txt}; }
    .stat-lbl { font-size: 10px; color: ${v.txt2}; letter-spacing: 1px; text-transform: uppercase; margin-top: 4px; font-weight: 600; }

    /* ── REVIEW ── */
    .review-item { background: ${v.bg2}; border-left: 3px solid ${v.bdr}; padding: 14px 18px; margin-bottom: 8px; border-radius: 0 8px 8px 0; }
    .review-item.correct { border-left-color: ${v.txt2}; }
    .review-item.wrong { border-left-color: #ef4444; }
    .review-q { font-size: 13px; font-weight: 600; margin-bottom: 5px; color: ${v.txt}; }
    .review-your { font-size: 11px; color: ${v.dim}; }
    .review-correct { font-size: 11px; color: ${v.txt2}; margin-top: 3px; font-weight: 600; }

    /* ── SHARE BOX ── */
    .share-box { background: ${v.bg3}; border: 1px solid ${v.bdr}; border-radius: 12px; padding: 16px; margin: 20px 0; }
    .share-url { font-size: 11px; color: ${v.txt2}; word-break: break-all; margin: 8px 0 12px; line-height: 1.6; font-family: monospace; }
    .copy-btn { background: ${acc}; color: ${dark ? "#212121" : "#ffffff"}; border: none; padding: 7px 16px; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; transition: background .15s; }
    .copy-btn:hover { background: ${accHover}; }

    /* ── MULTIPLAYER ── */
    .mp-room-code { font-size: 52px; font-weight: 700; color: ${v.txt}; letter-spacing: 10px; text-align: center; margin: 24px 0 8px; font-family: monospace; }
    .mp-status-text { font-size: 13px; color: ${v.txt2}; text-align: center; margin-bottom: 20px; }
    .mp-player-row { background: ${v.bg2}; border: 1px solid ${v.bdr}; border-radius: 10px; padding: 12px 16px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
    .mp-player-name { font-weight: 600; color: ${v.txt}; font-size: 14px; }
    .mp-player-score { font-size: 13px; color: ${v.txt2}; font-weight: 700; }

    /* ── EDIT ── */
    .edit-q-card { background: ${v.bg2}; border: 1px solid ${v.bdr}; border-radius: 12px; padding: 18px; margin-bottom: 14px; }
    .edit-q-num { font-size: 11px; color: ${v.txt2}; letter-spacing: 1px; margin-bottom: 8px; text-transform: uppercase; font-weight: 600; }
    .edit-choice-row { display: flex; gap: 7px; align-items: center; margin-bottom: 6px; }
    .edit-choice-letter { width: 26px; height: 26px; border: 1px solid ${v.bdr}; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 10px; color: ${v.txt2}; flex-shrink: 0; font-weight: 600; }
    .edit-correct-btn { padding: 3px 9px; border-radius: 6px; font-size: 10px; cursor: pointer; border: 1px solid ${v.bdr}; background: transparent; color: ${v.dim}; font-weight: 500; flex-shrink: 0; }
    .edit-correct-btn.sel { background: ${v.bg3}; border-color: ${v.bdr2}; color: ${v.txt}; }

    /* ── LOADING ── */
    .loading-screen { text-align: center; padding: 80px 0; }
    .loading-title { font-size: 22px; font-weight: 600; color: ${v.txt}; animation: pulse 1.5s ease-in-out infinite; }
    .loading-bar-wrap { width: 280px; height: 2px; background: ${v.bdr}; margin: 28px auto 14px; border-radius: 2px; overflow: hidden; }
    .loading-bar { height: 100%; background: ${v.txt2}; animation: bar-fill 3s ease-out forwards; border-radius: 2px; }
    .loading-hint { font-size: 12px; color: ${v.dim}; letter-spacing: 1px; text-transform: uppercase; font-weight: 500; }

    /* ── STUDY ── */
    .study-card { background: ${v.bg2}; border: 1px solid ${v.bdr}; border-radius: 12px; padding: 24px; margin-bottom: 12px; display: flex; gap: 24px; }
    .study-q-side { flex: 1; }
    .study-divider { width: 1px; background: ${v.bdr}; flex-shrink: 0; border-radius: 2px; }
    .study-a-side { flex: 1; }
    .study-side-label { font-size: 10px; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 8px; font-weight: 700; color: ${v.txt2}; }
    .study-q-text { font-size: 15px; font-weight: 600; color: ${v.txt}; line-height: 1.5; }
    .study-a-text { font-size: 15px; font-weight: 600; color: ${v.txt}; line-height: 1.5; }
    .study-explanation { font-size: 12px; color: ${v.dim}; margin-top: 6px; line-height: 1.6; }

    /* ── HOME ── */
    .home-hero { padding: 60px 0 40px; text-align: center; }
    .home-title { font-size: 42px; font-weight: 700; line-height: 1.1; margin-bottom: 12px; letter-spacing: -1px; color: ${v.txt}; }
    .home-title .green { color: ${v.txt}; }
    .home-sub { color: ${v.dim}; font-size: 14px; margin-bottom: 40px; line-height: 1.6; }
    .home-modes { display: flex; gap: 10px; margin-bottom: 32px; flex-wrap: wrap; justify-content: center; }
    .mode-card { flex: 1; min-width: 140px; background: ${v.bg2}; border: 1px solid ${v.bdr}; border-radius: 12px; padding: 18px 16px; cursor: pointer; transition: all .15s; text-align: center; }
    .mode-card:hover, .mode-card.active { border-color: ${v.bdr2}; background: ${v.bg3}; }
    .mode-card-icon { font-size: 20px; margin-bottom: 8px; color: ${v.txt2}; }
    .mode-card-title { font-size: 13px; font-weight: 700; color: ${v.txt}; margin-bottom: 3px; }
    .mode-card-desc { font-size: 11px; color: ${v.dim}; }
    .drop-zone { border: 1.5px dashed ${v.bdr}; border-radius: 12px; padding: 40px 32px; text-align: center; cursor: pointer; transition: all .2s; background: ${v.bg2}; position: relative; }
    .drop-zone:hover, .drop-zone.drag-over { border-color: ${v.bdr2}; background: ${v.bg3}; }
    .drop-zone input[type="file"] { position: absolute; inset: 0; opacity: 0; cursor: pointer; width: 100%; height: 100%; }
    .drop-label { font-size: 15px; font-weight: 600; margin-bottom: 6px; color: ${v.txt}; }
    .drop-hint { font-size: 12px; color: ${v.dim}; }
    .drop-file-name { margin-top: 10px; font-size: 12px; color: ${v.txt2}; background: ${v.bg3}; border: 1px solid ${v.bdr}; padding: 5px 12px; border-radius: 20px; display: inline-block; font-weight: 600; }
    .input-row { display: flex; gap: 12px; margin-top: 20px; flex-wrap: wrap; align-items: flex-end; }
    .toggles-row { display: flex; gap: 20px; margin-top: 16px; flex-wrap: wrap; }
    .section-divider { border: none; border-top: 1px solid ${v.bdr}; margin: 28px 0; }
    .collapsible { border: 1px solid ${v.bdr}; border-radius: 12px; overflow: hidden; margin-top: 20px; }
    .collapsible-header { background: ${v.bg3}; padding: 12px 18px; font-weight: 600; font-size: 13px; color: ${v.txt}; cursor: pointer; display: flex; justify-content: space-between; align-items: center; }
    .collapsible-body { padding: 16px; background: ${v.bg2}; display: flex; flex-direction: column; gap: 10px; }
    .text-area { width: 100%; min-height: 160px; background: ${v.bg2}; border: 1px solid ${v.bdr}; border-radius: 8px; color: ${v.txt}; font-family: 'Instrument Sans', sans-serif; font-size: 13px; padding: 16px; resize: vertical; outline: none; line-height: 1.7; transition: border-color .15s; }
    .text-area:focus { border-color: ${v.bdr2}; }
    .text-area::placeholder { color: ${v.dim}; }
  `;
}