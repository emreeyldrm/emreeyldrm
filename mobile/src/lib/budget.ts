import { currencySymbol, DEFAULT_CURRENCY, fmtAmount, type PlaceDetails } from './details';

/**
 * Gezi bütçesi (AC-MOB-45): plan günlerindeki yerlerin kişi başı harcamalarından (`details.spendPerPerson` +
 * `details.currency`) günlük ve toplam tahmini bütçe. Para birimleri çevrilmez, her biri ayrı toplanır.
 */
export interface Budget {
  /** Para birimine göre toplamlar, en büyük toplam önce (eşitlikte koda göre). */
  totals: { currency: string; amount: number }[];
  /** Harcaması girilmemiş yer sayısı. */
  missing: number;
  /** Bütçeye katılan yer sayısı. */
  counted: number;
}

const hasSpend = (d: PlaceDetails | null | undefined): d is PlaceDetails & { spendPerPerson: number } =>
  !!d && typeof d.spendPerPerson === 'number' && Number.isFinite(d.spendPerPerson) && d.spendPerPerson >= 0;

const round2 = (n: number) => Math.round(n * 100) / 100;

function build(map: Map<string, number>, missing: number, counted: number): Budget {
  const totals = [...map.entries()]
    .map(([currency, amount]) => ({ currency, amount: round2(amount) }))
    .sort((a, b) => b.amount - a.amount || a.currency.localeCompare(b.currency));
  return { totals, missing, counted };
}

/** Bir günün (ya da herhangi bir yer kümesinin) bütçesi. Para birimi yoksa varsayılan (TRY) sayılır. */
export function computeBudget(details: (PlaceDetails | null | undefined)[]): Budget {
  const map = new Map<string, number>();
  let missing = 0;
  let counted = 0;
  for (const d of details) {
    if (!hasSpend(d)) { missing++; continue; }
    const cur = (d.currency || DEFAULT_CURRENCY).toUpperCase();
    map.set(cur, (map.get(cur) ?? 0) + d.spendPerPerson);
    counted++;
  }
  return build(map, missing, counted);
}

/** Günlük bütçelerin toplamı (gezi toplamı). */
export function sumBudgets(budgets: Budget[]): Budget {
  const map = new Map<string, number>();
  let missing = 0;
  let counted = 0;
  for (const b of budgets) {
    for (const t of b.totals) map.set(t.currency, (map.get(t.currency) ?? 0) + t.amount);
    missing += b.missing;
    counted += b.counted;
  }
  return build(map, missing, counted);
}

/** "~45 € + ~1.200 ₺" ya da boş metin (hiç harcama yoksa). */
export function formatBudget(b: Budget): string {
  return b.totals.map((t) => `~${fmtThousands(t.amount)} ${currencySymbol(t.currency)}`).join(' + ');
}

/** 1200 -> "1.200", 12.5 -> "12,5" (Türkçe binlik ayırıcı ve ondalık virgül). */
export function fmtThousands(n: number): string {
  const [int, frac] = fmtAmount(n).split(',');
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (frac ? `,${frac}` : '');
}

/** "2 yerin harcaması yok" (0 ise boş). */
export const missingNote = (n: number): string => (n > 0 ? `${n} yerin harcaması yok` : '');

/** Gün satırı: "Bütçe ~45 € · 1 yerin harcaması yok"; hiç yer yoksa boş. */
export function budgetLine(b: Budget): string {
  if (b.counted === 0 && b.missing === 0) return '';
  const amount = formatBudget(b);
  return [amount ? `Bütçe ${amount}` : 'Bütçe girilmedi', missingNote(b.missing)].filter(Boolean).join(' · ');
}
