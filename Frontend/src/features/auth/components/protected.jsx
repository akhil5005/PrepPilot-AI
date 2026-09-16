import { Navigate, useLocation } from "react-router";

import { useAuth } from "../hooks/useAuth";

/**
 * Gate a route behind a signed in session.
 *
 * Two fixes over the previous version:
 *
 * 1. It waits for `status` to leave "loading". The old boolean `loading` flag
 *    was flipped by whichever component's `useAuth` effect finished first, so a
 *    signed in user hitting refresh could be redirected to /login before the
 *    session had been restored.
 *
 * 2. It remembers where the user was heading (`state.from`) so that after
 *    logging in they land on the page they actually wanted instead of always
 *    being dumped on the home page.
 */
const Protected = ({ children }) => {
  const { status } = useAuth();
  const location = useLocation();

  if (status === "loading") {
    return (
      <main>
        <h1>Loading.....</h1>
      </main>
    );
  }

  if (status !== "authenticated") {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return children;
};

export default Protected;
