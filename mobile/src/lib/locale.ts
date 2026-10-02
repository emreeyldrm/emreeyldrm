/** Cihaz dili (2 harf, ör. "tr", "en"). Arama sonuçlarının adları destekleniyorsa bu dilde gelir. */
export function deviceLanguage(): string {
  try {
    const tag = Intl.DateTimeFormat().resolvedOptions().locale || 'tr';
    const lang = tag.slice(0, 2).toLowerCase();
    return /^[a-z]{2}$/.test(lang) ? lang : 'tr';
  } catch {
    return 'tr';
  }
}
