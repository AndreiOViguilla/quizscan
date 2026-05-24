import { useState, useEffect } from "react";
import { useApp } from "../context/AppContext";
import { BackButton } from "../components/Layout";

const FB_URL = "https://quizscan-94acb-default-rtdb.asia-southeast1.firebasedatabase.app";

async function fbGet(path) {
  const res = await fetch(`${FB_URL}${path}.json`);
  if (!res.ok) return null;
  return res.json();
}

async function fbPush(path, data) {
  const res = await fetch(`${FB_URL}${path}.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return res.json();
}

async function fbUpdate(path, data) {
  await fetch(`${FB_URL}${path}.json`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export async function shareQuizPublicly(questions, topic, authorName) {
  const data = {
    topic: topic || "Untitled Quiz",
    author: authorName || "Anonymous",
    questions,
    count: questions.length,
    createdAt: Date.now(),
    likes: 0,
    plays: 0,
  };
  return fbPush("/shared_quizzes", data);
}

export default function FindPage() {
  const ctx = useApp();
  const [quizzes, setQuizzes] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  useEffect(() => {
    loadQuizzes();
  }, []);

  const loadQuizzes = async () => {
    setLoading(true);
    try {
      const data = await fbGet("/shared_quizzes");
      if (data) {
        const arr = Object.entries(data).map(([id, q]) => ({ id, ...q }))
          .sort((a, b) => b.createdAt - a.createdAt);
        setQuizzes(arr);
      } else {
        setQuizzes([]);
      }
    } catch {}
    setLoading(false);
  };

  const filtered = quizzes.filter(q =>
    !search || q.topic?.toLowerCase().includes(search.toLowerCase()) ||
    q.author?.toLowerCase().includes(search.toLowerCase())
  );

  const useQuiz = async (quiz) => {
    ctx.setQuestions(quiz.questions);
    ctx.resetQuizState();
    ctx.quizStartTime.current = Date.now();
    // Increment play count
    await fbUpdate(`/shared_quizzes/${quiz.id}`, { plays: (quiz.plays || 0) + 1 });
    ctx.navigate("edit");
  };

  const likeQuiz = async (quiz, e) => {
    e.stopPropagation();
    await fbUpdate(`/shared_quizzes/${quiz.id}`, { likes: (quiz.likes || 0) + 1 });
    setQuizzes(prev => prev.map(q => q.id === quiz.id ? { ...q, likes: (q.likes || 0) + 1 } : q));
  };

  const timeAgo = (ts) => {
    const diff = Date.now() - ts;
    const m = Math.floor(diff / 60000);
    const h = Math.floor(diff / 3600000);
    const d = Math.floor(diff / 86400000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    if (h < 24) return `${h}h ago`;
    return `${d}d ago`;
  };

  return (
    <div className="page" style={{ maxWidth: 700, paddingTop: 72 }}>
      <BackButton to="home" label="Back to Home" />

      <div className="page-heading">Find Questions</div>
      <div className="page-sub">Browse quizzes shared by the community</div>

      {/* Search */}
      <div style={{ position: "relative", marginBottom: 24 }}>
        <svg style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", opacity: 0.4 }}
          viewBox="0 0 20 20" fill="none" width="16" height="16">
          <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.5"/>
          <path d="M13.5 13.5l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
        <input
          className="field-input"
          style={{ paddingLeft: 40, fontSize: 14 }}
          placeholder="Search by topic or author..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* Results count */}
      {!loading && (
        <div style={{ fontSize: 12, opacity: 0.4, marginBottom: 16 }}>
          {search ? `${filtered.length} result${filtered.length !== 1 ? "s" : ""} for "${search}"` : `${quizzes.length} shared quiz${quizzes.length !== 1 ? "zes" : ""}`}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ textAlign: "center", padding: "60px 0", opacity: 0.4, fontSize: 14 }}>
          Loading...
        </div>
      )}

      {/* Empty */}
      {!loading && filtered.length === 0 && (
        <div style={{ textAlign: "center", padding: "60px 0" }}>
          <div style={{ fontSize: 14, opacity: 0.4, marginBottom: 8 }}>
            {search ? "No quizzes found for that search." : "No shared quizzes yet."}
          </div>
          <div style={{ fontSize: 12, opacity: 0.3 }}>
            Generate a quiz and share it to be the first!
          </div>
        </div>
      )}

      {/* Quiz cards */}
      {!loading && filtered.map(quiz => (
        <div key={quiz.id} className="card" style={{
          cursor: "pointer", transition: "all .15s",
          marginBottom: 10
        }}
          onClick={() => { setSelected(quiz); setPreviewOpen(true); }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {quiz.topic}
              </div>
              <div style={{ fontSize: 12, opacity: 0.5, display: "flex", gap: 12, flexWrap: "wrap" }}>
                <span>by {quiz.author}</span>
                <span>{quiz.count} questions</span>
                <span>{timeAgo(quiz.createdAt)}</span>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
              <button
                style={{ background: "transparent", border: "1px solid var(--bdr)", borderRadius: 8, padding: "5px 10px", cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", gap: 4, color: "inherit" }}
                onClick={e => likeQuiz(quiz, e)}
              >
                <svg viewBox="0 0 16 16" fill="none" width="13" height="13">
                  <path d="M8 13.5C8 13.5 1.5 9.5 1.5 5.5C1.5 3.567 3.067 2 5 2C6.105 2 7.1 2.527 7.75 3.35C8.4 2.527 9.395 2 10.5 2C12.433 2 14 3.567 14 5.5C14 9.5 8 13.5 8 13.5Z" stroke="currentColor" strokeWidth="1.2"/>
                </svg>
                {quiz.likes || 0}
              </button>
              <div style={{ fontSize: 11, opacity: 0.35, display: "flex", alignItems: "center", gap: 4 }}>
                <svg viewBox="0 0 16 16" fill="none" width="11" height="11">
                  <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2"/>
                  <path d="M6 8l1.5 1.5L10.5 6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                </svg>
                {quiz.plays || 0} plays
              </div>
            </div>
          </div>

          {/* Question type preview */}
          <div style={{ display: "flex", gap: 6, marginTop: 12, flexWrap: "wrap" }}>
            {["mcq", "tf", "fill"].map(type => {
              const count = quiz.questions?.filter(q => q.type === type).length || 0;
              if (!count) return null;
              const labels = { mcq: "MCQ", tf: "T/F", fill: "Fill" };
              return (
                <span key={type} style={{
                  fontSize: 10, fontWeight: 600, padding: "2px 8px",
                  borderRadius: 20, border: "1px solid var(--bdr)",
                  opacity: 0.6
                }}>
                  {count} {labels[type]}
                </span>
              );
            })}
          </div>
        </div>
      ))}

      {/* Preview Modal */}
      {previewOpen && selected && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
          display: "flex", alignItems: "center", justifyContent: "center",
          zIndex: 1000, padding: 24
        }} onClick={() => setPreviewOpen(false)}>
          <div style={{
            background: "var(--bg2)", border: "1px solid var(--bdr)",
            borderRadius: 16, padding: 28, maxWidth: 560, width: "100%",
            maxHeight: "80vh", overflowY: "auto"
          }} onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 700, fontSize: 20, marginBottom: 4 }}>{selected.topic}</div>
            <div style={{ fontSize: 12, opacity: 0.5, marginBottom: 20 }}>
              by {selected.author} · {selected.count} questions · {timeAgo(selected.createdAt)}
            </div>

            {/* Preview first 3 questions */}
            <div style={{ fontSize: 12, opacity: 0.5, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase", marginBottom: 10 }}>
              Preview
            </div>
            {selected.questions?.slice(0, 3).map((q, i) => (
              <div key={i} className="card-sm" style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{i + 1}. {q.question}</div>
                {q.choices && (
                  <div style={{ fontSize: 11, opacity: 0.5 }}>
                    {q.choices.slice(0, 2).join(" · ")}...
                  </div>
                )}
                {q.type === "tf" && <div style={{ fontSize: 11, opacity: 0.5 }}>True / False</div>}
              </div>
            ))}
            {selected.questions?.length > 3 && (
              <div style={{ fontSize: 12, opacity: 0.35, textAlign: "center", margin: "8px 0 16px" }}>
                + {selected.questions.length - 3} more questions
              </div>
            )}

            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button className="btn-primary" style={{ flex: 1, padding: "12px" }}
                onClick={() => { setPreviewOpen(false); useQuiz(selected); }}>
                Use this Quiz
              </button>
              <button className="btn-secondary" style={{ padding: "12px 16px" }}
                onClick={() => setPreviewOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}