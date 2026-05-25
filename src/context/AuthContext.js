import { createContext, useContext, useState, useEffect } from "react";
import { onAuthChange, signOut } from "../utils/firebase";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    let unsub;
    onAuthChange((u) => {
      setUser(u);
      setAuthLoading(false);
    }).then(fn => { unsub = fn; });
    return () => { if (unsub) unsub(); };
  }, []);

  return (
    <AuthContext.Provider value={{ user, authLoading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
