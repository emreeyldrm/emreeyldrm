import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, type ListSummary } from '../api';
import { ErrorMsg } from '../components/Bits';

export default function Lists() {
  const [lists, setLists] = useState<ListSummary[] | null>(null);
  const [city, setCity] = useState('');
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.myLists().then(setLists).catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!city.trim() || !title.trim()) { setError('Şehir ve başlık gerekli.'); return; }
    try {
      await api.createList(city.trim(), title.trim());
      setCity(''); setTitle('');
      load();
    } catch (err) { setError((err as Error).message); }
  }

  return (
    <section>
      <h1>Listelerim</h1>
      <p className="sub" data-testid="lists-summary">{lists ? `${lists.length} liste · ${lists.reduce((n, l) => n + l.itemCount, 0)} kayıtlı yer` : ' '}</p>
      <form className="panel form" onSubmit={create} data-testid="create-list-form">
        <h2 className="h-green">Yeni liste</h2>
        <label>Şehir
          <input value={city} onChange={(e) => setCity(e.target.value)} data-testid="list-city" />
        </label>
        <label>Başlık
          <input value={title} onChange={(e) => setTitle(e.target.value)} data-testid="list-title" />
        </label>
        <ErrorMsg message={error} />
        <button className="btn primary" type="submit" data-testid="list-create">Liste oluştur</button>
      </form>
      {lists === null ? <p className="muted" role="status">Yükleniyor…</p> : lists.length === 0 ? (
        <p className="muted" data-testid="lists-empty">Henüz listen yok. Yukarıdan ilk şehir listeni oluştur.</p>
      ) : (
        <ul className="cards" data-testid="list-cards">
          {lists.map((l) => (
            <li key={l.id}>
              <Link className="tile list-card" to={`/lists/${l.id}`} data-testid="list-card">
                <span className="row between">
                  <span>
                    <strong className="title" data-testid="list-card-title">{l.title}</strong>
                    <span className="city-sub">{l.city}</span>
                  </span>
                  <span className="pill-white">{l.itemCount} yer</span>
                </span>
                <span className="meta">
                  <span className={`pill-white ${l.visibility}`}>{l.visibility === 'public' ? 'Herkese açık' : 'Özel'}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
