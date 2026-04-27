import { useEffect } from "react";
import { useApp } from "../context/AppContext";
import { BackButton } from "../components/Layout";
import { LETTERS, TIMER_SEC } from "../utils/constants";
import { playSound } from "../utils/sounds";
import { groq, sbFetch } from "../utils/api";
import { saveLB, saveHistory } from "../utils/storage";
import { encodeQuiz } from "../utils/api";

export default function QuizPage() {
  const ctx = useApp();
  const {
    questions, setQuestions, current, setCurrent, answers, setAnswers,
    selected, setSelected, fillVal, setFillVal, revealed, setRevealed,
    hintUsed, setHintUsed, hintText, setHintText, eliminated, setEliminated,
    difficulty, setDifficulty, currentDiffLevel, setCurrentDiffLevel,
    adaptingQ, setAdaptingQ, adaptNotice, setAdaptNotice,
    streak, setStreak, bestStreak, setBestStreak,
    useTimer, useSounds, useStreak, autoDiff,
    timeLeft, setTimeLeft,
    timerRef,
    mpCode, myPlayerIdRef, mpPlayers, myMpName,
    playerName, tab, topicVal, urlVal, file,
    setShareUrl, setConfetti, setHistory, setLb,
    navigate, quizStartTime,
  } = ctx;

  // Timer
  useEffect(() => {
    if (!useTimer || revealed) { clearInterval(timerRef.current); return; }
    setTimeLeft(30);
    timerRef.current = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) {
          clearInterval(timerRef.current);
          const q = questions[current];
          if (q) {
            if (useSounds) playSound("wrong");
            setAnswers(prev => ({ ...prev, [current]: { userAnswer: null, correct: false } }));
            setRevealed(true); setStreak(0);
          }
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [current, useTimer, revealed]);

  const adaptDifficulty = async (newAnswers, afterIndex) => {
    if (!autoDiff) return;
    const answered = Object.keys(newAnswers).length;
    if (answered % 3 !== 0) return;
    const recent = Object.entries(newAnswers).sort((a, b) => Number(a[0]) - Number(b[0])).slice(-3).map(([, v]) => v.correct);
    const score = recent.filter(Boolean).length;
    const LEVELS = ["easy", "hard", "very_hard"];
    let newLevel = currentDiffLevel, direction = "";
    if (score === 3) { const i = LEVELS.indexOf(currentDiffLevel); newLevel = LEVELS[Math.min(i + 1, LEVELS.length - 1)]; direction = "harder"; }
    else if (score === 0) { const i = LEVELS.indexOf(currentDiffLevel); newLevel = LEVELS[Math.max(i - 1, 0)]; direction = "easier"; }
    else return;
    if (newLevel === currentDiffLevel) return;
    setCurrentDiffLevel(newLevel);
    setAdaptingQ(true);
    const disp = newLevel === "very_hard" ? "Very Difficult" : newLevel === "hard" ? "Hard" : "Easy";
    setAdaptNotice(`Adapting... generating ${disp} question`);
    try {
      const topic = questions.slice(0, 3).map(q => q.question).join("; ");
      const desc = newLevel === "easy" ? "Very simple, basic recall." : newLevel === "hard" ? "Challenging, requires analysis." : "Expert level, very tricky, subtle distinctions.";
      const raw = await groq([{ role: "user", content: `Topic: "${topic}"\nGenerate ONE ${disp} difficulty question.\n${desc}\nRespond ONLY with a single JSON object: {"type":"mcq","question":string,"choices":[4 strings],"answer":0-3,"explanation":string}` }]);
      let cleaned = raw.replace(/```json|```/g, "").trim();
      if (cleaned.startsWith("[")) cleaned = cleaned.slice(1, cleaned.lastIndexOf("]"));
      const newQ = JSON.parse(cleaned);
      if (!newQ.question) throw new Error("Invalid");
      setQuestions(prev => { const u = [...prev]; u.splice(afterIndex + 1, 0, { ...newQ, _adapted: true, _level: newLevel }); return u; });
      setAdaptNotice(`Going ${direction}! New ${disp} question added.`);
      setTimeout(() => setAdaptNotice(""), 3000);
    } catch { setAdaptNotice(""); }
    finally { setAdaptingQ(false); }
  };

  const submitAnswer = (force = null) => {
    if (revealed) return;
    const q = questions[current];
    let ua = force !== null ? force : (q.type === "fill" ? fillVal.trim() : selected);
    if (ua === null || ua === "") return;
    clearInterval(timerRef.current);
    let correct = false;
    if (q.type === "mcq") correct = ua === q.answer;
    else if (q.type === "tf") correct = ua === q.answer;
    else correct = String(ua).toLowerCase() === String(q.answer).toLowerCase();
    if (useSounds) playSound(correct ? "correct" : "wrong");
    const ns = correct ? streak + 1 : 0;
    setStreak(ns); setBestStreak(b => Math.max(b, ns));
    const newAnswers = { ...answers, [current]: { userAnswer: ua, correct } };
    setAnswers(newAnswers);
    setRevealed(true);
    if (mpCode && myPlayerIdRef.current) {
      const newScore = Object.values(newAnswers).filter(a => a.correct).length;
      sbFetch(`/room_players?id=eq.${myPlayerIdRef.current}`, "PATCH", { score: newScore, current_q: current + 1, updated_at: new Date().toISOString() }).catch(() => {});
    }
    adaptDifficulty(newAnswers, current);
  };

  const nextQuestion = () => {
    if (current + 1 >= questions.length) {
      finishQuiz();
    } else {
      setCurrent(c => c + 1);
      setSelected(null); setFillVal(""); setRevealed(false);
      setHintUsed(false); setHintText(""); setEliminated([]);
    }
  };

  const finishQuiz = () => {
    const correct = Object.values(answers).filter(a => a.correct).length;
    const pct = Math.round((correct / questions.length) * 100);
    const elapsed = Math.round((Date.now() - quizStartTime.current) / 1000);
    if (pct === 100) { setConfetti(true); setTimeout(() => setConfetti(false), 5000); }
    if (playerName) { saveLB({ name: playerName, pct, correct, total: questions.length, time: elapsed, date: new Date().toLocaleDateString() }); setLb(prev => [...prev]); }
    saveHistory({ id: Date.now(), date: new Date().toLocaleString(), pct, correct, total: questions.length, questions, title: tab === "topic" ? topicVal : tab === "url" ? urlVal : file?.name || "Quiz" });
    setHistory(loadHistory_());
    const encoded = encodeQuiz(questions);
    if (encoded) setShareUrl(`${window.location.origin}${window.location.pathname}?q=${encoded}`);
    navigate("results");
  };

  function loadHistory_() { try { return JSON.parse(localStorage.getItem("qs_history") || "[]"); } catch { return []; } }

  const useHint = () => {
    if (hintUsed || revealed) return;
    const q = questions[current];
    if (q.type === "mcq") {
      const wrong = q.choices.map((_, i) => i).filter(i => i !== q.answer && !eliminated.includes(i));
      setEliminated(wrong.sort(() => Math.random() - .5).slice(0, 2));
      setHintText("2 wrong answers removed!");
    } else if (q.type === "fill") {
      const ans = String(q.answer);
      setHintText(`First letter: "${ans[0].toUpperCase()}" (${ans.length} letters)`);
    } else {
      setHintText("No hint for True/False.");
    }
    setHintUsed(true);
  };

  const q = questions[current] || {};
  const timerPct = (ctx.timeLeft / TIMER_SEC) * 100;
  const timerColor = ctx.timeLeft > 15 ? "#4caf50" : ctx.timeLeft > 7 ? "#ff9800" : "#f44336";
  const correctCount = Object.values(answers).filter(a => a.correct).length;

  return (
    <div className="page">
      {/* Header row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontFamily: "'Space Mono',monospace", fontSize: 11, color: "var(--txt3,#2e7d32)", letterSpacing: 2, textTransform: "uppercase" }}>Question</div>
          <div style={{ fontFamily: "'Space Mono',monospace", fontSize: 28, fontWeight: 800, color: "#4caf50" }}>
            {String(current + 1).padStart(2, "0")} / {String(questions.length).padStart(2, "0")}
          </div>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          {useStreak && streak >= 2 && <div className="badge">{streak}x streak</div>}
          {mpCode && mpPlayers.map(p => (
            <div key={p.name} className="badge" style={{ color: p.name === myMpName ? "#4caf50" : "#81c784" }}>
              {p.name.substring(0, 8)} {p.score || 0}
            </div>
          ))}
          <div style={{ textAlign: "right" }}>
            <div style={{ fontFamily: "'Space Mono',monospace", fontSize: 11, color: "var(--txt3,#2e7d32)", letterSpacing: 2, textTransform: "uppercase" }}>Score</div>
            <div style={{ fontFamily: "'Space Mono',monospace", fontSize: 28, fontWeight: 800 }}>{correctCount}</div>
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="quiz-progress-bar">
        <div className="quiz-progress-fill" style={{ width: `${(current / questions.length) * 100}%` }} />
      </div>

      {/* Timer bar */}
      {useTimer && (
        <div className="timer-bar-wrap">
          <div className="timer-bar" style={{ width: `${timerPct}%`, background: timerColor }} />
        </div>
      )}

      {/* Auto-diff notice */}
      {adaptNotice && (
        <div className="alert-info" style={{ marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}>
          {adaptingQ && <span>...</span>} {adaptNotice}
        </div>
      )}
      {autoDiff && !adaptNotice && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <span style={{ fontFamily: "'Space Mono',monospace", fontSize: 10, letterSpacing: 2, color: "#2e7d32" }}>DIFFICULTY</span>
          <span style={{
            padding: "2px 10px", borderRadius: 3, fontSize: 11, fontFamily: "'Space Mono',monospace", fontWeight: 700,
            background: currentDiffLevel === "easy" ? "#0d2b0d" : currentDiffLevel === "very_hard" ? "#2d0000" : "#1a0000",
            color: currentDiffLevel === "easy" ? "#4caf50" : currentDiffLevel === "very_hard" ? "#ff1744" : "#f44336",
            border: `1px solid ${currentDiffLevel === "easy" ? "#4caf50" : currentDiffLevel === "very_hard" ? "#ff1744" : "#f44336"}`
          }}>
            {currentDiffLevel === "easy" ? "EASY" : currentDiffLevel === "hard" ? "HARD" : "VERY DIFFICULT"}
          </span>
          {q._adapted && <span style={{ fontFamily: "'Space Mono',monospace", fontSize: 10, color: "#555" }}>* ADAPTED</span>}
        </div>
      )}

      {/* Question card */}
      <div className="card">
        <div className="q-type-label">
          {q.type === "mcq" ? "* Multiple Choice" : q.type === "tf" ? "* True / False" : "* Fill in the Blank"}
          {useTimer && <span style={{ float: "right", fontFamily: "'Space Mono',monospace", color: timerColor }}>{ctx.timeLeft}s</span>}
        </div>
        <div className="question-text">{q.question}</div>

        {q.type === "mcq" && (
          <div className="choices">
            {(q.choices || []).map((c, i) => {
              let cls = "choice-btn";
              if (eliminated.includes(i)) cls += " eliminated";
              else if (revealed) { if (i === q.answer) cls += " correct"; else if (i === selected && selected !== q.answer) cls += " wrong"; }
              else if (selected === i) cls += " selected";
              return (
                <button key={i} className={cls} disabled={revealed || eliminated.includes(i)} onClick={() => setSelected(i)}>
                  <span className="choice-letter">{LETTERS[i]}</span>{c}
                </button>
              );
            })}
          </div>
        )}

        {q.type === "tf" && (
          <div className="tf-choices" style={{ marginTop: 22 }}>
            {["True", "False"].map(v => {
              let cls = "tf-btn";
              if (revealed) { if (v === q.answer) cls += " correct"; else if (v === selected && selected !== q.answer) cls += " wrong"; }
              else if (v === selected) cls += " selected";
              return (
                <button key={v} className={cls} disabled={revealed} onClick={() => { if (!revealed) { setSelected(v); submitAnswer(v); } }}>
                  {v}
                </button>
              );
            })}
          </div>
        )}

        {q.type === "fill" && (
          <div className="fill-input-wrap" style={{ marginTop: 22 }}>
            <input className={`fill-input${revealed ? (answers[current]?.correct ? " correct" : " wrong") : ""}`}
              placeholder="Type your answer..." value={fillVal}
              onChange={e => setFillVal(e.target.value)}
              onKeyDown={e => e.key === "Enter" && submitAnswer()} disabled={revealed} />
            {!revealed && <button className="btn-primary" onClick={() => submitAnswer()}>Submit</button>}
          </div>
        )}

        {!revealed && (
          <div>
            <button className="hint-btn" onClick={useHint} disabled={hintUsed}>
              {hintUsed ? "Hint used" : "Use Hint"}
            </button>
            {hintText && <div className="hint-text">! {hintText}</div>}
          </div>
        )}

        {revealed && (
          <>
            <div className={`feedback ${answers[current]?.correct ? "correct-fb" : "wrong-fb"}`}>
              {answers[current]?.correct ? "+ Correct! " : `- Wrong. Answer: ${q.type === "mcq" ? q.choices?.[q.answer] : q.answer}. `}
              {q.explanation}
            </div>
            <div className="diff-row">
              <span className="diff-label">Rate difficulty:</span>
              {["easy", "medium", "hard"].map(d => (
                <button key={d} className={`diff-btn ${difficulty[current] === d ? "sel " + d : ""}`}
                  onClick={() => setDifficulty(prev => ({ ...prev, [current]: d }))}>
                  {d === "easy" ? "Easy" : d === "medium" ? "Medium" : "Hard"}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="quiz-action-row">
        <button className="btn-secondary" onClick={() => navigate("home")} style={{ fontSize: 12, padding: "8px 16px" }}>
          ← Quit
        </button>
        <div>
          {!revealed && q.type === "mcq" && (
            <button className="next-btn" onClick={() => submitAnswer()} disabled={selected === null}>Check →</button>
          )}
          {revealed && (
            <button className="next-btn" onClick={nextQuestion}>
              {current + 1 >= questions.length ? "See Results →" : "Next →"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
