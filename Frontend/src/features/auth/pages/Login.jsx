import { useState } from "react";
import { useNavigate, useLocation, Link } from "react-router";

import "../auth.form.scss";
import { useAuth } from "../hooks/useAuth";

const Login = () => {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [form, setForm] = useState({ email: "", password: "" });

  /* Per-field messages from the server's validation response. */
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState("");

  /*
   * Local to this form, and separate from the provider's global status. Using
   * the global flag here would blank the whole form out while a background
   * session check was running.
   */
  const [submitting, setSubmitting] = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;

    setForm((current) => ({ ...current, [name]: value }));

    /* Clear the error for a field as soon as the user edits it. */
    setFieldErrors((current) => {
      if (!current[name]) return current;
      const next = { ...current };
      delete next[name];
      return next;
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    /* Guard against double submission from a fast double click or Enter. */
    if (submitting) return;

    setFormError("");
    setFieldErrors({});
    setSubmitting(true);

    try {
      await login(form);

      /*
       * Navigate ONLY after a successful login. The previous version navigated
       * unconditionally, so a failed login silently landed on the home page,
       * which then bounced back to /login with no explanation.
       */
      const destination = location.state?.from?.pathname || "/";
      navigate(destination, { replace: true });
    } catch (err) {
      setFieldErrors(err.fields || {});
      setFormError(err.fields ? "" : err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main>
      <div className="form-container">
        <h1>Login</h1>

        {formError && (
          <p className="form-error" role="alert">
            {formError}
          </p>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <div className="input-group">
            <label htmlFor="email">Email</label>
            <input
              value={form.email}
              onChange={handleChange}
              type="email"
              id="email"
              name="email"
              autoComplete="email"
              required
              aria-invalid={Boolean(fieldErrors.email)}
              placeholder="Enter email address"
            />
            {fieldErrors.email && (
              <span className="field-error">{fieldErrors.email}</span>
            )}
          </div>

          <div className="input-group">
            <label htmlFor="password">Password</label>
            <input
              value={form.password}
              onChange={handleChange}
              type="password"
              id="password"
              name="password"
              /*
               * Tells the password manager this is a sign-in field, not a new
               * password, so it offers to fill rather than to generate.
               */
              autoComplete="current-password"
              required
              aria-invalid={Boolean(fieldErrors.password)}
              placeholder="Enter password"
            />
            {fieldErrors.password && (
              <span className="field-error">{fieldErrors.password}</span>
            )}
          </div>

          <button
            className="button primary-button"
            type="submit"
            disabled={submitting}
          >
            {submitting ? "Signing in..." : "Login"}
          </button>
        </form>

        <p>
          Don&apos;t have an account? <Link to={"/register"}>Register</Link>
        </p>
      </div>
    </main>
  );
};

export default Login;
