import { FormEvent, useState } from "react";
import { useAuth } from "../context/AuthProvider";
import type { StaffRole } from "../../../shared/types/staff";
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

const ROLE_OPTIONS: { value: StaffRole; label: string }[] = [
  { value: "admin", label: "Админ" },
  { value: "manager", label: "Менеджер" },
  { value: "mechanic", label: "Механик" },
];

export function SetupView() {
  const { saveProfile, signOutUser } = useAuth();
  const [name, setName] = useState("");
  const [role, setRole] = useState<StaffRole>("mechanic");
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
      await saveProfile(name, role);
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
        <select
          className="auth-input"
          value={role}
          onChange={(event) => setRole(event.target.value as StaffRole)}
          disabled={saving}
        >
          {ROLE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
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
