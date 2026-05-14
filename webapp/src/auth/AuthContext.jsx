import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";
import { auth } from "../lib/firebase";
import { ApiError, api, clearWebappIdTokenGetter, setWebappIdTokenGetter } from "../lib/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [serverProfile, setServerProfile] = useState(null);
  const [meLoading, setMeLoading] = useState(false);
  const [meError, setMeError] = useState(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!user) {
      clearWebappIdTokenGetter();
      setServerProfile(null);
      setMeLoading(false);
      setMeError(null);
      return;
    }

    setWebappIdTokenGetter(() => user.getIdToken());
    let cancelled = false;
    setMeLoading(true);
    setMeError(null);

    (async () => {
      try {
        const body = await api.me();
        if (cancelled) return;
        if (body && typeof body === "object" && body.user && typeof body.user === "object") {
          setServerProfile(body.user);
        } else {
          setServerProfile(null);
        }
      } catch (err) {
        if (cancelled) return;
        setServerProfile(null);
        const code = err instanceof ApiError ? err.code : err instanceof Error ? err.message : "unknown_error";
        setMeError(code);
      } finally {
        if (!cancelled) setMeLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      clearWebappIdTokenGetter();
    };
  }, [user]);

  const value = useMemo(
    () => ({
      user,
      loading,
      serverProfile,
      meLoading,
      meError,
      signInWithGoogle: async () => {
        const provider = new GoogleAuthProvider();
        await signInWithPopup(auth, provider);
      },
      signOut: () => signOut(auth),
    }),
    [user, loading, serverProfile, meLoading, meError],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
