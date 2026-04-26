import { useApp } from "../context/AppContext";
import { BackButton } from "../components/Layout";
import { LETTERS } from "../utils/constants";

export default function EditPage() {
  const ctx = useApp();
  const { questions, setQuestions, navigate, resetQuizState, quizStartTime } = ctx;

  const startQuiz = () => {
    resetQuizState();
    quizStartTime.current = Date.now();
    navigate("quiz");
  };

  return (
    <div className="page">
      <BackButton to="home" label="Back to Home" />
      <h2 className="page-heading">Review &amp; Edit Questions</h2>
      <p className="page-sub">// fix any AI mistakes before starting &mdash; click any field to edit</p>

      {questions.map((q, qi) => (
        <div key={qi} className="edit-q-card">
          <div className="edit-q-num">Question {qi + 1} &middot; {q.type.toUpperCase()}</div>
          <input className="field-input" style={{ marginBottom: 8 }} value={q.question}
            onChange={e => setQuestions(qs => qs.map((x, i) => i === qi ? { ...x, question: e.target.value } : x))} />
          {q.type === "mcq" && (
            <div>
              {(q.choices || []).map((c, ci) => (
                <div key={ci} className="edit-choice-row">
                  <div className="edit-choice-letter">{LETTERS[ci]}</div>
                  <input className="field-input" style={{ flex: 1, marginBottom: 0 }} value={c}
                    onChange={e => setQuestions(qs => qs.map((x, i) => i === qi ? { ...x, choices: x.choices.map((ch, j) => j === ci ? e.target.value : ch) } : x))} />
                  <button className={`edit-correct-btn ${q.answer === ci ? "sel" : ""}`}
                    onClick={() => setQuestions(qs => qs.map((x, i) => i === qi ? { ...x, answer: ci } : x))}>
                    {q.answer === ci ? "+ Correct" : "Set correct"}
                  </button>
                </div>
              ))}
            </div>
          )}
          {q.type === "tf" && (
            <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
              {["True", "False"].map(v => (
                <button key={v} className={`edit-correct-btn ${q.answer === v ? "sel" : ""}`}
                  onClick={() => setQuestions(qs => qs.map((x, i) => i === qi ? { ...x, answer: v } : x))}>
                  {v} {q.answer === v ? "+" : ""}
                </button>
              ))}
            </div>
          )}
          {q.type === "fill" && (
            <input className="field-input" value={q.answer} placeholder="Correct answer"
              style={{ marginTop: 6 }}
              onChange={e => setQuestions(qs => qs.map((x, i) => i === qi ? { ...x, answer: e.target.value } : x))} />
          )}
        </div>
      ))}

      <div style={{ display: "flex", gap: 12, marginTop: 24, flexWrap: "wrap" }}>
        <button className="btn-primary" onClick={startQuiz}>Start Quiz &rarr;</button>
        <button className="btn-secondary" onClick={() => navigate("home")}>&larr; Back</button>
      </div>
    </div>
  );
}
