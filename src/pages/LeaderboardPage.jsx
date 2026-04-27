import { useApp } from "../context/AppContext";
import { BackButton } from "../components/Layout";
import { clearLB } from "../utils/storage";

export default function LeaderboardPage() {
  const { lb, setLb } = useApp();
  return (
    <div className="page">
      <BackButton to="home" />
      <h2 className="page-heading">Leaderboard</h2>
      <p className="page-sub">// top scores on this device · enter your name on home screen to appear here</p>
      {lb.length === 0 ? (
        <div className="table-empty">No scores yet. Complete a quiz with your name to appear here!</div>
      ) : (
        <table className="data-table">
          <thead>
            <tr><th>#</th><th>Name</th><th>Score</th><th>Result</th><th>Date</th></tr>
          </thead>
          <tbody>
            {lb.map((e, i) => (
              <tr key={i}>
                <td style={{ fontFamily: "'Space Mono',monospace", fontWeight: 700, color: "#4caf50" }}>
                  {i === 0 ? "#1" : i === 1 ? "#2" : i === 2 ? "#3" : i + 1}
                </td>
                <td style={{ fontWeight: 600 }}>{e.name}</td>
                <td style={{ fontFamily: "'Space Mono',monospace", fontWeight: 700, color: "#4caf50" }}>{e.pct}%</td>
                <td style={{ fontFamily: "'Space Mono',monospace", fontSize: 12 }}>{e.correct}/{e.total}</td>
                <td style={{ opacity: .6, fontSize: 12 }}>{e.date}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div style={{ marginTop: 20 }}>
        <button className="btn-danger" onClick={() => { clearLB(); setLb([]); }}>Clear Scores</button>
      </div>
    </div>
  );
}
