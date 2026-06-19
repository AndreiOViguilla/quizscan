import { useEffect } from "react";
import { AppProvider, useApp } from "./context/AppContext";
import { SettingsProvider } from "./context/SettingsContext";
import { QuizProvider } from "./context/QuizContext";
import { MultiplayerProvider } from "./context/MultiplayerContext";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { cleanupExpiredRooms } from "./utils/api";
import { makeGlobalStyles } from "./styles/theme";
import { Header, Footer, Confetti } from "./components/Layout";
import ErrorBoundary from "./components/ErrorBoundary";

import HomePage from "./pages/HomePage";
import LoadingPage from "./pages/LoadingPage";
import EditPage from "./pages/EditPage";
import QuizPage from "./pages/QuizPage";
import ResultsPage from "./pages/ResultsPage";
import StudyPage from "./pages/StudyPage";
import FlashcardPage from "./pages/FlashcardPage";
import MultiplayerPage from "./pages/MultiplayerPage";
import LeaderboardPage from "./pages/LeaderboardPage";
import HistoryPage from "./pages/HistoryPage";
import FindPage from "./pages/FindPage";
import ProfilePage from "./pages/ProfilePage";
import DailyPage from "./pages/DailyPage";

function Router() {
  const { page } = useApp();
  switch (page) {
    case "home":        return <HomePage />;
    case "loading":     return <LoadingPage />;
    case "edit":        return <EditPage />;
    case "quiz":        return <QuizPage />;
    case "results":     return <ResultsPage />;
    case "study":       return <StudyPage />;
    case "flashcard":   return <FlashcardPage />;
    case "multiplayer": return <MultiplayerPage />;
    case "leaderboard": return <LeaderboardPage />;
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
  const { dark, confetti, page } = useApp();

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
      <main key={page} className="app-body">
        <Router />
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
