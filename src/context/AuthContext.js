import { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import { onAuthChange, signOut } from "../utils/firebase";

const INACTIVITY_MS = 30 * 60 * 1000; // 30 minutes

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const timerRef = useRef(null);

  const handleSignOut = useCallback(async () => {
    await signOut();
  }, []);

  const resetTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(handleSignOut, INACTIVITY_MS);
  }, [handleSignOut]);

  // Start/stop inactivity timer based on auth state
  useEffect(() => {
    if (!user) {
      if (timerRef.current) clearTimeout(timerRef.current);
      return;
    }
    const events = ["mousemove", "mousedown", "keydown", "touchstart", "scroll"];
    events.forEach(e => window.addEventListener(e, resetTimer, { passive: true }));
    resetTimer();
    return () => {
      events.forEach(e => window.removeEventListener(e, resetTimer));
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [user, resetTimer]);

  useEffect(() => {
    let unsub;
    onAuthChange((u) => {
      setUser(u);
      setAuthLoading(false);
    }).then(fn => { unsub = fn; });
    return () => { if (unsub) unsub(); };
  }, []);

  return (
    <AuthContext.Provider value={{ user, authLoading, signOut: handleSignOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
