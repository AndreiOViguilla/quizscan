import { useState, useEffect } from "react";
import { useApp } from "../context/AppContext";
import { useAuth } from "../context/AuthContext";
import { BackButton } from "../components/Layout";
import { fbGet, fbPush, fbUpdate, deleteSharedQuiz, reportQuiz, getComments, addComment, deleteComment } from "../utils/db";

const stripHtml = (s) => String(s || "").replace(/<[^>]*>/g, "").trim();
const sanitizeField = (s, max = 500) => stripHtml(s).substring(0, max);

function sanitizeQuestions(questions) {
  return questions.map(q => ({
    type: ["mcq", "tf", "fill"].includes(q.type) ? q.type : "fill",
    question: sanitizeField(q.question, 500),
    answer: sanitizeField(String(q.answer ?? ""), 200),
    explanation: sanitizeField(q.explanation || "", 500),
    choices: Array.isArray(q.choices) ? q.choices.slice(0, 4).map(c => sanitizeField(c, 200)) : undefined,
  }));
}

export async function shareQuizPublicly(questions, topic, authorName, uid) {
  const res = await fetch("https://quizscan-94acb-default-rtdb.asia-southeast1.firebasedatabase.app/shared_quizzes.json", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      topic: sanitizeField(topic || "Untitled Quiz", 100),
      author: sanitizeField(authorName || "Anonymous", 50),
      uid: uid || null,
      questions: sanitizeQuestions(questions),
      count: questions.length,
      createdAt: Date.now(), likes: 0, plays: 0, commentCount: 0,
      category: "General", reportCount: 0,
    }),
  });
  return res.json();
}

const CATEGORIES = ["All", "Science", "History", "Math", "Technology", "Language", "Art", "Sports", "General"];
const SORTS = [
  { label: "Newest", value: "newest" },
  { label: "Most Played", value: "plays" },
  { label: "Most Liked", value: "likes" },
];

export default function FindPage() {
  const ctx = useApp();
  const { user } = useAuth();
  const [quizzes, setQuizzes] = useState([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [sort, setSort] = useState("newest");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [comments, setComments] = useState([]);
  const [commentText, setCommentText] = useState("");
  const [reportReason, setReportReason] = useState("");
  const [showReport, setShowReport] = useState(false);
  const [likedIds, setLikedIds] = useState(() => JSON.parse(localStorage.getItem("qs_liked") || "[]"));

  useEffect(() => { loadQuizzes(); }, []);

  const loadQuizzes = async () => {
    setLoading(true);
    const data = await fbGet("/shared_quizzes");
    if (data) {
      const arr = Object.entries(data)
        .filter(([, q]) => (q.reportCount || 0) < 5)
        .map(([id, q]) => ({ id, ...q }));
      setQuizzes(arr);
    }
    setLoading(false);
  };

  const filtered = quizzes
    .filter(q => category === "All" || q.category === category)
    .filter(q => !search || q.topic?.toLowerCase().includes(search.toLowerCase()) || q.author?.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (sort === "plays") return (b.plays || 0) - (a.plays || 0);
      if (sort === "likes") return (b.likes || 0) - (a.likes || 0);
      return b.createdAt - a.createdAt;
    });

  const openQuiz = async (quiz) => {
    setSelected(quiz);
    setComments([]);
    setCommentText("");
    setShowReport(false);
    const c = await getComments(quiz.id);
    setComments(c);
  };

  const useQuiz = async (quiz) => {
    ctx.setQuestions(quiz.questions);
    ctx.resetQuizState();
    ctx.quizStartTime.current = Date.now();
    await fbUpdate(`/shared_quizzes/${quiz.id}`, { plays: (quiz.plays || 0) + 1 });
    setSelected(null);
    ctx.navigate("edit");
  };

  const likeQuiz = async (quiz, e) => {
    e?.stopPropagation();
    if (likedIds.includes(quiz.id)) return;
    const newLiked = [...likedIds, quiz.id];
    setLikedIds(newLiked);
    localStorage.setItem("qs_liked", JSON.stringify(newLiked));
    const newLikes = (quiz.likes || 0) + 1;
    await fbUpdate(`/shared_quizzes/${quiz.id}`, { likes: newLikes });
    setQuizzes(prev => prev.map(q => q.id === quiz.id ? { ...q, likes: newLikes } : q));
    if (selected?.id === quiz.id) setSelected(s => ({ ...s, likes: newLikes }));
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this quiz?")) return;
    await deleteSharedQuiz(id);
    setQuizzes(q => q.filter(x => x.id !== id));
    setSelected(null);
  };

  const handleReport = async () => {
    if (!reportReason.trim()) return;
    await reportQuiz(selected.id, reportReason, user?.uid);
    setShowReport(false);
    setReportReason("");
    alert("Reported. Thank you!");
  };

  const handleComment = async () => {
    if (!user || !commentText.trim()) return;
    await addComment(selected.id, user, commentText);
    setCommentText("");
    const c = await getComments(selected.id);
    setComments(c);
  };

  const handleDeleteComment = async (commentId) => {
    await deleteComment(selected.id, commentId);
    setComments(c => c.filter(x => x.id !== commentId));
  };

  const timeAgo = (ts) => {
    const diff = Date.now() - ts;
    const m = Math.floor(diff / 60000), h = Math.floor(diff / 3600000), d = Math.floor(diff / 86400000);
    if (m < 1) return "just now"; if (m < 60) return `${m}m ago`;
    if (h < 24) return `${h}h ago`; return `${d}d ago`;
  };

  return (
    <div className="page" style={{ maxWidth: 700, paddingTop: 72 }}>
      <BackButton to="home" label="Back to Home" />
      <div className="page-heading">Find Questions</div>
      <div className="page-sub">Browse quizzes shared by the community</div>

      {/* Search + Sort */}
      <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: 1, minWidth: 200 }}>
          <svg style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", opacity: 0.4 }}
            viewBox="0 0 20 20" fill="none" width="15" height="15">
            <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M13.5 13.5l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <input className="field-input" style={{ paddingLeft: 38 }} placeholder="Search by topic or author..."
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="field-select" value={sort} onChange={e => setSort(e.target.value)}>
          {SORTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>

      {/* Category filter */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 20 }}>
        {CATEGORIES.map(c => (
          <button key={c} onClick={() => setCategory(c)} style={{
            padding: "5px 12px", borderRadius: 20, border: "1px solid var(--bdr)",
            background: category === c ? "var(--bg3)" : "transparent",
            color: "inherit", cursor: "pointer", fontSize: 12, fontWeight: category === c ? 600 : 400,
            fontFamily: "inherit", transition: "all .15s"
          }}>{c}</button>
        ))}
      </div>

      {!loading && (
        <div style={{ fontSize: 12, opacity: 0.4, marginBottom: 14 }}>
          {filtered.length} quiz{filtered.length !== 1 ? "zes" : ""}
        </div>
      )}

      {loading && <div style={{ textAlign: "center", padding: "60px 0", opacity: 0.4, fontSize: 14 }}>Loading...</div>}

      {!loading && filtered.length === 0 && (
        <div style={{ textAlign: "center", padding: "60px 0" }}>
          <div style={{ fontSize: 14, opacity: 0.4, marginBottom: 6 }}>
            {search ? "No quizzes found." : "No shared quizzes yet."}
          </div>
          <div style={{ fontSize: 12, opacity: 0.3 }}>Generate a quiz and share it to be the first!</div>
        </div>
      )}

      {!loading && filtered.map(quiz => (
        <div key={quiz.id} className="card" style={{ cursor: "pointer", marginBottom: 10 }} onClick={() => openQuiz(quiz)}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {quiz.topic}
              </div>
              <div style={{ fontSize: 12, opacity: 0.5, display: "flex", gap: 10, flexWrap: "wrap" }}>
                <span>by {quiz.author}</span>
                <span>{quiz.count} questions</span>
                <span>{timeAgo(quiz.createdAt)}</span>
                {quiz.category && quiz.category !== "General" && <span>{quiz.category}</span>}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
              <button style={{
                background: likedIds.includes(quiz.id) ? "var(--bg3)" : "transparent",
                border: "1px solid var(--bdr)", borderRadius: 8, padding: "4px 10px",
                cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", gap: 4, color: "inherit"
              }} onClick={e => likeQuiz(quiz, e)}>
                ♥ {quiz.likes || 0}
              </button>
              <span style={{ fontSize: 11, opacity: 0.35 }}>{quiz.plays || 0} plays</span>
            </div>
          </div>
          <div style={{ display: "flex", gap: 5, marginTop: 10, flexWrap: "wrap" }}>
            {["mcq", "tf", "fill"].map(type => {
              const count = quiz.questions?.filter(q => q.type === type).length || 0;
              if (!count) return null;
              return (
                <span key={type} style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 20, border: "1px solid var(--bdr)", opacity: 0.6 }}>
                  {count} {({ mcq: "MCQ", tf: "T/F", fill: "Fill" })[type]}
                </span>
              );
            })}
            {(quiz.commentCount || 0) > 0 && (
              <span style={{ fontSize: 10, opacity: 0.4, padding: "2px 8px" }}>
                {quiz.commentCount} comment{quiz.commentCount !== 1 ? "s" : ""}
              </span>
            )}
          </div>
        </div>
      ))}

      {/* Quiz Detail Modal */}
      {selected && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
          display: "flex", alignItems: "center", justifyContent: "center",
          zIndex: 1000, padding: 24
        }} onClick={() => setSelected(null)}>
          <div style={{
            background: "var(--bg2)", border: "1px solid var(--bdr)",
            borderRadius: 16, padding: 28, maxWidth: 580, width: "100%",
            maxHeight: "85vh", overflowY: "auto"
          }} onClick={e => e.stopPropagation()}>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
              <div style={{ fontWeight: 700, fontSize: 20, flex: 1 }}>{selected.topic}</div>
              <button onClick={() => setSelected(null)} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", opacity: 0.4, color: "inherit" }}>✕</button>
            </div>
            <div style={{ fontSize: 12, opacity: 0.5, marginBottom: 20 }}>
              by {selected.author} · {selected.count} questions · {timeAgo(selected.createdAt)}
            </div>

            {/* Preview */}
            <div style={{ fontSize: 11, opacity: 0.4, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase", marginBottom: 8 }}>Preview</div>
            {selected.questions?.slice(0, 3).map((q, i) => (
              <div key={i} className="card-sm" style={{ marginBottom: 6 }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 3 }}>{i + 1}. {q.question}</div>
                {q.choices && <div style={{ fontSize: 11, opacity: 0.5 }}>{q.choices.slice(0, 2).join(" · ")}...</div>}
                {q.type === "tf" && <div style={{ fontSize: 11, opacity: 0.5 }}>True / False</div>}
              </div>
            ))}
            {selected.questions?.length > 3 && (
              <div style={{ fontSize: 12, opacity: 0.3, textAlign: "center", margin: "6px 0 14px" }}>
                + {selected.questions.length - 3} more
              </div>
            )}

            {/* Actions */}
            <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
              <button className="btn-primary" style={{ flex: 1, padding: "11px" }} onClick={() => useQuiz(selected)}>
                Use this Quiz
              </button>
              <button style={{
                background: likedIds.includes(selected.id) ? "var(--bg3)" : "transparent",
                border: "1px solid var(--bdr)", borderRadius: 8, padding: "11px 16px",
                cursor: "pointer", fontSize: 13, color: "inherit", fontFamily: "inherit"
              }} onClick={() => likeQuiz(selected)}>
                ♥ {selected.likes || 0}
              </button>
              {user && user.uid === selected.uid && (
                <button className="btn-danger" style={{ padding: "11px 14px" }} onClick={() => handleDelete(selected.id)}>Delete</button>
              )}
              <button style={{
                background: "transparent", border: "1px solid var(--bdr)", borderRadius: 8,
                padding: "11px 14px", cursor: "pointer", fontSize: 12, opacity: 0.5, color: "inherit", fontFamily: "inherit"
              }} onClick={() => setShowReport(r => !r)}>
                Report
              </button>
            </div>

            {/* Report */}
            {showReport && (
              <div style={{ marginTop: 12 }}>
                <input className="field-input" placeholder="Reason for report..." value={reportReason}
                  onChange={e => setReportReason(e.target.value)} style={{ marginBottom: 8 }} />
                <button className="btn-danger" style={{ width: "100%" }} onClick={handleReport}>Submit Report</button>
              </div>
            )}

            {/* Comments */}
            <div style={{ borderTop: "1px solid var(--bdr)", marginTop: 20, paddingTop: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>
                Comments {comments.length > 0 && `(${comments.length})`}
              </div>
              {comments.length === 0 && <div style={{ fontSize: 13, opacity: 0.4, marginBottom: 12 }}>No comments yet.</div>}
              {comments.map(c => (
                <div key={c.id} style={{ display: "flex", gap: 10, marginBottom: 12, alignItems: "flex-start" }}>
                  <div style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--bg3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                    {c.name[0].toUpperCase()}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>{c.name} <span style={{ opacity: 0.4, fontWeight: 400 }}>{timeAgo(c.createdAt)}</span></div>
                    <div style={{ fontSize: 13, marginTop: 2 }}>{c.text}</div>
                  </div>
                  {user && (user.uid === c.uid || user.uid === selected.uid) && (
                    <button onClick={() => handleDeleteComment(c.id)} style={{ background: "none", border: "none", cursor: "pointer", opacity: 0.3, fontSize: 12, color: "inherit" }}>✕</button>
                  )}
                </div>
              ))}
              {user ? (
                <div style={{ display: "flex", gap: 8 }}>
                  <input className="field-input" placeholder="Add a comment..." value={commentText}
                    onChange={e => setCommentText(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && handleComment()}
                    style={{ flex: 1 }} />
                  <button className="btn-primary" onClick={handleComment}>Post</button>
                </div>
              ) : (
                <div style={{ fontSize: 12, opacity: 0.4 }}>Sign in to comment</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}