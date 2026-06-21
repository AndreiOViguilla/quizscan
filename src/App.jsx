import { useEffect, lazy, Suspense } from "react";
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

function InnerApp() {
  const { dark, confetti, page, navigate } = useApp();

  useEffect(() => { cleanupExpiredRooms(); }, []);

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
