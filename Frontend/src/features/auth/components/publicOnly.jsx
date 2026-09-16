import { Navigate } from "react-router";

import { useAuth } from "../hooks/useAuth";

/**
 * The mirror image of <Protected>: keeps an already signed in user off the
 * login and register screens.
 *
 * Without this, a signed in user who navigates to /login sees a form that, if
 * submitted, needlessly creates a second session — and the browser's back
 * button after logging in lands on a confusing empty form.
 */
const PublicOnly = ({ children }) => {
  const { status } = useAuth();

  if (status === "loading") {
    return (
      <main>
        <h1>Loading.....</h1>
      </main>
    );
  }

  if (status === "authenticated") {
    return <Navigate to="/" replace />;
  }

  return children;
};

export default PublicOnly;
