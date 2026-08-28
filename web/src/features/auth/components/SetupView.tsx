import { FormEvent, useState } from "react";
import { useAuth } from "../context/AuthProvider";
import "./auth.css";

const PROFILE_ICON = (
  <svg
    width="32"
    height="32"
    viewBox="0 0 24 24"
    fill="none"
    stroke="#185FA5"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <circle cx="12" cy="8" r="4" />
    <path d="M20 21a8 8 0 10-16 0" />
  </svg>
);

export function SetupView() {
  const { saveProfile, signOutUser } = useAuth();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      return;
    }

    setSaving(true);
    setError("");

    try {
      await saveProfile(name);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Не удалось сохранить профиль",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="auth-page auth-page--setup">
      <div className="auth-setup-icon">{PROFILE_ICON}</div>
      <h1 className="auth-setup-title">Настройка профиля</h1>
      <p className="auth-setup-subtitle">Введите имя для системы</p>

      <form className="auth-form" onSubmit={handleSubmit}>
        <input
          className="auth-input"
          placeholder="Ваше имя"
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={saving}
        />
        <div className="auth-setup-subtitle">Новый профиль будет создан с ролью «Механик»</div>
        <button className="auth-button" type="submit" disabled={saving}>
          {saving ? "Сохранение..." : "Сохранить"}
        </button>
        <button
          className="auth-link-button"
          type="button"
          onClick={() => void signOutUser()}
          disabled={saving}
        >
          Выйти
        </button>
        {error ? <div className="auth-error">{error}</div> : null}
      </form>
    </div>
  );
}
