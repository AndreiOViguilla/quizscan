import { useApp } from "../context/AppContext";
import { useSettings } from "../context/SettingsContext";
import { useQuiz } from "../context/QuizContext";
import { useMultiplayer } from "../context/MultiplayerContext";
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
  const { navigate } = useApp();
  const { useShuffleQ, setUseShuffleQ, useShuffleChoices, setUseShuffleChoices, gameMode, setGameMode, playerName } = useSettings();
  const { questions, setQuestions, resetQuizState, quizStartTime } = useQuiz();
  const { setMyMpName, setMpStatus, setMpCode, setMpPlayers, setMpMode, myPlayerIdRef, mpRealtimeRef, setMpError } = useMultiplayer();

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
    const name = playerName || "Host";
    setMyMpName(name);
    setMpStatus("Creating room...");
    try {
      const code = await createRoom(questions, name);
      myPlayerIdRef.current = name;
      setMpCode(code);
      setMpPlayers([{ name, score: 0, isHost: true }]);
      setMpMode("host");
      setMpStatus("Waiting for players...");
      const rt = new FirebaseListener(`/rooms/${code}/players`, (players) => {
        if (players) {
          const list = Object.values(players);
          setMpPlayers(list.map((p, i) => ({ ...p, isHost: i === 0 })));
        }
      });
      rt.connect();
      mpRealtimeRef.current = rt;
      navigate("multiplayer");
    } catch (e) {
      setMpError(`Failed to create room: ${e.message}`);
    }
  };

  const MODES = [
    {
      id: "normal", label: "Normal", desc: "Standard quiz",
      icon: (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/>
          <rect x="9" y="3" width="6" height="4" rx="1"/>
          <path d="M9 12h6M9 16h4"/>
        </svg>
      ),
    },
    {
      id: "survival", label: "Survival", desc: "3 lives, wrong = -1",
      icon: (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
        </svg>
      ),
    },
    {
      id: "speedrun", label: "Speed Run", desc: "Race the clock",
      icon: (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
        </svg>
      ),
    },
  ];

  return (
    <div className="page">
      <BackButton to="home" label="Back to Home" />
      <h2 className="page-heading">Review & Edit Questions</h2>
      <p className="page-sub">// fix any AI mistakes before starting — click any field to edit</p>

      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 14 }}>Quiz Settings</div>

        <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 18 }}>
          <Toggle on={useShuffleQ} onToggle={() => setUseShuffleQ(v => !v)} label="Shuffle Questions" />
          <Toggle on={useShuffleChoices} onToggle={() => setUseShuffleChoices(v => !v)} label="Shuffle Choices" />
        </div>

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
              <span style={{ fontWeight: 700, display: "flex", alignItems: "center", gap: 5 }}>{m.icon}{m.label}</span>
              <span style={{ opacity: 0.55, fontSize: 10, fontWeight: 400 }}>{m.desc}</span>
            </button>
          ))}
        </div>
      </div>

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
