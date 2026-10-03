import { expect, test } from '@playwright/test';
import {
  coordsFromGoogleUrl, dedupeItems, distanceKm, groupByCity, guessCategory, guessCity, guessCityFromAddress, importSummary,
  listNameFromFile, matchQuality, nameFromGoogleUrl, nameSimilarity, normalizeGoogleMapsUrl, parseCsv, parseSavedListCsv,
  parseSavedPlacesJson, parseTakeoutFile, pickBestMatch, placeKeys, splitForCapacity, validCoords,
} from '../src/lib/takeout';

// Node-only (no browser): src/lib/takeout.ts is pure apart from the bundled city dataset.

test.describe('AC-MOB-32: CSV ayrıştırıcı', () => {
  test('tırnaklı alanlar, kaçışlı tırnak, alan içinde virgül ve yeni satır', () => {
    const csv = 'a,b,c\n"x, y","he said ""hi""","line1\nline2"\nplain,,end\n';
    expect(parseCsv(csv)).toEqual([['a', 'b', 'c'], ['x, y', 'he said "hi"', 'line1\nline2'], ['plain', '', 'end']]);
  });

  test('CRLF, yalnız CR, BOM, son satırda yeni satır olmaması', () => {
    expect(parseCsv('\uFEFFTitle,Note\r\nA,1\r\nB,2')).toEqual([['Title', 'Note'], ['A', '1'], ['B', '2']]);
    expect(parseCsv('a,b\rc,d\r')).toEqual([['a', 'b'], ['c', 'd']]);
    expect(parseCsv('"q\r\nr",s\r\n')).toEqual([['q\r\nr', 's']]);
  });

  test('boş satırlar ve yalnız virgüllü satırlar atlanır; boş girdi', () => {
    expect(parseCsv('a,b\n\n,\n  , \nc,d\n\n')).toEqual([['a', 'b'], ['c', 'd']]);
    expect(parseCsv('')).toEqual([]);
    expect(parseCsv('\uFEFF')).toEqual([]);
  });

  test('alan sonunda boş alan ve tırnak içinde virgüllü son alan', () => {
    expect(parseCsv('a,\n"b,c"')).toEqual([['a', ''], ['b,c']]);
    // Tırnak alanın ortasında başlarsa metindir (RFC dışı ama gerçek dosyalarda görülür).
    expect(parseCsv('ab"c,d')).toEqual([['ab"c', 'd']]);
  });

  test('Takeout Kaydedilenler: başlık büyük/küçük harf duyarsız, Note + Comment, URL normalleşir', () => {
    const csv = [
      '\uFEFFTITLE,note,Url,TAGS,Comment',
      ',,,,', // Takeout'un ikinci (açıklama) satırı
      'Roscioli Salumeria,"Carbonara, cacio e pepe",https://www.google.com/maps/place/Roscioli/data=!4m2!3m1!1s0x1:0x2,,Rezervasyon şart',
      '"Sant\'Eustachio ""Il Caffè""","Sabah\nerken git",https://maps.app.goo.gl/abc,,',
      ',not var ama ad yok,,,',
      ',,"https://www.google.com/maps/place/Galata+Kulesi/@41.02,28.97,17z",,',
      'Dropped pin,,"https://www.google.com/maps/search/41.8902,12.4922",,',
      'Kötü bağlantı,,https://evil.example.com/maps/x,,',
    ].join('\r\n');
    const r = parseSavedListCsv(csv);
    expect(r.error).toBeUndefined();
    expect(r.skipped).toBe(1);
    expect(r.places).toEqual([
      { name: 'Roscioli Salumeria', note: 'Carbonara, cacio e pepe · Rezervasyon şart', url: 'https://www.google.com/maps/place/Roscioli/data=!4m2!3m1!1s0x1:0x2', lat: null, lon: null },
      { name: 'Sant\'Eustachio "Il Caffè"', note: 'Sabah\nerken git', url: 'https://maps.app.goo.gl/abc', lat: null, lon: null },
      { name: 'Galata Kulesi', note: '', url: 'https://www.google.com/maps/place/Galata+Kulesi/@41.02,28.97,17z', lat: null, lon: null },
      { name: 'Dropped pin', note: '', url: 'https://www.google.com/maps/search/41.8902,12.4922', lat: 41.8902, lon: 12.4922 },
      { name: 'Kötü bağlantı', note: '', lat: null, lon: null },
    ]);
  });

  test('yalnızca Title, Note, URL sütunları; Türkçe başlıklar; başlık yoksa hata', () => {
    expect(parseSavedListCsv('Title,Note,URL\nA,,\n').places).toEqual([{ name: 'A', note: '', lat: null, lon: null }]);
    expect(parseSavedListCsv('Başlık,Not,Bağlantı\nB,n,https://maps.google.com/?cid=1\n').places)
      .toEqual([{ name: 'B', note: 'n', url: 'https://maps.google.com/?cid=1', lat: null, lon: null }]);
    expect(parseSavedListCsv('foo,bar\n1,2\n').error).toMatch(/Başlık satırı/);
    expect(parseSavedListCsv('').error).toBeTruthy();
  });

  test('parseTakeoutFile: uzantı ya da içerikten tür, dosya adından liste adı, boş dosya hatası', () => {
    const f = parseTakeoutFile('Takeout/Kaydedilenler/Roma_yemek.csv', 'Title,Note,URL\nRoscioli,,\n');
    expect(f).toMatchObject({ kind: 'csv', listName: 'Roma yemek', places: [{ name: 'Roscioli' }] });
    expect(f.error).toBeUndefined();
    expect(parseTakeoutFile('export', '{"type":"FeatureCollection","features":[]}')).toMatchObject({ kind: 'json', error: expect.any(String) });
    expect(parseTakeoutFile('Want to go.csv', 'Title,Note,URL\n')).toMatchObject({ listName: 'Want to go', places: [], error: 'Bu dosyada yer bulunamadı.' });
    expect(listNameFromFile('C:\\x\\Saved Places.json')).toBe('Saved Places');
    expect(listNameFromFile('.csv')).toBe('Google listesi');
  });
});

test.describe('AC-MOB-32: Saved Places.json', () => {
  test('yeni biçim: [lon,lat], location.address/name, google_maps_url (http -> https), Comment; [0,0] konumsuz', () => {
    const json = JSON.stringify({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [12.4731, 41.8937] }, properties: {
          date: '2023-05-01T10:00:00Z', google_maps_url: 'http://maps.google.com/?cid=123',
          location: { address: 'Via dei Giubbonari 21, 00186 Roma RM, Italia', name: 'Roscioli Salumeria', country_code: 'IT' }, Comment: 'Carbonara' } },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {
          google_maps_url: 'https://www.google.com/maps/place/X', location: { name: 'Konumsuz Yer', address: 'Calle Mayor 1, 28013 Madrid, España' } } },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [28.9802, 41.0086] }, properties: { Title: 'Ayasofya' } },
        { type: 'Feature', properties: {} }, // adsız
        'çöp',
      ],
    });
    const r = parseSavedPlacesJson(`\uFEFF${json}`);
    expect(r.skipped).toBe(2);
    expect(r.places).toEqual([
      { name: 'Roscioli Salumeria', note: 'Carbonara', url: 'https://maps.google.com/?cid=123', address: 'Via dei Giubbonari 21, 00186 Roma RM, Italia', lat: 41.8937, lon: 12.4731 },
      { name: 'Konumsuz Yer', note: '', url: 'https://www.google.com/maps/place/X', address: 'Calle Mayor 1, 28013 Madrid, España', lat: null, lon: null },
      { name: 'Ayasofya', note: '', lat: 41.0086, lon: 28.9802 },
    ]);
  });

  test('eski biçim: Title, "Google Maps URL", Location.Address, Geo Coordinates; dizi kökü', () => {
    const r = parseSavedPlacesJson(JSON.stringify([{
      geometry: { coordinates: [0, 0] },
      properties: { Title: 'Çiya Sofrası', 'Google Maps URL': 'https://maps.google.com/?cid=9',
        Location: { Address: 'Güneşli Bahçe Sk. 43, Kadıköy, İstanbul', 'Business Name': 'Çiya', 'Geo Coordinates': { Latitude: '40.9894', Longitude: '29.0257' } } },
    }]));
    expect(r.places).toEqual([{ name: 'Çiya Sofrası', note: '', url: 'https://maps.google.com/?cid=9', address: 'Güneşli Bahçe Sk. 43, Kadıköy, İstanbul', lat: 40.9894, lon: 29.0257 }]);
  });

  test('bozuk JSON ve features olmayan nesne hata verir', () => {
    expect(parseSavedPlacesJson('{nope').error).toBeTruthy();
    expect(parseSavedPlacesJson('{"a":1}').error).toBeTruthy();
  });

  test('groupByCity: koordinatlılar en yakın şehre, koordinatsızlar adresten; bilinmeyen ayrı grup', () => {
    const groups = groupByCity([
      { name: 'Colosseo', note: '', lat: 41.8902, lon: 12.4922 },
      { name: 'Roscioli', note: '', lat: 41.8937, lon: 12.4731 },
      { name: 'Ayasofya', note: '', lat: 41.0086, lon: 28.9802 },
      { name: 'Mercado', note: '', address: 'Plaza de San Miguel, 28005 Madrid, España', lat: null, lon: null },
      { name: 'Hiçbir yer', note: '', lat: null, lon: null },
    ]);
    expect(groups.map((g) => [g.city?.name ?? null, g.places.map((p) => p.name)])).toEqual([
      ['Roma', ['Colosseo', 'Roscioli']], ['İstanbul', ['Ayasofya']], ['Madrid', ['Mercado']], [null, ['Hiçbir yer']],
    ]);
  });
});

test.describe('Google Maps bağlantıları', () => {
  test('normalizeGoogleMapsUrl sunucuyla aynı kuralı uygular', () => {
    for (const u of ['https://www.google.com/maps/place/X', 'https://maps.google.com/?cid=1', 'https://goo.gl/maps/abc', 'https://maps.app.goo.gl/abc'])
      expect(normalizeGoogleMapsUrl(u)).toBe(u);
    expect(normalizeGoogleMapsUrl(' http://maps.google.com/?cid=5 ')).toBe('https://maps.google.com/?cid=5');
    for (const u of ['https://evil.com/maps', 'https://www.google.com/search?q=1', 'https://goo.gl/abc', 'javascript:alert(1)', 'ftp://maps.google.com/',
      'https://maps.google.com.evil.com/', `https://maps.app.goo.gl/${'a'.repeat(477)}`, '', null, 3])
      expect(normalizeGoogleMapsUrl(u)).toBeUndefined();
    expect(normalizeGoogleMapsUrl(`https://maps.app.goo.gl/${'a'.repeat(476)}`)).toHaveLength(500);
  });

  test('bağlantıdan ad ve kesin koordinat', () => {
    expect(nameFromGoogleUrl('https://www.google.com/maps/place/Caf%C3%A9+de+Flore/@48.85,2.33,17z')).toBe('Café de Flore');
    expect(nameFromGoogleUrl('https://www.google.com/maps/place/41.89,12.49')).toBe('');
    expect(coordsFromGoogleUrl('https://www.google.com/maps/place/X/@41.0,12.0,17z/data=!3m1!4b1!4m5!3m4!1s0x0:0x0!8m2!3d41.8986!4d12.4769')).toEqual({ lat: 41.8986, lon: 12.4769 });
    expect(coordsFromGoogleUrl('https://www.google.com/maps/search/-33.8568,151.2153')).toEqual({ lat: -33.8568, lon: 151.2153 });
    expect(coordsFromGoogleUrl('https://maps.google.com/?q=40.4148,-3.7076')).toEqual({ lat: 40.4148, lon: -3.7076 });
    expect(coordsFromGoogleUrl('https://www.google.com/maps/place/X/@41.0,12.0,17z')).toBeNull(); // görünüm merkezi
    expect(coordsFromGoogleUrl('https://maps.google.com/?cid=123')).toBeNull();
    expect(validCoords(0, 0)).toBeNull();
    expect(validCoords(91, 0)).toBeNull();
  });
});

test.describe('AC-MOB-33: liste adından şehir ve kategori', () => {
  test('şehir tahmini (gömülü veri)', () => {
    const city = (n: string) => guessCity(n)?.name ?? null;
    expect(city('Madrid')).toBe('Madrid');
    expect(city('Roma yemek')).toBe('Roma');
    expect(city('İstanbul kahve')).toBe('İstanbul');
    expect(city('istanbul KAHVE')).toBe('İstanbul');
    expect(city('Rome eats')).toBe('Roma');
    expect(city('New York pizza')).toBe('New York');
    expect(city('Londra barlar')).toBe('Londra');
    expect(city('Tokyo 2024')).toBe('Tokyo');
    expect(city('Japonya')).toBe('Japonya'); // ülke yalnızca adın tamamıysa
    for (const n of ['Want to go', 'Favorite places', 'Starred places', 'Travel plans', 'Favori yerler', 'Gitmek istediklerim', 'Quiero ir', 'Default list', 'Best coffee', ''])
      expect(city(n), n).toBeNull();
    expect(guessCityFromAddress('Calle Mayor 10, 28013 Madrid, España')?.name).toBe('Madrid');
    expect(guessCityFromAddress('Via dei Giubbonari 21, 00186 Roma RM, Italia')?.name).toBe('Roma');
    expect(guessCityFromAddress(undefined)).toBeNull();
  });

  test('varsayılan kategori (TR/EN/ES/IT tür kelimeleri)', () => {
    const cases: [string, string | null][] = [
      ['Roma yemek', 'food'], ['Madrid restaurantes', 'food'], ['Napoli pizza', 'food'], ['Ristoranti Roma', 'food'], ['Places to eat', 'food'],
      ['İstanbul kahve', 'coffee'], ['Kahveciler', 'coffee'], ['Best coffee', 'coffee'], ['Caffè Roma', 'coffee'],
      ['Londra barlar', 'bar'], ['Cool bars', 'bar'], ['Cervecerías Madrid', 'bar'],
      ['Paris museums', 'museum'], ['Musei Roma', 'museum'], ['Müzeler', 'museum'],
      ['Bodrum plajlar', 'beach'], ['Playas Cádiz', 'beach'], ['Spiagge', 'beach'],
      ['Oteller', 'hotel'], ['Hotels', 'hotel'], ['Havalimanları', 'airport'], ['Parklar', 'park'], ['Parques Madrid', 'park'],
      ['Tarihi yerler', 'historic'],
      ['Madrid', null], ['Want to go', null], ['Barcelona', null], ['Saraybosna', null], ['Parisian', null],
    ];
    for (const [name, cat] of cases) expect(guessCategory(name, guessCity(name)?.name), name).toBe(cat);
  });
});

test.describe('AC-MOB-34: eşleşme kalitesi', () => {
  const roma = { lat: 41.8933, lon: 12.4829 };

  test('ad benzerliği: katlama, tür kelimeleri, kısmi adlar', () => {
    expect(nameSimilarity('Roscioli', 'Roscioli Salumeria')).toBe(1); // "salumeria" genel kelime
    expect(nameSimilarity('Ristorante Campana', 'Cervecería La Campana')).toBe(1);
    expect(nameSimilarity("SANT'EUSTACHIO", "Sant'Eustachio Il Caffè")).toBe(1);
    expect(nameSimilarity('Çiya', 'Ciya Sofrasi')).toBeGreaterThanOrEqual(0.7);
    expect(nameSimilarity('Kronotrop Cihangir', 'Kronotrop')).toBeGreaterThanOrEqual(0.5);
    expect(nameSimilarity('Colosseum', 'Colosseo')).toBeGreaterThanOrEqual(0.5);
    expect(nameSimilarity('Trattoria da Enzo', 'Colosseo')).toBeLessThan(0.3);
    expect(nameSimilarity('Pizzeria Da Michele', 'Antica Pizzeria da Michele')).toBeGreaterThanOrEqual(0.8);
    expect(nameSimilarity('', 'x')).toBe(0);
  });

  test('uzak (>50 km) ya da düşük benzerlik "Kontrol et"', () => {
    const near = matchQuality('Roscioli', { name: 'Roscioli Salumeria', lat: 41.8937, lon: 12.4731 }, roma);
    expect(near).toMatchObject({ needsCheck: false, far: false, lowSimilarity: false });
    expect(near.distanceKm).toBeLessThan(2);
    const far = matchQuality('Bar Basso', { name: 'Bar Basso', lat: 45.479, lon: 9.2107 }, roma);
    expect(far).toMatchObject({ needsCheck: true, far: true, lowSimilarity: false });
    expect(far.distanceKm).toBeGreaterThan(400);
    expect(matchQuality('Trattoria da Enzo', { name: 'Colosseo', lat: 41.89, lon: 12.49 }, roma)).toMatchObject({ needsCheck: true, lowSimilarity: true, far: false });
    expect(matchQuality('X', { name: 'X', lat: 0, lon: 0 }, null)).toMatchObject({ distanceKm: null, needsCheck: false });
    expect(Math.round(distanceKm({ lat: 41.0082, lon: 28.9784 }, { lat: 41.8933, lon: 12.4829 }))).toBe(1376);
  });

  test('en iyi sonuç: yakın ve benzer olan önce; uzak olan cezalı; boşta null', () => {
    const results = [
      { name: 'Hilton İstanbul Bomonti', lat: 41.0583, lon: 28.9798 },
      { name: 'Hilton Rome Airport', lat: 41.7935, lon: 12.249 },
    ];
    expect(pickBestMatch('Hilton', results, roma)?.index).toBe(1);
    expect(pickBestMatch('Hilton', results, roma)?.quality.needsCheck).toBe(false);
    expect(pickBestMatch('Colosseo', [{ name: 'Bar Colosseo', lat: 45.4, lon: 9.2 }, { name: 'Colosseo', lat: 41.89, lon: 12.49 }], roma)?.index).toBe(1);
    expect(pickBestMatch('x', [], roma)).toBeNull();
  });
});

test.describe('AC-MOB-35: tekrarlar, 500 sınırı, özet', () => {
  test('aynı sağlayıcı kimliği ya da aynı ad + ~100 m aynı yerdir', () => {
    const existing = [{ provider: 'fake', providerId: 'fake-colosseo', name: 'Colosseo', lat: 41.8902, lon: 12.4922 }];
    const incoming = [
      { provider: 'fake', providerId: 'fake-colosseo', name: 'Colosseum', lat: 41.89, lon: 12.49 }, // aynı kimlik
      { provider: 'voyage', providerId: 'colosseo@41.890,12.492', name: 'COLOSSEO', lat: 41.89021, lon: 12.49219 }, // ad + konum
      { provider: 'voyage', providerId: 'a@roma', name: 'Konumsuz', lat: null, lon: null },
      { provider: 'voyage', providerId: 'a2@roma', name: 'konumsuz', lat: null, lon: null }, // kendi içinde tekrar
      { provider: 'fake', providerId: 'fake-roscioli', name: 'Roscioli Salumeria', lat: 41.8937, lon: 12.4731 },
    ];
    const r = dedupeItems(existing, incoming);
    expect(r.items.map((i) => i.providerId)).toEqual(['a@roma', 'fake-roscioli']);
    expect(r.dupes).toBe(3);
    expect(placeKeys({ provider: 'p', providerId: 'i', name: 'İz', lat: null, lon: null })).toEqual(['p:p|i', 'n:iz|-']);
  });

  test('500 sınırı: mevcut listeye kalan yer kadar, gerisi 500lük parçalar', () => {
    const items = Array.from({ length: 1210 }, (_, i) => i);
    const r = splitForCapacity(300, items);
    expect(r.first).toHaveLength(200);
    expect(r.overflow.map((c) => c.length)).toEqual([500, 500, 10]);
    expect(splitForCapacity(500, [1, 2]).first).toEqual([]);
    expect(splitForCapacity(0, [1, 2])).toEqual({ first: [1, 2], overflow: [] });
  });

  test('özet metni', () => {
    expect(importSummary(3, 87, 5)).toBe('3 liste, 87 yer; 5 yer konumsuz');
    expect(importSummary(1, 4, 0)).toBe('1 liste, 4 yer');
    expect(importSummary(1, 4, 0, 2)).toBe('1 liste, 4 yer (2 yer zaten listedeydi)');
  });

  test('büyük dosya (3000 satır) hızlı ayrıştırılır', () => {
    const rows = ['Title,Note,URL', ...Array.from({ length: 3000 }, (_, i) => `"Yer ${i}, Roma","not ""${i}""",https://maps.app.goo.gl/x${i}`)];
    const t = Date.now();
    const r = parseSavedListCsv(rows.join('\n'));
    expect(r.places).toHaveLength(3000);
    expect(r.places[2999]).toEqual({ name: 'Yer 2999, Roma', note: 'not "2999"', url: 'https://maps.app.goo.gl/x2999', lat: null, lon: null });
    expect(Date.now() - t).toBeLessThan(1000);
  });
});
