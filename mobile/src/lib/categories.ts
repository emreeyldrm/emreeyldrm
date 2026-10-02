import type { Category } from './api';

export interface CategoryInfo { key: Category; title: string; color: string; tint: string; paths: string[] }

/**
 * Ported from Voyage/Models/PlaceCategory.swift and docs/design/Theme.dc.html:
 * `color` = dark tone (icon, text, map pin fill), `tint` = light tone (icon circle, chip background).
 */
export const CATEGORIES: CategoryInfo[] = [
  { key: 'food', title: 'Yemek', color: '#C2610C', tint: '#FFF1E2', paths: ['M7 3v7a2 2 0 0 0 2 2v9M11 3v7a2 2 0 0 1-2 2M9 3v6', 'M17 3c-2 1.5-3 4-3 7h3v11'] },
  { key: 'coffee', title: 'Kahve', color: '#8C5C38', tint: '#F4ECE6', paths: ['M5 8h11v6a5 5 0 0 1-5 5H10a5 5 0 0 1-5-5V8z', 'M16 10h2a2 2 0 0 1 0 4h-2', 'M8 3v2M12 3v2'] },
  { key: 'bar', title: 'Bar', color: '#9E3359', tint: '#F9E8EE', paths: ['M8 3h8l-.5 6a3.5 3.5 0 0 1-7 0L8 3z', 'M12 12.5V20M8.5 20h7'] },
  { key: 'historic', title: 'Tarihi', color: '#2E7D5B', tint: '#E6F5EB', paths: ['M3 9l9-5 9 5H3z', 'M5 11v7M10 11v7M14 11v7M19 11v7M3 20h18'] },
  { key: 'museum', title: 'Müze', color: '#8F6A00', tint: '#FBF1D6', paths: ['M12 3a9 9 0 1 0 0 18c1.5 0 2-1 1.5-2s0-2 1.5-2h2a3 3 0 0 0 3-3c0-5-4-11-8-11z', 'M8 11h.01M12 7.5h.01M16 10h.01'] },
  { key: 'park', title: 'Park', color: '#3F7D22', tint: '#E9F5DF', paths: ['M12 21v-5', 'M12 3c4 0 6 3 5 6 2 1 2 5-1 6H8c-3-1-3-5-1-6-1-3 1-6 5-6z'] },
  { key: 'beach', title: 'Plaj', color: '#0B7C8A', tint: '#DDF3F6', paths: ['M3 12a9 9 0 0 1 18 0H3z', 'M12 12v8M9 20h6'] },
  { key: 'hotel', title: 'Otel', color: '#5C54B3', tint: '#EAE8F7', paths: ['M3 18V7M3 14h18v4M21 14v-2a3 3 0 0 0-3-3h-7v5', 'M8.5 11h.01'] },
  { key: 'airport', title: 'Havalimanı', color: '#2F5F9E', tint: '#E1EBF7', paths: ['M21 15l-8-4V5.5a1.5 1.5 0 0 0-3 0V11l-8 4v2l8-2v3.5l-2 1.5v1.5l3.5-1 3.5 1V20l-2-1.5V15l8 2z'] },
  { key: 'other', title: 'Diğer', color: '#55645C', tint: '#EEF1EF', paths: ['M12 21s7-6.5 7-12a7 7 0 0 0-14 0c0 5.5 7 12 7 12z', 'M12 9h.01'] },
];

export const categoryInfo = (k: string): CategoryInfo =>
  CATEGORIES.find((c) => c.key === k) ?? CATEGORIES[CATEGORIES.length - 1];
