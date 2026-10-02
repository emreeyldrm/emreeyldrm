import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import { api, type DiscoverList } from '../api';
import { ErrorMsg, Stars } from '../components/Bits';

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
      <form className="row search" onSubmit={search} role="search" data-testid="discover-form">
        <label className="grow">
          <span className="sr-only">Şehir</span>
          <input placeholder="Şehir ara (ör. İstanbul)" value={city} onChange={(e) => setCity(e.target.value)} data-testid="discover-city" />
        </label>
        <button className="btn primary" type="submit" data-testid="discover-search"><Search size={16} aria-hidden /> Ara</button>
      </form>
      <ErrorMsg message={error} />
      {results && (results.length === 0 ? <p className="muted" data-testid="discover-empty">Sonuç bulunamadı.</p> : (
        <ul className="cards" data-testid="discover-results">
          {results.map((r) => (
            <li key={r.id}>
              <Link to={`/lists/${r.id}`} className="card list-card" data-testid="discover-card">
                <span className="city">{r.city}</span>
                <strong className="title" data-testid="discover-card-title">{r.title}</strong>
                <span className="meta">
                  <span>@{r.ownerHandle}</span>
                  <span data-testid="discover-count">{r.itemCount} yer</span>
                  <Stars value={r.avgStars} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ))}
    </section>
  );
}
