import { useEffect } from "react";
import { AppProvider, useApp } from "./context/AppContext";
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

// ─── Router ────────────────────────────────────────────────────────────────────
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
    default:            return <HomePage />;
  }
}

// ─── Inner App (has access to context) ────────────────────────────────────────
function InnerApp() {
  const { dark, confetti, page } = useApp();

  // Inject global styles
  useEffect(() => {
    let el = document.getElementById("qs-global-styles");
    if (!el) { el = document.createElement("style"); el.id = "qs-global-styles"; document.head.appendChild(el); }
    el.textContent = makeGlobalStyles(dark);
  }, [dark]);

  // Expose CSS variables to styled elements via data attr
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  }, [dark]);

  const showFooter = !["quiz", "loading"].includes(page);

  return (
    <div className="app">
      <Confetti active={confetti} />
      <Header />
      <Router />
      {showFooter && <Footer />}
    </div>
  );
}

// ─── Root ──────────────────────────────────────────────────────────────────────
export default function App() {
  return (
    <AppProvider>
      <InnerApp />
    </AppProvider>
  );
}
