import { useEffect, useRef, useState } from "react";
import { useApp } from "../context/AppContext";
import { useAuth } from "../context/AuthContext";
import AuthModal from "./AuthModal";
import { signOut } from "../utils/firebase";

export function Confetti({ active }) {
  const ref = useRef();
  useEffect(() => {
    if (!active) return;
    const canvas = ref.current; if (!canvas) return;
    const ctx = canvas.getContext("2d");
    canvas.width = window.innerWidth; canvas.height = window.innerHeight;
    const pieces = Array.from({ length: 120 }, () => ({
      x: Math.random() * canvas.width, y: Math.random() * -200,
      r: Math.random() * 8 + 4, tilt: Math.random() * 10 - 10, speed: Math.random() * 3 + 1,
      color: ["#888", "#aaa", "#ccc", "#fff", "#666"][Math.floor(Math.random() * 5)]
    }));
    let frame;
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      pieces.forEach(p => {
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = p.color; ctx.fill();
        p.y += p.speed; p.tilt += 0.1; p.x += Math.sin(p.tilt) * 1.5;
        if (p.y > canvas.height) { p.y = -20; p.x = Math.random() * canvas.width; }
      });
      frame = requestAnimationFrame(draw);
    };
    draw();
    const t = setTimeout(() => cancelAnimationFrame(frame), 4000);
    return () => { cancelAnimationFrame(frame); clearTimeout(t); };
  }, [active]);
  if (!active) return null;
  return <canvas ref={ref} style={{ position: "fixed", top: 0, left: 0, pointerEvents: "none", zIndex: 9999 }} />;
}

export function Header() {
  const { navigate, page, dark, setDark } = useApp();
  const { user } = useAuth();
  const [showAuth, setShowAuth] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);

  const NAV = [
    { label: "Home", to: "home" },
    { label: "Find", to: "find" },
    { label: "Daily", to: "daily" },
    { label: "Board", to: "leaderboard" },
    { label: "History", to: "history" },
  ];

  return (
    <>
      <div className="topbar">
        <div className="topbar-logo" onClick={() => navigate("home")}>QuizScan</div>
        <div className="topbar-right">
          {NAV.map(n => (
            <button key={n.to} className={`topbar-btn ${page === n.to ? "active" : ""}`} onClick={() => navigate(n.to)}>
              {n.label}
            </button>
          ))}
          <div className="topbar-divider" />
          <button className="topbar-btn" onClick={() => setDark(d => !d)}>
            {dark ? "Light" : "Dark"}
          </button>
          <div className="topbar-divider" />

          {user ? (
            <div style={{ position: "relative" }}>
              <button className="topbar-btn" style={{ display: "flex", alignItems: "center", gap: 6 }}
                onClick={() => setShowUserMenu(m => !m)}>
                {user.photoURL ? (
                  <img src={user.photoURL} alt="" style={{ width: 22, height: 22, borderRadius: "50%", objectFit: "cover" }} />
                ) : (
                  <div style={{ width: 22, height: 22, borderRadius: "50%", background: "var(--bdr2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700 }}>
                    {(user.displayName || user.email || "?")[0].toUpperCase()}
                  </div>
                )}
                <span style={{ maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13 }}>
                  {user.displayName || user.email?.split("@")[0]}
                </span>
              </button>
              {showUserMenu && (
                <div style={{
                  position: "absolute", right: 0, top: "calc(100% + 8px)",
                  background: "var(--bg2)", border: "1px solid var(--bdr)",
                  borderRadius: 10, padding: 8, minWidth: 160, zIndex: 200,
                  boxShadow: "0 4px 20px rgba(0,0,0,0.2)"
                }}>
                  <div style={{ fontSize: 11, opacity: 0.4, padding: "4px 10px 8px", borderBottom: "1px solid var(--bdr)", marginBottom: 4 }}>
                    {user.email}
                  </div>
                  <button style={{
                    width: "100%", textAlign: "left", background: "none", border: "none",
                    padding: "8px 10px", cursor: "pointer", fontSize: 13, color: "inherit",
                    borderRadius: 6, fontFamily: "inherit"
                  }} onClick={() => { navigate("profile"); setShowUserMenu(false); }}>
                    My Profile
                  </button>
                  <button style={{
                    width: "100%", textAlign: "left", background: "none", border: "none",
                    padding: "8px 10px", cursor: "pointer", fontSize: 13, color: "#ef4444",
                    borderRadius: 6, fontFamily: "inherit"
                  }} onClick={() => { signOut(); setShowUserMenu(false); }}>
                    Sign out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button className="btn-primary" style={{ padding: "6px 14px", fontSize: 13 }}
              onClick={() => setShowAuth(true)}>
              Sign in
            </button>
          )}
        </div>
      </div>
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
    </>
  );
}

export function Footer() {
  const { navigate } = useApp();
  return (
    <footer className="footer">
      <div className="footer-left"><span>QuizScan</span> — AI quiz generator</div>
      <div className="footer-right">
        <span className="footer-link" onClick={() => navigate("home")}>Home</span>
        <span className="footer-link" onClick={() => navigate("leaderboard")}>Leaderboard</span>
        <span className="footer-link" onClick={() => navigate("history")}>History</span>
      </div>
    </footer>
  );
}

export function BackButton({ to = "home", label = "Back" }) {
  const { navigate } = useApp();
  return (
    <button className="back-btn" onClick={() => navigate(to)}>
      &larr; {label}
    </button>
  );
}

export function Toggle({ on, onChange, label }) {
  return (
    <div className="toggle-item" onClick={() => onChange(!on)}>
      <div className={`toggle-track ${on ? "on" : ""}`}>
        <div className="toggle-thumb" />
      </div>
      <span className="toggle-label">{label}</span>
    </div>
  );
}