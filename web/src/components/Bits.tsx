import { categoryInfo } from '../categories';

export function CatSvg({ category, size = 20 }: { category: string; size?: number }) {
  const c = categoryInfo(category);
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {c.paths.map((d) => <path key={d} d={d} />)}
    </svg>
  );
}

export function CategoryIcon({ category, size = 22, box = 44 }: { category: string; size?: number; box?: number }) {
  const c = categoryInfo(category);
  return (
    <span className="cat-icon" style={{ background: c.tint, color: c.color, width: box, height: box }} data-testid="category-icon" data-category={c.key} title={c.title}>
      <CatSvg category={c.key} size={size} />
    </span>
  );
}

const STAR = 'M12 2.5l2.9 6.4 6.6.7-5 4.6 1.5 6.8-6-3.4-6 3.4 1.5-6.8-5-4.6 6.6-.7z';
export function StarIcon({ size = 16, filled = true }: { size?: number; filled?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? '#F28C28' : '#C9D8CF'} aria-hidden="true" focusable="false"><path d={STAR} /></svg>
  );
}

export const fmt = (n: number | null): string => (n === null ? '–' : n.toFixed(1).replace('.', ','));

export function Stars({ value }: { value: number | null }) {
  return (
    <span className="stars-static" aria-label={value === null ? 'Puan yok' : `${fmt(value)} yıldız`}>
      <StarIcon size={14} />
      <b>{fmt(value)}</b>
    </span>
  );
}

export function Avatar({ name, color = '#2E7D5B', size = 36 }: { name: string; color?: string; size?: number }) {
  return <span className="avatar" style={{ background: color, width: size, height: size, fontSize: size * 0.42 }} aria-hidden="true">{(name[0] ?? '?').toUpperCase()}</span>;
}

export function ErrorMsg({ message }: { message: string | null }) {
  return message ? <p className="error" role="alert" data-testid="error">{message}</p> : null;
}

export function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'şimdi';
  if (s < 3600) return `${Math.floor(s / 60)} dk önce`;
  if (s < 86400) return `${Math.floor(s / 3600)} sa önce`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} gün önce`;
  return `${Math.floor(s / (7 * 86400))} hafta önce`;
}

export const BackIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
);
