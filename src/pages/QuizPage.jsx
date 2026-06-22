import { useEffect, useRef, useState } from "react";
import { useApp } from "../context/AppContext";
import { useSettings } from "../context/SettingsContext";
import { useQuiz } from "../context/QuizContext";
import { useMultiplayer } from "../context/MultiplayerContext";
import { BackButton } from "../components/Layout";
import { LETTERS, TIMER_SEC } from "../utils/constants";
import { playSound } from "../utils/sounds";
import { groq, updateMpScore, setRoomCurrentQ, FirebaseListener } from "../utils/api";
import { saveLB, saveHistory, loadHistory } from "../utils/storage";
import { encodeQuiz } from "../utils/api";

export default function QuizPage() {
  const { navigate, setConfetti, setHistory, setLb, showToast } = useApp();
  const { useTimer, useSounds, useStreak, autoDiff, playerName, tab, topicVal, urlVal, file, gameMode } = useSettings();
  const {
    questions, setQuestions, current, setCurrent, answers, setAnswers,
    selected, setSelected, fillVal, setFillVal, revealed, setRevealed,
    hintUsed, setHintUsed, hintText, setHintText, eliminated, setEliminated,
    difficulty, setDifficulty, currentDiffLevel, setCurrentDiffLevel,
    adaptingQ, setAdaptingQ, adaptNotice, setAdaptNotice,
    streak, setStreak, bestStreak, setBestStreak,
    timeLeft, setTimeLeft,
    timerRef, quizStartTime,
    flagged, setFlagged,
    lives, setLives,
  } = useQuiz();
  const { mpCode, myPlayerIdRef, mpPlayers, myMpName, mpSyncMode, mpMode } = useMultiplayer();

  const [tabSwitches, setTabSwitches] = useState(0);
  const [showTabWarning, setShowTabWarning] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [dfSlots, setDfSlots] = useState([null, null]);
  const [orderSlots, setOrderSlots] = useState([null, null, null]);
  const [syncCurrentQ, setSyncCurrentQ] = useState(null);

  // Speedrun: track elapsed seconds
  useEffect(() => {
    if (gameMode !== "speedrun") return;
    const id = setInterval(() => {
      if (quizStartTime.current) setElapsed(Math.round((Date.now() - quizStartTime.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [gameMode, quizStartTime]);

  // Host-advances sync: guests listen to room's currentQ
  useEffect(() => {
    if (!mpCode || mpSyncMode !== "host" || mpMode === "host") return;
    const listener = new FirebaseListener(`/rooms/${mpCode}`, (room) => {
      if (!room) return;
      const q = room.currentQ;
      if (typeof q === "number") setSyncCurrentQ(q);
    });
    listener.connect();
    return () => listener.disconnect();
  }, [mpCode, mpSyncMode, mpMode]);

  // Navigate / finish when syncCurrentQ changes
  useEffect(() => {
    if (syncCurrentQ === null || mpMode === "host" || mpSyncMode !== "host") return;
    if (syncCurrentQ >= questions.length) { finishQuiz(); return; }
    if (syncCurrentQ !== current) navigateToQuestion(syncCurrentQ);
  }, [syncCurrentQ]);

  // Tab-switch detection
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        clearInterval(timerRef.current);
        setTabSwitches(n => n + 1);
      } else {
        setShowTabWarning(true);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const resumeQuiz = () => {
    setShowTabWarning(false);
    if (!useTimer || revealed || gameMode === "speedrun") return;
    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) {
          clearInterval(timerRef.current);
          const q = questions[current];
          if (q) {
            if (useSounds) playSound("wrong");
            setAnswers(prev => ({ ...prev, [current]: { userAnswer: null, correct: false, revealed: true } }));
            setRevealed(true); setStreak(0);
          }
          return 0;
        }
        return t - 1;
      });
    }, 1000);
  };

  const qStartRef = useRef(Date.now());
  useEffect(() => { qStartRef.current = Date.now(); }, [current]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e) => {
      const isScreenshot =
        e.key === "PrintScreen" ||
        (e.shiftKey && e.metaKey && ["3", "4", "5"].includes(e.key)) ||
        (e.shiftKey && e.key === "S" && (e.metaKey || e.ctrlKey));
      if (isScreenshot) {
        e.preventDefault();
        const page = document.querySelector(".quiz-page");
        if (page) { page.style.filter = "blur(12px)"; setTimeout(() => { page.style.filter = ""; }, 2000); }
        showToast("Screenshot detected — quiz content is protected.", "error");
        return;
      }
      if (["INPUT", "TEXTAREA"].includes(e.target.tagName)) return;
      const q = questions[current];
      if (!q) return;
      if (!revealed) {
        if (q.type === "mcq") {
          const idx = { "1": 0, "2": 1, "3": 2, "4": 3 }[e.key];
          if (idx !== undefined && idx < (q.choices?.length || 0) && !eliminated.includes(idx)) {
            e.preventDefault(); setSelected(idx);
          }
          if ((e.key === "Enter" || e.key === " ") && selected !== null) {
            e.preventDefault(); submitAnswer();
          }
        } else if (q.type === "tf") {
          if (e.key.toLowerCase() === "t") { e.preventDefault(); submitAnswer("True"); }
          if (e.key.toLowerCase() === "f") { e.preventDefault(); submitAnswer("False"); }
        }
      } else {
        if (e.key === "Enter" || e.key === "ArrowRight") { e.preventDefault(); nextQuestion(); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [questions, current, revealed, selected, eliminated, answers]);

  // Per-question timer (disabled in speedrun)
  useEffect(() => {
    if (!useTimer || revealed || gameMode === "speedrun") { clearInterval(timerRef.current); return; }
    setTimeLeft(30);
    // Always clear the previous interval before starting a new one to prevent leaks
    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) {
          clearInterval(timerRef.current);
          const q = questions[current];
          if (q) {
            if (useSounds) playSound("wrong");
            setAnswers(prev => ({ ...prev, [current]: { userAnswer: null, correct: false, revealed: true } }));
            setRevealed(true); setStreak(0);
          }
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [current, useTimer, revealed, gameMode]);

  const retryMpScore = async (code, name, score, q) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try { await updateMpScore(code, name, score, q); return; } catch {
        if (attempt === 2) showToast("Score sync failed — check connection", "error");
        else await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
      }
    }
  };

  const navigateToQuestion = (i) => {
    const prev = answers[i];
    const q = questions[i];
    setCurrent(i);
    if (prev !== undefined) {
      setSelected(prev.userAnswer);
      setFillVal(typeof prev.userAnswer === "string" ? prev.userAnswer : "");
      setRevealed(prev.revealed ?? true);
      if (q?.type === "double_fill" && typeof prev.userAnswer === "string") {
        const parts = prev.userAnswer.split(" / ");
        setDfSlots(parts.length === 2 ? parts : [null, null]);
      } else {
        setDfSlots([null, null]);
      }
      if (q?.type === "ordering") {
        setOrderSlots(Array(q.items?.length || 3).fill(null));
      } else {
        setOrderSlots([null, null, null]);
      }
    } else {
      setSelected(null); setFillVal(""); setRevealed(false); setDfSlots([null, null]);
      if (q?.type === "ordering") {
        setOrderSlots(Array(q.items?.length || 3).fill(null));
      } else {
        setOrderSlots([null, null, null]);
      }
    }
    setHintUsed(false); setHintText(""); setEliminated([]);
  };

  const skipQuestion = () => {
    setFlagged(prev => { const s = new Set(prev); s.add(current); return s; });
    for (let i = current + 1; i < questions.length; i++) {
      if (answers[i] === undefined) { navigateToQuestion(i); return; }
    }
    for (let i = 0; i < current; i++) {
      if (answers[i] === undefined) { navigateToQuestion(i); return; }
    }
  };

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

  const fillMatches = (userInput, correctAnswer) => {
    const ua = userInput.toLowerCase().trim();
    const ca = correctAnswer.toLowerCase().replace(/…$/, "").trim();
    if (ua === ca) return true;
    // For short answers (≤4 words) require near-exact match
    const caWords = ca.split(/\s+/);
    if (caWords.length <= 4) return ua === ca || ca.includes(ua) && ua.length >= ca.length * 0.8;
    // For longer answers, check that the user typed most of the key words
    const SKIP = new Set(["the","a","an","is","are","was","were","of","in","on","at","by","for","with","and","but","or","to","it","its","this","that","from","into","as","had","has","been","their","which","also"]);
    const keys = caWords.filter(w => w.length > 2 && !SKIP.has(w));
    if (!keys.length) return ua.includes(ca.substring(0, 15));
    const matched = keys.filter(w => ua.includes(w));
    return matched.length / keys.length >= 0.6;
  };

  const submitAnswer = (force = null) => {
    if (revealed) return;
    const q = questions[current];
    let ua, correct;
    if (q.type === "double_fill") {
      if (dfSlots.includes(null)) return;
      ua = dfSlots.join(" / ");
      correct = dfSlots.every((s, i) => s?.toLowerCase() === (q.answers?.[i] || "").toLowerCase());
    } else if (q.type === "ordering") {
      if (orderSlots.includes(null)) return;
      ua = orderSlots.join(" ||| ");
      correct = orderSlots.every((s, i) => s === (q.answers?.[i] || ""));
    } else if (q.type === "error_id") {
      ua = force !== null ? force : selected;
      if (ua === null) return;
      correct = ua === q.answer;
    } else {
      ua = force !== null ? force : (q.type === "fill" ? fillVal.trim() : selected);
      if (ua === null || ua === "") return;
      if (q.type === "mcq") correct = ua === q.answer;
      else if (q.type === "tf") correct = ua.toLowerCase() === String(q.answer).toLowerCase();
      else correct = fillMatches(ua, String(q.answer));
    }
    if (useSounds) playSound(correct ? "correct" : "wrong");
    const ns = correct ? streak + 1 : 0;
    setStreak(ns); setBestStreak(b => Math.max(b, ns));
    const timeTaken = Math.max(1, Math.round((Date.now() - qStartRef.current) / 1000));
    const newAnswers = { ...answers, [current]: { userAnswer: ua, correct, timeTaken, revealed: true } };
    setAnswers(newAnswers);
    setRevealed(true);
    if (gameMode === "survival" && !correct) {
      if (lives <= 1) {
        setLives(0);
        setGameOver(true);
      } else {
        setLives(l => l - 1);
      }
    }
    if (mpCode && myMpName) {
      const newScore = Object.values(newAnswers).filter(a => a.correct).length;
      retryMpScore(mpCode, myMpName, newScore, current + 1);
    }
    adaptDifficulty(newAnswers, current);
  };

  const nextQuestion = () => {
    if (current + 1 >= questions.length) {
      const firstUnanswered = questions.findIndex((_, i) => answers[i] === undefined);
      if (firstUnanswered !== -1) navigateToQuestion(firstUnanswered);
      else finishQuiz();
    } else {
      navigateToQuestion(current + 1);
    }
  };

  const finishQuiz = () => {
    const correct = Object.values(answers).filter(a => a.correct).length;
    const pct = Math.round((correct / questions.length) * 100);
    const totalElapsed = Math.round((Date.now() - quizStartTime.current) / 1000);
    if (pct === 100) { setConfetti(true); setTimeout(() => setConfetti(false), 5000); }
    if (playerName) { saveLB({ name: playerName, pct, correct, total: questions.length, time: totalElapsed, date: new Date().toLocaleDateString() }); setLb(prev => [...prev]); }
    saveHistory({ id: Date.now(), date: new Date().toLocaleString(), pct, correct, total: questions.length, questions, title: tab === "topic" ? topicVal : tab === "url" ? urlVal : file?.name || "Quiz" });
    setHistory(loadHistory());
    const encoded = encodeQuiz(questions);
    if (encoded) { /* shareUrl set via QuizContext */ }
    navigate("results");
  };

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
    } else if (q.type === "ordering") {
      setHintText(`First sentence starts with: "${(q.answers?.[0] || "").slice(0, 30)}..."`);
    } else if (q.type === "error_id") {
      setHintText(`The incorrect word is ${q.spans?.[q.answer]?.length} letters long.`);
    } else {
      setHintText("No hint for True/False.");
    }
    setHintUsed(true);
  };

  const toggleFlag = () => {
    setFlagged(prev => {
      const s = new Set(prev);
      if (s.has(current)) s.delete(current); else s.add(current);
      return s;
    });
  };

  const q = questions[current] || {};
  const timerPct = (timeLeft / TIMER_SEC) * 100;
  const timerColor = timeLeft > 15 ? "rgba(255,255,255,0.7)" : timeLeft > 7 ? "#f59e0b" : "#ef4444";
  const correctCount = Object.values(answers).filter(a => a.correct).length;
  const isFlagged = flagged?.has(current);

  const unansweredCount = questions.filter((_, i) => answers[i] === undefined).length;
  const nextLabel = current + 1 >= questions.length
    ? (unansweredCount > 0 ? `${unansweredCount} left →` : "See Results →")
    : "Next →";

  const elapsedFmt = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;

  const isHostSync = mpCode && mpSyncMode === "host" && mpMode === "host";
  const isGuestSync = mpCode && mpSyncMode === "host" && mpMode !== "host";
  const answeredCount = mpPlayers.filter(p => (p.current_q || 0) > current).length;

  const handleHostNext = () => {
    const nextQ = current + 1;
    if (nextQ >= questions.length) {
      setRoomCurrentQ(mpCode, questions.length).catch(() => {});
      finishQuiz();
    } else {
      setRoomCurrentQ(mpCode, nextQ).catch(() => {});
      navigateToQuestion(nextQ);
    }
  };

  return (
    <div className="page quiz-page" onContextMenu={e => e.preventDefault()}>

      {gameOver && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 3000, padding: 24 }}>
          <div style={{ background: "var(--bg2)", border: "2px solid #ef4444", borderRadius: 16, padding: "32px 28px", maxWidth: 340, width: "100%", textAlign: "center" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>💀</div>
            <div style={{ fontWeight: 700, fontSize: 20, marginBottom: 8, color: "#ef4444" }}>Game Over</div>
            <div style={{ fontSize: 13, opacity: 0.6, marginBottom: 24 }}>
              You ran out of lives!<br />Score: {correctCount} / {questions.length}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn-secondary" style={{ flex: 1 }} onClick={() => { setGameOver(false); finishQuiz(); }}>See Results</button>
              <button className="btn-primary" style={{ flex: 1 }} onClick={() => navigate("home")}>Quit</button>
            </div>
          </div>
        </div>
      )}

      {showTabWarning && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.78)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 3000, padding: 24 }}>
          <div style={{ background: "var(--bg2)", border: "2px solid #f59e0b", borderRadius: 16, padding: "32px 28px", maxWidth: 340, width: "100%", textAlign: "center" }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>⚠</div>
            <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 8, color: "#f59e0b" }}>Tab Switch Detected</div>
            <div style={{ fontSize: 13, opacity: 0.65, marginBottom: 6 }}>You left the quiz tab. The timer was paused.</div>
            <div style={{ fontSize: 12, opacity: 0.4, marginBottom: 24 }}>
              {tabSwitches} switch{tabSwitches !== 1 ? "es" : ""} this session
            </div>
            <button className="btn-primary" style={{ width: "100%", padding: 12 }} onClick={resumeQuiz}>Resume Quiz</button>
          </div>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontSize: 11, opacity: 0.5 }}>Question</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>
            {String(current + 1).padStart(2, "0")} / {String(questions.length).padStart(2, "0")}
          </div>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          {gameMode === "survival" && (
            <div style={{ display: "flex", gap: 2, alignItems: "center" }}>
              {[...Array(3)].map((_, i) => (
                <span key={i} style={{ fontSize: 17, lineHeight: 1, opacity: i < lives ? 1 : 0.15 }}>♥</span>
              ))}
            </div>
          )}
          {gameMode === "speedrun" && (
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--txt2)" }}>
              {elapsedFmt}
            </span>
          )}
          {useStreak && streak >= 2 && <div className="badge">{streak}x streak</div>}
          {tabSwitches > 0 && <div className="badge" style={{ color: "#f59e0b", borderColor: "#f59e0b" }}>⚠ {tabSwitches} switch{tabSwitches !== 1 ? "es" : ""}</div>}
          {mpCode && mpPlayers.filter(p => p?.name).map(p => (
            <div key={p.name} className="badge" style={{ opacity: p.name === myMpName ? 1 : 0.6 }}>
              {p.name.substring(0, 8)} {p.score || 0}
            </div>
          ))}
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 11, opacity: 0.5, letterSpacing: 1, textTransform: "uppercase" }}>Score</div>
            <div style={{ fontSize: 24, fontWeight: 700 }}>{correctCount}</div>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 16, alignItems: "center" }}>
        {questions.map((_, i) => {
          const ans = answers[i];
          const isCur = i === current;
          const isFlg = flagged?.has(i);
          let bg = "transparent";
          let borderColor = "var(--bdr)";
          if (isCur) { bg = "var(--txt)"; borderColor = "var(--txt)"; }
          else if (ans?.correct) { bg = "var(--bdr2)"; borderColor = "var(--bdr2)"; }
          else if (ans && !ans.correct) { bg = "#ef444450"; borderColor = "#ef4444"; }
          else if (isFlg) { borderColor = "#f59e0b"; }
          return (
            <div
              key={i}
              onClick={() => !isHostSync && !isGuestSync && navigateToQuestion(i)}
              title={`Q${i + 1}${isFlg ? " (flagged)" : ""}`}
              style={{ width: 8, height: 8, borderRadius: "50%", background: bg, border: `2px solid ${borderColor}`, cursor: (isHostSync || isGuestSync) ? "default" : "pointer", transition: "all .15s", flexShrink: 0 }}
            />
          );
        })}
      </div>

      {useTimer && gameMode !== "speedrun" && (
        <div className="timer-bar-wrap">
          <div className="timer-bar" style={{ width: `${timerPct}%`, background: timerColor }} />
        </div>
      )}

      {adaptNotice && (
        <div className="alert-info" style={{ marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}>
          {adaptingQ && <span>...</span>} {adaptNotice}
        </div>
      )}
      {autoDiff && !adaptNotice && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <span style={{ fontSize: 10, letterSpacing: 1, opacity: 0.5, textTransform: "uppercase" }}>Difficulty</span>
          <span style={{ padding: "2px 10px", borderRadius: 4, fontSize: 11, fontWeight: 600, background: "transparent", color: currentDiffLevel === "easy" ? "inherit" : currentDiffLevel === "very_hard" ? "#ef4444" : "#f59e0b", border: `1px solid ${currentDiffLevel === "easy" ? "var(--bdr,#3e3e3e)" : currentDiffLevel === "very_hard" ? "#ef4444" : "#f59e0b"}` }}>
            {currentDiffLevel === "easy" ? "EASY" : currentDiffLevel === "hard" ? "HARD" : "VERY DIFFICULT"}
          </span>
          {q._adapted && <span style={{ fontSize: 10, opacity: 0.4 }}>adapted</span>}
        </div>
      )}

      <div className="card">
        <div className="q-type-label" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>{q.type === "mcq" ? "* Multiple Choice" : q.type === "tf" ? "* True / False" : q.type === "double_fill" ? "* Double Blank" : q.type === "ordering" ? "* Ordering" : q.type === "error_id" ? "* Error Identification" : "* Fill in the Blank"}</span>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {useTimer && gameMode !== "speedrun" && (
              <span style={{ color: timerColor, fontWeight: 600 }}>{timeLeft}s</span>
            )}
            <button
              onClick={toggleFlag}
              style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11, padding: "2px 4px", fontFamily: "inherit", fontWeight: 600, color: isFlagged ? "#f59e0b" : "var(--dim)", opacity: isFlagged ? 1 : 0.7, transition: "all .15s", letterSpacing: 0.3 }}>
              ⚑ {isFlagged ? "Flagged" : "Flag"}
            </button>
          </div>
        </div>

        <div className="question-text">
          {q.type === "double_fill"
            ? q.question.split("___").map((part, i, arr) => (
                <span key={i}>
                  {part}
                  {i < arr.length - 1 && (
                    <button
                      className={`df-slot${dfSlots[i] ? " filled" : ""}${revealed ? (dfSlots[i]?.toLowerCase() === (q.answers?.[i] || "").toLowerCase() ? " correct" : " wrong") : ""}`}
                      onClick={() => {
                        if (revealed || !dfSlots[i]) return;
                        const next = [...dfSlots]; next[i] = null; setDfSlots(next);
                      }}
                    >
                      {dfSlots[i] || "___"}
                    </button>
                  )}
                </span>
              ))
            : q.type === "error_id"
            ? (() => {
                const sentence = q.question;
                const spans = q.spans || [];
                const parts = [];
                let cursor = 0;
                const positions = spans
                  .map(sp => ({ sp, idx: sentence.toLowerCase().indexOf(sp.toLowerCase()) }))
                  .filter(p => p.idx !== -1)
                  .sort((a, b) => a.idx - b.idx);
                for (const { sp, idx } of positions) {
                  if (idx > cursor) parts.push(<span key={cursor}>{sentence.slice(cursor, idx)}</span>);
                  const spanIdx = spans.indexOf(sp);
                  let cls = "error-span";
                  if (revealed) cls += spanIdx === q.answer ? " wrong-span" : " correct-span";
                  else if (selected === spanIdx) cls += " selected-span";
                  parts.push(
                    <button key={idx} className={cls} onClick={() => { if (!revealed) setSelected(spanIdx); }}>
                      {sentence.slice(idx, idx + sp.length)}
                    </button>
                  );
                  cursor = idx + sp.length;
                }
                if (cursor < sentence.length) parts.push(<span key={cursor}>{sentence.slice(cursor)}</span>);
                return (
                  <div>
                    <div style={{ fontSize: 12, color: "var(--dim)", marginBottom: 10 }}>Click the word that has been changed to its opposite:</div>
                    <div className="error-sentence">{parts}</div>
                  </div>
                );
              })()
            : q.question}
        </div>

        {q.type === "double_fill" && !revealed && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 18 }}>
            {(q.choices || []).map((c, i) => {
              const placed = dfSlots.includes(c);
              return (
                <button key={i} className={`df-word-btn${placed ? " used" : ""}`}
                  disabled={placed}
                  onClick={() => {
                    if (placed) return;
                    const emptyIdx = dfSlots.indexOf(null);
                    if (emptyIdx !== -1) { const next = [...dfSlots]; next[emptyIdx] = c; setDfSlots(next); }
                  }}>
                  {c}
                </button>
              );
            })}
          </div>
        )}

        {q.type === "ordering" && (
          <div style={{ marginTop: 16 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
              {(q.answers || []).map((_, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "var(--dim)", width: 20, flexShrink: 0 }}>{i + 1}.</span>
                  <button
                    className={`order-slot${orderSlots[i] ? " filled" : ""}${revealed ? (orderSlots[i] === q.answers?.[i] ? " correct" : " wrong") : ""}`}
                    onClick={() => { if (revealed || !orderSlots[i]) return; const ns = [...orderSlots]; ns[i] = null; setOrderSlots(ns); }}
                  >
                    {orderSlots[i] || <span style={{ opacity: 0.35 }}>Click a sentence below</span>}
                  </button>
                </div>
              ))}
            </div>
            {!revealed && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {(q.items || []).map((item, i) => {
                  const placed = orderSlots.includes(item);
                  return (
                    <button key={i} className={`order-item-btn${placed ? " used" : ""}`} disabled={placed}
                      onClick={() => { if (placed) return; const emptyIdx = orderSlots.indexOf(null); if (emptyIdx !== -1) { const ns = [...orderSlots]; ns[emptyIdx] = item; setOrderSlots(ns); } }}>
                      {item}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

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
              {answers[current]?.correct ? "+ Correct! " : `- Wrong. Answer: ${q.type === "mcq" ? q.choices?.[q.answer] : q.type === "double_fill" ? (q.answers || []).join(" / ") : q.type === "ordering" ? "Order: " + (q.answers || []).map((s, i) => `${i + 1}. ${s.slice(0, 40)}...`).join(" → ") : q.type === "error_id" ? `"${q.spans?.[q.answer]}" was the changed word` : q.answer}. `}
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
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {!revealed && !isGuestSync && (
            <button className="btn-secondary" onClick={skipQuestion} style={{ fontSize: 12, padding: "8px 16px" }}>
              Skip
            </button>
          )}
          {!revealed && q.type === "mcq" && (
            <button className="next-btn" onClick={() => submitAnswer()} disabled={selected === null}>Check →</button>
          )}
          {!revealed && q.type === "double_fill" && (
            <button className="next-btn" onClick={() => submitAnswer()} disabled={dfSlots.includes(null)}>Check →</button>
          )}
          {!revealed && q.type === "ordering" && (
            <button className="next-btn" onClick={() => submitAnswer()} disabled={orderSlots.includes(null)}>Check →</button>
          )}
          {!revealed && q.type === "error_id" && (
            <button className="next-btn" onClick={() => submitAnswer()} disabled={selected === null}>Check →</button>
          )}
          {revealed && isGuestSync && (
            <div style={{ fontSize: 12, opacity: 0.45, padding: "8px 12px", fontStyle: "italic" }}>
              Waiting for host...
            </div>
          )}
          {revealed && !isGuestSync && (
            <button className="next-btn" onClick={isHostSync ? handleHostNext : nextQuestion}>
              {isHostSync
                ? (current + 1 >= questions.length
                  ? `See Results (${answeredCount}/${mpPlayers.length}) →`
                  : `Next (${answeredCount}/${mpPlayers.length}) →`)
                : nextLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
