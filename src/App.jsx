import { useEffect } from "react";
import { AppProvider, useApp } from "./context/AppContext";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { cleanupExpiredRooms } from "./utils/api";
import { makeGlobalStyles } from "./styles/theme";
import { Header, Footer, Confetti } from "./components/Layout";

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

// Signs out after 30 min of no mouse/keyboard/touch activity
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

  // Clean up expired rooms on load
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
        <Router />
      </main>
      {showFooter && <Footer />}
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppProvider>
        <IdleLogout />
        <InnerApp />
      </AppProvider>
    </AuthProvider>
  );
}