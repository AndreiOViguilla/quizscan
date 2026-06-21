import { useState, useRef, useEffect } from "react";
import { signInWithGoogle, signInWithEmail, signUpWithEmail, resetPassword } from "../utils/firebase";

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 30 * 60 * 1000;
const CREDENTIAL_ERRORS = new Set(["auth/user-not-found", "auth/wrong-password", "auth/invalid-credential", "auth/invalid-email"]);

function lockKey(email) { return `qs-lock-${email.trim().toLowerCase()}`; }
function getLock(email) { try { return JSON.parse(localStorage.getItem(lockKey(email)) || "{}"); } catch { return {}; } }
function setLock(email, data) { localStorage.setItem(lockKey(email), JSON.stringify(data)); }
function clearLock(email) { localStorage.removeItem(lockKey(email)); }

function checkLock(email) {
  const { lockedUntil, attempts } = getLock(email);
  if (lockedUntil && Date.now() < lockedUntil) {
    const mins = Math.ceil((lockedUntil - Date.now()) / 60000);
    return { locked: true, mins, attempts };
  }
  if (lockedUntil) clearLock(email);
  return { locked: false, attempts: attempts || 0 };
}

function getAuthError(code = "") {
  switch (code) {
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-credential":
    case "auth/invalid-email":
    case "auth/user-disabled":
      return "Invalid email or password.";
    case "auth/email-already-in-use":
      return "An account with this email already exists.";
    case "auth/weak-password":
      return "Password must be at least 6 characters.";
    case "auth/too-many-requests":
      return "Too many attempts. Please try again later.";
    case "auth/network-request-failed":
      return "Network error. Check your connection.";
    default:
      return "Sign in failed. Please try again.";
  }
}

export default function AuthModal({ onClose }) {
  const [tab, setTab] = useState("signin"); // signin | signup | reset
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [cfToken, setCfToken] = useState(null);
  const tsRef = useRef(null);
  const tsWidgetId = useRef(null);

  const SITE_KEY = process.env.REACT_APP_TURNSTILE_SITE_KEY;

  useEffect(() => {
    if (!SITE_KEY || tab === "reset") return;
    let pollTimer = null;
    const tryRender = () => {
      const container = tsRef.current;
      if (window.turnstile && container && !container._tsRendered) {
        container._tsRendered = true;
        tsWidgetId.current = window.turnstile.render(container, {
          sitekey: SITE_KEY,
          callback: (token) => setCfToken(token),
          "expired-callback": () => setCfToken(null),
          "error-callback": () => setCfToken(null),
          theme: "auto",
          size: "normal",
        });
      } else {
        pollTimer = setTimeout(tryRender, 200);
      }
    };
    if (!document.getElementById("ts-script")) {
      const s = document.createElement("script");
      s.id = "ts-script";
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      s.async = true;
      document.head.appendChild(s);
    }
    tryRender();
    return () => {
      clearTimeout(pollTimer);
      if (tsWidgetId.current !== null && window.turnstile) {
        try { window.turnstile.remove(tsWidgetId.current); } catch {}
      }
      if (tsRef.current) delete tsRef.current._tsRendered;
      tsWidgetId.current = null;
      setCfToken(null);
    };
  }, [tab, SITE_KEY]);

  const resetTurnstile = () => {
    if (tsWidgetId.current !== null && window.turnstile) {
      try { window.turnstile.reset(tsWidgetId.current); } catch {}
    }
    setCfToken(null);
  };

  const handleGoogle = async () => {
    setError("");
    if (SITE_KEY && !cfToken) { setError("Please complete the verification first."); return; }
    setLoading(true);
    try {
      await signInWithGoogle();
      onClose();
    } catch (e) {
      const code = e.code || "";
      setError(code === "auth/popup-closed-by-user" ? "" : getAuthError(code));
      resetTurnstile();
    }
    setLoading(false);
  };

  const handleEmail = async () => {
    setError("");
    if (tab === "signup" && password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (tab === "signin" && email) {
      const lock = checkLock(email);
      if (lock.locked) {
        setError(`Too many failed attempts. Try again in ${lock.mins} minute${lock.mins !== 1 ? "s" : ""}.`);
        return;
      }
    }
    if (SITE_KEY && !cfToken) { setError("Please complete the verification first."); return; }
    setLoading(true);
    try {
      if (tab === "signup") {
        await signUpWithEmail(email, password, name);
      } else {
        await signInWithEmail(email, password);
      }
      if (email) clearLock(email);
      onClose();
    } catch (e) {
      resetTurnstile();
      if (tab === "signin" && email && CREDENTIAL_ERRORS.has(e.code)) {
        const lock = getLock(email);
        const attempts = (lock.attempts || 0) + 1;
        if (attempts >= MAX_ATTEMPTS) {
          setLock(email, { attempts, lockedUntil: Date.now() + LOCKOUT_MS });
          setError("Too many failed attempts. Account locked for 30 minutes.");
        } else {
          setLock(email, { attempts });
          setError(`Invalid email or password. ${MAX_ATTEMPTS - attempts} attempt${MAX_ATTEMPTS - attempts !== 1 ? "s" : ""} remaining.`);
        }
      } else {
        setError(getAuthError(e.code));
      }
    }
    setLoading(false);
  };

  const handleReset = async () => {
    setError(""); setLoading(true);
    try {
      await resetPassword(email);
    } catch {
      // Silently ignore — don't reveal whether email exists
    }
    setResetSent(true);
    setLoading(false);
  };

  const switchTab = (t) => { setTab(t); setError(""); setResetSent(false); };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 2000, padding: 24
    }} onClick={onClose}>
      <div style={{
        background: "var(--bg2,#2f2f2f)", border: "1px solid var(--bdr,#3e3e3e)",
        borderRadius: 16, padding: 32, maxWidth: 400, width: "100%"
      }} onClick={e => e.stopPropagation()}>

        <div style={{ fontWeight: 700, fontSize: 20, marginBottom: 4 }}>
          {tab === "reset" ? "Reset Password" : tab === "signup" ? "Create Account" : "Sign In"}
        </div>
        <div style={{ fontSize: 13, opacity: 0.5, marginBottom: 24 }}>
          {tab === "reset" ? "Enter your email to receive a reset link" :
           tab === "signup" ? "Join to share quizzes and save scores globally" :
           "Sign in to share quizzes and appear on the global leaderboard"}
        </div>

        {error && <div className="alert-error" style={{ marginBottom: 16 }}>{error}</div>}

        {tab === "reset" ? (
          resetSent ? (
            <div className="alert-info" style={{ marginBottom: 16 }}>
              If an account exists with this email, a reset link has been sent.
            </div>
          ) : (
            <>
              <label className="field-label">Email</label>
              <input className="field-input" type="email" placeholder="you@email.com"
                value={email} onChange={e => setEmail(e.target.value)} style={{ marginBottom: 16 }} />
              <button className="btn-primary" style={{ width: "100%", padding: "12px", marginBottom: 12 }}
                onClick={handleReset} disabled={loading || !email}>
                {loading ? "Sending..." : "Send Reset Link"}
              </button>
            </>
          )
        ) : (
          <>
            <button onClick={handleGoogle} disabled={loading} style={{
              width: "100%", padding: "11px", borderRadius: 8, border: "1px solid var(--bdr,#3e3e3e)",
              background: "transparent", color: "inherit", cursor: "pointer",
              fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center",
              justifyContent: "center", gap: 10, marginBottom: 16, fontFamily: "inherit",
              transition: "background .15s"
            }}>
              <svg viewBox="0 0 24 24" width="18" height="18">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Continue with Google
            </button>

            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
              <div style={{ flex: 1, height: 1, background: "var(--bdr,#3e3e3e)" }} />
              <span style={{ fontSize: 12, opacity: 0.4 }}>or</span>
              <div style={{ flex: 1, height: 1, background: "var(--bdr,#3e3e3e)" }} />
            </div>

            {tab === "signup" && (
              <>
                <label className="field-label">Display Name</label>
                <input className="field-input" placeholder="Your name" value={name}
                  onChange={e => setName(e.target.value)} style={{ marginBottom: 12 }} />
              </>
            )}

            <label className="field-label">Email</label>
            <input className="field-input" type="email" placeholder="you@email.com"
              value={email} onChange={e => setEmail(e.target.value)} style={{ marginBottom: 12 }} />

            <label className="field-label">Password</label>
            <input className="field-input" type="password" placeholder="••••••••"
              value={password} onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === "Enter" && tab === "signin" && handleEmail()}
              style={{ marginBottom: tab === "signup" ? 12 : 20 }} />

            {tab === "signup" && (
              <>
                <label className="field-label">Confirm Password</label>
                <input className="field-input" type="password" placeholder="••••••••"
                  value={confirm} onChange={e => setConfirm(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleEmail()}
                  style={{ marginBottom: 20 }} />
              </>
            )}

            {SITE_KEY && (
              <div style={{ marginBottom: 16 }}>
                <div ref={tsRef} />
              </div>
            )}

            <button className="btn-primary" style={{ width: "100%", padding: "12px", marginBottom: 12 }}
              onClick={handleEmail} disabled={loading}>
              {loading ? "Please wait..." : tab === "signup" ? "Create Account" : "Sign In"}
            </button>
          </>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          {tab === "signin" && (
            <>
              <button style={{ background: "none", border: "none", color: "inherit", opacity: 0.5, fontSize: 12, cursor: "pointer", padding: 0 }}
                onClick={() => switchTab("signup")}>
                Create account
              </button>
              <button style={{ background: "none", border: "none", color: "inherit", opacity: 0.5, fontSize: 12, cursor: "pointer", padding: 0 }}
                onClick={() => switchTab("reset")}>
                Forgot password?
              </button>
            </>
          )}
          {tab === "signup" && (
            <button style={{ background: "none", border: "none", color: "inherit", opacity: 0.5, fontSize: 12, cursor: "pointer", padding: 0 }}
              onClick={() => switchTab("signin")}>
              Already have an account? Sign in
            </button>
          )}
          {tab === "reset" && (
            <button style={{ background: "none", border: "none", color: "inherit", opacity: 0.5, fontSize: 12, cursor: "pointer", padding: 0 }}
              onClick={() => switchTab("signin")}>
              Back to sign in
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
