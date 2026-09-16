import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { setOnSessionExpired } from "../../lib/api";
import { AuthContext } from "./authContext";
import * as authApi from "./services/auth.api";

/**
 * Authentication state for the whole app.
 *
 * The important change from the previous version: the "who am I?" bootstrap
 * request lives HERE, in the provider, and runs exactly once.
 *
 * Before, that `useEffect` lived inside the `useAuth` hook, so every component
 * that called the hook fired its own `/get-me` request — Protected, Login and
 * Register each did one — and each of them independently flipped the shared
 * `loading` flag. That produced redundant network traffic and a login screen
 * that could flash or redirect at the wrong moment depending on which request
 * happened to settle last.
 */
export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);

  /*
   * A three-state status instead of a boolean. "Not loading and no user" is
   * genuinely different from "haven't checked yet", and conflating them is what
   * makes protected routes bounce a signed in user to the login page on a
   * refresh.
   */
  const [status, setStatus] = useState("loading");

  /* StrictMode mounts effects twice in development; only bootstrap once. */
  const bootstrapped = useRef(false);

  useEffect(() => {
    if (bootstrapped.current) {
      return;
    }

    bootstrapped.current = true;

    /*
     * Note: there is deliberately NO "cancelled" flag or cleanup function here.
     *
     * Combining one with the `bootstrapped` ref guard deadlocks under
     * StrictMode, which mounts every effect twice in development: the first
     * mount's cleanup would set cancelled = true and suppress its own state
     * update, while the ref guard makes the second mount return early without
     * re-fetching. The result is a status stuck on "loading" forever and an app
     * frozen on the loading screen.
     *
     * The guard alone is enough — it already ensures exactly one request — and
     * setting state after unmount is a harmless no-op in React 18+.
     */
    (async () => {
      try {
        const data = await authApi.getMe();

        setUser(data.user);
        setStatus("authenticated");
      } catch {
        /*
         * A 401 here is the normal "not signed in" case, not an error worth
         * showing. The api interceptor has already tried a silent refresh
         * before this point, so reaching the catch really does mean anonymous.
         */
        setUser(null);
        setStatus("anonymous");
      }
    })();
  }, []);

  /*
   * If a refresh fails mid-session (token revoked, logged out elsewhere,
   * refresh token expired), the api layer calls this and the UI drops to the
   * signed out state immediately instead of showing a broken page.
   */
  useEffect(() => {
    setOnSessionExpired(() => {
      setUser(null);
      setStatus("anonymous");
    });

    return () => setOnSessionExpired(null);
  }, []);

  const login = useCallback(async ({ email, password }) => {
    const data = await authApi.login({ email, password });

    setUser(data.user);
    setStatus("authenticated");

    return data.user;
  }, []);

  const register = useCallback(async ({ username, email, password }) => {
    const data = await authApi.register({ username, email, password });

    setUser(data.user);
    setStatus("authenticated");

    return data.user;
  }, []);

  const logout = useCallback(async () => {
    /*
     * Clear local state first and unconditionally. Even if the network call
     * fails, the user asked to be signed out and the UI must reflect that;
     * the server side session expires on its own regardless.
     */
    try {
      await authApi.logout();
    } finally {
      setUser(null);
      setStatus("anonymous");
    }
  }, []);

  const logoutAll = useCallback(async () => {
    try {
      await authApi.logoutAll();
    } finally {
      setUser(null);
      setStatus("anonymous");
    }
  }, []);

  const changePassword = useCallback(async ({ currentPassword, newPassword }) => {
    return authApi.changePassword({ currentPassword, newPassword });
  }, []);

  /* Memoised so consumers do not re-render on every provider render. */
  const value = useMemo(
    () => ({
      user,
      status,
      isLoading: status === "loading",
      isAuthenticated: status === "authenticated",
      login,
      register,
      logout,
      logoutAll,
      changePassword,
    }),
    [user, status, login, register, logout, logoutAll, changePassword],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
