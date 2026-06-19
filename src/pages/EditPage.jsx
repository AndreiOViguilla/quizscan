import { useApp } from "../context/AppContext";
import { BackButton } from "../components/Layout";
import { LETTERS } from "../utils/constants";
import { createRoom, FirebaseListener } from "../utils/api";

function Toggle({ on, onToggle, label }) {
  return (
    <label className="toggle-item" onClick={onToggle} style={{ cursor: "pointer" }}>
      <div className={`toggle-track ${on ? "on" : ""}`}><div className="toggle-thumb" /></div>
      <span className="toggle-label">{label}</span>
    </label>
  );
}

export default function EditPage() {
  const ctx = useApp();
  const {
    questions, setQuestions, navigate, resetQuizState, quizStartTime,
    useShuffleQ, setUseShuffleQ, useShuffleChoices, setUseShuffleChoices,
    gameMode, setGameMode,
  } = ctx;

  const startQuiz = () => {
    resetQuizState();
    let qs = [...questions];
    if (useShuffleQ) qs = qs.sort(() => Math.random() - 0.5);
    if (useShuffleChoices) {
      qs = qs.map(q => {
        if (q.type !== "mcq") return q;
        const order = q.choices.map((_, i) => i).sort(() => Math.random() - 0.5);
        return { ...q, choices: order.map(i => q.choices[i]), answer: order.indexOf(q.answer) };
      });
    }
    setQuestions(qs);
    quizStartTime.current = Date.now();
    navigate("quiz");
  };

  const hostRoom = async () => {
    const name = ctx.playerName || "Host";
    ctx.setMyMpName(name);
    ctx.setMpStatus("Creating room...");
    try {
      const code = await createRoom(ctx.questions, name);
      ctx.myPlayerIdRef.current = name;
      ctx.setMpCode(code);
      ctx.setMpPlayers([{ name, score: 0, isHost: true }]);
      ctx.setMpMode("host");
      ctx.setMpStatus("Waiting for players...");
      const rt = new FirebaseListener(`/rooms/${code}/players`, (players) => {
        if (players) {
          const list = Object.values(players);
          ctx.setMpPlayers(list.map((p, i) => ({ ...p, isHost: i === 0 })));
        }
      });
      rt.connect();
      ctx.mpRealtimeRef.current = rt;
      navigate("multiplayer");
    } catch (e) {
      ctx.setMpError(`Failed to create room: ${e.message}`);
    }
  };

  const MODES = [
    { id: "normal", label: "Normal", desc: "Standard quiz" },
    { id: "survival", label: "Survival", desc: "3 lives, wrong = -1" },
    { id: "speedrun", label: "Speed Run", desc: "Race the clock" },
  ];

  return (
    <div className="page">
      <BackButton to="home" label="Back to Home" />
      <h2 className="page-heading">Review & Edit Questions</h2>
      <p className="page-sub">// fix any AI mistakes before starting — click any field to edit</p>

      {/* Quiz Settings */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 14 }}>Quiz Settings</div>

        {/* Shuffle toggles */}
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 18 }}>
          <Toggle on={useShuffleQ} onToggle={() => setUseShuffleQ(v => !v)} label="Shuffle Questions" />
          <Toggle on={useShuffleChoices} onToggle={() => setUseShuffleChoices(v => !v)} label="Shuffle Choices" />
        </div>

        {/* Game mode */}
        <div style={{ fontSize: 11, fontWeight: 600, color: "var(--txt2)", letterSpacing: 1, textTransform: "uppercase", marginBottom: 8 }}>
          Game Mode
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {MODES.map(m => (
            <button
              key={m.id}
              className={`edit-correct-btn ${gameMode === m.id ? "sel" : ""}`}
              style={{ padding: "8px 16px", fontSize: 12, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2, height: "auto" }}
              onClick={() => setGameMode(m.id)}
            >
              <span style={{ fontWeight: 700 }}>{m.label}</span>
              <span style={{ opacity: 0.55, fontSize: 10, fontWeight: 400 }}>{m.desc}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Question list */}
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
