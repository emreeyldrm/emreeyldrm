import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, type SocialUser } from '../api';
import { Avatar, BackIcon, ErrorMsg } from '../components/Bits';

function Row({ u, onToggle }: { u: SocialUser; onToggle: (u: SocialUser) => void }) {
  const mutual = u.following && u.followsMe;
  return (
    <li className="user-row row between" data-testid="user-row" data-handle={u.handle}>
      <span>
        <Avatar name={u.handle} size={36} /> <strong>@{u.handle}</strong>{' '}
        {mutual && <span className="badge friend" data-testid="friend-badge">Arkadaş</span>}
      </span>
      <button className={`btn small ${u.following ? '' : 'primary'}`} onClick={() => onToggle(u)} aria-label={`${u.following ? 'Takibi bırak' : 'Takip et'}: @${u.handle}`} data-testid={u.following ? 'unfollow' : 'follow'}>
        {u.following ? 'Takibi bırak' : 'Takip et'}
      </button>
    </li>
  );
}

export default function Friends() {
  const [term, setTerm] = useState('');
  const [searched, setSearched] = useState<string | null>(null);
  const [results, setResults] = useState<SocialUser[]>([]);
  const [following, setFollowing] = useState<SocialUser[]>([]);
  const [error, setError] = useState<string | null>(null);

  const loadFollowing = useCallback(() => { api.following().then(setFollowing).catch((e: Error) => setError(e.message)); }, []);
  useEffect(loadFollowing, [loadFollowing]);

  const runSearch = useCallback(async (t: string) => {
    try { setResults(await api.searchUsers(t)); } catch (e) { setError((e as Error).message); }
  }, []);

  async function search(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const t = term.trim().toLowerCase();
    if (t.length < 2) { setError('En az 2 karakter yaz.'); return; }
    setSearched(t);
    await runSearch(t);
  }

  async function toggle(u: SocialUser) {
    setError(null);
    try {
      if (u.following) await api.unfollow(u.id); else await api.follow(u.id);
      loadFollowing();
      if (searched) await runSearch(searched);
    } catch (e) { setError((e as Error).message); }
  }

  return (
    <section>
      <Link to="/profile" className="back"><BackIcon />Profil</Link>
      <h1>Arkadaşlar</h1>
      <form className="row search" onSubmit={search} role="search" data-testid="user-search-form">
        <label className="grow">
          <span className="sr-only">Kullanıcı adı</span>
          <input placeholder="Kullanıcı adı ara" value={term} onChange={(e) => setTerm(e.target.value)} data-testid="user-search" />
        </label>
        <button className="btn primary" type="submit" data-testid="user-search-submit">Ara</button>
      </form>
      <ErrorMsg message={error} />
      {searched !== null && (
        <>
          <h2 className="h-green">Sonuçlar</h2>
          {results.length === 0 ? <p className="muted" data-testid="search-empty">Kullanıcı bulunamadı.</p> : (
            <ul className="cards" data-testid="search-results">{results.map((u) => <Row key={u.id} u={u} onToggle={toggle} />)}</ul>
          )}
        </>
      )}
      <h2 className="h-green">Takip ettiklerim</h2>
      {following.length === 0 ? <p className="muted" data-testid="following-empty">Henüz kimseyi takip etmiyorsun.</p> : (
        <ul className="cards" data-testid="following-list">{following.map((u) => <Row key={u.id} u={u} onToggle={toggle} />)}</ul>
      )}
    </section>
  );
}
