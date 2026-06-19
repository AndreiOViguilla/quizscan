import { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import { BackButton } from "../components/Layout";
import { getLeaderboard } from "../utils/db";

export default function LeaderboardPage() {
  const { user } = useAuth();
  const [global, setGlobal] = useState([]);
  const [local, setLocal] = useState([]);
  const [tab, setTab] = useState("global");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getLeaderboard().then(data => { setGlobal(data); setLoading(false); });
    try {
      const lb = JSON.parse(localStorage.getItem("qs_lb") || "[]");
      setLocal(lb.sort((a, b) => b.score - a.score));
    } catch {}
  }, []);

  const medals = ["🥇", "🥈", "🥉"];

  return (
    <div className="page" style={{ maxWidth: 680, paddingTop: 72 }}>
      <BackButton />
      <div className="page-heading">Leaderboard</div>
      <div className="page-sub">Top players globally and on this device</div>

      <div className="tabs" style={{ marginBottom: 20 }}>
        <button className={`tab-btn ${tab === "global" ? "active" : ""}`} onClick={() => setTab("global")}>Global</button>
        <button className={`tab-btn ${tab === "local" ? "active" : ""}`} onClick={() => setTab("local")}>This Device</button>
      </div>

      {tab === "global" && (
        <>
          {!user && (
            <div className="alert-info" style={{ marginBottom: 16 }}>
              Sign in to appear on the global leaderboard
            </div>
          )}
          {loading ? (
            <div style={{ opacity: 0.4, textAlign: "center", padding: 60 }}>Loading...</div>
          ) : global.length === 0 ? (
            <div className="card" style={{ opacity: 0.5, fontSize: 13, textAlign: "center" }}>
              No scores yet — complete a quiz to be the first!
            </div>
          ) : (
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              {global.map((entry, i) => (
                <div key={entry.uid} style={{
                  display: "flex", alignItems: "center", gap: 14,
                  padding: "14px 20px",
                  borderBottom: i < global.length - 1 ? "1px solid var(--bdr)" : "none",
                  background: user && entry.uid === user.uid ? "var(--bg3)" : "transparent"
                }}>
                  <div style={{ width: 28, fontWeight: 700, fontSize: 14, textAlign: "center" }}>
                    {i < 3 ? medals[i] : `#${i + 1}`}
                  </div>
                  {entry.avatar ? (
                    <img src={entry.avatar} alt="" style={{ width: 32, height: 32, borderRadius: "50%", objectFit: "cover" }} />
                  ) : (
                    <div style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--bdr)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700 }}>
                      {entry.name[0].toUpperCase()}
                    </div>
                  )}
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>
                      {entry.name} {user && entry.uid === user.uid && <span style={{ fontSize: 11, opacity: 0.5 }}>(you)</span>}
                    </div>
                    <div style={{ fontSize: 11, opacity: 0.5 }}>{entry.plays} plays · last: {entry.lastTopic}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontWeight: 700, fontSize: 16 }}>{entry.score}</div>
                    <div style={{ fontSize: 11, opacity: 0.4 }}>
                      {entry.totalQuestions > 0 ? `${Math.round((entry.totalCorrect / entry.totalQuestions) * 100)}% avg` : ""}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === "local" && (
        <>
          {local.length === 0 ? (
            <div className="card" style={{ opacity: 0.5, fontSize: 13, textAlign: "center" }}>
              No scores yet. Complete a quiz with your name to appear here.
            </div>
          ) : (
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              {local.map((entry, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "center", gap: 14,
                  padding: "14px 20px",
                  borderBottom: i < local.length - 1 ? "1px solid var(--bdr)" : "none"
                }}>
                  <div style={{ width: 28, fontWeight: 700, fontSize: 14, textAlign: "center" }}>
                    {i < 3 ? medals[i] : `#${i + 1}`}
                  </div>
                  <div style={{ flex: 1, fontWeight: 600 }}>{entry.name}</div>
                  <div style={{ fontWeight: 700, fontSize: 16 }}>{entry.score}</div>
                </div>
              ))}
            </div>
          )}
          <button className="btn-danger" style={{ marginTop: 16 }}
            onClick={() => { localStorage.removeItem("qs_lb"); setLocal([]); }}>
            Clear Local Scores
          </button>
        </>
      )}
    </div>
  );
}
