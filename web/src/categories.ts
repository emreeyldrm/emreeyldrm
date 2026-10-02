import { Utensils, Coffee, Wine, Landmark, Palette, TreePine, Umbrella, BedDouble, Plane, MapPin, type LucideIcon } from 'lucide-react';
import type { Category } from './api';

export interface CategoryInfo { key: Category; title: string; color: string; tint: string; Icon: LucideIcon }

export const CATEGORIES: CategoryInfo[] = [
  { key: 'food', title: 'Yemek', color: '#C2610C', tint: '#FFF1E2', Icon: Utensils },
  { key: 'coffee', title: 'Kahve', color: '#8C5C38', tint: '#F4ECE6', Icon: Coffee },
  { key: 'bar', title: 'Bar', color: '#9E3359', tint: '#F9E8EE', Icon: Wine },
  { key: 'historic', title: 'Tarihi', color: '#2E7D5B', tint: '#E6F5EB', Icon: Landmark },
  { key: 'museum', title: 'Müze', color: '#8F6A00', tint: '#FBF1D6', Icon: Palette },
  { key: 'park', title: 'Park', color: '#3F7D22', tint: '#E9F5DF', Icon: TreePine },
  { key: 'beach', title: 'Plaj', color: '#0B7C8A', tint: '#DDF3F6', Icon: Umbrella },
  { key: 'hotel', title: 'Otel', color: '#5C54B3', tint: '#EAE8F7', Icon: BedDouble },
  { key: 'airport', title: 'Havalimanı', color: '#2F5F9E', tint: '#E1EBF7', Icon: Plane },
  { key: 'other', title: 'Diğer', color: '#55645C', tint: '#EEF1EF', Icon: MapPin },
];

export const categoryInfo = (k: string): CategoryInfo => CATEGORIES.find((c) => c.key === k) ?? CATEGORIES[CATEGORIES.length - 1];
