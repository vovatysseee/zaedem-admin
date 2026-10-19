// 19.10: проверка порции «журнал брони у Островка, брони гостей в «Пользователях», даты без GMT, подпись платформы».
// Лежит в .github/ — GitHub Pages эту папку не публикует (на сайт не попадает).
// Запуск из корня репозитория: node .github/admin-test/admin-journal-guests.test.js
// Нужны playwright и Chromium; API — заглушки, в сеть не ходит.
// Три режима бэкенда: old3 — старый бэкенд, все брони загружены; old250 — старый, загружены не все («≥»);
// new — бэкенд порции 39 (bookings_count, last_booking_at, source, source_ru в GET /api/users).
const http = require('http'), fs = require('fs'), path = require('path');
let chromium; try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/node-tools/node_modules/playwright')); }

const ROOT = path.join(__dirname, '..', '..');
const bk = (o) => Object.assign({ status: 'confirmed', currency: 'BYN', total_price: 100, nights: 2, guests_count: 2,
  hotel_name: 'Тест-отель', room_name: 'Стандарт', check_in: '2026-11-20', check_out: '2026-11-22' }, o);
const BOOKINGS = [
  bk({ id: 'b1', booking_num: 'ZD-1001', source: 'direct',   guest_name: 'Анна',  guest_email: 'anna@test.by',  created_at: '2026-10-10T09:00:00Z', host_opened_at: '2026-10-10T10:00:00Z' }),
  bk({ id: 'b2', booking_num: 'ZD-1002', source: 'direct',   guest_name: 'Анна',  guest_email: 'Anna@test.by',  created_at: '2026-10-15T09:00:00Z', host_opened_at: null }),
  bk({ id: 'b3', booking_num: 'OST-2001', source: 'ostrovok', guest_name: 'Борис', guest_email: 'boris@test.by', created_at: '2026-10-12T09:00:00Z', host_opened_at: null }),
  // порция 39 бэкенда: у Островка вместо host_opened_at — host_opened_na
  bk({ id: 'b4', booking_num: 'OST-2002', source: 'ostrovok', guest_name: 'Борис', guest_email: 'boris@test.by', created_at: '2026-10-13T09:00:00Z', host_opened_na: true }),
];
const USERS = [
  { id: 'u1', email: 'anna@test.by',  name: 'Анна',  phone: '+375291', role: 'tourist', is_active: true, created_at: '2026-09-01T00:00:00Z' },
  { id: 'u2', email: 'vera@test.by',  name: 'Вера',  phone: '',        role: 'tourist', is_active: true, created_at: '2026-09-02T00:00:00Z' },
  { id: 'u3', email: 'owner@test.by', name: 'Хозяин', phone: '',       role: 'hotel_owner', is_active: true, created_at: '2026-09-03T00:00:00Z' },
  { id: 'u4', email: 'adm@test.by',   name: 'Админ', phone: '',        role: 'admin', is_active: true, created_at: '2026-09-04T00:00:00Z' },
];

// Ответ GET /api/users бэкенда порции 39: точные числа с сервера (у Анны — 5, больше, чем загружено броней), source_ru у гостя из брони
const USERS_NEW = USERS.map(u => Object.assign({}, u, { bookings_count: 0, last_booking_at: null, source: null, source_ru: null }));
Object.assign(USERS_NEW[0], { bookings_count: 5, last_booking_at: '2026-10-18T08:00:00Z', source: 'booking', source_ru: 'из брони' });

async function run(vw, vh, mode) {
  const total = mode === 'old250' ? 250 : 3;
  const isNew = mode === 'new';
  const errs = [];
  const srv = http.createServer((q, r) => { r.setHeader('Content-Type', 'text/html; charset=utf-8'); r.end(fs.readFileSync(path.join(ROOT, 'index.html'))); }).listen(0);
  const base = 'http://127.0.0.1:' + srv.address().port + '/';
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, locale: 'ru-RU', timezoneId: 'Europe/Minsk' });
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  const json = (route, body, status) => route.fulfill({ status: status || 200, contentType: 'application/json', body: JSON.stringify(body) });
  await ctx.route(u => !u.href.startsWith(base), route => {
    const u = new URL(route.request().url()), p = u.pathname;
    if (u.host !== 'api.zaedem.by') return route.fulfill({ status: 200, contentType: 'text/plain', body: '' });   // шрифты и прочее — пусто
    if (p === '/api/users/login') return json(route, { success: true, token: 't', user: { role: 'admin' } });
    if (p === '/api/bookings') return json(route, { bookings: u.searchParams.get('status') ? [] : BOOKINGS, total });
    if (p === '/api/users') return json(route, { users: isNew ? USERS_NEW : USERS, total: USERS.length });
    const j = p.match(/^\/api\/bookings\/([^/]+)\/journal$/);
    if (j) { const b = BOOKINGS.find(x => x.booking_num === decodeURIComponent(j[1])); return json(route, { booking: b, consents: [], transfers: [] }); }
    if (p === '/api/applications') return json(route, { applications: [] });
    if (p === '/api/hotels') return json(route, { hotels: [] });
    return json(route, {});
  });
  await page.goto(base);
  // подпись платформы на экране входа: под «Панель администратора», мелко, без горизонтальной прокрутки
  const tag = await page.$eval('.login-tag', e => ({ t: e.innerText, fs: parseFloat(getComputedStyle(e).fontSize), below: e.getBoundingClientRect().top >= document.querySelector('.login-sub').getBoundingClientRect().bottom - 1, vis: e.offsetParent !== null }));
  const loginRes = {
    loginTag: tag.t === 'Белорусская платформа бронирования жилья' && tag.vis && tag.below && tag.fs <= 12,
    loginNoHScroll: await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  };
  await page.fill('#loginEmail', 'adm'); await page.fill('#loginPass', 'x'); await page.click('#loginWrap button[type=button], #loginWrap .login-btn, #loginWrap button');
  await page.waitForSelector('#app', { state: 'visible' });
  await page.waitForTimeout(600);
  const res = Object.assign({}, loginRes);
  const noHScroll = async () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

  // журнал: Островок — строки нет; свои (открыл / не открыл) — есть
  await page.evaluate(() => showPage('bookings', null));
  const journal = async (num) => { await page.evaluate(n => showJournal(n), num); await page.waitForSelector('#modal-body .jr-sec'); const t = await page.innerText('#modal-body'); await page.evaluate(() => closeModal && closeModal()); return t; };
  const jo = await journal('OST-2001'), jd1 = await journal('ZD-1001'), jd2 = await journal('ZD-1002');
  const jo2 = await journal('OST-2002');   // Островок с host_opened_na
  res.journalOstNoRow = !jo.includes('Хозяин открыл') && !jo2.includes('Хозяин открыл') && jo.includes('Источник');
  res.journalDirectRow = jd1.includes('Хозяин открыл') && jd2.includes('Хозяин открыл') && jd2.includes('ещё не открывал');

  // детали брони: дата вида «20 нояб. 2026 г.», без GMT
  await page.evaluate(() => showBooking('b1'));
  const det = await page.innerText('#modal-body');
  res.detailsDate = /20 нояб\. 2026 г\./.test(det) && !/GMT/.test(det);
  await page.evaluate(() => closeModal && closeModal());

  // пользователи: фильтр «Гости», число броней и дата последней
  await page.evaluate(() => showPage('tourists', null));
  await page.click('.urole-chip[data-urole="tourist"]');
  const rows = await page.$$eval('#tourists-table tr', trs => trs.slice(1).map(tr => tr.innerText.replace(/\s+/g, ' ')));
  res.guestsListed = rows.length === 2;
  // new — число и дата с сервера (5, 18 окт.), без «≥»; old — по загруженным броням (2, 15 окт.), «≥» если загружены не все
  const annaWant = isNew ? ['5', 'последняя: 18 окт. 2026 г.'] : [mode === 'old250' ? '≥2' : '2', 'последняя: 15 окт. 2026 г.'];
  res.annaCount = rows.some(r => r.includes('anna@test.by') && annaWant.every(x => r.includes(x))) && (!isNew || !rows.join().includes('≥'));
  res.veraNone = rows.some(r => r.includes('vera@test.by') && r.includes('нет'));
  // метка «из брони» рядом с e-mail — только там, где сервер её прислал
  const srcLbl = await page.$$eval('#tourists-table tr', trs => trs.slice(1).map(tr => [tr.innerText.includes('anna@test.by'), !!tr.querySelector('.u-src'), (tr.querySelector('.u-src') || {}).innerText]));
  res.sourceLabel = isNew ? srcLbl.filter(x => x[1]).length === 1 && srcLbl.some(x => x[0] && x[2] === 'из брони') : srcLbl.every(x => !x[1]);
  await page.click('.urole-chip[data-urole="hotelowner"]');
  res.ownerNoCount = (await page.$$eval('#tourists-table tr', trs => trs.slice(1).map(tr => tr.innerText))).every(t => !t.includes('последняя'));
  res.usersNoHScroll = await noHScroll();
  await page.click('.urole-chip[data-urole="tourist"]');
  // клик по числу → «Все брони» с поиском по e-mail
  await page.click('#tourists-table a.u-bk');
  res.clickGoesToBookings = await page.evaluate(() => document.getElementById('page-bookings').classList.contains('on') && document.getElementById('bk-search').value === 'anna@test.by');
  const bnums = await page.$$eval('#bookings-table tr td:first-child', tds => tds.map(t => t.innerText.trim()));
  res.clickFilters = JSON.stringify(bnums) === JSON.stringify(['ZD-1001', 'ZD-1002'].reverse()) || (bnums.length === 2 && bnums.includes('ZD-1001') && bnums.includes('ZD-1002'));

  // прежние экраны открываются, горизонтальной прокрутки нет, GMT нигде нет
  let allOk = true, gmt = false;
  for (const name of ['dashboard', 'bookings', 'applications', 'hotels', 'tourists']) {
    await page.evaluate(n => showPage(n, null), name); await page.waitForTimeout(150);
    if (!(await noHScroll())) allOk = false;
    if (/GMT/.test(await page.innerText('body'))) gmt = true;
  }
  res.screensNoHScroll = allOk; res.noGmtAnywhere = !gmt;
  res.bookingsHeadUnchanged = (await page.$$eval('#bookings-table tr:first-child th', ths => ths.map(t => t.innerText).join('|'))) === 'Бронь|Источник|Гость|Отель|Заезд|Выезд|Ночей|Сумма|Статус|';
  res.noConsoleErrors = errs.length === 0;
  await page.screenshot({ path: process.env.SHOT ? `${process.env.SHOT}/users-${vw}.png` : undefined }).catch(() => {});
  await browser.close(); srv.close();
  return { res, errs };
}

(async () => {
  let fail = 0;
  for (const [w, h] of [[1366, 768], [390, 844]]) for (const mode of ['old3', 'old250', 'new']) {
    const { res, errs } = await run(w, h, mode);
    for (const k in res) if (!res[k]) { fail++; console.log(`FAIL ${w}x${h} ${mode}: ${k}`); }
    if (errs.length) console.log(errs.join('\n'));
    console.log(`${w}x${h} ${mode}: ${Object.values(res).filter(Boolean).length}/${Object.keys(res).length} ok`);
  }
  process.exit(fail ? 1 : 0);
})();
