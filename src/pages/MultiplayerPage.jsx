import { useApp } from "../context/AppContext";
import { BackButton } from "../components/Layout";

export default function MultiplayerPage() {
  const ctx = useApp();
  const { mpCode, mpMode, mpPlayers, myMpName, mpStatus, mpError, navigate, questions,
    mpRealtimeRef, setMpMode, setMpPlayers, setMpCode, setMpStatus, setMpError,
    resetQuizState, quizStartTime } = ctx;

  const startGame = () => {
    resetQuizState();
    quizStartTime.current = Date.now();
    navigate("quiz");
  };

  const leaveRoom = () => {
    if (mpRealtimeRef.current) { mpRealtimeRef.current.disconnect(); mpRealtimeRef.current = null; }
    setMpMode(""); setMpPlayers([]); setMpCode(""); setMpStatus(""); setMpError("");
    ctx.myPlayerIdRef.current = null;
    navigate("home");
  };

  return (
    <div className="page">
      <h2 className="page-heading">{mpMode === "host" ? "Game Lobby" : "Joined Room"}</h2>
      <p className="page-sub">// powered by Supabase — works across any device globally</p>
      <div className="mp-room-code">{mpCode}</div>
      <div className="mp-status-text">
        {mpStatus || (mpMode === "host"
          ? `${mpPlayers.length} player(s) connected — share the code above!`
          : "Connected! Waiting for host to start...")}
      </div>
      {mpError && <div className="alert-error">! {mpError}</div>}
      <div style={{ marginBottom: 20 }}>
        {mpPlayers.map((p, i) => (
          <div key={i} className="mp-player-row">
            <span className="mp-player-name">
              {p.name} {i === 0 ? "[H]" : ""} {p.name === myMpName ? "(you)" : ""}
            </span>
            <span className="mp-player-score">{p.score || 0} pts</span>
          </div>
        ))}
      </div>
      {questions.length > 0 && (
        <button className="btn-primary" onClick={startGame} style={{ marginBottom: 12 }}>
          {mpMode === "host"
            ? `Start Game (${mpPlayers.length} player${mpPlayers.length !== 1 ? "s" : ""})`
            : "Start Playing"} →
        </button>
      )}
      <div className="alert-info">
        Share the code <strong>{mpCode}</strong> with friends — they go to this site, click Join, enter the code and play live!
      </div>
      <div style={{ marginTop: 20 }}>
        <button className="btn-secondary" onClick={leaveRoom}>← Leave Room</button>
      </div>
    </div>
  );
}
