import { expect, test } from '@playwright/test';
import { atTime, localClock, openBadge, openState, parseOpeningHours, type LocalClock } from '../src/lib/openingHours';
import { placeTimeZone } from '../src/lib/placeTime';

// Node-only (no browser). Days: 0 = Monday … 6 = Sunday; minutes since local midnight.
const at = (day: number, hhmm: string): LocalClock => {
  const [h, m] = hhmm.split(':').map(Number);
  return { day, minutes: h * 60 + m };
};
const MO = 0, TU = 1, FR = 4, SA = 5, SU = 6;

test.describe('AC-MOB-44: opening_hours ayrıştırıcı', () => {
  test('gün aralıkları, off, birden çok aralık', () => {
    const w = parseOpeningHours('Mo-Fr 09:00-18:00; Sa 10:00-14:00; Su off')!;
    expect(w[MO]).toEqual([{ start: 540, end: 1080 }]);
    expect(w[FR]).toEqual([{ start: 540, end: 1080 }]);
    expect(w[SA]).toEqual([{ start: 600, end: 840 }]);
    expect(w[SU]).toEqual([]);
    const split = parseOpeningHours('Mo,We,Fr 12:00-15:00,19:00-23:00')!;
    expect(split[0]).toEqual([{ start: 720, end: 900 }, { start: 1140, end: 1380 }]);
    expect(split[TU]).toEqual([]);
    expect(split[2]).toHaveLength(2);
  });

  test('24/7, gün belirtmeyen kural, sarmal gün aralığı, gece yarısını aşan aralık', () => {
    expect(parseOpeningHours('24/7')!.every((d) => d.length === 1 && d[0].start === 0 && d[0].end === 1440)).toBe(true);
    expect(parseOpeningHours('10:00-20:00')!.every((d) => d[0].start === 600)).toBe(true);
    const wrap = parseOpeningHours('Fr-Mo 10:00-12:00')!;
    expect(wrap.map((d) => d.length)).toEqual([1, 0, 0, 0, 1, 1, 1]);
    expect(parseOpeningHours('Mo-Su 18:00-02:00')![MO]).toEqual([{ start: 1080, end: 1560 }]);
    expect(parseOpeningHours('Mo-Su 10:00-24:00')![MO]).toEqual([{ start: 600, end: 1440 }]);
  });

  test('sonraki kural günleri ezer; virgülle ek kural ezmez; PH yok sayılır', () => {
    const w = parseOpeningHours('Mo-Su 09:00-17:00; Su off')!;
    expect(w[SU]).toEqual([]);
    expect(w[SA]).toHaveLength(1);
    const add = parseOpeningHours('Mo 10:00-12:00, Tu 14:00-16:00')!;
    expect(add[MO]).toEqual([{ start: 600, end: 720 }]);
    expect(add[TU]).toEqual([{ start: 840, end: 960 }]);
    const ph = parseOpeningHours('Mo-Sa 09:00-18:00; Su off; PH off')!;
    expect(ph[SA]).toHaveLength(1);
    expect(parseOpeningHours('Mo-Fr,PH 08:00-12:00')![FR]).toHaveLength(1);
    expect(parseOpeningHours('PH off')).toBeNull();
  });

  test('desteklenmeyen ya da bozuk metin null döner (rozet yok)', () => {
    for (const t of ['', null, undefined, 'Jan-Mar Mo-Fr 09:00-17:00', 'sunrise-sunset', 'Mo-Fr 10:00+', 'Mo-Fr', 'open',
      'Mo-Fr 9-17', 'Mo-Fr 25:00-26:00', '"by appointment"', 'Xx 10:00-12:00']) {
      expect([t, parseOpeningHours(t as string)]).toEqual([t, null]);
    }
  });
});

test.describe('AC-MOB-44: şimdi açık mı ve rozet metni', () => {
  const office = 'Mo-Fr 09:00-18:00; Sa 10:00-14:00; Su off';

  test('açık · kapanır, kapanmasına N dk, kapalı · açılır', () => {
    expect(openBadge(office, at(MO, '10:00'))).toEqual({ text: "Açık · 18:00'de kapanır", tone: 'open' });
    expect(openBadge(office, at(MO, '17:30'))).toEqual({ text: 'Kapanmasına 30 dk', tone: 'soon' });
    expect(openBadge(office, at(MO, '17:00'))).toEqual({ text: 'Kapanmasına 60 dk', tone: 'soon' });
    expect(openBadge(office, at(MO, '07:00'))).toEqual({ text: "Kapalı · 09:00'da açılır", tone: 'closed' });
    expect(openBadge(office, at(MO, '18:00'))).toEqual({ text: "Kapalı · yarın 09:00'da açılır", tone: 'closed' });
    expect(openBadge(office, at(SA, '15:00'))).toEqual({ text: "Kapalı · Pzt 09:00'da açılır", tone: 'closed' });
    expect(openBadge('Mo-Su 09:00-23:00', at(TU, '12:00'))).toEqual({ text: "Açık · 23:00'te kapanır", tone: 'open' });
  });

  test('gece yarısını aşan aralık: önceki günün aralığı bugün sabaha kadar açık sayılır', () => {
    const bar = 'Tu-Su 18:00-02:00; Mo off';
    expect(openBadge(bar, at(FR, '23:00'))?.text).toBe("Açık · 02:00'de kapanır");
    expect(openBadge(bar, at(SA, '01:30'))?.text).toBe('Kapanmasına 30 dk');
    // Sunday night into Monday morning (week wrap), Monday itself off
    expect(openBadge(bar, at(MO, '01:00'))?.text).toBe('Kapanmasına 60 dk');
    expect(openBadge(bar, at(MO, '03:00'))?.text).toBe("Kapalı · yarın 18:00'de açılır");
    expect(openBadge('Mo-Su 07:30-01:00', at(TU, '00:15'))?.text).toBe('Kapanmasına 45 dk');
  });

  test('24/7 ve hiç açılmayan yer; 24:00 kapanış', () => {
    expect(openBadge('24/7', at(SU, '03:00'))).toEqual({ text: '24 saat açık', tone: 'open' });
    expect(openBadge('Mo-Su 00:00-24:00', at(SU, '03:00'))?.text).toBe('24 saat açık');
    expect(openBadge('Mo-Su off', at(SU, '03:00'))).toEqual({ text: 'Kapalı', tone: 'closed' });
    expect(openBadge('Mo-Su 10:00-24:00', at(MO, '20:00'))?.text).toBe("Açık · 00:00'da kapanır");
    expect(openBadge(null, at(MO, '10:00'))).toBeNull();
    expect(openState(parseOpeningHours('Mo 10:00-12:00')!, at(MO, '11:00'))).toEqual({ state: 'open', closesAt: 720, minutesLeft: 60, closeDayOffset: 0 });
  });

  test("Türkçe ek: 'te / 'de / 'da / 'ta", () => {
    expect(atTime(23 * 60)).toBe("23:00'te");
    expect(atTime(9 * 60)).toBe("09:00'da");
    expect(atTime(2 * 60)).toBe("02:00'de");
    expect(atTime(9 * 60 + 30)).toBe("09:30'da");
    expect(atTime(10 * 60 + 40)).toBe("10:40'ta");
    expect(atTime(6 * 60)).toBe("06:00'da");
    expect(atTime(14 * 60 + 45)).toBe("14:45'te");
    expect(atTime(0)).toBe("00:00'da");
    expect(atTime(20 * 60)).toBe("20:00'de");
  });

  test('yerin saat dilimine göre yerel saat; bilinmeyen saat diliminde cihaz saati', () => {
    const now = new Date('2026-10-05T19:30:00Z'); // Monday
    expect(localClock(now, 'Europe/Rome')).toEqual({ day: MO, minutes: 21 * 60 + 30, zoned: true });
    expect(localClock(now, 'Europe/Istanbul')).toEqual({ day: MO, minutes: 22 * 60 + 30, zoned: true });
    expect(localClock(now, 'Asia/Tokyo')).toEqual({ day: TU, minutes: 4 * 60 + 30, zoned: true });
    const device = localClock(now, 'Not/AZone');
    expect(device.zoned).toBe(false);
    expect(device.minutes).toBe(now.getHours() * 60 + now.getMinutes());
    expect(localClock(now, null).zoned).toBe(false);
  });

  test('koordinattan saat dilimi (tek saat dilimli ülkeler), çok saat dilimli ülkede null', () => {
    expect(placeTimeZone(41.8937, 12.4731)).toBe('Europe/Rome');
    expect(placeTimeZone(41.0256, 28.9741)).toBe('Europe/Istanbul');
    expect(placeTimeZone(40.4148, -3.7076)).toBe('Europe/Madrid');
    expect(placeTimeZone(40.7128, -74.006)).toBeNull(); // New York: US has several zones
    expect(placeTimeZone(null, 12)).toBeNull();
  });
});
