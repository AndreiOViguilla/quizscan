import { createContext, useContext, useState, useRef } from "react";

const QuizContext = createContext(null);

export function QuizProvider({ children }) {
  const [questions, setQuestions] = useState([]);
  const [flagged, setFlagged] = useState(new Set());
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState({});
  const [selected, setSelected] = useState(null);
  const [fillVal, setFillVal] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [timeLeft, setTimeLeft] = useState(30);
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
  const [flipped, setFlipped] = useState(false);
  const [fcKnown, setFcKnown] = useState(new Set());
  const [lives, setLives] = useState(3);

  const quizStartTime = useRef(null);
  const timerRef = useRef(null);

  const resetQuizState = () => {
    setCurrent(0); setAnswers({}); setSelected(null); setFillVal(""); setRevealed(false);
    setHintUsed(false); setHintText(""); setEliminated([]); setDifficulty({});
    setCurrentDiffLevel("easy"); setAdaptNotice(""); setAdaptingQ(false);
    setStreak(0); setBestStreak(0); setShareUrl("");
    setFlipped(false); setFcKnown(new Set());
    setFlagged(new Set());
    setLives(3);
  };

  return (
    <QuizContext.Provider value={{
      questions, setQuestions,
      flagged, setFlagged,
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
      flipped, setFlipped,
      fcKnown, setFcKnown,
      lives, setLives,
      resetQuizState,
      quizStartTime,
      timerRef,
    }}>
      {children}
    </QuizContext.Provider>
  );
}

export function useQuiz() { return useContext(QuizContext); }
