// AC-MOB-38/39 için ikinci kullanıcı (Maestro runScript, GraalJS). Tek cihazda iki kullanıcı olamayacağından arkadaş
// API ile kaydolur ve uygulamadaki kullanıcıyı (OWNER) takip eder; karşı yönü akış uygulamada (Arkadaşlar) yapar.
// Gerekli: API_URL (ör. -e API_URL=http://10.0.2.2:8787), OWNER (uygulamadaki kullanıcının handle'ı).
var handle = 'f' + Date.now().toString(36);
var email = handle + '@example.com';
var reg = http.post(API_URL + '/auth/register', {
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: email, password: 'Passw0rd!x', handle: handle }),
});
var token = json(reg.body).token;
var auth = { Authorization: 'Bearer ' + token };
var found = json(http.get(API_URL + '/users/search?q=' + OWNER, { headers: auth }).body);
var owner = found.filter(function (u) { return u.handle === OWNER; })[0];
http.post(API_URL + '/follows/' + owner.id, { headers: auth });
output.friend = { handle: handle, email: email };
