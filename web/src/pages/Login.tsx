import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { ErrorMsg } from '../components/Bits';

export default function Login() {
  const { user, signIn } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to="/lists" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await api.login(email.trim(), password);
      signIn(r.token, r.user);
      nav('/lists');
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? 'E-posta veya parola hatalı.' : (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card form auth" onSubmit={submit} data-testid="login-form">
      <h1>Giriş yap</h1>
      <label>E-posta
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} data-testid="login-email" autoComplete="email" />
      </label>
      <label>Parola
        <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} data-testid="login-password" autoComplete="current-password" />
      </label>
      <ErrorMsg message={error} />
      <button className="btn primary" type="submit" disabled={busy} data-testid="login-submit">Giriş yap</button>
      <p className="muted">Hesabın yok mu? <Link to="/register" data-testid="goto-register">Kayıt ol</Link></p>
    </form>
  );
}
