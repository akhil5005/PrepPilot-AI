import { createContext } from "react";

/**
 * The auth context object itself.
 *
 * It lives in its own module — separate from the provider component — because
 * React Fast Refresh only preserves state for files that export components and
 * nothing else. Keeping the context here means editing the provider no longer
 * forces a full page reload during development.
 */
export const AuthContext = createContext(null);

/*
 * The original name had a typo (`AutoContext`). Aliased so any file still
 * importing the old spelling keeps working.
 */
export const AutoContext = AuthContext;

export default AuthContext;
