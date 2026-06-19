import { createContext, useContext, useState } from "react";

const SettingsContext = createContext(null);

export function SettingsProvider({ children }) {
  const [mode, setMode] = useState("quiz");
  const [tab, setTab] = useState("pdf");
  const [file, setFile] = useState(null);
  const [text, setText] = useState("");
  const [urlVal, setUrlVal] = useState("");
  const [ytVal, setYtVal] = useState("");
  const [topicVal, setTopicVal] = useState("");
  const [numQ, setNumQ] = useState(10);
  const [qType, setQType] = useState("mixed");
  const [lang, setLang] = useState("English");
  const [playerName, setPlayerName] = useState("");
  const [useTimer, setUseTimer] = useState(true);
  const [useStreak, setUseStreak] = useState(true);
  const [useSounds, setUseSounds] = useState(true);
  const [autoDiff, setAutoDiff] = useState(false);
  const [useShuffleQ, setUseShuffleQ] = useState(false);
  const [useShuffleChoices, setUseShuffleChoices] = useState(false);
  const [gameMode, setGameMode] = useState("normal");
  const [mpAfterGenerate, setMpAfterGenerate] = useState(false);

  return (
    <SettingsContext.Provider value={{
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
      useShuffleQ, setUseShuffleQ,
      useShuffleChoices, setUseShuffleChoices,
      gameMode, setGameMode,
      mpAfterGenerate, setMpAfterGenerate,
    }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() { return useContext(SettingsContext); }
