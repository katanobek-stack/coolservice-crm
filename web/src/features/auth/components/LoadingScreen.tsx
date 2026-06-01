import "./auth.css";

export function LoadingScreen() {
  return (
    <div className="auth-page auth-page--center">
      <div className="auth-spinner" aria-label="Загрузка" />
    </div>
  );
}
