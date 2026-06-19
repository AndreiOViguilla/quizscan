import { createContext, useContext, useState, useRef } from "react";

const MultiplayerContext = createContext(null);

export function MultiplayerProvider({ children }) {
  const [mpMode, setMpMode] = useState("");
  const [mpCode, setMpCode] = useState("");
  const [mpJoinCode, setMpJoinCode] = useState("");
  const [mpPlayers, setMpPlayers] = useState([]);
  const [myMpName, setMyMpName] = useState("");
  const [mpStatus, setMpStatus] = useState("");
  const [mpError, setMpError] = useState("");
  const [mpSyncMode, setMpSyncMode] = useState("self");

  const mpRealtimeRef = useRef(null);
  const myPlayerIdRef = useRef(null);

  return (
    <MultiplayerContext.Provider value={{
      mpMode, setMpMode,
      mpCode, setMpCode,
      mpJoinCode, setMpJoinCode,
      mpPlayers, setMpPlayers,
      myMpName, setMyMpName,
      mpStatus, setMpStatus,
      mpError, setMpError,
      mpSyncMode, setMpSyncMode,
      mpRealtimeRef,
      myPlayerIdRef,
    }}>
      {children}
    </MultiplayerContext.Provider>
  );
}

export function useMultiplayer() { return useContext(MultiplayerContext); }
