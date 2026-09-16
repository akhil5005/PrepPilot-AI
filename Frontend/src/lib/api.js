import axios from "axios";

/**
 * The single axios instance used by every feature.
 *
 * Previously each feature built its own instance, which meant the refresh
 * logic below would have had to be duplicated (and would have drifted). One
 * instance keeps the session behaviour identical everywhere.
 */
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  /* Required for the httpOnly auth cookies to be sent cross-origin. */
  withCredentials: true,
});

/**
 * A normalised error the UI can render directly.
 *
 * Components should never have to reach into `err.response.data.message` and
 * guess at the shape; they read `.message`, `.status`, `.fields` and `.code`.
 */
export class ApiError extends Error {
  constructor({ message, status, fields, code }) {
    super(message);
    this.name = "ApiError";
    this.status = status ?? 0;
    this.fields = fields ?? null;
    this.code = code ?? null;
  }
}

/**
 * @description Turn any axios failure into an ApiError.
 */
function toApiError(err) {
  if (err instanceof ApiError) {
    return err;
  }

  if (axios.isCancel?.(err)) {
    return new ApiError({ message: "Request cancelled", status: 0 });
  }

  const response = err?.response;

  if (!response) {
    return new ApiError({
      message:
        "Could not reach the server. Check your connection and try again.",
      status: 0,
      code: "NETWORK",
    });
  }

  const data = response.data ?? {};

  return new ApiError({
    message: data.message || "Something went wrong. Please try again.",
    status: response.status,
    fields: data.details?.fields ?? null,
    code: data.details?.code ?? null,
  });
}

/* ------------------------------------------------------------------ */
/* Silent refresh                                                      */
/* ------------------------------------------------------------------ */

/*
 * Access tokens now live ~15 minutes, so a 401 is a routine event rather than
 * an error. On the first 401 we call /api/auth/refresh once and replay the
 * original request. The user sees nothing.
 *
 * `refreshPromise` deduplicates: if ten requests 401 at the same moment, they
 * all await the SAME refresh call instead of firing ten rotations, which would
 * trip the server's refresh-token reuse detection and log the user out.
 */
let refreshPromise = null;

/** Called when refreshing fails, so the app can drop to a signed out state. */
let onSessionExpired = null;

export function setOnSessionExpired(handler) {
  onSessionExpired = handler;
}

function refreshSession() {
  if (!refreshPromise) {
    refreshPromise = api
      .post("/api/auth/refresh")
      .finally(() => {
        refreshPromise = null;
      });
  }

  return refreshPromise;
}

/* Endpoints that must never trigger a refresh attempt. */
const NO_REFRESH_PATHS = [
  "/api/auth/refresh",
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/logout",
];

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    const status = error.response?.status;

    const shouldTryRefresh =
      status === 401 &&
      original &&
      !original._retried &&
      !NO_REFRESH_PATHS.some((path) => (original.url || "").includes(path));

    if (!shouldTryRefresh) {
      return Promise.reject(toApiError(error));
    }

    original._retried = true;

    try {
      await refreshSession();
      return await api(original);
    } catch {
      /*
       * The refresh token is gone or was revoked; this really is a signed out
       * user. Tell the app so it can clear its state, then surface the
       * ORIGINAL error rather than the refresh failure, which is more
       * meaningful to the caller.
       */
      if (onSessionExpired) {
        onSessionExpired();
      }

      return Promise.reject(toApiError(error));
    }
  },
);

export { api, toApiError };
export default api;
