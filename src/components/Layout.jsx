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
  const { navigate, page, dark, toggleDark, showAuthModal, setShowAuthModal } = useApp();
  const { user } = useAuth();
  const showAuth = showAuthModal;
  const setShowAuth = setShowAuthModal;
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);

  const NAV = [
    { label: "Home", to: "home" },
    { label: "Find", to: "find" },
    { label: "Daily", to: "daily" },
    { label: "Board", to: "leaderboard" },
    { label: "History", to: "history" },
  ];

  const navTo = (to) => { navigate(to); setShowMobileMenu(false); };

  return (
    <>
      <div className="topbar">
        <div className="topbar-logo" onClick={() => navigate("home")} role="button" tabIndex={0} onKeyDown={e => e.key === "Enter" && navigate("home")} aria-label="Go to home">QuizScan</div>
        <div className="topbar-right">
          <nav className="topbar-nav">
            {NAV.map(n => (
              <button key={n.to} className={`topbar-btn ${page === n.to ? "active" : ""}`} onClick={() => navigate(n.to)} aria-current={page === n.to ? "page" : undefined}>
                {n.label}
              </button>
            ))}
          </nav>
          <button className="hamburger-btn" onClick={() => setShowMobileMenu(m => !m)} aria-label="Menu" aria-expanded={showMobileMenu}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              {showMobileMenu
                ? <><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>
                : <><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></>}
            </svg>
          </button>
          <div className="topbar-divider" />
          <button className="topbar-btn" onClick={toggleDark} aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
            style={{ padding: "6px 10px", display: "flex", alignItems: "center" }}>
            {dark ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
                <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
              </svg>
            )}
          </button>
          <div className="topbar-divider" />

          {user ? (
            <div style={{ position: "relative" }}>
              <button className="topbar-btn" style={{ display: "flex", alignItems: "center", gap: 6 }}
                onClick={() => setShowUserMenu(m => !m)} aria-expanded={showUserMenu} aria-label="User menu">
                {user.photoURL ? (
                  <img src={user.photoURL} alt={user.displayName || "User avatar"} style={{ width: 22, height: 22, borderRadius: "50%", objectFit: "cover" }} />
                ) : (
                  <div style={{ width: 22, height: 22, borderRadius: "50%", background: "var(--bdr2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700 }}>
                    {(user.displayName || user.email || "?")[0].toUpperCase()}
                  </div>
                )}
                <span style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13 }}>
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
      {showMobileMenu && (
        <div className="mobile-menu">
          {NAV.map(n => (
            <button key={n.to} className={`topbar-btn ${page === n.to ? "active" : ""}`} onClick={() => navTo(n.to)}>
              {n.label}
            </button>
          ))}
        </div>
      )}
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
    </>
  );
}

function ReportModal({ onClose }) {
  const [text, setText] = useState("");
  const [image, setImage] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [status, setStatus] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef();

  const handleImage = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setStatus("Image must be under 5MB."); return; }
    const reader = new FileReader();
    reader.onload = (ev) => { setImage(ev.target.result); setImagePreview(ev.target.result); };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async () => {
    if (!text.trim() && !image) { setStatus("Please add a description or image."); return; }
    setSubmitting(true);
    setStatus("");
    try {
      // Moderate text
      if (text.trim()) {
        const modRes = await fetch("/api/moderate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        const modData = await modRes.json();
        if (modData.flagged) { setStatus("Your report contains inappropriate content."); setSubmitting(false); return; }
      }
      // Moderate image
      if (image) {
        const modRes = await fetch("/api/moderate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: "image", imageBase64: image }),
        });
        const modData = await modRes.json();
        if (modData.flagged) { setStatus("The uploaded image was flagged as inappropriate."); setSubmitting(false); return; }
      }
      // Submit to Firebase
      await fetch("https://quizscan-94acb-default-rtdb.asia-southeast1.firebasedatabase.app/feedback.json", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.trim(), hasImage: !!image, image: image || null, createdAt: Date.now() }),
      });
      setStatus("done");
    } catch {
      setStatus("Something went wrong. Please try again.");
    }
    setSubmitting(false);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000, padding: 24 }}
      onClick={onClose}>
      <div style={{ background: "var(--bg2)", border: "1px solid var(--bdr)", borderRadius: 16, padding: 28, maxWidth: 480, width: "100%" }}
        onClick={e => e.stopPropagation()}>
        {status === "done" ? (
          <div style={{ textAlign: "center", padding: "20px 0" }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>✓</div>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>Report submitted</div>
            <div style={{ fontSize: 13, opacity: 0.5, marginBottom: 20 }}>Thanks for helping improve QuizScan.</div>
            <button className="btn-primary" onClick={onClose}>Close</button>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <div style={{ fontWeight: 700, fontSize: 17 }}>Report a problem</div>
              <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", opacity: 0.4, color: "inherit" }}>✕</button>
            </div>
            <textarea
              className="field-input"
              placeholder="Describe the issue..."
              value={text}
              onChange={e => setText(e.target.value)}
              rows={4}
              style={{ width: "100%", resize: "vertical", marginBottom: 12, fontFamily: "inherit" }}
            />
            <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleImage} />
            {imagePreview ? (
              <div style={{ position: "relative", marginBottom: 12 }}>
                <img src={imagePreview} alt="preview" style={{ width: "100%", borderRadius: 10, maxHeight: 200, objectFit: "cover" }} />
                <button onClick={() => { setImage(null); setImagePreview(null); fileRef.current.value = ""; }}
                  style={{ position: "absolute", top: 8, right: 8, background: "rgba(0,0,0,0.6)", border: "none", borderRadius: "50%", width: 28, height: 28, cursor: "pointer", color: "#fff", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
              </div>
            ) : (
              <button className="btn-secondary" style={{ width: "100%", marginBottom: 12 }} onClick={() => fileRef.current.click()}>
                + Attach screenshot
              </button>
            )}
            {status && status !== "done" && <div className="alert-error" style={{ marginBottom: 12 }}>{status}</div>}
            <button className="btn-primary" style={{ width: "100%" }} onClick={handleSubmit} disabled={submitting}>
              {submitting ? "Submitting..." : "Submit Report"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export function Footer() {
  const { navigate } = useApp();
  const [showReport, setShowReport] = useState(false);
  return (
    <>
      <footer className="footer">
        <div className="footer-left"><span>QuizScan</span> — AI quiz generator</div>
        <nav className="footer-right" aria-label="Footer navigation">
          <button className="footer-link" onClick={() => navigate("home")}>Home</button>
          <button className="footer-link" onClick={() => navigate("leaderboard")}>Leaderboard</button>
          <button className="footer-link" onClick={() => navigate("history")}>History</button>
          <button className="footer-link" onClick={() => setShowReport(true)}>Report</button>
        </nav>
      </footer>
      {showReport && <ReportModal onClose={() => setShowReport(false)} />}
    </>
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