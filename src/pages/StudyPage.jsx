import { useApp } from "../context/AppContext";
import { BackButton } from "../components/Layout";

export default function StudyPage() {
  const { questions, navigate, resetQuizState, quizStartTime, setMode } = useApp();
  return (
    <div className="page">
      <BackButton to="home" />
      <h2 className="page-heading">Study Mode</h2>
      <p className="page-sub">// {questions.length} cards — question & answer side by side</p>
      <div style={{ marginBottom: 20 }}>
        <button className="btn-secondary" onClick={() => { setMode("quiz"); resetQuizState(); quizStartTime.current = Date.now(); navigate("edit"); }}>
          Take Quiz Instead →
        </button>
      </div>
      {questions.map((q, i) => (
        <div key={i} className="study-card">
          <div className="study-q-side">
            <div className="study-side-label">Q{i + 1}</div>
            <div className="study-q-text">{q.question}</div>
          </div>
          <div className="study-divider" />
          <div className="study-a-side">
            <div className="study-side-label">Answer</div>
            <div className="study-a-text">{q.type === "mcq" ? (q.choices?.[q.answer] || "") : String(q.answer || "")}</div>
            {q.explanation && <div className="study-explanation">{q.explanation}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}
