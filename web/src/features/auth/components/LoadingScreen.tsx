import "./auth.css";

export function LoadingScreen() {
  return (
    <div className="auth-page">
      <div className="auth-spinner" aria-label="Загрузка" />
    </div>
  );
}
