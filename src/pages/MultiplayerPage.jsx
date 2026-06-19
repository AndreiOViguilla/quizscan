import { useEffect } from "react";
import { useApp } from "../context/AppContext";
import { useQuiz } from "../context/QuizContext";
import { useMultiplayer } from "../context/MultiplayerContext";
import { pingRoom, setRoomSyncMode } from "../utils/api";

export default function MultiplayerPage() {
  const { navigate } = useApp();
  const { questions, resetQuizState, quizStartTime } = useQuiz();
  const {
    mpCode, mpMode, mpPlayers, myMpName, mpStatus, mpError,
    mpRealtimeRef, setMpMode, setMpPlayers, setMpCode, setMpStatus, setMpError,
    mpSyncMode, setMpSyncMode, myPlayerIdRef,
  } = useMultiplayer();

  useEffect(() => {
    if (!mpCode) return;
    const interval = setInterval(() => pingRoom(mpCode), 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [mpCode]);

  const setSyncMode = async (mode) => {
    setMpSyncMode(mode);
    if (mpCode) setRoomSyncMode(mpCode, mode).catch(() => {});
  };

  const startGame = () => {
    resetQuizState();
    quizStartTime.current = Date.now();
    navigate("quiz");
  };

  const leaveRoom = () => {
    if (mpRealtimeRef.current) { mpRealtimeRef.current.disconnect(); mpRealtimeRef.current = null; }
    setMpMode(""); setMpPlayers([]); setMpCode(""); setMpStatus(""); setMpError("");
    setMpSyncMode("self");
    myPlayerIdRef.current = null;
    navigate("home");
  };

  const isHost = mpMode === "host";

  return (
    <div className="page">
      <h2 className="page-heading">{isHost ? "Game Lobby" : "Joined Room"}</h2>
      <p className="page-sub">// powered by Firebase — works across any device globally</p>
      <div className="mp-room-code">{mpCode}</div>
      <div className="mp-status-text">
        {mpStatus || (isHost
          ? `${mpPlayers.length} player(s) connected — share the code above!`
          : "Connected! Waiting for host to start...")}
      </div>
      {mpError && <div className="alert-error">! {mpError}</div>}

      {isHost && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--txt2)", letterSpacing: 1, textTransform: "uppercase", marginBottom: 8 }}>
            Pace Mode
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            <button
              className={`edit-correct-btn ${mpSyncMode === "self" ? "sel" : ""}`}
              style={{ padding: "10px 18px", fontSize: 13, display: "flex", flexDirection: "row", alignItems: "center", gap: 12, height: "auto" }}
              onClick={() => setSyncMode("self")}
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, opacity: 0.8 }}>
                <circle cx="12" cy="8" r="4" />
                <path d="M6 21v-1a6 6 0 0 1 12 0v1" />
              </svg>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2 }}>
                <span style={{ fontWeight: 700 }}>Self-paced</span>
                <span style={{ fontSize: 10, opacity: 0.55, fontWeight: 400 }}>Everyone answers at their own pace</span>
              </div>
            </button>
            <button
              className={`edit-correct-btn ${mpSyncMode === "host" ? "sel" : ""}`}
              style={{ padding: "10px 18px", fontSize: 13, display: "flex", flexDirection: "row", alignItems: "center", gap: 12, height: "auto" }}
              onClick={() => setSyncMode("host")}
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, opacity: 0.8 }}>
                <path d="M3 18 L5.5 9 L10 13 L12 5 L14 13 L18.5 9 L21 18 Z" />
                <line x1="3" y1="21" x2="21" y2="21" />
              </svg>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2 }}>
                <span style={{ fontWeight: 700 }}>Host controls</span>
                <span style={{ fontSize: 10, opacity: 0.55, fontWeight: 400 }}>You advance everyone simultaneously</span>
              </div>
            </button>
          </div>
        </div>
      )}

      {!isHost && (
        <div className="badge" style={{ marginBottom: 20, display: "inline-flex" }}>
          {mpSyncMode === "host" ? "Host controls pace" : "Self-paced"}
        </div>
      )}

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
          {isHost
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
