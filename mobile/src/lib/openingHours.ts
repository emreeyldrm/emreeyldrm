/**
 * OSM `opening_hours` ayrıştırıcı ve "şimdi açık mı?" hesabı (AC-MOB-44). Saf modül: saat ve saat dilimi dışarıdan
 * verilir (`localClock`), böylece birim testleri ve Playwright'ın sabit saati deterministiktir.
 *
 * Desteklenen sözdizimi (OSM'de en yaygın biçimler):
 *   `24/7` · `Mo-Fr 09:00-18:00; Sa 10:00-14:00; Su off` · `Mo,We,Fr 10:00-12:00,14:00-18:00` · sarmal gün aralığı
 *   `Fr-Mo` · gece yarısını aşan aralık `18:00-02:00` (ve `24:00`, `26:00` gibi) · gün belirtmeyen kural `10:00-20:00`
 *   (her gün) · `off` / `closed` · sonraki kural aynı günleri ezer (OSM kuralı) · `Mo 10:00-12:00, Tu 14:00-16:00`
 *   (ek kural, ezmez) · `PH`/`SH` (resmî/okul tatili) kuralları ve gün listesindeki `PH` yok sayılır.
 * Desteklenmeyen (ay, hafta numarası, `sunrise`, açık uçlu `10:00+`, yorumlar "…"): sonuç `null`, rozet gösterilmez
 * (yanlış rozet göstermektense hiç göstermemek).
 */

/** Dakika cinsinden aralık; `end` 1440'ı aşabilir (gece yarısını aşan aralık). */
export interface TimeRange { start: number; end: number }
/** Pazartesi (0) … Pazar (6). */
export type Week = TimeRange[][];

export const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'] as const;
const DAY_INDEX: Record<string, number> = Object.fromEntries(DAYS.map((d, i) => [d, i]));
const WEEK_MIN = 7 * 1440;

const emptyWeek = (): Week => DAYS.map(() => []);

function parseTime(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 48 || min > 59) return null;
  return h * 60 + min;
}

function parseTimes(text: string): TimeRange[] | null {
  const out: TimeRange[] = [];
  for (const part of text.split(',')) {
    const m = /^\s*(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\s*$/.exec(part);
    if (!m) return null;
    const start = parseTime(m[1]);
    let end = parseTime(m[2]);
    if (start === null || end === null || start >= 1440) return null;
    if (end <= start) end += 1440; // 18:00-02:00: ertesi gün 02:00'ye kadar
    out.push({ start, end });
  }
  return out;
}

/** "Mo-Fr,Su" -> gün indeksleri; PH/SH atılır (yalnızca PH/SH ise boş dizi). Tanınmayan -> null. */
function parseDays(text: string): number[] | null {
  const days = new Set<number>();
  for (const raw of text.split(',')) {
    const part = raw.trim();
    if (part === 'PH' || part === 'SH') continue;
    const m = /^(Mo|Tu|We|Th|Fr|Sa|Su)(?:-(Mo|Tu|We|Th|Fr|Sa|Su))?$/.exec(part);
    if (!m) return null;
    const a = DAY_INDEX[m[1]];
    const b = m[2] ? DAY_INDEX[m[2]] : a;
    for (let i = a; ; i = (i + 1) % 7) {
      days.add(i);
      if (i === b) break;
    }
  }
  return [...days];
}

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const SELECTOR = /^((?:(?:Mo|Tu|We|Th|Fr|Sa|Su|PH|SH)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?)(?:\s*,\s*(?:(?:Mo|Tu|We|Th|Fr|Sa|Su|PH|SH)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?))*)(?:\s+|$)/;

/** Bir kural: `[günler] (saatler|off)`. Uygulanacak günler ve aralıklar; yalnızca PH/SH kuralı -> `skip`. */
function parseRule(rule: string): { days: number[]; ranges: TimeRange[] } | 'skip' | null {
  let rest = rule.trim();
  let days = ALL_DAYS;
  const sel = SELECTOR.exec(rest);
  if (sel) {
    const parsed = parseDays(sel[1].replace(/\s+/g, ''));
    if (!parsed) return null;
    if (parsed.length === 0) return 'skip';
    days = parsed;
    rest = rest.slice(sel[0].length).trim();
  }
  if (rest === '' && sel) return null;
  if (/^(off|closed)$/i.test(rest)) return { days, ranges: [] };
  if (rest === '24/7') return { days, ranges: [{ start: 0, end: 1440 }] };
  const ranges = parseTimes(rest);
  return ranges ? { days, ranges } : null;
}

/** OSM opening_hours metni -> haftalık aralıklar; desteklenmeyen sözdiziminde null. */
export function parseOpeningHours(text: string | null | undefined): Week | null {
  const src = (text ?? '').trim();
  if (!src) return null;
  if (src === '24/7') return DAYS.map(() => [{ start: 0, end: 1440 }]);
  const week = emptyWeek();
  let any = false;
  for (const rule of src.split(/;|\|\|/)) {
    if (!rule.trim()) continue;
    // "Mo 10:00-12:00, Tu 14:00-16:00": virgülden sonra gün gelirse ek kural (önceki günleri ezmez).
    const pieces = rule.replace(/(\d|off|closed)\s*,\s*(?=(?:Mo|Tu|We|Th|Fr|Sa|Su|PH|SH)\b)/g, '$1\u0000').split('\u0000');
    for (let i = 0; i < pieces.length; i++) {
      const r = parseRule(pieces[i]);
      if (r === null) return null;
      if (r === 'skip') continue;
      any = true;
      for (const d of r.days) week[d] = i === 0 ? [...r.ranges] : [...week[d], ...r.ranges];
    }
  }
  return any ? week : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Şimdi açık mı?

/** Yerin yerel saati: haftanın günü (Pzt = 0) ve gece yarısından beri dakika. */
export interface LocalClock { day: number; minutes: number }

const WEEKDAY_EN: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

/**
 * `now` anının `timeZone`'daki (IANA, ör. "Europe/Rome") yerel günü ve saati. Saat dilimi yoksa ya da Intl onu
 * desteklemiyorsa cihazın yerel saati kullanılır (`zoned: false`).
 */
export function localClock(now: Date, timeZone?: string | null): LocalClock & { zoned: boolean } {
  if (timeZone) {
    try {
      const parts = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
        .formatToParts(now);
      const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
      const day = WEEKDAY_EN[get('weekday')];
      const h = Number(get('hour')) % 24;
      const m = Number(get('minute'));
      if (day !== undefined && Number.isFinite(h) && Number.isFinite(m)) return { day, minutes: h * 60 + m, zoned: true };
    } catch { /* bilinmeyen saat dilimi: cihaz saati */ }
  }
  return { day: (now.getDay() + 6) % 7, minutes: now.getHours() * 60 + now.getMinutes(), zoned: false };
}

export type OpenState =
  | { state: 'always' }
  | { state: 'open'; closesAt: number; minutesLeft: number; closeDayOffset: number }
  | { state: 'closed'; opensAt: number; minutesUntil: number; openDayOffset: number }
  | { state: 'never' };

/** Haftayı önceki/sonraki haftayla birlikte mutlak dakikalara açar ve bitişik aralıkları birleştirir. */
function intervals(week: Week): [number, number][] {
  const raw: [number, number][] = [];
  for (const shift of [-WEEK_MIN, 0, WEEK_MIN]) {
    week.forEach((ranges, d) => ranges.forEach((r) => raw.push([shift + d * 1440 + r.start, shift + d * 1440 + r.end])));
  }
  raw.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [s, e] of raw) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  return merged;
}

export function openState(week: Week, clock: LocalClock): OpenState {
  const all = intervals(week);
  if (!all.length) return { state: 'never' };
  if (all.length === 1 && all[0][0] <= -WEEK_MIN && all[0][1] >= 2 * WEEK_MIN) return { state: 'always' };
  const t = clock.day * 1440 + clock.minutes;
  const cur = all.find(([s, e]) => s <= t && t < e);
  if (cur) {
    const closesAt = ((cur[1] % 1440) + 1440) % 1440;
    const minutesLeft = cur[1] - t;
    // Gece yarısını aşan kapanış ("02:00'de kapanır") 24 saatten azsa gün öneki almaz.
    return { state: 'open', closesAt, minutesLeft, closeDayOffset: minutesLeft < 1440 ? 0 : Math.floor((cur[1] - 1) / 1440) - clock.day };
  }
  const next = all.find(([s]) => s > t);
  if (!next) return { state: 'never' };
  return { state: 'closed', opensAt: ((next[0] % 1440) + 1440) % 1440, minutesUntil: next[0] - t, openDayOffset: Math.floor(next[0] / 1440) - clock.day };
}

// ---------------------------------------------------------------------------------------------------------------
// Türkçe etiket

export const fmtClock = (min: number): string =>
  `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** Sayının okunuşundaki son kelime (ünlü uyumu ve sertleşme için). */
const ONES = ['', 'bir', 'iki', 'üç', 'dört', 'beş', 'altı', 'yedi', 'sekiz', 'dokuz'];
const TENS = ['', 'on', 'yirmi', 'otuz', 'kırk', 'elli'];
function lastWord(n: number): string {
  if (n === 0) return 'sıfır';
  return n % 10 ? ONES[n % 10] : TENS[Math.floor(n / 10)];
}

/** "23:00" -> "23:00'te", "09:00" -> "09:00'da", "02:00" -> "02:00'de", "09:30" -> "09:30'da". */
export function atTime(min: number): string {
  const text = fmtClock(min);
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  const word = lastWord(m ? m : h);
  const vowels = word.match(/[aıoueiöü]/g) ?? ['a'];
  const back = 'aıou'.includes(vowels[vowels.length - 1]);
  const hard = /[fstkçşhp]$/.test(word);
  return `${text}'${hard ? 't' : 'd'}${back ? 'a' : 'e'}`;
}

const DAY_TR = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
function dayPrefix(offset: number, clock: LocalClock): string {
  if (offset <= 0) return '';
  if (offset === 1) return 'yarın ';
  return `${DAY_TR[(clock.day + offset) % 7]} `;
}

/** Kapanışa bu kadar dakika kalınca "Kapanmasına N dk" gösterilir. */
export const CLOSING_SOON_MIN = 60;

export type BadgeTone = 'open' | 'soon' | 'closed';
export interface OpenBadge { text: string; tone: BadgeTone }

/** "Açık · 23:00'te kapanır" / "Kapanmasına 30 dk" / "Kapalı · 09:00'da açılır" / "24 saat açık"; bilinmiyorsa null. */
export function openBadge(text: string | null | undefined, clock: LocalClock): OpenBadge | null {
  const week = parseOpeningHours(text);
  if (!week) return null;
  const s = openState(week, clock);
  switch (s.state) {
    case 'always': return { text: '24 saat açık', tone: 'open' };
    case 'never': return { text: 'Kapalı', tone: 'closed' };
    case 'open':
      if (s.minutesLeft <= CLOSING_SOON_MIN) return { text: `Kapanmasına ${s.minutesLeft} dk`, tone: 'soon' };
      return { text: `Açık · ${dayPrefix(s.closeDayOffset, clock)}${atTime(s.closesAt)} kapanır`, tone: 'open' };
    case 'closed':
      return { text: `Kapalı · ${dayPrefix(s.openDayOffset, clock)}${atTime(s.opensAt)} açılır`, tone: 'closed' };
  }
}
