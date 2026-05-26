import { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import { useApp } from "../context/AppContext";
import { BackButton } from "../components/Layout";
import { getDailyChallenge, getDailyScores, submitDailyScore } from "../utils/db";
import { groq, parseQuestions } from "../utils/api";

const DAILY_TOPIC_SEED = () => {
  const topics = ["World History", "Science", "Geography", "Literature", "Technology", "Mathematics", "Art", "Sports", "Music", "Film"];
  const day = Math.floor(Date.now() / 86400000);
  return topics[day % topics.length];
};

export default function DailyPage() {
  const { user } = useAuth();
  const ctx = useApp();
  const [challenge, setChallenge] = useState(null);
  const [scores, setScores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [alreadyPlayed, setAlreadyPlayed] = useState(false);

  const today = new Date().toISOString().split("T")[0];
  const topic = DAILY_TOPIC_SEED();

  useEffect(() => {
    loadDaily();
  }, []);

  const loadDaily = async () => {
    setLoading(true);
    const [c, s] = await Promise.all([getDailyChallenge(), getDailyScores()]);
    setChallenge(c);
    setScores(s);
    if (user && s.find(x => x.uid === user.uid)) setAlreadyPlayed(true);
    setLoading(false);
  };

  const startChallenge = () => {
    if (!challenge?.questions) return;
    ctx.setQuestions(challenge.questions);
    ctx.resetQuizState();
    ctx.quizStartTime.current = Date.now();
    ctx.navigate("quiz");
  };

  return (
    <div className="page" style={{ maxWidth: 680, paddingTop: 72 }}>
      <BackButton />
      <div className="page-heading">Daily Challenge</div>
      <div className="page-sub">One quiz per day — same questions for everyone. {today}</div>

      {loading ? (
        <div style={{ opacity: 0.4, textAlign: "center", padding: 60 }}>Loading...</div>
      ) : (
        <>
          <div className="card" style={{ textAlign: "center", marginBottom: 20 }}>
            <div style={{ fontSize: 11, opacity: 0.5, letterSpacing: 1, textTransform: "uppercase", marginBottom: 8 }}>Today's Topic</div>
            <div style={{ fontSize: 28, fontWeight: 700, marginBottom: 16 }}>{challenge?.topic || topic}</div>
            {alreadyPlayed ? (
              <div className="alert-info">You've already completed today's challenge!</div>
            ) : challenge ? (
              <button className="btn-primary" style={{ padding: "12px 32px", fontSize: 15 }} onClick={startChallenge}>
                Start Challenge ({challenge.questions?.length} questions)
              </button>
            ) : (
              <button className="btn-primary" style={{ padding: "12px 32px", fontSize: 15 }}
                onClick={async () => {
                  setGenerating(true);
                  try {
                    const raw = await groq([{ role: "user", content: `Generate exactly 10 quiz questions about: ${topic}\nMixed types (mcq, tf, fill). Medium difficulty.\nReturn ONLY a JSON array: [{"type":"mcq","question":"...","choices":["A","B","C","D"],"answer":0,"explanation":"..."}]` }]);
                    const qs = parseQuestions(raw);
                    const { setDailyChallenge } = await import("../utils/db");
                    await setDailyChallenge(qs, topic);
                    setChallenge({ questions: qs, topic });
                  } catch (e) { alert("Failed: " + e.message); }
                  setGenerating(false);
                }} disabled={generating}>
                {generating ? "Generating..." : "Generate Today's Challenge"}
              </button>
            )}
          </div>

          {/* Leaderboard */}
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12 }}>Today's Scores</div>
          {scores.length === 0 ? (
            <div className="card" style={{ opacity: 0.5, fontSize: 13, textAlign: "center" }}>
              No scores yet — be the first to complete today's challenge!
            </div>
          ) : (
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              {scores.slice(0, 20).map((s, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "12px 20px", borderBottom: i < scores.length - 1 ? "1px solid var(--bdr)" : "none",
                  background: user && s.uid === user.uid ? "var(--bg3)" : "transparent"
                }}>
                  <div style={{ width: 24, fontWeight: 700, fontSize: 13, opacity: 0.5 }}>#{i + 1}</div>
                  <div style={{ flex: 1, fontWeight: 600, fontSize: 14 }}>{s.name}</div>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{s.score}/{s.total}</div>
                  <div style={{ fontSize: 11, opacity: 0.4 }}>{Math.round((s.score / s.total) * 100)}%</div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
