import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, clearToken } from '../api';
import { useAuth } from '../auth';
import { ErrorMsg } from '../components/Bits';

export default function Profile() {
  const { user, signOut } = useAuth();
  const nav = useNavigate();
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function logout() { signOut(); nav('/login'); }

  async function del() {
    try {
      await api.deleteMe();
      clearToken();
      signOut();
      nav('/login');
    } catch (e) { setError((e as Error).message); }
  }

  if (!user) return null;
  return (
    <section>
      <h1>Profil</h1>
      <dl className="card profile">
        <dt>Kullanıcı adı</dt><dd data-testid="profile-handle">@{user.handle}</dd>
        <dt>E-posta</dt><dd data-testid="profile-email">{user.email}</dd>
      </dl>
      <div className="stack">
        <button className="btn" onClick={logout} data-testid="logout">Çıkış yap</button>
        <button className="btn danger" onClick={() => setConfirm(true)} data-testid="delete-account">Hesabı sil</button>
      </div>
      <ErrorMsg message={error} />
      {confirm && (
        <div className="overlay">
          <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="del-title" data-testid="delete-dialog">
            <h2 id="del-title">Hesabı sil</h2>
            <p>Hesabın, listelerin, puanların, yorumların ve takiplerin kalıcı olarak silinecek. Bu işlem geri alınamaz.</p>
            <div className="row">
              <button className="btn danger" onClick={del} data-testid="delete-confirm" autoFocus>Evet, hesabı sil</button>
              <button className="btn" onClick={() => setConfirm(false)} data-testid="delete-cancel">Vazgeç</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
