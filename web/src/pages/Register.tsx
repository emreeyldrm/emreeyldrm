import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { ErrorMsg } from '../components/Bits';

export default function Register() {
  const { user, signIn } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [handle, setHandle] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to="/lists" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^[a-z0-9_]{3,20}$/.test(handle)) {
      setError('Kullanıcı adı 3-20 karakter olmalı; yalnızca küçük harf, rakam ve alt çizgi.');
      return;
    }
    if (password.length < 8) {
      setError('Parola en az 8 karakter olmalı.');
      return;
    }
    setBusy(true);
    try {
      const r = await api.register(email.trim(), password, handle);
      signIn(r.token, r.user);
      nav('/lists');
    } catch (err) {
      setError(err instanceof ApiError && err.status === 409 ? 'Bu e-posta veya kullanıcı adı zaten kullanılıyor.' : (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card form auth" onSubmit={submit} data-testid="register-form" noValidate>
      <h1>Kayıt ol</h1>
      <label>E-posta
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} data-testid="register-email" autoComplete="email" />
      </label>
      <label>Kullanıcı adı
        <input required value={handle} onChange={(e) => setHandle(e.target.value)} data-testid="register-handle" autoComplete="username" />
      </label>
      <label>Parola (en az 8 karakter)
        <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} data-testid="register-password" autoComplete="new-password" />
      </label>
      <ErrorMsg message={error} />
      <button className="btn primary" type="submit" disabled={busy} data-testid="register-submit">Kayıt ol</button>
      <p className="muted">Zaten hesabın var mı? <Link to="/login" data-testid="goto-login">Giriş yap</Link></p>
    </form>
  );
}
