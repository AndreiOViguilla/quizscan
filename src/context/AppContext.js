import { createContext, useContext, useState } from "react";
import { loadLB, loadHistory } from "../utils/storage";

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [page, setPage] = useState("home");
  const [dark, setDark] = useState(() => {
    const saved = localStorage.getItem("quizscan-theme");
    return saved ? saved === "dark" : true;
  });

  const toggleDark = (val) => {
    const next = typeof val === "boolean" ? val : !dark;
    setDark(next);
    localStorage.setItem("quizscan-theme", next ? "dark" : "light");
  };

  const [confetti, setConfetti] = useState(false);
  const [error, setError] = useState("");
  const [toasts, setToasts] = useState([]);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [returnToSettings, setReturnToSettings] = useState(false);
  const [lb, setLb] = useState(loadLB());
  const [history, setHistory] = useState(loadHistory());

  const showToast = (message, type = "success") => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000);
  };

  const navigate = (to) => {
    if (to !== "home") setError("");
    setPage(to);
  };

  return (
    <AppContext.Provider value={{
      page, navigate,
      dark, setDark, toggleDark,
      confetti, setConfetti,
      error, setError,
      toasts, showToast,
      showAuthModal, setShowAuthModal,
      returnToSettings, setReturnToSettings,
      lb, setLb,
      history, setHistory,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() { return useContext(AppContext); }
