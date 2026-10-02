import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, type CommentVisibility, type PlaceComment, type PlaceDetail } from '../api';
import { useAuth } from '../auth';
import { categoryInfo } from '../categories';
import { Avatar, BackIcon, CatSvg, ErrorMsg, StarIcon, fmt, timeAgo } from '../components/Bits';

const VIS: { key: CommentVisibility; label: string }[] = [
  { key: 'private', label: 'Sadece ben' },
  { key: 'friends', label: 'Arkadaşlar' },
  { key: 'public', label: 'Herkes' },
];
const visLabel = (v: string) => VIS.find((x) => x.key === v)?.label ?? v;
const AV = ['#2E7D5B', '#C2610C', '#2F5F9E', '#9E3359', '#5C54B3'];
const avColor = (s: string) => AV[[...s].reduce((n, ch) => n + ch.charCodeAt(0), 0) % AV.length];

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
  const cat = categoryInfo(place.place.category);
  const total = Math.max(1, rating.count);
  const dist = (n: number) => rating.distribution.find((d) => d.stars === n)?.n ?? 0;

  return (
    <section className="place-page">
      <div className="hero" style={{ background: cat.tint }}>
        <Link to="/lists" className="round-back" aria-label="Geri"><BackIcon /></Link>
        <span className="hero-badge" style={{ background: cat.color }} data-testid="category-icon" data-category={cat.key}><CatSvg category={cat.key} size={26} /></span>
      </div>
      <h1 data-testid="place-title">{place.place.name}</h1>
      <p className="sub">{cat.title}{place.place.city ? ` · ${place.place.city}` : ''}</p>

      <div className="rating-block">
        <div className="big">
          <div className="big-num" data-testid="rating-avg">{fmt(rating.avg)}</div>
          <div className="row tight" aria-hidden="true">{[1, 2, 3, 4, 5].map((n) => <StarIcon key={n} size={14} filled={rating.avg !== null && n <= Math.round(rating.avg)} />)}</div>
          <div className="sub small"><span data-testid="rating-count">{rating.count}</span> puan</div>
        </div>
        <div className="bars" data-testid="rating-distribution">
          {[5, 4, 3, 2, 1].map((n) => (
            <div key={n} className="bar-row">{n}<div className="bar"><div style={{ width: `${Math.round((dist(n) / total) * 100)}%` }} /></div></div>
          ))}
        </div>
      </div>

      <div className="my-rating">
        <div className="h-green small-h">Senin puanın{rating.mine !== null && <span className="sr-only"> <span data-testid="rating-mine">{rating.mine}</span></span>}</div>
        <div className="row tight" role="group" aria-label="Puan ver" data-testid="rating-stars">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} className="icon-btn star" onClick={() => rate(n)} aria-label={`${n} yıldız ver`} aria-pressed={rating.mine === n} data-testid={`star-${n}`}>
              <StarIcon size={28} filled={rating.mine !== null && n <= rating.mine} />
            </button>
          ))}
        </div>
      </div>

      <h2 className="h-green">Yorumlar</h2>
      <ErrorMsg message={error} />
      {info && <p className="info" role="status" data-testid="info">{info}</p>}
      {comments.length === 0 ? <p className="muted" data-testid="comments-empty">Henüz yorum yok.</p> : (
        <ul className="comments" data-testid="comments">
          {comments.map((c) => {
            const own = !!user && String(c.authorId) === String(user.id);
            return (
              <li key={c.id} className="comment" data-testid="comment">
                <Avatar name={c.author} color={avColor(c.author)} />
                <div className="grow">
                  <div className="row between c-head">
                    <b>@{c.author}</b>
                    <span className="row tight">
                      <span className="muted small">{timeAgo(c.createdAt)}</span>
                      <span className={`badge vis-${c.visibility}`} data-testid="comment-badge">{visLabel(c.visibility)}</span>
                      <span className="menu-wrap">
                        <button className="icon-btn" aria-label="Yorum menüsü" aria-haspopup="menu" aria-expanded={menuFor === c.id} onClick={() => setMenuFor(menuFor === c.id ? null : c.id)} data-testid="comment-menu">
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="12" cy="19" r="1.8" /></svg>
                        </button>
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
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <form className="composer" onSubmit={post} data-testid="comment-form">
        <label className="vis-select">Kimler görebilir?
          <select value={vis} onChange={(e) => setVis(e.target.value as CommentVisibility)} data-testid="comment-visibility">
            {VIS.map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}
          </select>
        </label>
        <div className="row nowrap">
          <label className="grow">
            <span className="sr-only">Yorumun</span>
            <textarea rows={1} maxLength={1000} placeholder="Yorum yaz..." value={body} onChange={(e) => setBody(e.target.value)} data-testid="comment-body" />
          </label>
          <button className="send" type="submit" aria-label="Yorumu gönder" data-testid="comment-submit">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
          </button>
        </div>
      </form>
    </section>
  );
}
