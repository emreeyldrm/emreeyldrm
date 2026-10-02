import { Star } from 'lucide-react';
import { categoryInfo } from '../categories';

export function CategoryIcon({ category, size = 20 }: { category: string; size?: number }) {
  const c = categoryInfo(category);
  return (
    <span className="cat-icon" style={{ background: c.tint, color: c.color }} data-testid="category-icon" data-category={c.key} title={c.title}>
      <c.Icon size={size} aria-hidden />
    </span>
  );
}

export function Stars({ value }: { value: number | null }) {
  const v = value ?? 0;
  return (
    <span className="stars-static" aria-label={value === null ? 'Puan yok' : `${v.toFixed(1)} yıldız`}>
      <Star size={16} fill="#F28C28" stroke="#C2610C" aria-hidden />
      <span>{value === null ? '–' : v.toFixed(1)}</span>
    </span>
  );
}

export function ErrorMsg({ message }: { message: string | null }) {
  return message ? <p className="error" role="alert" data-testid="error">{message}</p> : null;
}
