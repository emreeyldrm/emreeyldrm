import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type Category, type ItemInput, type ListDetail } from '../api';
import { useAuth } from '../auth';
import { CATEGORIES, categoryInfo } from '../categories';
import { BackIcon, CatSvg, CategoryIcon, ErrorMsg } from '../components/Bits';

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

const Switch = ({ on, label, sub, onChange, testid }: { on: boolean; label: string; sub: string; onChange: () => void; testid: string }) => (
  <div className="switch-row">
    <div><div className="sw-label">{label}</div><div className="sw-sub">{sub}</div></div>
    <button type="button" role="switch" aria-checked={on} aria-label={label} className={`switch ${on ? 'on' : ''}`} onClick={onChange} data-testid={testid}><span /></button>
  </div>
);

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

  async function patch(p: Parameters<typeof api.patchList>[1]) {
    if (!list) return;
    try { await api.patchList(list.id, p); load(); } catch (err) { setError((err as Error).message); }
  }

  async function remove() {
    if (!list) return;
    try { await api.deleteList(list.id); nav('/lists'); } catch (err) { setError((err as Error).message); }
  }

  if (!list) return error ? <><ErrorMsg message={error} /><Link to="/lists">Listelerime dön</Link></> : <p className="muted" role="status">Yükleniyor…</p>;

  return (
    <section>
      <Link to={mine ? '/lists' : '/discover'} className="back"><BackIcon />{mine ? 'Listelerim' : 'Keşfet'}</Link>
      <h1 data-testid="list-detail-city">{list.city}</h1>
      <p className="sub"><span data-testid="list-detail-title">{list.title}</span> · @{list.ownerHandle} · {items.length} yer</p>

      <div className="segmented" role="tablist" aria-label="Görünüm">
        <span role="tab" aria-selected="true" className="seg-on">Liste</span>
      </div>

      {mine && (
        <>
          <h2 className="h-green">Kim görebilir?</h2>
          <div className="radio-cards" role="group" aria-label="Görünürlük" data-testid="visibility-toggle">
            <button type="button" className={`radio-card ${list.visibility === 'private' ? 'on' : ''}`} aria-pressed={list.visibility === 'private'} onClick={() => patch({ visibility: 'private' })} data-testid="visibility-private">
              <span className="ic" style={{ background: '#EEF1EF', color: '#55645C' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
              </span>
              <span className="grow"><b>Özel</b><small>Sadece sen</small></span>
              <span className="radio-dot" aria-hidden="true" />
            </button>
            <button type="button" className="radio-card" disabled aria-disabled="true" data-testid="visibility-friends">
              <span className="ic" style={{ background: '#FFF1E2', color: '#C2610C' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.7-3.5 3.2-5 6.5-5s5.8 1.5 6.5 5" /></svg>
              </span>
              <span className="grow"><b>Arkadaşlar</b><small>Yakında</small></span>
              <span className="radio-dot" aria-hidden="true" />
            </button>
            <button type="button" className={`radio-card ${list.visibility === 'public' ? 'on' : ''}`} aria-pressed={list.visibility === 'public'} onClick={() => patch({ visibility: 'public' })} data-testid="visibility-public">
              <span className="ic" style={{ background: '#E6F5EB', color: '#2E7D5B' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" /></svg>
              </span>
              <span className="grow"><b>Herkese açık</b><small>Keşfet'te görünür, herkes yorum yapabilir</small></span>
              <span className="radio-dot" aria-hidden="true" />
            </button>
          </div>
          <Switch on={list.allowCopy} label="Başkaları kopyalayabilsin" sub="Kendi listesine ekleyebilir" onChange={() => patch({ allowCopy: !list.allowCopy })} testid="toggle-allow-copy" />
          <Switch on={list.allowComments} label="Yorumlara izin ver" sub="Liste ve yerler altında" onChange={() => patch({ allowComments: !list.allowComments })} testid="toggle-allow-comments" />
        </>
      )}
      <ErrorMsg message={error} />

      {mine && (
        <form className="panel form" onSubmit={addPlace} data-testid="add-place-form">
          <h2 className="h-green">Yer ekle</h2>
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
          <button className="btn accent" type="submit" data-testid="place-add">Ekle</button>
        </form>
      )}

      <div className="chips" role="group" aria-label="Kategori filtresi" data-testid="category-filters">
        <button className={`chip all ${filter === 'all' ? 'on' : ''}`} aria-pressed={filter === 'all'} onClick={() => setFilter('all')} data-testid="filter-all">Hepsi ({items.length})</button>
        {usedCats.map((c) => (
          <button key={c.key} className={`chip ${filter === c.key ? 'on' : ''}`} aria-pressed={filter === c.key} onClick={() => setFilter(c.key)} data-testid={`filter-${c.key}`}
            style={filter === c.key ? { background: c.color, color: '#fff' } : { background: c.tint, color: c.color }}>
            <CatSvg category={c.key} size={16} />{c.title}
          </button>
        ))}
      </div>

      {visible.length === 0 ? <p className="muted" data-testid="places-empty">Bu listede yer yok.</p> : (
        <ul className="rows" data-testid="place-items">
          {visible.map((it) => {
            const idx = items.indexOf(it);
            return (
              <li key={`${it.placeId}-${idx}`} className="place-row" data-testid="place-item" data-category={it.category}>
                <CategoryIcon category={it.category} />
                <div className="grow">
                  <Link to={`/places/${it.placeId}`} className="place-link" data-testid="place-link">{it.name}</Link>
                  <div className="note">{it.note ? <span data-testid="place-item-note">{it.note}</span> : categoryInfo(it.category).title}</div>
                </div>
                {mine && (
                  <button className="icon-btn" aria-label={`${it.name} yerini listeden çıkar`} onClick={() => removeItem(idx)} data-testid="place-remove">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>
                  </button>
                )}
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
            <div role="alertdialog" aria-label="Listeyi sil" className="panel">
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
