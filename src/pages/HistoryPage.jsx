import { useApp } from "../context/AppContext";
import { BackButton } from "../components/Layout";
import { clearHistory, loadHistory } from "../utils/storage";

export default function HistoryPage() {
  const { history, setHistory, navigate, setQuestions, resetQuizState, quizStartTime } = useApp();

  const replay = (entry) => {
    setQuestions(entry.questions);
    resetQuizState();
    quizStartTime.current = Date.now();
    navigate("edit");
  };

  return (
    <div className="page">
      <BackButton to="home" />
      <h2 className="page-heading">Quiz History</h2>
      <p className="page-sub">// your last 20 quizzes · click Replay to retake any</p>
      {history.length === 0 ? (
        <div className="table-empty">No history yet. Complete a quiz to see it here!</div>
      ) : (
        <table className="data-table">
          <thead>
            <tr><th>Title</th><th>Score</th><th>Date</th><th></th></tr>
          </thead>
          <tbody>
            {history.map((e, i) => (
              <tr key={i}>
                <td style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.title}</td>
                <td style={{ fontFamily: "'Space Mono',monospace", fontWeight: 700, color: "#4caf50" }}>{e.pct}% ({e.correct}/{e.total})</td>
                <td style={{ opacity: .6, fontSize: 12, fontFamily: "'Space Mono',monospace" }}>{e.date}</td>
                <td>
                  <button className="btn-secondary" style={{ padding: "5px 12px", fontSize: 12 }} onClick={() => replay(e)}>
                    Replay
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div style={{ marginTop: 20 }}>
        <button className="btn-danger" onClick={() => { clearHistory(); setHistory([]); }}>Clear History</button>
      </div>
    </div>
  );
}
