import { useEffect, useRef } from "react";
import { useApp } from "../context/AppContext";

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
      color: ["#4caf50", "#81c784", "#a5d6a7", "#fff", "#c8e6c9"][Math.floor(Math.random() * 5)]
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

  const NAV = [
    { label: "HOME", to: "home" },
    { label: "BOARD", to: "leaderboard" },
    { label: "HISTORY", to: "history" },
  ];

  return (
    <header className="header">
      <div className="header-logo" onClick={() => navigate("home")}>
        Quiz<span>Scan</span>
      </div>
      <div className="header-badge">AI</div>
      <nav className="header-nav">
        {NAV.map(n => (
          <button key={n.to} className={`nav-btn ${page === n.to ? "active" : ""}`} onClick={() => navigate(n.to)}>
            {n.label}
          </button>
        ))}
        <div className="nav-divider" />
        <button className="nav-btn" onClick={() => setDark(d => !d)}>
          {dark ? "LIGHT" : "DARK"}
        </button>
      </nav>
    </header>
  );
}

export function Footer() {
  const { navigate } = useApp();
  return (
    <footer className="footer">
      <div className="footer-left">
        <span>QuizScan</span> &mdash; AI-powered quiz generator
      </div>
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
