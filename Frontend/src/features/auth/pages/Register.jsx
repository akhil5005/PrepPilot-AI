import { useState } from "react";
import { useNavigate, Link } from "react-router";

import "../auth.form.scss";
import { useAuth } from "../hooks/useAuth";

/*
 * Mirrors the server's rules in src/validators/auth.validator.js.
 *
 * This is a convenience, not a security control — the server validates
 * independently and is the only check that counts. Its job is to tell the user
 * what is wrong before they wait on a round trip.
 */
const PASSWORD_RULES = [
  { label: "At least 8 characters", test: (v) => v.length >= 8 },
  { label: "A lowercase letter", test: (v) => /[a-z]/.test(v) },
  { label: "An uppercase letter", test: (v) => /[A-Z]/.test(v) },
  { label: "A number", test: (v) => /[0-9]/.test(v) },
];

const Register = () => {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({
    username: "",
    email: "",
    password: "",
  });

  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const unmetRules = PASSWORD_RULES.filter(
    (rule) => !rule.test(form.password),
  );

  const handleChange = (e) => {
    const { name, value } = e.target;

    setForm((current) => ({ ...current, [name]: value }));

    setFieldErrors((current) => {
      if (!current[name]) return current;
      const next = { ...current };
      delete next[name];
      return next;
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (submitting) return;

    setFormError("");
    setFieldErrors({});

    /* Catch the obvious problems without a round trip. */
    if (unmetRules.length) {
      setFieldErrors({
        password: `Password needs: ${unmetRules
          .map((rule) => rule.label.toLowerCase())
          .join(", ")}`,
      });
      return;
    }

    setSubmitting(true);

    try {
      await register(form);
      navigate("/", { replace: true });
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
        <h1>Register</h1>

        {formError && (
          <p className="form-error" role="alert">
            {formError}
          </p>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <div className="input-group">
            <label htmlFor="username">Username</label>
            <input
              value={form.username}
              onChange={handleChange}
              type="text"
              id="username"
              name="username"
              autoComplete="username"
              required
              aria-invalid={Boolean(fieldErrors.username)}
              placeholder="Enter Username"
            />
            {fieldErrors.username && (
              <span className="field-error">{fieldErrors.username}</span>
            )}
          </div>

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
              /* "new-password" makes password managers offer to generate one. */
              autoComplete="new-password"
              required
              aria-invalid={Boolean(fieldErrors.password)}
              placeholder="Enter password"
            />
            {fieldErrors.password && (
              <span className="field-error">{fieldErrors.password}</span>
            )}

            {form.password && unmetRules.length > 0 && (
              <ul className="password-rules">
                {PASSWORD_RULES.map((rule) => (
                  <li
                    key={rule.label}
                    className={rule.test(form.password) ? "met" : "unmet"}
                  >
                    {rule.label}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <button
            className="button primary-button"
            type="submit"
            disabled={submitting}
          >
            {submitting ? "Creating account..." : "Register"}
          </button>
        </form>

        <p>
          Already have an account? <Link to={"/login"}>Login</Link>
        </p>
      </div>
    </main>
  );
};

export default Register;
