import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Star, MoreVertical, Globe, Lock, Users } from 'lucide-react';
import { api, type CommentVisibility, type PlaceComment, type PlaceDetail } from '../api';
import { useAuth } from '../auth';
import { CategoryIcon, ErrorMsg } from '../components/Bits';

const VIS: { key: CommentVisibility; label: string }[] = [
  { key: 'private', label: 'Sadece ben' },
  { key: 'friends', label: 'Arkadaşlar' },
  { key: 'public', label: 'Herkes' },
];
const visLabel = (v: string) => VIS.find((x) => x.key === v)?.label ?? v;
const VisIcon = ({ v }: { v: CommentVisibility }) => (v === 'private' ? <Lock size={12} aria-hidden /> : v === 'friends' ? <Users size={12} aria-hidden /> : <Globe size={12} aria-hidden />);

export default function Place() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const [place, setPlace] = useState<PlaceDetail | null>(null);
  const [comments, setComments] = useState<PlaceComment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [vis, setVis] = useState<CommentVisibility>('public');
  const [menuFor, setMenuFor] = useState<string | number | null>(null);

  const loadPlace = useCallback(() => { api.getPlace(id).then(setPlace).catch((e: Error) => setError(e.message)); }, [id]);
  const loadComments = useCallback(() => { api.comments(id).then(setComments).catch((e: Error) => setError(e.message)); }, [id]);
  useEffect(() => { loadPlace(); loadComments(); }, [loadPlace, loadComments]);

  async function rate(n: number) {
    setError(null);
    try { await api.rate(id, n); loadPlace(); } catch (e) { setError((e as Error).message); }
  }

  async function post(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!body.trim()) { setError('Yorum boş olamaz.'); return; }
    try { await api.addComment(id, body.trim(), vis); setBody(''); loadComments(); } catch (err) { setError((err as Error).message); }
  }

  async function act(fn: () => Promise<unknown>, msg?: string) {
    setMenuFor(null); setError(null);
    try { await fn(); if (msg) setInfo(msg); loadComments(); } catch (e) { setError((e as Error).message); }
  }

  if (!place) return error ? <ErrorMsg message={error} /> : <p className="muted" role="status">Yükleniyor…</p>;
  const { rating } = place;

  return (
    <section>
      <Link to="/lists" className="back">← Listelerim</Link>
      <div className="row place-head">
        <CategoryIcon category={place.place.category} size={24} />
        <div>
          <h1 data-testid="place-title">{place.place.name}</h1>
          {place.place.city && <p className="muted">{place.place.city}</p>}
        </div>
      </div>

      <div className="card">
        <h2>Puanın</h2>
        <div className="row" role="group" aria-label="Puan ver" data-testid="rating-stars">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} className="icon-btn star" onClick={() => rate(n)} aria-label={`${n} yıldız ver`} aria-pressed={rating.mine === n} data-testid={`star-${n}`}>
              <Star size={30} aria-hidden fill={rating.mine !== null && n <= rating.mine ? '#F28C28' : 'none'} stroke={rating.mine !== null && n <= rating.mine ? '#C2610C' : '#55645C'} />
            </button>
          ))}
        </div>
        <p data-testid="rating-summary">
          Ortalama <strong data-testid="rating-avg">{rating.avg === null ? '–' : rating.avg.toFixed(1)}</strong>
          {' · '}<span data-testid="rating-count">{rating.count}</span> puan
          {rating.mine !== null && <> · Senin puanın <span data-testid="rating-mine">{rating.mine}</span></>}
        </p>
      </div>

      <h2>Yorumlar</h2>
      <form className="card form" onSubmit={post} data-testid="comment-form">
        <label>Yorumun
          <textarea rows={3} maxLength={1000} value={body} onChange={(e) => setBody(e.target.value)} data-testid="comment-body" />
        </label>
        <label>Kimler görebilir?
          <select value={vis} onChange={(e) => setVis(e.target.value as CommentVisibility)} data-testid="comment-visibility">
            {VIS.map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}
          </select>
        </label>
        <button className="btn primary" type="submit" data-testid="comment-submit">Yorum yap</button>
      </form>
      <ErrorMsg message={error} />
      {info && <p className="info" role="status" data-testid="info">{info}</p>}

      {comments.length === 0 ? <p className="muted" data-testid="comments-empty">Henüz yorum yok.</p> : (
        <ul className="cards" data-testid="comments">
          {comments.map((c) => {
            const own = !!user && String(c.authorId) === String(user.id);
            return (
              <li key={c.id} className="card comment" data-testid="comment">
                <div className="row between">
                  <strong>@{c.author}</strong>
                  <span className="row">
                    <span className={`badge vis-${c.visibility}`} data-testid="comment-badge"><VisIcon v={c.visibility} />{visLabel(c.visibility)}</span>
                    <span className="menu-wrap">
                      <button className="icon-btn" aria-label="Yorum menüsü" aria-haspopup="menu" aria-expanded={menuFor === c.id} onClick={() => setMenuFor(menuFor === c.id ? null : c.id)} data-testid="comment-menu"><MoreVertical size={18} aria-hidden /></button>
                      {menuFor === c.id && (
                        <div className="menu" role="menu">
                          {own ? (
                            <button role="menuitem" onClick={() => act(() => api.deleteComment(c.id))} data-testid="comment-delete">Sil</button>
                          ) : (<>
                            <button role="menuitem" onClick={() => act(() => api.report('comment', c.id, 'Uygunsuz içerik'), 'Şikayetin alındı.')} data-testid="comment-report">Şikayet et</button>
                            <button role="menuitem" onClick={() => act(() => api.block(c.authorId), `@${c.author} engellendi.`)} data-testid="comment-block">Engelle</button>
                          </>)}
                        </div>
                      )}
                    </span>
                  </span>
                </div>
                <p className="body" data-testid="comment-text">{c.body}</p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
