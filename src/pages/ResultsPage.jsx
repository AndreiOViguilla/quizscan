import { useState } from "react";
import { useApp } from "../context/AppContext";
import { BackButton } from "../components/Layout";

export default function ResultsPage() {
  const ctx = useApp();
  const { questions, answers, difficulty, bestStreak, useStreak, shareUrl, navigate, resetQuizState, quizStartTime, setAnswers, setStreak, setBestStreak, setRevealed, setSelected, setFillVal, setCurrent, setHintUsed, setHintText, setEliminated, setDifficulty, mode, setMode } = ctx;
  const [copied, setCopied] = useState(false);

  const correctCount = Object.values(answers).filter(a => a.correct).length;
  const wrongCount = questions.length - correctCount;
  const pct = questions.length ? Math.round((correctCount / questions.length) * 100) : 0;
  const circ = 2 * Math.PI * 68;
  const dash = (pct / 100) * circ;
  const diffCounts = { easy: 0, medium: 0, hard: 0 };
  Object.values(difficulty).forEach(d => { if (d) diffCounts[d]++; });

  const retryAll = () => {
    resetQuizState();
    quizStartTime.current = Date.now();
    navigate("quiz");
  };

  const retryWrong = () => {
    const wrongQs = questions.filter((_, i) => !answers[i]?.correct);
    if (!wrongQs.length) return;
    ctx.setQuestions(wrongQs);
    resetQuizState();
    quizStartTime.current = Date.now();
    navigate("quiz");
  };

  const exportPDF = () => {
    const rows = questions.map((q, i) => {
      const a = answers[i];
      const dc = q.type === "mcq" ? q.choices?.[q.answer] : q.answer;
      const ua = q.type === "mcq" && a ? q.choices?.[a.userAnswer] : (a?.userAnswer ?? "—");
      const diff = difficulty[i] || "";
      return `<tr style="background:${i % 2 === 0 ? "#f9f9f9" : "#fff"}">
        <td style="padding:8px;border:1px solid #ddd">${i + 1}</td>
        <td style="padding:8px;border:1px solid #ddd">${q.question}</td>
        <td style="padding:8px;border:1px solid #ddd;color:${a?.correct ? "#2e7d32" : "#c62828"}">${ua}</td>
        <td style="padding:8px;border:1px solid #ddd;color:#2e7d32">${dc}</td>
        <td style="padding:8px;border:1px solid #ddd;text-align:center">${a?.correct ? "+" : "x"}</td>
        <td style="padding:8px;border:1px solid #ddd;font-size:11px;color:#666">${diff}</td>
      </tr>`;
    }).join("");
    const html = `<html><head><title>QuizScan Results</title></head><body style="font-family:sans-serif;padding:40px;max-width:860px;margin:0 auto">
      <h1 style="color:#2e7d32">QuizScan Results</h1><p>${new Date().toLocaleDateString()}</p>
      <div style="display:flex;gap:32px;margin:20px 0">
        <div style="text-align:center"><div style="font-size:48px;font-weight:800;color:#4caf50">${pct}%</div><div style="color:#666;font-size:12px">SCORE</div></div>
        <div style="text-align:center"><div style="font-size:48px;font-weight:800;color:#4caf50">${correctCount}/${questions.length}</div><div style="color:#666;font-size:12px">CORRECT</div></div>
      </div>
      <table style="width:100%;border-collapse:collapse">
        <thead><tr style="background:#2e7d32;color:#fff">
          <th style="padding:10px;text-align:left">#</th><th style="padding:10px;text-align:left">Question</th>
          <th style="padding:10px;text-align:left">Your Answer</th><th style="padding:10px;text-align:left">Correct</th>
          <th style="padding:10px">Result</th><th style="padding:10px">Difficulty</th>
        </tr></thead><tbody>${rows}</tbody>
      </table></body></html>`;
    const w = window.open("", "_blank"); w.document.write(html); w.document.close(); w.print();
  };

  return (
    <div className="page">
      <BackButton to="home" label="New Quiz" />

      <div style={{ textAlign: "center", marginBottom: 32 }}>
        <div className="score-ring">
          <svg width="150" height="150" viewBox="0 0 150 150">
            <circle cx="75" cy="75" r="68" fill="none" stroke="#0d2b0d" strokeWidth="7" />
            <circle cx="75" cy="75" r="68" fill="none" stroke="#4caf50" strokeWidth="7"
              strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" />
          </svg>
          <div className="score-ring-center">
            <div className="score-pct">{pct}%</div>
            <div className="score-sub">SCORE</div>
          </div>
        </div>
        <h2 className="page-heading">
          {pct === 100 ? "Perfect!" : pct >= 80 ? "Excellent!" : pct >= 60 ? "Good job!" : pct >= 40 ? "Keep going!" : "Keep studying!"}
        </h2>
        <p className="page-sub">// quiz complete &middot; {questions.length} questions</p>
      </div>

      <div className="stats-row" style={{ marginBottom: 24 }}>
        <div className="stat-box"><div className="stat-num" style={{ color: "#4caf50" }}>{correctCount}</div><div className="stat-lbl">Correct</div></div>
        <div className="stat-box"><div className="stat-num" style={{ color: "#c62828" }}>{wrongCount}</div><div className="stat-lbl">Wrong</div></div>
        <div className="stat-box"><div className="stat-num">{questions.length}</div><div className="stat-lbl">Total</div></div>
        {useStreak && <div className="stat-box"><div className="stat-num" style={{ color: "#ff9800" }}>{bestStreak}</div><div className="stat-lbl">Best Streak</div></div>}
      </div>

      {(diffCounts.easy || diffCounts.medium || diffCounts.hard) > 0 && (
        <div style={{ display: "flex", gap: 10, marginBottom: 24, flexWrap: "wrap" }}>
          {diffCounts.easy > 0 && <span style={{ padding: "5px 14px", borderRadius: 20, background: "#0d2b0d", color: "#4caf50", border: "1px solid #4caf50", fontSize: 12, fontFamily: "'Space Mono',monospace" }}>Easy: {diffCounts.easy}</span>}
          {diffCounts.medium > 0 && <span style={{ padding: "5px 14px", borderRadius: 20, background: "#1a1000", color: "#ff9800", border: "1px solid #ff9800", fontSize: 12, fontFamily: "'Space Mono',monospace" }}>Medium: {diffCounts.medium}</span>}
          {diffCounts.hard > 0 && <span style={{ padding: "5px 14px", borderRadius: 20, background: "#1a0000", color: "#f44336", border: "1px solid #f44336", fontSize: 12, fontFamily: "'Space Mono',monospace" }}>Hard: {diffCounts.hard}</span>}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 32 }}>
        <button className="btn-primary" onClick={retryAll}>Retry All</button>
        {wrongCount > 0 && <button className="btn-primary" style={{ background: "#ff9800" }} onClick={retryWrong}>Retry Wrong ({wrongCount})</button>}
        <button className="btn-secondary" onClick={() => { setMode("flashcard"); navigate("flashcard"); }}>Flashcards</button>
        <button className="btn-secondary" onClick={() => { setMode("study"); navigate("study"); }}>Study</button>
        <button className="btn-secondary" onClick={exportPDF}>Export PDF</button>
      </div>

      {shareUrl && (
        <div className="share-box">
          <label className="field-label">Share this quiz</label>
          <div className="share-url">{shareUrl.substring(0, 80)}{shareUrl.length > 80 ? "..." : ""}</div>
          <button className="copy-btn" onClick={() => { navigator.clipboard.writeText(shareUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); }}>
            {copied ? "+ Copied!" : "Copy Link"}
          </button>
        </div>
      )}

      <div className="review-list" style={{ marginTop: 24 }}>
        <h3 className="page-heading" style={{ fontSize: 16, marginBottom: 14 }}>Review Answers</h3>
        {questions.map((q, i) => {
          const a = answers[i];
          const dc = q.type === "mcq" ? q.choices?.[q.answer] : q.answer;
          const ua = q.type === "mcq" && a ? q.choices?.[a.userAnswer] : (a?.userAnswer ?? "—");
          const diff = difficulty[i];
          return (
            <div key={i} className={`review-item ${a?.correct ? "correct" : "wrong"}`}>
              <div className="review-q">{i + 1}. {q.question} {diff && <span style={{ fontSize: 10, opacity: .6 }}>[{diff}]</span>}</div>
              <div className="review-your">Your answer: {ua}</div>
              {!a?.correct && <div className="review-correct">+ Correct: {dc}</div>}
              {q.explanation && <div className="review-your" style={{ marginTop: 3, opacity: .7 }}>{q.explanation}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
