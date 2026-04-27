import { createContext, useContext, useState, useRef } from "react";
import { loadLB, loadHistory } from "../utils/storage";

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [page, setPage] = useState("home"); // home|loading|edit|quiz|study|flashcard|results|leaderboard|history|multiplayer
  const [dark, setDark] = useState(true);
  const [mode, setMode] = useState("quiz"); // quiz|study|flashcard
  const [tab, setTab] = useState("pdf");

  // Input
  const [file, setFile] = useState(null);
  const [text, setText] = useState("");
  const [urlVal, setUrlVal] = useState("");
  const [ytVal, setYtVal] = useState("");
  const [topicVal, setTopicVal] = useState("");

  // Settings
  const [numQ, setNumQ] = useState(10);
  const [qType, setQType] = useState("mixed");
  const [lang, setLang] = useState("English");
  const [playerName, setPlayerName] = useState("");
  const [useTimer, setUseTimer] = useState(true);
  const [useStreak, setUseStreak] = useState(true);
  const [useSounds, setUseSounds] = useState(true);
  const [autoDiff, setAutoDiff] = useState(false);
  const [mpAfterGenerate, setMpAfterGenerate] = useState(false);

  // Quiz state
  const [questions, setQuestions] = useState([]);
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState({});
  const [selected, setSelected] = useState(null);
  const [fillVal, setFillVal] = useState("");
  const [revealed, setRevealed] = useState(false);

  // Timer
  const [timeLeft, setTimeLeft] = useState(30);

  // Feature state
  const [hintUsed, setHintUsed] = useState(false);
  const [hintText, setHintText] = useState("");
  const [eliminated, setEliminated] = useState([]);
  const [difficulty, setDifficulty] = useState({});
  const [currentDiffLevel, setCurrentDiffLevel] = useState("easy");
  const [adaptingQ, setAdaptingQ] = useState(false);
  const [adaptNotice, setAdaptNotice] = useState("");
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [shareUrl, setShareUrl] = useState("");
  const [confetti, setConfetti] = useState(false);

  // Flashcard
  const [flipped, setFlipped] = useState(false);
  const [fcKnown, setFcKnown] = useState(new Set());

  // Multiplayer
  const [mpMode, setMpMode] = useState("");
  const [mpCode, setMpCode] = useState("");
  const [mpJoinCode, setMpJoinCode] = useState("");
  const [mpPlayers, setMpPlayers] = useState([]);
  const [myMpName, setMyMpName] = useState("");
  const [mpStatus, setMpStatus] = useState("");
  const [mpError, setMpError] = useState("");

  // Data
  const [lb, setLb] = useState(loadLB());
  const [history, setHistory] = useState(loadHistory());

  // Error
  const [error, setError] = useState("");

  // Refs
  const quizStartTime = useRef(null);
  const mpRealtimeRef = useRef(null);
  const myPlayerIdRef = useRef(null);
  const timerRef = useRef(null);

  const resetQuizState = () => {
    setCurrent(0); setAnswers({}); setSelected(null); setFillVal(""); setRevealed(false);
    setHintUsed(false); setHintText(""); setEliminated([]); setDifficulty({});
    setCurrentDiffLevel("easy"); setAdaptNotice(""); setAdaptingQ(false);
    setStreak(0); setBestStreak(0); setShareUrl("");
    setFlipped(false); setFcKnown(new Set());
  };

  const navigate = (to) => {
    setError("");
    setPage(to);
  };

  return (
    <AppContext.Provider value={{
      page, navigate,
      dark, setDark,
      mode, setMode,
      tab, setTab,
      file, setFile,
      text, setText,
      urlVal, setUrlVal,
      ytVal, setYtVal,
      topicVal, setTopicVal,
      numQ, setNumQ,
      qType, setQType,
      lang, setLang,
      playerName, setPlayerName,
      useTimer, setUseTimer,
      useStreak, setUseStreak,
      useSounds, setUseSounds,
      autoDiff, setAutoDiff,
      mpAfterGenerate, setMpAfterGenerate,
      questions, setQuestions,
      current, setCurrent,
      answers, setAnswers,
      selected, setSelected,
      fillVal, setFillVal,
      revealed, setRevealed,
      timeLeft, setTimeLeft,
      hintUsed, setHintUsed,
      hintText, setHintText,
      eliminated, setEliminated,
      difficulty, setDifficulty,
      currentDiffLevel, setCurrentDiffLevel,
      adaptingQ, setAdaptingQ,
      adaptNotice, setAdaptNotice,
      streak, setStreak,
      bestStreak, setBestStreak,
      shareUrl, setShareUrl,
      confetti, setConfetti,
      flipped, setFlipped,
      fcKnown, setFcKnown,
      mpMode, setMpMode,
      mpCode, setMpCode,
      mpJoinCode, setMpJoinCode,
      mpPlayers, setMpPlayers,
      myMpName, setMyMpName,
      mpStatus, setMpStatus,
      mpError, setMpError,
      lb, setLb,
      history, setHistory,
      error, setError,
      quizStartTime,
      mpRealtimeRef,
      myPlayerIdRef,
      timerRef,
      resetQuizState,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() { return useContext(AppContext); }
