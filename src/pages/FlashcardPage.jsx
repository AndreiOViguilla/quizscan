import { useApp } from "../context/AppContext";
import { BackButton } from "../components/Layout";
import { playSound } from "../utils/sounds";

export default function FlashcardPage() {
  const ctx = useApp();
  const { questions, setQuestions, current, setCurrent, flipped, setFlipped, fcKnown, setFcKnown, useSounds, navigate } = ctx;
  const fc = questions[current] || {};
  const isDone = current >= questions.length;
  const getAns = q => q.type === "mcq" ? (q.choices?.[q.answer] || "") : String(q.answer || "");

  return (
    <div className="page">
      <BackButton to="home" />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div style={{ fontFamily: "'Space Mono',monospace", fontSize: 12, color: "#2e7d32", letterSpacing: 2 }}>
          CARD {Math.min(current + 1, questions.length)} / {questions.length}
        </div>
        <div className="badge">+ {fcKnown.size} known</div>
      </div>
      <div className="fc-dots">
        {questions.map((_, i) => <div key={i} className={`fc-dot ${fcKnown.has(i) ? "known" : ""} ${i === current && !isDone ? "cur" : ""}`} />)}
      </div>
      {isDone ? (
        <div style={{ textAlign: "center", padding: "60px 0" }}>
          <h2 className="page-heading" style={{ color: "#4caf50", fontSize: 36, marginBottom: 8 }}>
            {fcKnown.size === questions.length ? "Perfect!" : `${fcKnown.size} / ${questions.length} Known`}
          </h2>
          <p className="page-sub">// deck complete</p>
          <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
            <button className="btn-primary" onClick={() => { setCurrent(0); setFlipped(false); setFcKnown(new Set()); }}>Restart</button>
            {fcKnown.size < questions.length && (
              <button className="btn-secondary" onClick={() => { setQuestions(questions.filter((_, i) => !fcKnown.has(i))); setCurrent(0); setFlipped(false); setFcKnown(new Set()); }}>
                Study Missed ({questions.length - fcKnown.size})
              </button>
            )}
            <button className="btn-secondary" onClick={() => navigate("home")}>New Deck</button>
          </div>
        </div>
      ) : (
        <>
          <div className="fc-scene" onClick={() => { if (useSounds) playSound("flip"); setFlipped(f => !f); }}>
            <div className={`fc-card ${flipped ? "flipped" : ""}`}>
              <div className="fc-face fc-front">
                <div className="fc-face-label">Question</div>
                <div className="fc-face-question">{fc.question}</div>
                <div className="fc-face-hint">tap to reveal answer</div>
              </div>
              <div className="fc-face fc-back">
                <div className="fc-face-label">Answer</div>
                <div className="fc-face-answer">{getAns(fc)}</div>
                <div className="fc-face-hint">tap to flip back</div>
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 14, justifyContent: "center" }}>
            <button className="btn-secondary" style={{ flex: 1, maxWidth: 200 }}
              onClick={() => { setCurrent(c => c + 1); setFlipped(false); }}>
              x Still Learning
            </button>
            <button className="btn-primary" style={{ flex: 1, maxWidth: 200 }}
              onClick={() => { setFcKnown(p => new Set([...p, current])); setCurrent(c => c + 1); setFlipped(false); }}>
              + Got It
            </button>
          </div>
        </>
      )}
    </div>
  );
}
