import { FormEvent, useState } from "react";
import { useAuth } from "../context/AuthProvider";
import "./auth.css";

const LOGO_SVG = (
  <svg
    width="34"
    height="34"
    viewBox="0 0 24 24"
    fill="none"
    stroke="#fff"
    strokeWidth="1.3"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <line x1="12" y1="2" x2="12" y2="22" />
    <line x1="2" y1="12" x2="22" y2="12" />
    <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
    <line x1="19.07" y1="4.93" x2="4.93" y2="19.07" />
    <line x1="12" y1="2" x2="9" y2="5" />
    <line x1="12" y1="2" x2="15" y2="5" />
    <line x1="12" y1="22" x2="9" y2="19" />
    <line x1="12" y1="22" x2="15" y2="19" />
    <line x1="2" y1="12" x2="5" y2="9" />
    <line x1="2" y1="12" x2="5" y2="15" />
    <line x1="22" y1="12" x2="19" y2="9" />
    <line x1="22" y1="12" x2="19" y2="15" />
    <line x1="4.93" y1="4.93" x2="7" y2="3.5" />
    <line x1="4.93" y1="4.93" x2="3.5" y2="7" />
    <line x1="19.07" y1="19.07" x2="17" y2="20.5" />
    <line x1="19.07" y1="19.07" x2="20.5" y2="17" />
    <line x1="19.07" y1="4.93" x2="20.5" y2="7" />
    <line x1="19.07" y1="4.93" x2="17" y2="3.5" />
    <line x1="4.93" y1="19.07" x2="3.5" y2="17" />
    <line x1="4.93" y1="19.07" x2="7" y2="20.5" />
  </svg>
);

export function LoginView() {
  const { signIn, loginLoading, loginError } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!email.trim() || !password) {
      return;
    }
    await signIn(email, password);
  }

  return (
    <div className="auth-page auth-page--login">
      <div className="auth-logo">{LOGO_SVG}</div>
      <h1 className="auth-title">CoolService CRM</h1>
      <p className="auth-subtitle">РефСервисДВ</p>

      <form className="auth-form" onSubmit={handleSubmit}>
        <input
          className="auth-input"
          type="email"
          placeholder="Email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={loginLoading}
        />
        <input
          className="auth-input"
          type="password"
          placeholder="Пароль"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={loginLoading}
        />
        <button className="auth-button" type="submit" disabled={loginLoading}>
          {loginLoading ? "Вход..." : "Войти"}
        </button>
        {loginError ? <div className="auth-error">{loginError}</div> : null}
      </form>
    </div>
  );
}
