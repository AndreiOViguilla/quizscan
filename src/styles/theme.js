export function getTheme(dark) {
  return dark
    ? { bg: "#000", bg2: "#040f04", bg3: "#0d2b0d", bdr: "#1a3d1a", bdr2: "#2e7d32", txt: "#e8f5e9", txt2: "#81c784", txt3: "#2e7d32", dim: "#555" }
    : { bg: "#f5f5f5", bg2: "#fff", bg3: "#e8f5e9", bdr: "#c8e6c9", bdr2: "#4caf50", txt: "#1b2e1b", txt2: "#388e3c", txt3: "#66bb6a", dim: "#aaa" };
}

export function makeGlobalStyles(dark) {
  const v = getTheme(dark);
  return `
    @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syne:wght@400;600;700;800&display=swap');
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: ${v.bg}; color: ${v.txt}; font-family: 'Syne', sans-serif; transition: background .2s, color .2s; }
    a { color: #4caf50; text-decoration: none; }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
    @keyframes bar-fill { 0%{width:0%} 100%{width:100%} }
    @keyframes slide-in { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }
    @keyframes fade-in { from{opacity:0} to{opacity:1} }

    /* ── LAYOUT ── */
    .app { min-height: 100vh; background: ${v.bg}; display: flex; flex-direction: column; }
    .page { flex: 1; max-width: 900px; margin: 0 auto; width: 100%; padding: 40px 24px; animation: slide-in .25s ease; }

    /* ── HEADER ── */
    .header {
      position: sticky; top: 0; z-index: 100;
      background: ${v.bg}; border-bottom: 1px solid ${v.bdr};
      padding: 0 32px; height: 60px;
      display: flex; align-items: center; gap: 16px;
      backdrop-filter: blur(8px);
    }
    .header-logo { font-family: 'Space Mono', monospace; font-size: 20px; font-weight: 700; color: #4caf50; letter-spacing: -1px; cursor: pointer; }
    .header-logo span { color: ${v.txt}; }
    .header-badge { background: ${v.bg3}; border: 1px solid ${v.bdr2}; color: #66bb6a; font-size: 9px; font-family: 'Space Mono', monospace; padding: 2px 7px; border-radius: 2px; letter-spacing: 2px; text-transform: uppercase; }
    .header-nav { display: flex; gap: 4px; margin-left: auto; align-items: center; }
    .nav-btn {
      background: transparent; border: 1px solid transparent; color: ${v.dim};
      padding: 6px 14px; border-radius: 3px; cursor: pointer;
      font-size: 12px; font-family: 'Space Mono', monospace; font-weight: 700;
      transition: all .15s; letter-spacing: .5px; white-space: nowrap;
    }
    .nav-btn:hover { border-color: ${v.bdr}; color: ${v.txt2}; }
    .nav-btn.active { background: ${v.bg3}; border-color: ${v.bdr2}; color: #4caf50; }
    .nav-divider { width: 1px; height: 20px; background: ${v.bdr}; margin: 0 4px; }

    /* ── FOOTER ── */
    .footer {
      border-top: 1px solid ${v.bdr}; padding: 20px 32px;
      display: flex; align-items: center; justify-content: space-between;
      flex-wrap: wrap; gap: 12px;
    }
    .footer-left { font-family: 'Space Mono', monospace; font-size: 11px; color: ${v.dim}; }
    .footer-left span { color: #4caf50; }
    .footer-right { display: flex; gap: 16px; }
    .footer-link { font-family: 'Space Mono', monospace; font-size: 11px; color: ${v.dim}; cursor: pointer; transition: color .15s; }
    .footer-link:hover { color: #4caf50; }

    /* ── BACK BUTTON ── */
    .back-btn {
      display: inline-flex; align-items: center; gap: 6px;
      background: transparent; border: 1px solid ${v.bdr}; color: ${v.dim};
      padding: 7px 14px; border-radius: 3px; cursor: pointer;
      font-family: 'Space Mono', monospace; font-size: 11px; font-weight: 700;
      transition: all .15s; margin-bottom: 28px; letter-spacing: .5px;
    }
    .back-btn:hover { border-color: #4caf50; color: #4caf50; }
    .back-btn::before { content: '&larr;'; }

    /* ── PAGE HEADER ── */
    .page-heading { font-size: 28px; font-weight: 800; color: ${v.txt}; margin-bottom: 6px; }
    .page-sub { font-family: 'Space Mono', monospace; font-size: 12px; color: ${v.dim}; margin-bottom: 28px; }

    /* ── CARDS ── */
    .card { background: ${v.bg2}; border: 1px solid ${v.bdr}; border-radius: 6px; padding: 24px; margin-bottom: 16px; }
    .card-sm { background: ${v.bg2}; border: 1px solid ${v.bdr}; border-radius: 4px; padding: 14px 18px; margin-bottom: 10px; }

    /* ── BUTTONS ── */
    .btn-primary { background: #4caf50; color: #000; border: none; padding: 12px 28px; font-family: 'Syne', sans-serif; font-size: 14px; font-weight: 800; cursor: pointer; border-radius: 3px; transition: all .15s; white-space: nowrap; }
    .btn-primary:hover { background: #66bb6a; transform: translateY(-1px); }
    .btn-primary:disabled { background: ${v.bdr}; color: ${v.dim}; cursor: not-allowed; transform: none; }
    .btn-secondary { background: transparent; border: 1px solid ${v.bdr}; color: #4caf50; padding: 12px 28px; font-family: 'Syne', sans-serif; font-size: 14px; font-weight: 700; cursor: pointer; border-radius: 3px; transition: all .15s; white-space: nowrap; }
    .btn-secondary:hover { border-color: #4caf50; background: ${v.bg3}; }
    .btn-danger { background: transparent; border: 1px solid #c62828; color: #ef9a9a; padding: 8px 18px; border-radius: 3px; cursor: pointer; font-family: 'Space Mono', monospace; font-size: 11px; }
    .btn-danger:hover { background: #1a0000; }

    /* ── FORM ── */
    .field-label { font-size: 11px; color: ${v.txt3}; font-family: 'Space Mono', monospace; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 6px; display: block; }
    .field-input { background: ${v.bg2}; border: 1px solid ${v.bdr}; color: ${v.txt}; font-family: 'Syne', sans-serif; font-size: 13px; padding: 9px 12px; border-radius: 3px; outline: none; width: 100%; }
    .field-input:focus { border-color: #4caf50; }
    .field-input::placeholder { color: ${v.dim}; }
    .field-select { background: ${v.bg2}; border: 1px solid ${v.bdr}; color: ${v.txt}; font-family: 'Syne', sans-serif; font-size: 13px; font-weight: 600; padding: 9px 12px; border-radius: 3px; outline: none; cursor: pointer; }
    .field-select:focus { border-color: #4caf50; }

    /* ── ALERTS ── */
    .alert-error { background: #1a0000; border: 1px solid #b71c1c; color: #ef9a9a; padding: 12px 16px; border-radius: 4px; font-family: 'Space Mono', monospace; font-size: 12px; margin: 12px 0; }
    .alert-info { background: ${v.bg3}; border: 1px solid ${v.bdr2}; color: ${v.txt2}; padding: 12px 16px; border-radius: 4px; font-family: 'Space Mono', monospace; font-size: 12px; margin: 12px 0; line-height: 1.7; }

    /* ── TOGGLE ── */
    .toggle-item { display: flex; align-items: center; gap: 8px; cursor: pointer; user-select: none; }
    .toggle-track { width: 38px; height: 20px; background: ${v.bdr}; border-radius: 10px; position: relative; transition: background .2s; flex-shrink: 0; }
    .toggle-track.on { background: #4caf50; }
    .toggle-thumb { width: 14px; height: 14px; background: #fff; border-radius: 50%; position: absolute; top: 3px; left: 3px; transition: left .2s; }
    .toggle-track.on .toggle-thumb { left: 21px; }
    .toggle-label { font-size: 12px; color: ${v.txt2}; font-family: 'Space Mono', monospace; }

    /* ── TABS ── */
    .tabs { display: flex; border: 1px solid ${v.bdr}; border-radius: 4px; overflow: hidden; width: fit-content; flex-wrap: wrap; }
    .tab-btn { padding: 9px 20px; background: transparent; border: none; color: ${v.dim}; font-family: 'Syne', sans-serif; font-size: 13px; font-weight: 700; cursor: pointer; transition: all .15s; border-right: 1px solid ${v.bdr}; }
    .tab-btn:last-child { border-right: none; }
    .tab-btn.active { background: ${v.bg3}; color: #4caf50; }
    .tab-btn:hover:not(.active) { background: ${v.bg3}; color: ${v.txt2}; }

    /* ── BADGE ── */
    .badge { display: inline-flex; align-items: center; gap: 5px; background: ${v.bg3}; border: 1px solid ${v.bdr2}; color: #4caf50; padding: 3px 10px; border-radius: 2px; font-family: 'Space Mono', monospace; font-size: 11px; }

    /* ── TABLE ── */
    .data-table { width: 100%; border-collapse: collapse; }
    .data-table th { font-family: 'Space Mono', monospace; font-size: 10px; letter-spacing: 2px; text-transform: uppercase; color: ${v.txt3}; text-align: left; padding: 10px 14px; border-bottom: 1px solid ${v.bdr}; }
    .data-table td { padding: 14px; border-bottom: 1px solid ${v.bdr}; font-size: 13px; color: ${v.txt}; }
    .data-table tr:hover td { background: ${v.bg3}; }
    .table-empty { text-align: center; padding: 60px; color: ${v.dim}; font-family: 'Space Mono', monospace; font-size: 13px; }

    /* ── SCORE RING ── */
    .score-ring { width: 150px; height: 150px; margin: 0 auto 24px; position: relative; }
    .score-ring svg { transform: rotate(-90deg); }
    .score-ring-center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
    .score-pct { font-size: 32px; font-weight: 800; color: #4caf50; font-family: 'Space Mono', monospace; line-height: 1; }
    .score-sub { font-size: 10px; color: ${v.txt3}; font-family: 'Space Mono', monospace; letter-spacing: 2px; text-transform: uppercase; }

    /* ── QUIZ ── */
    .quiz-progress-bar { width: 100%; height: 3px; background: ${v.bg3}; border-radius: 2px; margin-bottom: 24px; overflow: hidden; }
    .quiz-progress-fill { height: 100%; background: #4caf50; border-radius: 2px; transition: width .4s ease; }
    .timer-bar-wrap { width: 100%; height: 5px; background: ${v.bg3}; border-radius: 3px; margin-bottom: 16px; overflow: hidden; }
    .timer-bar { height: 100%; border-radius: 3px; transition: width 1s linear, background 1s; }
    .q-type-label { font-family: 'Space Mono', monospace; font-size: 10px; color: ${v.txt3}; letter-spacing: 3px; text-transform: uppercase; margin-bottom: 14px; }
    .question-text { font-size: 20px; font-weight: 700; line-height: 1.4; color: ${v.txt}; margin-bottom: 22px; }
    .choices { display: flex; flex-direction: column; gap: 10px; }
    .choice-btn { background: ${v.bg}; border: 1px solid ${v.bdr}; border-radius: 4px; padding: 14px 18px; color: ${v.txt2}; font-family: 'Syne', sans-serif; font-size: 14px; font-weight: 600; cursor: pointer; text-align: left; transition: all .15s; display: flex; align-items: center; gap: 12px; }
    .choice-btn:hover:not(:disabled) { border-color: #4caf50; background: ${v.bg3}; color: ${v.txt}; }
    .choice-btn.selected { border-color: #4caf50; background: ${v.bg3}; }
    .choice-btn.correct { border-color: #4caf50; background: ${v.bg3}; color: #a5d6a7; }
    .choice-btn.wrong { border-color: #c62828; background: #1a0000; color: #ef9a9a; }
    .choice-btn.eliminated { opacity: .3; cursor: not-allowed; text-decoration: line-through; }
    .choice-btn:disabled { cursor: default; }
    .choice-letter { width: 24px; height: 24px; border: 1px solid currentColor; border-radius: 2px; display: flex; align-items: center; justify-content: center; font-family: 'Space Mono', monospace; font-size: 10px; font-weight: 700; flex-shrink: 0; }
    .tf-choices { display: flex; gap: 14px; }
    .tf-btn { flex: 1; background: ${v.bg}; border: 1px solid ${v.bdr}; border-radius: 4px; padding: 20px; color: ${v.txt2}; font-family: 'Syne', sans-serif; font-size: 17px; font-weight: 800; cursor: pointer; transition: all .15s; }
    .tf-btn:hover:not(:disabled) { border-color: #4caf50; background: ${v.bg3}; }
    .tf-btn.correct { border-color: #4caf50; background: ${v.bg3}; color: #a5d6a7; }
    .tf-btn.wrong { border-color: #c62828; background: #1a0000; color: #ef9a9a; }
    .tf-btn:disabled { cursor: default; }
    .fill-input-wrap { display: flex; gap: 10px; margin-top: 4px; }
    .fill-input { flex: 1; background: ${v.bg2}; border: 2px solid ${v.bdr}; border-radius: 4px; color: ${v.txt}; font-family: 'Space Mono', monospace; font-size: 15px; padding: 12px 16px; outline: none; transition: border-color .2s; }
    .fill-input:focus { border-color: #4caf50; }
    .fill-input.correct { border-color: #4caf50; }
    .fill-input.wrong { border-color: #c62828; }
    .feedback { margin-top: 16px; padding: 14px 18px; border-radius: 4px; font-family: 'Space Mono', monospace; font-size: 12px; line-height: 1.6; }
    .feedback.correct-fb { background: ${v.bg3}; border: 1px solid ${v.bdr2}; color: #a5d6a7; }
    .feedback.wrong-fb { background: #1a0000; border: 1px solid #b71c1c; color: #ef9a9a; }
    .hint-btn { background: transparent; border: 1px solid ${v.bdr2}; color: ${v.txt3}; padding: 6px 14px; border-radius: 3px; font-family: 'Space Mono', monospace; font-size: 11px; cursor: pointer; margin-top: 14px; transition: all .15s; }
    .hint-btn:hover { border-color: #4caf50; color: #4caf50; }
    .hint-btn:disabled { opacity: .3; cursor: not-allowed; }
    .hint-text { margin-top: 8px; font-family: 'Space Mono', monospace; font-size: 12px; color: #ff9800; background: #1a1000; border: 1px solid #ff9800; padding: 8px 14px; border-radius: 3px; }
    .diff-row { display: flex; gap: 8px; margin-top: 14px; align-items: center; flex-wrap: wrap; }
    .diff-label { font-family: 'Space Mono', monospace; font-size: 11px; color: ${v.txt3}; }
    .diff-btn { padding: 5px 12px; border-radius: 3px; font-family: 'Space Mono', monospace; font-size: 11px; cursor: pointer; border: 1px solid ${v.bdr}; background: transparent; color: ${v.dim}; }
    .diff-btn.sel.easy { background: #0d2b0d; border-color: #4caf50; color: #4caf50; }
    .diff-btn.sel.medium { background: #1a1000; border-color: #ff9800; color: #ff9800; }
    .diff-btn.sel.hard { background: #1a0000; border-color: #f44336; color: #f44336; }
    .quiz-action-row { display: flex; justify-content: space-between; align-items: center; margin-top: 16px; }
    .next-btn { background: transparent; border: 1px solid #4caf50; color: #4caf50; padding: 11px 28px; font-family: 'Syne', sans-serif; font-size: 14px; font-weight: 700; cursor: pointer; border-radius: 3px; transition: all .15s; }
    .next-btn:hover { background: #4caf50; color: #000; }

    /* ── FLASHCARD ── */
    .fc-scene { width: 100%; max-width: 600px; height: 300px; perspective: 1200px; cursor: pointer; margin: 0 auto 24px; display: block; }
    .fc-card { width: 100%; height: 100%; position: relative; transform-style: preserve-3d; transition: transform .55s cubic-bezier(.4,.2,.2,1); }
    .fc-card.flipped { transform: rotateY(180deg); }
    .fc-face { position: absolute; inset: 0; border-radius: 8px; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 36px; backface-visibility: hidden; -webkit-backface-visibility: hidden; text-align: center; }
    .fc-front { background: ${v.bg2}; border: 2px solid ${v.bdr}; }
    .fc-back { background: ${v.bg3}; border: 2px solid #4caf50; transform: rotateY(180deg); }
    .fc-face-label { font-family: 'Space Mono', monospace; font-size: 9px; color: ${v.txt3}; letter-spacing: 3px; text-transform: uppercase; margin-bottom: 16px; }
    .fc-back .fc-face-label { color: #66bb6a; }
    .fc-face-question { font-size: 18px; font-weight: 700; color: ${v.txt}; line-height: 1.5; }
    .fc-face-answer { font-size: 20px; font-weight: 800; color: #4caf50; line-height: 1.4; }
    .fc-face-hint { margin-top: 12px; font-family: 'Space Mono', monospace; font-size: 10px; color: ${v.txt3}; }
    .fc-dots { display: flex; gap: 5px; flex-wrap: wrap; justify-content: center; margin-bottom: 20px; }
    .fc-dot { width: 9px; height: 9px; border-radius: 50%; background: ${v.bg3}; border: 1px solid ${v.bdr}; transition: all .3s; }
    .fc-dot.known { background: #4caf50; border-color: #4caf50; }
    .fc-dot.cur { background: ${v.txt}; border-color: ${v.txt}; }

    /* ── STATS ROW ── */
    .stats-row { display: flex; gap: 12px; flex-wrap: wrap; }
    .stat-box { background: ${v.bg2}; border: 1px solid ${v.bdr}; border-radius: 4px; padding: 16px 24px; min-width: 80px; text-align: center; flex: 1; }
    .stat-num { font-size: 28px; font-weight: 800; font-family: 'Space Mono', monospace; color: #4caf50; }
    .stat-lbl { font-size: 10px; color: ${v.txt3}; font-family: 'Space Mono', monospace; letter-spacing: 1px; text-transform: uppercase; margin-top: 4px; }

    /* ── REVIEW ── */
    .review-item { background: ${v.bg2}; border-left: 3px solid ${v.bdr}; padding: 14px 18px; margin-bottom: 8px; border-radius: 0 4px 4px 0; }
    .review-item.correct { border-left-color: #4caf50; }
    .review-item.wrong { border-left-color: #c62828; }
    .review-q { font-size: 13px; font-weight: 700; margin-bottom: 5px; color: ${v.txt}; }
    .review-your { font-size: 11px; font-family: 'Space Mono', monospace; color: ${v.dim}; }
    .review-correct { font-size: 11px; font-family: 'Space Mono', monospace; color: #4caf50; margin-top: 3px; }

    /* ── SHARE BOX ── */
    .share-box { background: ${v.bg3}; border: 1px solid ${v.bdr2}; border-radius: 4px; padding: 16px; margin: 20px 0; }
    .share-url { font-family: 'Space Mono', monospace; font-size: 11px; color: #4caf50; word-break: break-all; margin: 8px 0 12px; line-height: 1.6; }
    .copy-btn { background: #4caf50; color: #000; border: none; padding: 7px 16px; border-radius: 3px; font-family: 'Space Mono', monospace; font-size: 11px; font-weight: 700; cursor: pointer; }
    .copy-btn:hover { background: #66bb6a; }

    /* ── MULTIPLAYER ── */
    .mp-room-code { font-family: 'Space Mono', monospace; font-size: 52px; font-weight: 700; color: #4caf50; letter-spacing: 10px; text-align: center; margin: 24px 0 8px; }
    .mp-status-text { font-family: 'Space Mono', monospace; font-size: 12px; color: ${v.txt3}; text-align: center; margin-bottom: 20px; }
    .mp-player-row { background: ${v.bg2}; border: 1px solid ${v.bdr}; border-radius: 4px; padding: 12px 16px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
    .mp-player-name { font-weight: 700; color: ${v.txt}; font-size: 14px; }
    .mp-player-score { font-family: 'Space Mono', monospace; font-size: 13px; color: #4caf50; font-weight: 700; }

    /* ── EDIT ── */
    .edit-q-card { background: ${v.bg2}; border: 1px solid ${v.bdr}; border-radius: 6px; padding: 18px; margin-bottom: 14px; }
    .edit-q-num { font-family: 'Space Mono', monospace; font-size: 10px; color: ${v.txt3}; letter-spacing: 2px; margin-bottom: 8px; text-transform: uppercase; }
    .edit-choice-row { display: flex; gap: 7px; align-items: center; margin-bottom: 6px; }
    .edit-choice-letter { width: 26px; height: 26px; border: 1px solid ${v.bdr}; border-radius: 2px; display: flex; align-items: center; justify-content: center; font-family: 'Space Mono', monospace; font-size: 10px; color: ${v.txt3}; flex-shrink: 0; }
    .edit-correct-btn { padding: 3px 9px; border-radius: 2px; font-size: 10px; font-family: 'Space Mono', monospace; cursor: pointer; border: 1px solid ${v.bdr}; background: transparent; color: ${v.dim}; flex-shrink: 0; }
    .edit-correct-btn.sel { background: ${v.bg3}; border-color: #4caf50; color: #4caf50; }

    /* ── LOADING ── */
    .loading-screen { text-align: center; padding: 80px 0; }
    .loading-title { font-size: 28px; font-weight: 800; color: #4caf50; animation: pulse 1.5s ease-in-out infinite; }
    .loading-bar-wrap { width: 280px; height: 3px; background: ${v.bg3}; margin: 28px auto 14px; border-radius: 2px; overflow: hidden; }
    .loading-bar { height: 100%; background: #4caf50; animation: bar-fill 3s ease-out forwards; border-radius: 2px; }
    .loading-hint { font-family: 'Space Mono', monospace; font-size: 11px; color: ${v.txt3}; letter-spacing: 2px; text-transform: uppercase; }

    /* ── STUDY ── */
    .study-card { background: ${v.bg2}; border: 1px solid ${v.bdr}; border-radius: 8px; padding: 24px; margin-bottom: 12px; display: flex; gap: 24px; }
    .study-q-side { flex: 1; }
    .study-divider { width: 2px; background: ${v.bdr}; flex-shrink: 0; border-radius: 2px; }
    .study-a-side { flex: 1; }
    .study-side-label { font-family: 'Space Mono', monospace; font-size: 10px; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 8px; }
    .study-q-side .study-side-label { color: ${v.txt3}; }
    .study-a-side .study-side-label { color: #4caf50; }
    .study-q-text { font-size: 16px; font-weight: 700; color: ${v.txt}; line-height: 1.4; }
    .study-a-text { font-size: 16px; font-weight: 700; color: #4caf50; line-height: 1.4; }
    .study-explanation { font-size: 12px; color: ${v.txt3}; font-family: 'Space Mono', monospace; margin-top: 6px; line-height: 1.6; }

    /* ── HOME ── */
    .home-hero { padding: 40px 0 32px; }
    .home-title { font-size: 48px; font-weight: 800; line-height: 1.05; margin-bottom: 12px; }
    .home-title .green { color: #4caf50; }
    .home-sub { color: ${v.dim}; font-size: 15px; margin-bottom: 32px; font-family: 'Space Mono', monospace; }
    .home-modes { display: flex; gap: 12px; margin-bottom: 32px; flex-wrap: wrap; }
    .mode-card { flex: 1; min-width: 160px; background: ${v.bg2}; border: 2px solid ${v.bdr}; border-radius: 8px; padding: 20px; cursor: pointer; transition: all .15s; text-align: center; }
    .mode-card:hover, .mode-card.active { border-color: #4caf50; background: ${v.bg3}; }
    .mode-card-icon { font-size: 28px; margin-bottom: 8px; font-family: 'Space Mono', monospace; color: #4caf50; font-weight: 700; }
    .mode-card-title { font-size: 15px; font-weight: 800; color: ${v.txt}; margin-bottom: 4px; }
    .mode-card-desc { font-size: 12px; color: ${v.dim}; font-family: 'Space Mono', monospace; }
    .drop-zone { border: 2px dashed ${v.bdr}; border-radius: 6px; padding: 48px 32px; text-align: center; cursor: pointer; transition: all .2s; background: ${v.bg2}; position: relative; }
    .drop-zone:hover, .drop-zone.drag-over { border-color: #4caf50; background: ${v.bg3}; }
    .drop-zone input[type="file"] { position: absolute; inset: 0; opacity: 0; cursor: pointer; width: 100%; height: 100%; }
    .drop-label { font-size: 16px; font-weight: 700; margin-bottom: 6px; color: ${v.txt}; }
    .drop-hint { font-size: 12px; color: ${v.txt3}; font-family: 'Space Mono', monospace; }
    .drop-file-name { margin-top: 10px; font-size: 12px; color: #66bb6a; font-family: 'Space Mono', monospace; background: ${v.bg3}; border: 1px solid ${v.bdr2}; padding: 5px 12px; border-radius: 2px; display: inline-block; }
    .input-row { display: flex; gap: 14px; margin-top: 20px; flex-wrap: wrap; align-items: flex-end; }
    .toggles-row { display: flex; gap: 20px; margin-top: 16px; flex-wrap: wrap; }
    .section-divider { border: none; border-top: 1px solid ${v.bdr}; margin: 28px 0; }
    .collapsible { border: 1px solid ${v.bdr}; border-radius: 6px; overflow: hidden; margin-top: 20px; }
    .collapsible-header { background: ${v.bg3}; padding: 12px 18px; font-weight: 700; font-size: 13px; color: #4caf50; cursor: pointer; display: flex; justify-content: space-between; align-items: center; }
    .collapsible-body { padding: 16px; background: ${v.bg2}; display: flex; flex-direction: column; gap: 10px; }
    .text-area { width: 100%; min-height: 160px; background: ${v.bg2}; border: 2px solid ${v.bdr}; border-radius: 4px; color: ${v.txt}; font-family: 'Space Mono', monospace; font-size: 13px; padding: 16px; resize: vertical; outline: none; line-height: 1.7; }
    .text-area:focus { border-color: #4caf50; }
    .text-area::placeholder { color: ${v.dim}; }
  `;
}
