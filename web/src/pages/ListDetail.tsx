import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
import { api, type Category, type ItemInput, type ListDetail } from '../api';
import { useAuth } from '../auth';
import { CATEGORIES, categoryInfo } from '../categories';
import { CategoryIcon, ErrorMsg } from '../components/Bits';

const toInput = (city: string, it: { name: string; lat: number | null; lon: number | null; category: Category; note: string | null }): ItemInput => {
  const out: ItemInput = {
    provider: 'voyage',
    providerId: `${it.name.toLowerCase()}@${city}`,
    name: it.name,
    category: it.category,
    city,
  };
  if (it.note) out.note = it.note;
  if (it.lat !== null && it.lat !== undefined) out.lat = it.lat;
  if (it.lon !== null && it.lon !== undefined) out.lon = it.lon;
  return out;
};

export default function ListDetailPage() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const [list, setList] = useState<ListDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Category | 'all'>('all');
  const [name, setName] = useState('');
  const [category, setCategory] = useState<Category>('food');
  const [note, setNote] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(() => {
    api.getList(id).then(setList).catch((e: Error) => setError(e.message));
  }, [id]);
  useEffect(load, [load]);

  const mine = !!list && !!user && list.ownerHandle === user.handle;
  const items = useMemo(() => (list ? [...list.items].sort((a, b) => a.position - b.position) : []), [list]);
  const visible = filter === 'all' ? items : items.filter((i) => i.category === filter);
  const usedCats = CATEGORIES.filter((c) => items.some((i) => i.category === c.key));

  async function save(next: ItemInput[]) {
    if (!list) return;
    setError(null);
    try {
      await api.putItems(list.id, next);
      load();
    } catch (err) { setError((err as Error).message); }
  }

  async function addPlace(e: FormEvent) {
    e.preventDefault();
    if (!list) return;
    if (!name.trim()) { setError('Yer adı gerekli.'); return; }
    const current = items.map((i) => toInput(list.city, i));
    const added: ItemInput = {
      provider: 'voyage',
      providerId: `${name.trim().toLowerCase()}@${list.city}`,
      name: name.trim(),
      category,
      city: list.city,
    };
    if (note.trim()) added.note = note.trim();
    await save([...current, added]);
    setName(''); setNote('');
  }

  async function removeItem(idx: number) {
    if (!list) return;
    await save(items.filter((_, i) => i !== idx).map((i) => toInput(list.city, i)));
  }

  async function setVisibility(v: 'private' | 'public') {
    if (!list || list.visibility === v) return;
    try { await api.patchList(list.id, { visibility: v }); load(); } catch (err) { setError((err as Error).message); }
  }

  async function remove() {
    if (!list) return;
    try { await api.deleteList(list.id); nav('/lists'); } catch (err) { setError((err as Error).message); }
  }

  if (!list) return error ? <><ErrorMsg message={error} /><Link to="/lists">Listelerime dön</Link></> : <p className="muted" role="status">Yükleniyor…</p>;

  return (
    <section>
      <Link to={mine ? '/lists' : '/discover'} className="back">← Geri</Link>
      <p className="city" data-testid="list-detail-city">{list.city}</p>
      <h1 data-testid="list-detail-title">{list.title}</h1>
      <p className="muted">Hazırlayan @{list.ownerHandle}</p>

      {mine && (
        <div className="row" data-testid="visibility-toggle" role="group" aria-label="Görünürlük">
          <button className={`seg ${list.visibility === 'private' ? 'on' : ''}`} aria-pressed={list.visibility === 'private'} onClick={() => setVisibility('private')} data-testid="visibility-private">Özel</button>
          <button className={`seg ${list.visibility === 'public' ? 'on' : ''}`} aria-pressed={list.visibility === 'public'} onClick={() => setVisibility('public')} data-testid="visibility-public">Herkese açık</button>
        </div>
      )}
      <ErrorMsg message={error} />

      {mine && (
        <form className="card form" onSubmit={addPlace} data-testid="add-place-form">
          <h2>Yer ekle</h2>
          <label>Yer adı
            <input value={name} onChange={(e) => setName(e.target.value)} data-testid="place-name" />
          </label>
          <label>Kategori
            <select value={category} onChange={(e) => setCategory(e.target.value as Category)} data-testid="place-category">
              {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.title}</option>)}
            </select>
          </label>
          <label>Not
            <input value={note} onChange={(e) => setNote(e.target.value)} data-testid="place-note" />
          </label>
          <button className="btn primary" type="submit" data-testid="place-add">Ekle</button>
        </form>
      )}

      <div className="chips" role="group" aria-label="Kategori filtresi" data-testid="category-filters">
        <button className={`chip ${filter === 'all' ? 'on' : ''}`} aria-pressed={filter === 'all'} onClick={() => setFilter('all')} data-testid="filter-all">Tümü ({items.length})</button>
        {usedCats.map((c) => (
          <button key={c.key} className={`chip ${filter === c.key ? 'on' : ''}`} aria-pressed={filter === c.key} onClick={() => setFilter(c.key)} data-testid={`filter-${c.key}`}
            style={filter === c.key ? { background: c.color, color: '#fff', borderColor: c.color } : { background: c.tint, color: c.color, borderColor: c.tint }}>
            <c.Icon size={14} aria-hidden /> {c.title}
          </button>
        ))}
      </div>

      {visible.length === 0 ? <p className="muted" data-testid="places-empty">Bu listede yer yok.</p> : (
        <ul className="cards" data-testid="place-items">
          {visible.map((it) => {
            const idx = items.indexOf(it);
            return (
              <li key={`${it.placeId}-${idx}`} className="card item" data-testid="place-item" data-category={it.category}>
                <CategoryIcon category={it.category} />
                <div className="grow">
                  <Link to={`/places/${it.placeId}`} className="place-link" data-testid="place-link"><strong style={{ color: categoryInfo(it.category).color }}>{it.name}</strong></Link>
                  <div className="muted small">{categoryInfo(it.category).title}</div>
                  {it.note && <div className="note" data-testid="place-item-note">{it.note}</div>}
                </div>
                {mine && <button className="icon-btn" aria-label={`${it.name} yerini listeden çıkar`} onClick={() => removeItem(idx)} data-testid="place-remove"><Trash2 size={18} aria-hidden /></button>}
              </li>
            );
          })}
        </ul>
      )}

      {mine && (
        <div className="danger-zone">
          {!confirmDelete ? (
            <button className="btn danger" onClick={() => setConfirmDelete(true)} data-testid="list-delete">Listeyi sil</button>
          ) : (
            <div role="alertdialog" aria-label="Listeyi sil" className="card">
              <p>Bu liste ve içindeki yerler silinecek. Emin misin?</p>
              <div className="row">
                <button className="btn danger" onClick={remove} data-testid="list-delete-confirm">Evet, sil</button>
                <button className="btn" onClick={() => setConfirmDelete(false)}>Vazgeç</button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
