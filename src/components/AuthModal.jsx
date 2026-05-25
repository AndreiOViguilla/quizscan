import { useState } from "react";
import { signInWithGoogle, signInWithEmail, signUpWithEmail, resetPassword } from "../utils/firebase";

export default function AuthModal({ onClose }) {
  const [tab, setTab] = useState("signin"); // signin | signup | reset
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  const handleGoogle = async () => {
    setError(""); setLoading(true);
    try {
      await signInWithGoogle();
      onClose();
    } catch (e) {
      setError(e.message.replace("Firebase: ", ""));
    }
    setLoading(false);
  };

  const handleEmail = async () => {
    setError(""); setLoading(true);
    try {
      if (tab === "signup") {
        await signUpWithEmail(email, password, name);
      } else {
        await signInWithEmail(email, password);
      }
      onClose();
    } catch (e) {
      setError(e.message.replace("Firebase: ", "").replace(/\(.*\)/, "").trim());
    }
    setLoading(false);
  };

  const handleReset = async () => {
    setError(""); setLoading(true);
    try {
      await resetPassword(email);
      setResetSent(true);
    } catch (e) {
      setError(e.message.replace("Firebase: ", "").replace(/\(.*\)/, "").trim());
    }
    setLoading(false);
  };

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
              Reset link sent! Check your email.
            </div>
          ) : (
            <>
              <label className="field-label">Email</label>
              <input className="field-input" type="email" placeholder="you@email.com"
                value={email} onChange={e => setEmail(e.target.value)} style={{ marginBottom: 16 }} />
              <button className="btn-primary" style={{ width: "100%", padding: "12px", marginBottom: 12 }}
                onClick={handleReset} disabled={loading}>
                {loading ? "Sending..." : "Send Reset Link"}
              </button>
            </>
          )
        ) : (
          <>
            {/* Google */}
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
              onKeyDown={e => e.key === "Enter" && handleEmail()}
              style={{ marginBottom: 20 }} />

            <button className="btn-primary" style={{ width: "100%", padding: "12px", marginBottom: 12 }}
              onClick={handleEmail} disabled={loading}>
              {loading ? "Please wait..." : tab === "signup" ? "Create Account" : "Sign In"}
            </button>
          </>
        )}

        {/* Footer links */}
        <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          {tab === "signin" && (
            <>
              <button style={{ background: "none", border: "none", color: "inherit", opacity: 0.5, fontSize: 12, cursor: "pointer", padding: 0 }}
                onClick={() => { setTab("signup"); setError(""); }}>
                Create account
              </button>
              <button style={{ background: "none", border: "none", color: "inherit", opacity: 0.5, fontSize: 12, cursor: "pointer", padding: 0 }}
                onClick={() => { setTab("reset"); setError(""); }}>
                Forgot password?
              </button>
            </>
          )}
          {tab === "signup" && (
            <button style={{ background: "none", border: "none", color: "inherit", opacity: 0.5, fontSize: 12, cursor: "pointer", padding: 0 }}
              onClick={() => { setTab("signin"); setError(""); }}>
              Already have an account? Sign in
            </button>
          )}
          {tab === "reset" && (
            <button style={{ background: "none", border: "none", color: "inherit", opacity: 0.5, fontSize: 12, cursor: "pointer", padding: 0 }}
              onClick={() => { setTab("signin"); setError(""); setResetSent(false); }}>
              Back to sign in
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
