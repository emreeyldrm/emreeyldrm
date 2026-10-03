import { expect, test } from '@playwright/test';
import { budgetLine, computeBudget, fmtThousands, formatBudget, missingNote, sumBudgets } from '../src/lib/budget';

// Node-only (no browser).
test.describe('AC-MOB-45: gezi bütçesi', () => {
  test('günlük toplam para birimine göre ayrı; harcaması olmayan yerler sayılır', () => {
    const b = computeBudget([
      { spendPerPerson: 25, currency: 'EUR' },
      { spendPerPerson: 12.5, currency: 'EUR' },
      { dineIn: true },
      undefined,
      { spendPerPerson: 600, currency: 'TRY' },
      { spendPerPerson: 0, currency: 'EUR' },
    ]);
    expect(b).toEqual({ totals: [{ currency: 'TRY', amount: 600 }, { currency: 'EUR', amount: 37.5 }], missing: 2, counted: 4 });
    expect(formatBudget(b)).toBe('~600 ₺ + ~37,5 €');
    expect(budgetLine(b)).toBe('Bütçe ~600 ₺ + ~37,5 € · 2 yerin harcaması yok');
  });

  test('para birimi yoksa TRY; küçük harf kod büyütülür; geçersiz tutar sayılmaz', () => {
    const b = computeBudget([{ spendPerPerson: 100 }, { spendPerPerson: 50, currency: 'try' }, { spendPerPerson: Number.NaN, currency: 'EUR' }]);
    expect(b.totals).toEqual([{ currency: 'TRY', amount: 150 }]);
    expect(b.missing).toBe(1);
  });

  test('gezi toplamı günlerin toplamıdır', () => {
    const d1 = computeBudget([{ spendPerPerson: 20, currency: 'EUR' }, {}]);
    const d2 = computeBudget([{ spendPerPerson: 15.25, currency: 'EUR' }, { spendPerPerson: 1200, currency: 'TRY' }]);
    const total = sumBudgets([d1, d2, computeBudget([])]);
    expect(total).toEqual({ totals: [{ currency: 'TRY', amount: 1200 }, { currency: 'EUR', amount: 35.25 }], missing: 1, counted: 3 });
    expect(formatBudget(total)).toBe('~1.200 ₺ + ~35,25 €');
  });

  test('boş gün ve hiç harcama girilmemiş gün', () => {
    expect(budgetLine(computeBudget([]))).toBe('');
    expect(budgetLine(computeBudget([{}, {}]))).toBe('Bütçe girilmedi · 2 yerin harcaması yok');
    expect(missingNote(0)).toBe('');
    expect(missingNote(1)).toBe('1 yerin harcaması yok');
  });

  test('binlik ayırıcı ve ondalık virgül; bilinmeyen birim kodla yazılır', () => {
    expect(fmtThousands(1234567)).toBe('1.234.567');
    expect(fmtThousands(999)).toBe('999');
    expect(fmtThousands(1500.5)).toBe('1.500,5');
    expect(formatBudget(computeBudget([{ spendPerPerson: 40, currency: 'CHF' }]))).toBe('~40 CHF');
  });
});
