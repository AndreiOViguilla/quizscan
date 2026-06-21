import { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import { useApp } from "../context/AppContext";
import { BackButton } from "../components/Layout";
import { getUserProfile, getUserSharedQuizzes, getUserAchievements, ACHIEVEMENTS, deleteSharedQuiz } from "../utils/db";
import { loadHistory } from "../utils/storage";

export default function ProfilePage() {
  const { user } = useAuth();
  const { dark } = useApp();
  const [profile, setProfile] = useState(null);
  const [quizzes, setQuizzes] = useState([]);
  const [achievements, setAchievements] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    Promise.all([
      getUserProfile(user.uid),
      getUserSharedQuizzes(user.uid),
      getUserAchievements(user.uid),
    ]).then(([p, q, a]) => {
      setProfile(p); setQuizzes(q); setAchievements(a);
      setLoading(false);
    });
  }, [user]);

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this quiz?")) return;
    await deleteSharedQuiz(id);
    setQuizzes(q => q.filter(x => x.id !== id));
  };

  if (!user) return (
    <div className="page" style={{ paddingTop: 72, textAlign: "center" }}>
      <BackButton />
      <div style={{ opacity: 0.5, marginTop: 60 }}>Sign in to view your profile</div>
    </div>
  );

  const avgScore = profile?.totalQuestions > 0
    ? Math.round((profile.totalCorrect / profile.totalQuestions) * 100)
    : null;

  return (
    <div className="page" style={{ maxWidth: 680, paddingTop: 72 }}>
      <BackButton />

      <div className="card" style={{ display: "flex", gap: 20, alignItems: "center", marginBottom: 20 }}>
        {user.photoURL ? (
          <img src={user.photoURL} alt="" style={{ width: 64, height: 64, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
        ) : (
          <div style={{ width: 64, height: 64, borderRadius: "50%", background: "var(--bg3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, fontWeight: 700, flexShrink: 0 }}>
            {(user.displayName || user.email || "?")[0].toUpperCase()}
          </div>
        )}
        <div>
          <div style={{ fontWeight: 700, fontSize: 20 }}>{user.displayName || user.email?.split("@")[0]}</div>
          <div style={{ fontSize: 12, opacity: 0.5, marginTop: 2 }}>{user.email}</div>
          {user.metadata?.lastSignInTime && (
            <div style={{ fontSize: 11, opacity: 0.35, marginTop: 4 }}>
              Last login: {new Date(user.metadata.lastSignInTime).toLocaleString()}
            </div>
          )}
        </div>
      </div>

      <div className="stats-row" style={{ marginBottom: 20 }}>
        <div className="stat-box">
          <div className="stat-num">{profile?.plays || 0}</div>
          <div className="stat-lbl">Quizzes Played</div>
        </div>
        <div className="stat-box">
          <div className="stat-num">{avgScore !== null ? `${avgScore}%` : "--"}</div>
          <div className="stat-lbl">Avg Score</div>
        </div>
        <div className="stat-box">
          <div className="stat-num">{quizzes.length}</div>
          <div className="stat-lbl">Quizzes Shared</div>
        </div>
        <div className="stat-box">
          <div className="stat-num">{profile?.score || 0}</div>
          <div className="stat-lbl">Total Points</div>
        </div>
      </div>

      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12 }}>Achievements</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 24 }}>
        {ACHIEVEMENTS.map(a => {
          const unlocked = achievements.includes(a.id);
          return (
            <div key={a.id} title={a.desc} style={{
              padding: "8px 14px", borderRadius: 10,
              border: `1px solid ${unlocked ? "var(--bdr2)" : "var(--bdr)"}`,
              background: unlocked ? "var(--bg3)" : "transparent",
              opacity: unlocked ? 1 : 0.35,
              display: "flex", alignItems: "center", gap: 6, cursor: "default"
            }}>
              <span style={{ fontSize: 14 }}>{a.icon}</span>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600 }}>{a.label}</div>
                <div style={{ fontSize: 10, opacity: 0.5 }}>{a.desc}</div>
              </div>
            </div>
          );
        })}
      </div>

      {(() => {
        const hData = loadHistory();
        const today = new Date();
        const CELLS = 16 * 7;
        const dayCounts = {};
        hData.forEach(h => {
          const d = new Date(h.id);
          const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
          dayCounts[key] = (dayCounts[key] || 0) + 1;
        });
        const cells = [];
        for (let i = CELLS - 1; i >= 0; i--) {
          const d = new Date(today);
          d.setDate(today.getDate() - i);
          const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
          cells.push({ d, count: dayCounts[key] || 0 });
        }
        const totalActive = cells.filter(c => c.count > 0).length;
        const colors = dark
          ? ["#2a2a2a", "#1a3d28", "#236b3b", "#2d9450", "#39bd66"]
          : ["#ebedf0", "#9be9a8", "#40c463", "#30a14e", "#216e39"];
        return (
          <div style={{ marginBottom: 28 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>Activity Calendar</div>
              <div style={{ fontSize: 11, opacity: 0.4 }}>{totalActive} active days</div>
            </div>
            <div style={{ overflowX: "auto" }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(16, 14px)", gridTemplateRows: "repeat(7, 14px)", gap: 3, width: "fit-content" }}>
                {cells.map((cell, i) => (
                  <div
                    key={i}
                    title={`${cell.d.toDateString()}: ${cell.count} quiz${cell.count !== 1 ? "zes" : ""}`}
                    style={{
                      width: 14, height: 14, borderRadius: 3,
                      background: colors[Math.min(cell.count, 4)],
                      cursor: "default",
                    }}
                  />
                ))}
              </div>
            </div>
            <div style={{ fontSize: 11, opacity: 0.35, marginTop: 8 }}>Last 16 weeks · oldest left, newest right</div>
          </div>
        );
      })()}

      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12 }}>Your Shared Quizzes</div>
      {loading ? (
        <div style={{ opacity: 0.4, fontSize: 13 }}>Loading...</div>
      ) : quizzes.length === 0 ? (
        <div className="card" style={{ opacity: 0.5, fontSize: 13, textAlign: "center" }}>
          No shared quizzes yet — generate a quiz and share it publicly!
        </div>
      ) : quizzes.map(q => (
        <div key={q.id} className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{q.topic}</div>
            <div style={{ fontSize: 11, opacity: 0.5, marginTop: 2 }}>
              {q.count} questions · {q.plays || 0} plays · {q.likes || 0} likes
            </div>
          </div>
          <button className="btn-danger" onClick={() => handleDelete(q.id)}>Delete</button>
        </div>
      ))}
    </div>
  );
}
