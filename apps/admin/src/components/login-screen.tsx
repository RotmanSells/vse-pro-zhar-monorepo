import { useState } from "react";

import type { AdminAuthRequestController } from "@vse-pro-zhar/api-client";

interface LoginScreenProps {
  readonly controller: AdminAuthRequestController;
  readonly message?: string | undefined;
}

export function LoginScreen({ controller, message }: LoginScreenProps): React.JSX.Element {
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setSubmitting(true);
    try {
      await controller.login({ login, password });
    } catch {
      // The controller exposes a safe, user-facing error state.
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="login-page">
      <form className="login-card" onSubmit={(event) => void submit(event)}>
        <div className="sidebar-logo login-logo"><span aria-hidden="true">🔥</span><span>VPZ Admin</span></div>
        <p className="eyebrow">STAFF ACCESS</p>
        <h1>Вход в админ-панель</h1>
        <p className="login-subtitle">Используйте выданную учётную запись сотрудника.</p>
        {message !== undefined ? <div className="catalog-action-error" role="alert">{message}</div> : null}
        <label className="form-group">
          <span>Логин</span>
          <input autoComplete="username" onChange={(event) => setLogin(event.target.value)} required value={login} />
        </label>
        <label className="form-group">
          <span>Пароль</span>
          <input autoComplete="current-password" minLength={12} onChange={(event) => setPassword(event.target.value)} required type="password" value={password} />
        </label>
        <button className="btn btn-primary login-submit" disabled={submitting} type="submit">
          {submitting ? "Проверяем…" : "Войти"}
        </button>
      </form>
    </main>
  );
}
