import api from "../../../lib/api";

/*
 * Every function here lets errors PROPAGATE.
 *
 * The previous version caught each error, logged it, and returned undefined.
 * That turned a failed login into `undefined.user` — a TypeError in the caller
 * — while the UI cheerfully navigated to the home page as though the login had
 * worked. Failing loudly is what lets the hook and the pages show the user what
 * actually went wrong.
 */

/**
 * @description Create an account. The server sets the session cookies.
 * @param {{ username: string, email: string, password: string }} credentials
 * @returns {Promise<{ user: object, message: string }>}
 */
export async function register({ username, email, password }) {
  const response = await api.post("/api/auth/register", {
    username,
    email,
    password,
  });

  return response.data;
}

/**
 * @description Sign in. The server sets the session cookies.
 * @param {{ email: string, password: string }} credentials
 * @returns {Promise<{ user: object, message: string }>}
 */
export async function login({ email, password }) {
  const response = await api.post("/api/auth/login", { email, password });

  return response.data;
}

/**
 * @description End the current session.
 *
 * POST, not GET: logging out changes server state. This is the one call that
 * deliberately does not rethrow — if the request fails the client still wants
 * to forget the user locally, and the server side session expires on its own.
 */
export async function logout() {
  try {
    const response = await api.post("/api/auth/logout");
    return response.data;
  } catch {
    return { success: false };
  }
}

/**
 * @description End every session for this account, on all devices.
 */
export async function logoutAll() {
  const response = await api.post("/api/auth/logout-all");

  return response.data;
}

/**
 * @description Change the password. Signs out every other device.
 * @param {{ currentPassword: string, newPassword: string }} payload
 */
export async function changePassword({ currentPassword, newPassword }) {
  const response = await api.post("/api/auth/change-password", {
    currentPassword,
    newPassword,
  });

  return response.data;
}

/**
 * @description Fetch the signed in user. Used once on app start to restore the
 * session from the cookie.
 */
export async function getMe() {
  const response = await api.get("/api/auth/get-me");

  return response.data;
}
