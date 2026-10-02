import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, type DiscoverList } from '../api';
import { Avatar, ErrorMsg, Stars } from '../components/Bits';

export default function Discover() {
  const [city, setCity] = useState('');
  const [results, setResults] = useState<DiscoverList[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function search(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try { setResults(await api.discover(city.trim())); } catch (err) { setError((err as Error).message); }
  }

  return (
    <section>
      <h1>Keşfet</h1>
      <p className="sub">Herkese açık listeleri şehre göre bul.</p>
      <form className="row search" onSubmit={search} role="search" data-testid="discover-form">
        <label className="grow">
          <span className="sr-only">Şehir</span>
          <span className="search-box">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>
            <input placeholder="Şehir ara (ör. İstanbul)" value={city} onChange={(e) => setCity(e.target.value)} data-testid="discover-city" />
          </span>
        </label>
        <button className="btn primary" type="submit" data-testid="discover-search">Ara</button>
      </form>
      <ErrorMsg message={error} />
      {results && (results.length === 0 ? <p className="muted" data-testid="discover-empty">Sonuç bulunamadı.</p> : (
        <>
        <h2 className="h-green">Sonuçlar</h2>
        <ul className="cards" data-testid="discover-results">
          {results.map((r) => (
            <li key={r.id}>
              <Link to={`/lists/${r.id}`} className="tile list-card" data-testid="discover-card">
                <span className="row author">
                  <Avatar name={r.ownerHandle} />
                  <span className="grow"><b>@{r.ownerHandle}</b><span className="city-sub">{r.city}</span></span>
                  <span className="pill-white">Herkese açık</span>
                </span>
                <strong className="title big" data-testid="discover-card-title">{r.title}</strong>
                <span className="meta">
                  <Stars value={r.avgStars} />
                  <span data-testid="discover-count">{r.itemCount} yer</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
        </>
      ))}
    </section>
  );
}
