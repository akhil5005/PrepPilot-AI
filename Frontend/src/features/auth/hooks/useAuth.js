import { useContext } from "react";

import { AuthContext } from "../authContext";

/**
 * Read the authentication state.
 *
 * This is now a plain consumer with no side effects of its own. All the session
 * work (the bootstrap request, login, logout) lives in AuthProvider, so calling
 * this hook from ten components costs ten context reads rather than ten
 * network requests — which is what the previous version did.
 *
 * @returns {{
 *   user: object|null,
 *   status: "loading"|"authenticated"|"anonymous",
 *   isLoading: boolean,
 *   isAuthenticated: boolean,
 *   login: (c: {email: string, password: string}) => Promise<object>,
 *   register: (c: {username: string, email: string, password: string}) => Promise<object>,
 *   logout: () => Promise<void>,
 *   logoutAll: () => Promise<void>,
 *   changePassword: (p: {currentPassword: string, newPassword: string}) => Promise<object>,
 * }}
 */
export const useAuth = () => {
  const context = useContext(AuthContext);

  if (!context) {
    /*
     * Without this the failure mode is a confusing "cannot destructure
     * property 'user' of undefined" somewhere deep in a component. Naming the
     * real cause saves the next person a debugging session.
     */
    throw new Error("useAuth must be used inside an <AuthProvider>");
  }

  return context;
};

export default useAuth;
