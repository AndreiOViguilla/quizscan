import { useEffect, lazy, Suspense, useState } from "react";
import { AppProvider, useApp } from "./context/AppContext";
import { SettingsProvider } from "./context/SettingsContext";
import { QuizProvider, useQuiz } from "./context/QuizContext";
import { MultiplayerProvider, useMultiplayer } from "./context/MultiplayerContext";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { cleanupExpiredRooms } from "./utils/api";
import { makeGlobalStyles } from "./styles/theme";
import { Header, Footer, Confetti } from "./components/Layout";
import ErrorBoundary from "./components/ErrorBoundary";

const HomePage      = lazy(() => import("./pages/HomePage"));
const LoadingPage   = lazy(() => import("./pages/LoadingPage"));
const EditPage      = lazy(() => import("./pages/EditPage"));
const QuizPage      = lazy(() => import("./pages/QuizPage"));
const ResultsPage   = lazy(() => import("./pages/ResultsPage"));
const StudyPage     = lazy(() => import("./pages/StudyPage"));
const FlashcardPage = lazy(() => import("./pages/FlashcardPage"));
const MultiplayerPage = lazy(() => import("./pages/MultiplayerPage"));
const LeaderboardPage = lazy(() => import("./pages/LeaderboardPage"));
const HistoryPage   = lazy(() => import("./pages/HistoryPage"));
const FindPage      = lazy(() => import("./pages/FindPage"));
const ProfilePage   = lazy(() => import("./pages/ProfilePage"));
const DailyPage     = lazy(() => import("./pages/DailyPage"));

function ProtectedPage({ children }) {
  const { navigate, showToast } = useApp();
  const { questions } = useQuiz();
  const { mpMode } = useMultiplayer();

  useEffect(() => {
    if (questions.length === 0 && !mpMode) {
      showToast("Generate a quiz first.", "error");
      navigate("home");
    }
  }, []);

  if (questions.length === 0 && !mpMode) return null;
  return children;
}

function Router() {
  const { page } = useApp();
  switch (page) {
    case "home":        return <HomePage />;
    case "loading":     return <LoadingPage />;
    case "edit":        return <ProtectedPage><EditPage /></ProtectedPage>;
    case "quiz":        return <ProtectedPage><QuizPage /></ProtectedPage>;
    case "results":     return <ProtectedPage><ResultsPage /></ProtectedPage>;
    case "study":       return <ProtectedPage><StudyPage /></ProtectedPage>;
    case "flashcard":   return <ProtectedPage><FlashcardPage /></ProtectedPage>;
    case "leaderboard": return <ProtectedPage><LeaderboardPage /></ProtectedPage>;
    case "multiplayer": return <MultiplayerPage />;
    case "history":     return <HistoryPage />;
    case "find":        return <FindPage />;
    case "profile":     return <ProfilePage />;
    case "daily":       return <DailyPage />;
    default:            return <HomePage />;
  }
}

function Toast() {
  const { toasts, dark } = useApp();
  if (!toasts.length) return null;
  return (
    <div style={{
      position: "fixed", bottom: 24, right: 24, zIndex: 9999,
      display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end",
      pointerEvents: "none",
    }}>
      {toasts.map(t => (
        <div key={t.id} style={{
          padding: "10px 16px", borderRadius: 10, fontSize: 13, fontWeight: 500,
          background: t.type === "error" ? "#ef4444" : dark ? "#2f2f2f" : "#ffffff",
          color: t.type === "error" ? "#fff" : "inherit",
          border: t.type === "error" ? "none" : "1px solid var(--bdr)",
          boxShadow: "0 4px 20px rgba(0,0,0,0.18)",
          animation: "slide-in .2s ease",
          maxWidth: 300,
        }}>
          {t.message}
        </div>
      ))}
    </div>
  );
}

function IdleLogout() {
  const { user, signOut } = useAuth();

  useEffect(() => {
    if (!user) return;
    const IDLE_MS = 30 * 60 * 1000;
    let timer;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => signOut(), IDLE_MS);
    };
    const events = ["mousedown", "mousemove", "keydown", "scroll", "touchstart", "click"];
    events.forEach(e => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      clearTimeout(timer);
      events.forEach(e => window.removeEventListener(e, reset));
    };
  }, [user, signOut]);

  return null;
}

function TermsModal({ onAccept, onDecline }) {
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 10000,
      background: "rgba(0,0,0,0.85)", backdropFilter: "blur(6px)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
    }}>
      <div style={{
        background: "var(--bg2)", border: "1px solid var(--bdr)",
        borderRadius: 16, padding: "32px", maxWidth: 520, width: "100%",
        maxHeight: "80vh", display: "flex", flexDirection: "column", gap: 0,
        boxShadow: "0 24px 80px rgba(0,0,0,0.5)",
      }}>
        <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 4 }}>Terms of Service</div>
        <div style={{ fontSize: 11, opacity: 0.4, marginBottom: 20 }}>Last updated: June 2026</div>

        <div style={{ overflowY: "auto", flex: 1, fontSize: 13, lineHeight: 1.7, color: "var(--txt2)", display: "flex", flexDirection: "column", gap: 16 }}>
          <section>
            <div style={{ fontWeight: 600, color: "var(--txt)", marginBottom: 4 }}>1. Acceptance</div>
            <p style={{ margin: 0 }}>By using QuizScan, you agree to these terms. If you do not agree, please do not use this service.</p>
          </section>
          <section>
            <div style={{ fontWeight: 600, color: "var(--txt)", marginBottom: 4 }}>2. About This Service</div>
            <p style={{ margin: 0 }}>QuizScan is a student-made tool that generates quizzes from your content using AI and pattern-matching. It is not affiliated with any university, institution, or AI provider.</p>
          </section>
          <section>
            <div style={{ fontWeight: 600, color: "var(--txt)", marginBottom: 4 }}>3. Accuracy Disclaimer</div>
            <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
              <li>AI-generated questions may be incomplete, inaccurate, or misleading.</li>
              <li>Do not rely solely on QuizScan for academic, professional, or critical decisions.</li>
              <li>Always verify generated content against your original source material.</li>
            </ul>
          </section>
          <section>
            <div style={{ fontWeight: 600, color: "var(--txt)", marginBottom: 4 }}>4. Acceptable Use</div>
            <p style={{ margin: 0, marginBottom: 6 }}>You agree not to use this service to:</p>
            <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
              <li>Submit harmful, abusive, or offensive content</li>
              <li>Attempt to manipulate or jailbreak the AI</li>
              <li>Use outputs to facilitate academic dishonesty</li>
              <li>Upload content you do not have rights to use</li>
            </ul>
          </section>
          <section>
            <div style={{ fontWeight: 600, color: "var(--txt)", marginBottom: 4 }}>5. Privacy</div>
            <p style={{ margin: 0 }}>QuizScan does not sell your data. Content you submit is processed to generate quizzes and is not stored beyond your session unless you explicitly save or share it.</p>
          </section>
          <section>
            <div style={{ fontWeight: 600, color: "var(--txt)", marginBottom: 4 }}>6. Limitation of Liability</div>
            <p style={{ margin: 0 }}>The creators of QuizScan are not responsible for any consequences resulting from the use or misuse of AI-generated content.</p>
          </section>
          <section>
            <div style={{ fontWeight: 600, color: "var(--txt)", marginBottom: 4 }}>7. Changes</div>
            <p style={{ margin: 0 }}>These terms may be updated at any time. Continued use of the service implies acceptance of any changes.</p>
          </section>
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
          <button className="btn-primary" style={{ flex: 1, padding: "12px" }} onClick={onAccept}>
            I Agree — Start Using QuizScan →
          </button>
          <button className="btn-secondary" style={{ padding: "12px 20px" }} onClick={onDecline}>
            Decline
          </button>
        </div>
      </div>
    </div>
  );
}

function InnerApp() {
  const { dark, confetti, page, navigate, setShowAuthModal } = useApp();
  const [tosAccepted, setTosAccepted] = useState(() => !!localStorage.getItem("qs-tos-accepted"));

  useEffect(() => { cleanupExpiredRooms(); }, []);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("reset") === "1") {
      setShowAuthModal(true);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  useEffect(() => {
    let el = document.getElementById("qs-global-styles");
    if (!el) { el = document.createElement("style"); el.id = "qs-global-styles"; document.head.appendChild(el); }
    el.textContent = makeGlobalStyles(dark);
  }, [dark]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  }, [dark]);

  const showFooter = !["quiz", "loading"].includes(page);

  return (
    <div className="app-shell">
      {!tosAccepted && (
        <TermsModal
          onAccept={() => { localStorage.setItem("qs-tos-accepted", "1"); setTosAccepted(true); }}
          onDecline={() => { document.body.innerHTML = '<div style="height:100vh;display:flex;align-items:center;justify-content:center;font-family:system-ui;color:#fff;background:#0d0d0d;font-size:15px;text-align:center;padding:24px">You must accept the Terms of Service to use QuizScan.</div>'; }}
        />
      )}
      <Confetti active={confetti} />
      <Header />
      <main className="app-body">
        <ErrorBoundary key={page} onReset={() => navigate("home")}>
          <Suspense fallback={<div style={{ paddingTop: 80, textAlign: "center", opacity: 0.4, fontSize: 13 }}>Loading...</div>}>
            <Router />
          </Suspense>
        </ErrorBoundary>
      </main>
      {showFooter && <Footer />}
      <Toast />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <AppProvider>
          <SettingsProvider>
            <QuizProvider>
              <MultiplayerProvider>
                <IdleLogout />
                <InnerApp />
              </MultiplayerProvider>
            </QuizProvider>
          </SettingsProvider>
        </AppProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}
