import { useApp } from "../context/AppContext";
import { BackButton } from "../components/Layout";
import { LETTERS } from "../utils/constants";
import { sbFetch, SupabaseRealtime } from "../utils/api";

export default function EditPage() {
  const ctx = useApp();
  const { questions, setQuestions, navigate, resetQuizState, quizStartTime } = ctx;

  const startQuiz = () => {
    resetQuizState();
    quizStartTime.current = Date.now();
    navigate("quiz");
  };

  const hostRoom = async () => {
    const code = Math.random().toString(36).substring(2, 6).toUpperCase();
    const name = ctx.playerName || "Host";
    ctx.setMyMpName(name);
    ctx.setMpStatus("Creating room...");
    try {
      await sbFetch("/rooms", "POST", { id: code, questions: ctx.questions, host: name });
      const player = await sbFetch("/room_players", "POST", { room_id: code, name, score: 0, current_q: 0 });
      if (player?.[0]?.id) ctx.myPlayerIdRef.current = player[0].id;
      ctx.setMpCode(code);
      ctx.setMpPlayers([{ name, score: 0, isHost: true }]);
      ctx.setMpMode("host");
      ctx.setMpStatus("Waiting for players...");
      const rt = new SupabaseRealtime(code, (record) => {
        if (record?.name) ctx.setMpPlayers(prev => {
          const ex = prev.find(p => p.name === record.name);
          return ex ? prev.map(p => p.name === record.name ? { ...p, score: record.score } : p)
            : [...prev, { name: record.name, score: record.score || 0 }];
        });
      });
      rt.connect();
      ctx.mpRealtimeRef.current = rt;
      const poll = setInterval(async () => {
        try {
          const players = await sbFetch(`/room_players?room_id=eq.${code}&select=name,score,current_q`);
          if (players) ctx.setMpPlayers(players.map((p, i) => ({ ...p, isHost: i === 0 })));
        } catch {}
      }, 3000);
      setTimeout(() => clearInterval(poll), 300000);
      navigate("multiplayer");
    } catch (e) {
      ctx.setMpError(`Failed to create room: ${e.message}`);
    }
  };

  return (
    <div className="page">
      <BackButton to="home" label="Back to Home" />
      <h2 className="page-heading">Review & Edit Questions</h2>
      <p className="page-sub">// fix any AI mistakes before starting — click any field to edit</p>

      {questions.map((q, qi) => (
        <div key={qi} className="edit-q-card">
          <div className="edit-q-num">Question {qi + 1} · {q.type.toUpperCase()}</div>
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
        <button className="btn-primary" onClick={startQuiz}>Start Quiz →</button>
        <button className="btn-secondary" onClick={hostRoom}>Host Multiplayer Room</button>
        <button className="btn-secondary" onClick={() => navigate("home")}>← Back</button>
      </div>
    </div>
  );
}
