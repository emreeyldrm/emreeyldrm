import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Globe, Lock } from 'lucide-react';
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
      <form className="card form" onSubmit={create} data-testid="create-list-form">
        <h2>Yeni liste</h2>
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
              <Link className="card list-card" to={`/lists/${l.id}`} data-testid="list-card">
                <span className="city">{l.city}</span>
                <strong className="title" data-testid="list-card-title">{l.title}</strong>
                <span className="meta">
                  <span>{l.itemCount} yer</span>
                  <span className={`badge ${l.visibility}`}>
                    {l.visibility === 'public' ? <Globe size={12} aria-hidden /> : <Lock size={12} aria-hidden />}
                    {l.visibility === 'public' ? 'Herkese açık' : 'Özel'}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
