// 23.10: проверка порции «роли сотрудников, смена временного пароля, «только через VPN», раздел «Сотрудники», «Отчёты».
// Лежит в .github/ — GitHub Pages эту папку не публикует (на сайт не попадает).
// Запуск из корня репозитория: node .github/admin-test/admin-roles-staff-reports.test.js
// Нужны playwright и Chromium; API — заглушки, в сеть не ходит.
// Заглушка сервера повторяет бэкенд порций 40А и 40Б (vovatysseee/zaedem-backend, только чтение):
//   src/middleware/auth.js — карта прав STAFF_ACCESS, 403 «Доступ запрещён», pwd_tmp → 403 must_change_password, vpn_required;
//   src/routes/staff.js    — /api/admin/staff…;   src/routes/buh_reports.js и services/buh_reports.js — отчёты и status();
//   src/routes/users.js    — /login (must_change_password), /change-password (новый токен).
// Любой запрос, которого нет в карте роли, заглушка отвечает 403 — и тест считает такие ответы ошибкой:
// интерфейс не должен просить у сервера то, чего роли не положено.
const http = require('http'), fs = require('fs'), path = require('path');
let chromium; try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/node-tools/node_modules/playwright')); }

const ROOT = path.join(__dirname, '..', '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'));

// ── права ролей: копия STAFF_ACCESS из бэкенда (порция 40А) ──
const ACCESS = {
  accountant: { allow: [
    ['GET', '/api/agentika/payables'], ['POST', '/api/agentika/payables/:num/paid'], ['GET', '/api/agentika/report'],
    ['GET', '/api/admin/agentika/paid'], ['POST', '/api/admin/agentika/paid/:num/undo'],
    ['*', '/api/admin/reminders'], ['*', '/api/admin/reminders/*'], ['*', '/api/admin/payees'], ['*', '/api/admin/payees/*'],
    ['*', '/api/admin/reports'], ['*', '/api/admin/reports/*'],
    ['GET', '/api/bookings'], ['GET', '/api/bookings/stats'], ['GET', '/api/bookings/:id'] ], deny: [] },
  support: { allow: [
    ['GET', '/api/bookings'], ['GET', '/api/bookings/:id'], ['GET', '/api/bookings/:num/journal'],
    ['PATCH', '/api/bookings/:num/status', (b) => !!b && b.status === 'cancelled' && !b.local_only],
    ['POST', '/api/ostrovok/order/details'] ], deny: [['GET', '/api/bookings/stats']] },
};
function patMatch(pat, p) {
  const ps = pat.split('/'), xs = p.split('/');
  if (ps[ps.length - 1] === '*') { ps.pop(); if (xs.length <= ps.length) return false; } else if (ps.length !== xs.length) return false;
  for (let i = 0; i < ps.length; i++) { if (ps[i][0] === ':') { if (!xs[i]) return false; continue; } if (ps[i] !== xs[i]) return false; }
  return true;
}
const hit = (rules, m, p, body) => (rules || []).some(([rm, pat, cond]) => (rm === '*' || rm === m) && patMatch(pat, p) && (!cond || cond(body)));
const roleCan = (role, m, p, body) => role === 'admin' || (ACCESS[role] && !hit(ACCESS[role].deny, m, p, body) && hit(ACCESS[role].allow, m, p, body));

// ── данные ──
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (p) => b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64(Object.assign({ exp: 4102444800 }, p)) + '.sig';   // exp — 2100 год
const PEOPLE = {
  admin:      { id: 'u-admin', email: 'dir@zaedem.by', name: 'Иван Директоров', role: 'admin' },
  accountant: { id: 'u-acc',   email: 'buh@zaedem.by', name: 'Анна Бухгалтерова', role: 'accountant' },
  support:    { id: 'u-sup',   email: 'help@zaedem.by', name: 'Олег Поддержкин', role: 'support' },
};
const ROLE_RU = { admin: 'Директор', accountant: 'Бухгалтер', support: 'Поддержка' };
const bk = (o) => Object.assign({ status: 'confirmed', currency: 'BYN', total_price: 100, nights: 2, guests_count: 2,
  hotel_name: 'Тест-отель', room_name: 'Стандарт', check_in: '2026-11-20', check_out: '2026-11-22', source: 'direct',
  guest_name: 'Анна Гостева', guest_email: 'anna@test.by', guest_phone: '+375291112233', created_at: '2026-10-10T09:00:00Z' }, o);
const BOOKINGS = [
  bk({ id: 'b1', booking_num: 'ZD-1001' }),
  bk({ id: 'b2', booking_num: 'OST-2001', source: 'ostrovok', status: 'needs_check', guest_name: 'Борис Гостев', guest_email: 'boris@test.by' }),
];
const GUEST_KEYS = ['guest_name', 'guest_email', 'guest_phone'];
const scrub = (b) => { const o = Object.assign({}, b); GUEST_KEYS.forEach(k => delete o[k]); return o; };

const STAFF0 = () => [
  { id: 'u-admin', email: 'dir@zaedem.by', name: 'Иван Директоров', role: 'admin', is_active: true, must_change_password: false },
  { id: 'u-acc', email: 'buh@zaedem.by', name: 'Анна Бухгалтерова', role: 'accountant', is_active: true, must_change_password: false },
  { id: 'u-sup', email: 'help@zaedem.by', name: 'Олег Поддержкин', role: 'support', is_active: false, must_change_password: false },
];
// ответ GET /api/admin/reports/status — как отдаёт services/buh_reports.js status()
const STATUS_OK = () => ({
  ok: true, enabled: ['monthly', 'weekly', 'daily', 'due'], buh_email: 'b***@zaedem.by', schema_ready: true, auto: true,
  send_time: '08:00 по Минску', dump_window: 'понедельник 10:00–10:59 по Минску — автоотправка ждёт до 11:00', due_days: 2,
  last: {
    daily: { kind: 'daily', key: 'daily:2026-10-22', period_from: '2026-10-22', period_to: '2026-10-22', status: 'sent', attempts: 1, info: 'строк: 14', sent_at: '2026-10-23T05:00:12.000Z', created_at: '2026-10-23T05:00:10.000Z' },
    weekly: { kind: 'weekly', key: 'weekly:2026-10-12', period_from: '2026-10-12', period_to: '2026-10-18', status: 'failed', attempts: 3, info: 'почта не приняла письмо или отчёт не собран', sent_at: null, created_at: '2026-10-19T05:00:10.000Z' },
  },
  next: {
    monthly: { at: '2026-11-02T05:00:00.000Z', minsk: '02 ноября 2026 08:00', from: '2026-10-01', to: '2026-10-31' },
    weekly: { at: '2026-10-26T05:00:00.000Z', minsk: '26 октября 2026 08:00', from: '2026-10-19', to: '2026-10-25' },
    daily: { at: '2026-10-24T05:00:00.000Z', minsk: '24 октября 2026 08:00', from: '2026-10-23', to: '2026-10-23' },
  },
  recent: [
    { kind: 'daily', key: 'daily:2026-10-22', period_from: '2026-10-22', period_to: '2026-10-22', status: 'sent', attempts: 1, info: 'строк: 14', sent_at: '2026-10-23T05:00:12.000Z', created_at: '2026-10-23T05:00:10.000Z' },
    { kind: 'manual', key: 'manual:2026-10-20T10:00:00.000Z', period_from: '2026-09-01', period_to: '2026-09-30', status: 'sent', attempts: 1, info: 'строк: 220', sent_at: '2026-10-20T10:00:05.000Z', created_at: '2026-10-20T10:00:00.000Z' },
    { kind: 'due', key: 'due:ZD-5:2026-10-24:day', period_from: '2026-10-24', period_to: '2026-10-24', status: 'sent', attempts: 1, info: 'day', sent_at: '2026-10-24T05:00:01.000Z', created_at: '2026-10-24T05:00:00.000Z' },
  ],
  pending: ['daily:2026-10-21'],
});

// ── стенд ──
async function openApp(vw, vh, o) {
  o = o || {};
  const errs = [], log = [], dlg = { log: [], accept: true };
  const state = { staff: STAFF0(), status: STATUS_OK(), pwd: o.tempPassword || 'Qwerty123456AbCd' };
  const srv = http.createServer((q, r) => { r.setHeader('Content-Type', 'text/html; charset=utf-8'); r.end(HTML); }).listen(0);
  const base = 'http://127.0.0.1:' + srv.address().port + '/';
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, locale: 'ru-RU', timezoneId: 'Europe/Minsk', acceptDownloads: true });
  if (o.stored) {   // вход уже сохранён на устройстве (как после «Запомнить»)
    const tok = jwt({ id: PEOPLE[o.stored].id, email: PEOPLE[o.stored].email, role: PEOPLE[o.stored].role, tv: 0 });
    await ctx.addInitScript(([t, u]) => { try { if (!localStorage.getItem('admin_token')) { localStorage.setItem('admin_token', t); localStorage.setItem('admin_exp', String(Date.now() + 864e5)); localStorage.setItem('admin_user', JSON.stringify(u)); } } catch (e) {} }, [tok, PEOPLE[o.stored]]);
  }
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('dialog', d => { dlg.log.push(d.message()); (dlg.accept ? d.accept() : d.dismiss()).catch(() => {}); });
  const json = (route, body, status) => route.fulfill({ status: status || 200, contentType: 'application/json', body: JSON.stringify(body) });
  await ctx.route(u => !u.href.startsWith(base), async route => {
    const rq = route.request(), u = new URL(rq.url()), p = u.pathname.replace(/\/+$/, ''), m = rq.method();
    if (u.host !== 'api.zaedem.by') return route.fulfill({ status: 200, contentType: 'text/plain', body: '' });
    let body = null; try { body = rq.postData() ? JSON.parse(rq.postData()) : null; } catch (e) {}
    const auth = rq.headers()['authorization'] || '';
    const rec = { m, p, q: u.search, body, auth, status: 200 };
    log.push(rec);
    const reply = (b, st) => { rec.status = st || 200; return json(route, b, st); };
    // вход
    if (p === '/api/users/login') {
      if (o.loginVpn) return reply({ error: 'Доступ только через VPN', vpn_required: true }, 403);
      const who = PEOPLE[o.role || 'admin'];
      const tmp = !!o.tmp && who.role !== 'admin' ? { pwd_tmp: true } : {};
      return reply({ success: true, token: jwt(Object.assign({ id: who.id, email: who.email, role: who.role, tv: 0 }, tmp)),
        user: { id: who.id, email: who.email, name: who.name, phone: null, role: who.role, must_change_password: !!o.tmp } });
    }
    // смена пароля самим пользователем
    if (p === '/api/users/change-password') {
      const b = body || {};
      if (b.oldPassword !== (o.tmpPass || 'Temp-pass-123')) return reply({ error: 'Неверный текущий пароль' }, 401);
      const who = PEOPLE[o.role || 'admin'];
      state.changed = b;
      return reply({ success: true, message: 'Пароль изменён', token: jwt({ id: who.id, email: who.email, role: who.role, tv: 1 }) });
    }
    // прочее — только с токеном; роль и метка временного пароля берутся из токена
    let pay = {}; try { pay = JSON.parse(Buffer.from(auth.replace(/^Bearer\s+/i, '').split('.')[1] || '', 'base64url').toString()); } catch (e) {}
    const role = pay.role || 'admin';
    if (o.vpnAfterLogin && o.vpnAfterLogin()) return reply({ error: 'Доступ только через VPN', vpn_required: true }, 403);
    if (o.vpnTextOnly && o.vpnTextOnly()) return reply({ error: 'Доступ только через VPN' }, 403);
    if (pay.pwd_tmp) return reply({ error: 'Смените временный пароль, чтобы продолжить', must_change_password: true }, 403);
    if (o.force403 && o.force403(m, p)) return reply({ error: 'Доступ запрещён' }, 403);
    if (!roleCan(role, m, p, body)) return reply({ error: 'Доступ запрещён' }, 403);
    // данные
    const view = (b) => role === 'accountant' ? scrub(b) : b;
    if (m === 'GET' && p === '/api/bookings') {
      const st = u.searchParams.get('status');
      const list = BOOKINGS.filter(b => st ? b.status === st : b.status !== 'needs_check');
      return reply({ bookings: list.map(view), total: list.length, pd_hidden: role === 'accountant' ? 'no_guest' : undefined });
    }
    const j = p.match(/^\/api\/bookings\/([^/]+)\/journal$/);
    if (j) { const b = BOOKINGS.find(x => x.booking_num === decodeURIComponent(j[1])); return reply({ booking: view(b), consents: [], transfers: [] }); }
    const st = p.match(/^\/api\/bookings\/([^/]+)\/status$/);
    if (st && m === 'PATCH') return reply({ ok: true, success: true });
    if (p === '/api/bookings/stats') return reply({ buckets: [] });
    if (p === '/api/users') return reply({ users: [], total: 0 });
    if (p === '/api/applications') return reply({ applications: [] });
    if (p === '/api/hotels') return reply({ hotels: [] });
    if (p === '/api/admin/reminders') return reply({ ok: true, items: [], stats: {}, tg_hour: 9, alerts: false });
    if (p === '/api/agentika/payables') return reply({ ok: true, buffer_min: 40, unpaid: [], paid: [], totals: {}, overdue: 0, urgent: 0 });
    if (p === '/api/admin/agentika/paid') return reply({ ok: true, items: [], total: {} });
    // сотрудники (40А)
    if (p.startsWith('/api/admin/staff')) {
      if (o.staffOff) return reply({ error: 'Not found' }, 404);
      const id = (p.match(/^\/api\/admin\/staff\/([^/]+)/) || [])[1];
      const row = id && state.staff.find(x => x.id === id);
      if (m === 'GET' && p === '/api/admin/staff') return reply({ ok: true, items: state.staff, roles: [] });
      if (m === 'POST' && p === '/api/admin/staff') {
        if (o.createError) return reply({ error: o.createError }, 409);
        const u2 = { id: 'u-new', email: body.email, name: body.name, role: body.role, is_active: true, must_change_password: true };
        state.staff.push(u2); return reply({ ok: true, user: u2, temp_password: state.pwd }, 201);
      }
      if (row && m === 'PATCH') { row.role = body.role; return reply({ ok: true, user: row }); }
      if (row && m === 'POST' && /\/disable$/.test(p)) { row.is_active = false; return reply({ ok: true }); }
      if (row && m === 'POST' && /\/enable$/.test(p)) { row.is_active = true; return reply({ ok: true }); }
      if (row && m === 'POST' && /\/reset-password$/.test(p)) { row.must_change_password = true; return reply({ ok: true, temp_password: state.pwd }); }
      return reply({ error: 'Сотрудник не найден' }, 404);
    }
    // отчёты (40Б)
    if (p === '/api/admin/reports/status') {
      if (o.reportsOff) return reply({ error: 'Not found' }, 404);
      return reply(state.statusOverride || state.status);
    }
    if (p === '/api/admin/reports/export') {
      if (o.reportsOff) return reply({ error: 'Not found' }, 404);
      if (o.exportError) return reply({ error: o.exportError }, 400);
      rec.status = 200;
      return route.fulfill({ status: 200, body: Buffer.from('PK\u0003\u0004xlsx-test'), headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="zaedem_otchet_${u.searchParams.get('from')}_${u.searchParams.get('to')}.xlsx"`, 'Access-Control-Expose-Headers': 'Content-Disposition' } });
    }
    if (p === '/api/admin/reports/send') {
      if (o.sendFail) return reply(o.sendFail.body, o.sendFail.status);
      return reply({ ok: true, from: body.from, to: body.to, to_email: 'b***@zaedem.by', rows: 14 });
    }
    return reply({});
  });
  await page.goto(base);
  const noH = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  const login = async () => {
    await page.fill('#loginEmail', 'user'); await page.fill('#loginPass', o.tmpPass || 'Temp-pass-123');
    await page.click('#loginWrap .login-btn');
  };
  return { page, ctx, browser, srv, errs, log, dlg, state, noH, login, json,
    close: async () => { await browser.close(); srv.close(); },
    // ошибки консоли без «Failed to load resource» (его браузер пишет на любой 4xx, когда заглушка отвечает так специально)
    realErrs: () => errs.filter(e => !/Failed to load resource/.test(e)) };
}

const menuPages = (page) => page.$$eval('#app .sb-nav .ni', els => els.filter(e => getComputedStyle(e).display !== 'none')
  .map(e => (/showPage\('([a-z]+)'/.exec(e.getAttribute('onclick') || '') || [])[1]));
const visiblePage = (page) => page.$$eval('.page.on', els => els.map(e => e.id.replace('page-', '')).join(','));
const T = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); return e ? e.innerText : ''; }, sel);

// ═══ 1. Три роли: меню, имя и роль вверху, запросы, брони ═══
async function scenRoles(vw, vh) {
  const res = {};
  const EXPECT = {
    admin: ['dashboard', 'bookings', 'applications', 'hotels', 'invite', 'newobj', 'moderation', 'tourists', 'staff', 'agentika', 'pay', 'reports', 'logs', 'audit'],
    accountant: ['bookings', 'agentika', 'pay', 'reports'],
    support: ['bookings'],
  };
  const HOME = { admin: 'dashboard', accountant: 'pay', support: 'bookings' };
  for (const role of ['admin', 'accountant', 'support']) {
    const a = await openApp(vw, vh, { role });
    const { page, log } = a, k = (n) => role + '.' + n;
    await a.login();
    await page.waitForSelector('#app', { state: 'visible' }); await page.waitForTimeout(700);
    res[k('menu')] = JSON.stringify(await menuPages(page)) === JSON.stringify(EXPECT[role]);
    res[k('who')] = (await T(page, '#tbUserName')) === PEOPLE[role].name && (await T(page, '#tbUserRole')).trim().toLowerCase() === ROLE_RU[role].toLowerCase()
      && (await page.textContent('#sbRole')) === ROLE_RU[role] && (await page.textContent('#sbName')) === PEOPLE[role].name;
    res[k('whoVisible')] = await page.$eval('#tbUser', e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right <= window.innerWidth + 1 && getComputedStyle(e).display !== 'none'; });
    res[k('home')] = (await visiblePage(page)) === HOME[role];
    if (vw > 760) {   // на телефоне подписи разделов меню скрыты стилями
      const secs = await page.$$eval('#app .sb-nav .sb-sec', els => els.filter(e => getComputedStyle(e).display !== 'none').map(e => e.textContent.trim()));
      res[k('sections')] = JSON.stringify(secs) === JSON.stringify({ admin: ['Главное', 'Партнёры', 'Пользователи', 'Островок', 'Компания', 'Сервер'], accountant: ['Главное', 'Островок', 'Компания'], support: ['Главное'] }[role]);
    }
    // обход доступных разделов: без ошибок, без горизонтальной прокрутки
    let hs = true;
    for (const pg of EXPECT[role]) {
      await page.evaluate(n => showPage(n, null), pg); await page.waitForTimeout(250);
      if (!(await a.noH())) hs = false;
      if ((await visiblePage(page)) !== pg) res[k('open.' + pg)] = false;
    }
    res[k('screensNoHScroll')] = hs;
    // раздел не для роли → «Нет доступа» без запросов и пустой страницы
    if (role !== 'admin') {
      const n0 = a.log.length;
      await page.evaluate(() => showPage('staff', null)); await page.waitForTimeout(200);
      res[k('noaccessScreen')] = (await visiblePage(page)) === 'noaccess' && /Нет доступа/.test(await T(page, '#page-noaccess')) && a.log.length === n0 && await a.noH();
      await page.evaluate(() => showPage('dashboard', null));
      res[k('noaccessDashboard')] = (await visiblePage(page)) === 'noaccess';
    }
    // запросы
    res[k('noForbiddenCalls')] = log.filter(r => r.status === 403).length === 0;
    const paths = log.map(r => r.p).filter(p => p !== '/api/users/login');   // сам вход — не запрос данных
    if (role === 'accountant') res[k('onlyAllowed')] = !paths.some(p => /^\/api\/(applications|users|hotels|cities|ostrovok|admin\/(logs|audit|nearby|staff))/.test(p) || p === '/api/bookings/stats') && paths.includes('/api/admin/reminders');
    if (role === 'support') res[k('onlyAllowed')] = !paths.some(p => /^\/api\/(applications|users|hotels|cities|ostrovok|agentika|admin)/.test(p)) && paths.includes('/api/bookings');
    if (role === 'admin') res[k('adminLoadsAll')] = ['/api/bookings', '/api/applications', '/api/users', '/api/hotels'].every(p => paths.includes(p));
    // брони
    await page.evaluate(() => showPage('bookings', null)); await page.waitForTimeout(300);
    const head = await page.$$eval('#bookings-table tr:first-child th', ths => ths.map(t => t.textContent).join('|'));   // textContent: innerText отдаёт заголовки ПРОПИСНЫМИ из-за CSS
    const body = await T(page, '#bookings-table');
    const btns = await page.$$eval('#bookings-table button', bs => bs.map(b => b.innerText.trim()));
    if (role === 'accountant') {
      res[k('bk.noGuest')] = !/Гость/.test(head) && !/anna@test|boris@test|Анна Гостева|\+375/.test(body);
      res[k('bk.noJournalNoCancel')] = !btns.includes('Журнал') && !btns.includes('✗') && btns.includes('Детали');
      await page.evaluate(() => showBooking('b1')); const det = await T(page, '#modal-body');
      res[k('bk.detailsNoGuest')] = /Отель/.test(det) && !/Гость:|Email:|Телефон:|журнал брони/.test(det) && !/anna@test/.test(det);
      await page.evaluate(() => closeModal());
      await page.evaluate(() => showBooking('b2')); const nc = await T(page, '#modal-body');
      res[k('bk.ncheckReadOnly')] = /Требует проверки/.test(nc) && !/Подтвердить|Отменить|Проверить у Островка/.test(nc);
      await page.evaluate(() => closeModal());
      await page.evaluate(() => showPage('agentika', null)); await page.waitForTimeout(300);
      res[k('agentika.adminBlocksHidden')] = await page.evaluate(() => ['dump-sec', 'rv-sec', 'nb-sec'].every(id => document.getElementById(id).offsetParent === null));
      res[k('agentika.noOstrovokCalls')] = !log.some(r => r.p.startsWith('/api/ostrovok') || r.p.startsWith('/api/admin/nearby'));
    } else {
      res[k('bk.guestShown')] = /Гость/.test(head) && /anna@test\.by/.test(body) && btns.includes('Журнал') && btns.includes('✗');
      await page.evaluate(() => showBooking('b2')); const nc = await T(page, '#modal-body');
      if (role === 'support') {
        res[k('bk.ncheckSupport')] = /Отменить/.test(nc) && /Проверить у Островка/.test(nc) && !/Подтвердить|только у нас/.test(nc);
      } else {
        res[k('bk.ncheckAdmin')] = /Подтвердить/.test(nc) && /Отменить/.test(nc) && /только у нас/.test(nc);
      }
      await page.evaluate(() => closeModal());
    }
    if (role === 'support') {
      // журнал открывается, отмена уходит обычным запросом (не «только у нас»)
      await page.evaluate(() => showJournal('ZD-1001')); await page.waitForSelector('#modal-body .jr-sec');
      res[k('journalOpens')] = /Источник/.test(await T(page, '#modal-body'));
      await page.evaluate(() => closeModal());
      await page.evaluate(() => adminCancelBooking('ZD-1001')); await page.waitForTimeout(300);
      const pr = log.find(r => r.m === 'PATCH' && r.p === '/api/bookings/ZD-1001/status');
      res[k('cancelRequest')] = !!pr && pr.body.status === 'cancelled' && !pr.body.local_only && pr.status === 200;
      res[k('noForbiddenAfterActions')] = log.filter(r => r.status === 403).length === 0;
    }
    res[k('noConsoleErrors')] = a.errs.length === 0;
    if (a.errs.length) console.log(role, a.errs.join('\n'));
    await a.close();
  }
  return res;
}

// ═══ 2. Любой 403 — «Нет доступа», без белого экрана ═══
async function scenForbidden(vw, vh) {
  const res = {};
  const a = await openApp(vw, vh, { role: 'support', force403: (m, p) => p === '/api/bookings' });
  await a.login();
  await a.page.waitForSelector('#app', { state: 'visible' }); await a.page.waitForTimeout(700);
  const note = await a.page.$eval('#adm-403', e => ({ shown: getComputedStyle(e).display !== 'none', t: e.innerText }));
  res.noteShown = note.shown && /Нет доступа/.test(note.t) && /Поддержка/.test(note.t);
  res.appAlive = await a.page.evaluate(() => document.getElementById('app').offsetParent !== null && document.body.innerText.length > 80 && !!document.querySelector('.page.on'));
  res.menuStillThere = (await menuPages(a.page)).join() === 'bookings';
  res.noHScroll = await a.noH();
  await a.page.evaluate(() => showPage('bookings', null));   // переход в раздел прячет плашку
  res.noteHiddenOnNav = await a.page.$eval('#adm-403', e => getComputedStyle(e).display === 'none');
  res.noPageErrors = a.errs.filter(e => /^pageerror/.test(e)).length === 0 && a.realErrs().length === 0;
  await a.close();
  return res;
}

// ═══ 3. Обязательная смена временного пароля ═══
async function scenTmpPassword(vw, vh, role) {
  const res = {}, k = (n) => role + '.' + n;
  const a = await openApp(vw, vh, { role, tmp: true });
  const { page } = a;
  await a.login();
  await page.waitForSelector('#pwWrap', { state: 'visible' });
  const vis = await page.evaluate(() => ({ app: document.getElementById('app').offsetParent !== null, login: document.getElementById('loginWrap').offsetParent !== null,
    tok: localStorage.getItem('admin_token'), old: document.getElementById('pwOld').value }));
  res[k('pwScreen')] = !vis.app && !vis.login && !vis.tok && /Смена временного пароля/.test(await T(page, '#pwWrap')) && vis.old === 'Temp-pass-123';
  await page.waitForTimeout(500);
  res[k('noApiBeforeChange')] = a.log.every(r => r.p === '/api/users/login');
  res[k('pwNoHScroll')] = await a.noH();
  // проверки на форме — без запросов
  const n0 = a.log.length, err = () => T(page, '#pwErr');
  await page.fill('#pwNew', 'short'); await page.fill('#pwNew2', 'short'); await page.click('#pwBtn');
  const e1 = await err();
  await page.fill('#pwNew', 'Newpass-12345'); await page.fill('#pwNew2', 'Other-12345'); await page.click('#pwBtn');
  const e2 = await err();
  await page.fill('#pwNew', 'Temp-pass-123'); await page.fill('#pwNew2', 'Temp-pass-123'); await page.click('#pwBtn');
  const e3 = await err();
  res[k('validation')] = /не короче 8/.test(e1) && /не совпадают/.test(e2) && /отличаться/.test(e3) && a.log.length === n0;
  // неверный временный пароль: сервер 401 — остаёмся на экране смены, сессию не рвём
  await page.fill('#pwOld', 'wrong-temp-pass'); await page.fill('#pwNew', 'Newpass-12345'); await page.fill('#pwNew2', 'Newpass-12345'); await page.click('#pwBtn');
  await page.waitForFunction(() => /Неверный текущий пароль/.test(document.getElementById('pwErr').innerText));
  res[k('wrongOldStays')] = await page.evaluate(() => document.getElementById('pwWrap').offsetParent !== null && document.getElementById('loginWrap').offsetParent === null);
  // обновили страницу посреди смены — токена на устройстве нет, снова форма входа
  // (проверим ниже отдельно); сейчас — успешная смена
  await page.fill('#pwOld', 'Temp-pass-123'); await page.click('#pwBtn');
  await page.waitForSelector('#app', { state: 'visible' }); await page.waitForTimeout(700);
  const st = await page.evaluate(() => ({ pw: document.getElementById('pwWrap').offsetParent !== null, tok: localStorage.getItem('admin_token'), who: document.getElementById('tbUserRole').textContent, adminToken }));
  res[k('changeBody')] = !!a.state.changed && a.state.changed.oldPassword === 'Temp-pass-123' && a.state.changed.newPassword === 'Newpass-12345';
  res[k('enteredAfterChange')] = !st.pw && !!st.tok && st.tok === st.adminToken && st.who.toLowerCase() === ROLE_RU[role].toLowerCase();
  const tokPayload = JSON.parse(Buffer.from(st.tok.split('.')[1], 'base64url').toString());
  res[k('newTokenWithoutTmp')] = !tokPayload.pwd_tmp && tokPayload.tv === 1;
  const after = a.log.filter(r => r.p === '/api/bookings');
  res[k('requestsUseNewToken')] = after.length > 0 && after.every(r => r.auth === 'Bearer ' + st.tok);
  res[k('noForbiddenAfter')] = a.log.filter(r => r.status === 403).length === 0;
  res[k('homeAfterChange')] = (await visiblePage(page)) === { admin: 'dashboard', accountant: 'pay', support: 'bookings' }[role];
  // после перезагрузки вход сохранён, экран смены не возвращается
  await page.reload(); await page.waitForSelector('#app', { state: 'visible' }); await page.waitForTimeout(400);
  res[k('reloadKeepsSession')] = await page.evaluate(() => document.getElementById('pwWrap').offsetParent === null && document.getElementById('app').offsetParent !== null);
  res[k('noPageErrors')] = a.realErrs().length === 0;
  await a.close();

  // обновили страницу, не сменив пароль, — токен не сохранялся, снова вход
  const b = await openApp(vw, vh, { role, tmp: true });
  await b.login(); await b.page.waitForSelector('#pwWrap', { state: 'visible' });
  await b.page.reload(); await b.page.waitForTimeout(500);
  res[k('reloadBeforeChangeAsksLogin')] = await b.page.evaluate(() => document.getElementById('loginWrap').offsetParent !== null && document.getElementById('app').offsetParent === null && !localStorage.getItem('admin_token'));
  await b.close();

  // «Назад ко входу»
  const c = await openApp(vw, vh, { role, tmp: true });
  await c.login(); await c.page.waitForSelector('#pwWrap', { state: 'visible' });
  await c.page.click('#pwWrap .login-link');
  res[k('backToLogin')] = await c.page.evaluate(() => document.getElementById('loginWrap').offsetParent !== null && document.getElementById('pwWrap').offsetParent === null && !localStorage.getItem('admin_token'));
  await c.close();
  return res;
}

// ═══ 4. «Доступ только через VPN» ═══
async function scenVpn(vw, vh) {
  const res = {};
  // а) при входе
  const a = await openApp(vw, vh, { loginVpn: true });
  await a.login(); await a.page.waitForSelector('#vpnWrap', { state: 'visible' });
  const v = await a.page.evaluate(() => ({ h: document.querySelector('#vpnWrap h1').innerText, btn: document.getElementById('vpnBtn').innerText,
    login: document.getElementById('loginWrap').offsetParent !== null, app: document.getElementById('app').offsetParent !== null, tok: localStorage.getItem('admin_token') }));
  res.loginVpnScreen = v.h === 'Подключите VPN и обновите страницу' && v.btn === 'Обновить страницу' && !v.login && !v.app && !v.tok && /Заедем\.by/.test(await T(a.page, '#vpnWrap'));
  res.loginVpnNoHScroll = await a.noH();
  const box = await a.page.$eval('#vpnWrap .login-box', e => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth; });
  res.loginVpnFits = box;
  await a.page.click('#vpnBtn'); await a.page.waitForLoadState('load'); await a.page.waitForTimeout(300);
  res.refreshReturnsToLogin = await a.page.evaluate(() => document.getElementById('loginWrap').offsetParent !== null);
  res.loginVpnNoErrors = a.realErrs().length === 0;
  await a.close();

  // б) уже открытая панель: любой запрос ответил vpn_required — экран VPN, вход на устройстве остаётся; включили VPN — панель открывается
  let blocked = true;
  const b = await openApp(vw, vh, { stored: 'accountant', vpnAfterLogin: () => blocked });
  await b.page.waitForSelector('#vpnWrap', { state: 'visible' });
  res.sessionVpnScreen = await b.page.evaluate(() => document.getElementById('app').offsetParent === null && !!localStorage.getItem('admin_token'));
  blocked = false;
  await b.page.reload(); await b.page.waitForSelector('#app', { state: 'visible' }); await b.page.waitForTimeout(500);
  res.afterVpnOpens = await b.page.evaluate(() => document.getElementById('vpnWrap').offsetParent === null) && (await visiblePage(b.page)) === 'pay';
  await b.close();

  // в) сервер без флага vpn_required, только текст
  const c = await openApp(vw, vh, { stored: 'support', vpnTextOnly: () => true });
  await c.page.waitForSelector('#vpnWrap', { state: 'visible' });
  res.textOnlyVpn = true;
  await c.close();
  return res;
}

// ═══ 5. Сотрудники ═══
async function scenStaff(vw, vh) {
  const res = {};
  const a = await openApp(vw, vh, { role: 'admin', tempPassword: 'Zx7mQ2pLw9RtYb4N' });
  const { page, log, dlg } = a;
  await a.login(); await page.waitForSelector('#app', { state: 'visible' }); await page.waitForTimeout(500);
  await page.evaluate(() => showPage('staff', null)); await page.waitForSelector('#st-list table');
  const rowsOf = () => page.$$eval('#st-list tr', trs => trs.slice(1).map(tr => tr.innerText.replace(/\s+/g, ' ')));
  const rows = await rowsOf();
  res.list = rows.length === 3 && rows.some(r => /Анна Бухгалтерова/.test(r) && /Бухгалтер/.test(r) && /Активен/.test(r))
    && rows.some(r => /Олег Поддержкин/.test(r) && /Выключен/.test(r) && /Включить/.test(r));
  res.selfNoButtons = rows.some(r => /Иван Директоров/.test(r) && /Директор/.test(r) && /это вы/.test(r) && !/Выключить|Сменить роль|Сбросить/.test(r));
  res.noHScroll1 = await a.noH();
  const mut = () => log.filter(r => r.m !== 'GET' && r.p.startsWith('/api/admin/staff')).length;

  // добавить: проверки формы, отказ в подтверждении, успех
  await page.click('text=＋ Добавить сотрудника'); await page.waitForSelector('#st-email');
  res.addFormNoHScroll = await a.noH();
  await page.fill('#st-email', 'не-почта'); await page.click('#st-add-btn');
  res.addValidEmail = /e-mail/.test(await T(page, '#st-err')) && mut() === 0;
  await page.fill('#st-email', 'new@zaedem.by'); await page.click('#st-add-btn');
  res.addValidName = /имя/.test(await T(page, '#st-err')) && mut() === 0;
  await page.fill('#st-name', 'Мария Новая'); await page.selectOption('#st-role', 'support');
  dlg.accept = false; dlg.log.length = 0;
  await page.click('#st-add-btn'); await page.waitForTimeout(250);
  res.addConfirmAsked = dlg.log.length === 1 && /Мария Новая/.test(dlg.log[0]) && /new@zaedem\.by/.test(dlg.log[0]) && /Поддержка/.test(dlg.log[0]);
  res.addDeclinedNoRequest = mut() === 0;
  dlg.accept = true;
  await page.click('#st-add-btn'); await page.waitForSelector('#st-pwd');
  const pc = log.find(r => r.m === 'POST' && r.p === '/api/admin/staff');
  res.addRequest = !!pc && JSON.stringify(pc.body) === JSON.stringify({ email: 'new@zaedem.by', name: 'Мария Новая', role: 'support' });
  res.tempPasswordShown = (await T(page, '#st-pwd')) === 'Zx7mQ2pLw9RtYb4N' && /один раз/.test(await T(page, '#modal-body'));
  res.pwdNoHScroll = await a.noH();
  res.pwdFits = await page.$eval('#st-pwd', e => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth; });
  await page.waitForTimeout(300);
  res.listRefreshed = (await rowsOf()).some(r => /Мария Новая/.test(r) && /Не сменил временный пароль/.test(r));
  await page.click('#modal .modal-btn-cancel'); await page.waitForTimeout(200);
  res.passwordGoneAfterClose = !(await page.evaluate(() => document.body.textContent.includes('Zx7mQ2pLw9RtYb4N'))) && await page.evaluate(() => !document.getElementById('modal').classList.contains('open'));

  // смена роли
  const rowBtn = async (who, label) => { await page.click(`#st-list tr:has-text("${who}") >> text=${label}`); };
  dlg.accept = false; dlg.log.length = 0; const m0 = mut();
  await rowBtn('Анна Бухгалтерова', 'Сменить роль'); await page.waitForSelector('#st-newrole');
  await page.selectOption('#st-newrole', 'support'); await page.click('#modal >> text=Сменить роль >> nth=-1');
  await page.waitForTimeout(250);
  res.roleConfirmAsked = dlg.log.length === 1 && /Анна Бухгалтерова/.test(dlg.log[0]) && /Бухгалтер → Поддержка/.test(dlg.log[0]);
  res.roleDeclinedNoRequest = mut() === m0;
  dlg.accept = true;
  await page.click('#modal >> text=Сменить роль >> nth=-1'); await page.waitForTimeout(400);
  const pr = log.find(r => r.m === 'PATCH' && r.p === '/api/admin/staff/u-acc');
  res.roleRequest = !!pr && JSON.stringify(pr.body) === JSON.stringify({ role: 'support' });
  res.roleShown = (await rowsOf()).some(r => /Анна Бухгалтерова/.test(r) && /Поддержка/.test(r));

  // включить / выключить
  dlg.accept = false; dlg.log.length = 0;
  await rowBtn('Олег Поддержкин', 'Включить'); await page.waitForTimeout(200);
  res.enableDeclined = dlg.log.length === 1 && /Включить сотрудника/.test(dlg.log[0]) && !log.some(r => /\/enable$/.test(r.p));
  dlg.accept = true;
  await rowBtn('Олег Поддержкин', 'Включить'); await page.waitForTimeout(400);
  res.enableRequest = log.some(r => r.m === 'POST' && r.p === '/api/admin/staff/u-sup/enable') && (await rowsOf()).some(r => /Олег/.test(r) && /Активен/.test(r) && /Выключить/.test(r));
  dlg.accept = false; dlg.log.length = 0;
  await rowBtn('Олег Поддержкин', 'Выключить'); await page.waitForTimeout(200);
  res.disableDeclined = dlg.log.length === 1 && /Выключить сотрудника/.test(dlg.log[0]) && !log.some(r => /\/disable$/.test(r.p));
  dlg.accept = true;
  await rowBtn('Олег Поддержкин', 'Выключить'); await page.waitForTimeout(400);
  res.disableRequest = log.some(r => r.m === 'POST' && r.p === '/api/admin/staff/u-sup/disable') && (await rowsOf()).some(r => /Олег/.test(r) && /Выключен/.test(r));

  // сброс пароля
  dlg.accept = false; dlg.log.length = 0; const m1 = mut();
  await rowBtn('Олег Поддержкин', 'Сбросить пароль'); await page.waitForTimeout(200);
  res.resetDeclined = dlg.log.length === 1 && /Сбросить пароль/.test(dlg.log[0]) && mut() === m1;
  dlg.accept = true;
  await rowBtn('Олег Поддержкин', 'Сбросить пароль'); await page.waitForSelector('#st-pwd');
  res.resetRequest = log.some(r => r.m === 'POST' && r.p === '/api/admin/staff/u-sup/reset-password') && (await T(page, '#st-pwd')) === 'Zx7mQ2pLw9RtYb4N';
  await page.keyboard.press('Escape'); await page.click('#modal .modal-btn-cancel'); await page.waitForTimeout(200);
  res.resetPasswordGone = !(await page.evaluate(() => document.body.textContent.includes('Zx7mQ2pLw9RtYb4N')));
  res.noHScroll2 = await a.noH();
  res.noErrors = a.errs.length === 0;
  if (a.errs.length) console.log(a.errs.join('\n'));
  await a.close();

  // ошибка сервера при создании и выключенный раздел
  const b = await openApp(vw, vh, { role: 'admin', createError: 'Этот e-mail уже занят другой учётной записью — нужен отдельный адрес сотрудника' });
  await b.login(); await b.page.waitForSelector('#app', { state: 'visible' });
  await b.page.evaluate(() => showPage('staff', null)); await b.page.waitForSelector('#st-list table');
  await b.page.click('text=＋ Добавить сотрудника'); await b.page.fill('#st-email', 'busy@zaedem.by'); await b.page.fill('#st-name', 'Занятый'); await b.page.click('#st-add-btn');
  await b.page.waitForFunction(() => /уже занят/.test(document.getElementById('st-err').innerText));
  res.createErrorShown = !(await b.page.evaluate(() => !!document.getElementById('st-pwd')));
  await b.close();
  const c = await openApp(vw, vh, { role: 'admin', staffOff: true });
  await c.login(); await c.page.waitForSelector('#app', { state: 'visible' });
  await c.page.evaluate(() => showPage('staff', null)); await c.page.waitForFunction(() => /STAFF_ACCOUNTS/.test(document.getElementById('st-list').innerText));
  res.staffOffMessage = await c.noH();
  await c.close();
  return res;
}

// ═══ 6. Отчёты ═══
async function scenReports(vw, vh, role) {
  const res = {}, k = (n) => role + '.' + n;
  const a = await openApp(vw, vh, { role });
  const { page, log, dlg } = a;
  await a.login(); await page.waitForSelector('#app', { state: 'visible' }); await page.waitForTimeout(400);
  await page.evaluate(() => showPage('reports', null)); await page.waitForSelector('#rp-auto table');
  const vals = () => page.evaluate(() => [document.getElementById('rp-from').value, document.getElementById('rp-to').value]);
  const press = async (label) => { await page.click(`#rp-pre >> text=${label}`); return vals(); };
  const eq = (x, y) => JSON.stringify(x) === JSON.stringify(y);
  // быстрые периоды — по Минску
  const cases = [
    ['2026-10-23T09:00:00Z', { 'Вчера': ['2026-10-22', '2026-10-22'], 'Прошлая неделя': ['2026-10-12', '2026-10-18'], 'Прошлый месяц': ['2026-09-01', '2026-09-30'], 'Этот месяц': ['2026-10-01', '2026-10-23'] }],
    ['2026-10-31T22:30:00Z', { 'Вчера': ['2026-10-31', '2026-10-31'], 'Прошлая неделя': ['2026-10-19', '2026-10-25'], 'Прошлый месяц': ['2026-10-01', '2026-10-31'], 'Этот месяц': ['2026-11-01', '2026-11-01'] }],   // в Минске уже 1 ноября, воскресенье
    ['2027-01-01T05:00:00Z', { 'Вчера': ['2026-12-31', '2026-12-31'], 'Прошлая неделя': ['2026-12-21', '2026-12-27'], 'Прошлый месяц': ['2026-12-01', '2026-12-31'], 'Этот месяц': ['2027-01-01', '2027-01-01'] }],   // начало года
    ['2026-10-26T04:00:00Z', { 'Прошлая неделя': ['2026-10-19', '2026-10-25'] }],   // понедельник
  ];
  let presetsOk = true;
  for (const [iso, exp] of cases) {
    await page.clock.setFixedTime(new Date(iso));
    for (const lbl of Object.keys(exp)) { if (!eq(await press(lbl), exp[lbl])) { presetsOk = false; console.log('  пресет', iso, lbl, await vals(), exp[lbl]); } }
  }
  res[k('presets')] = presetsOk;
  await page.clock.setFixedTime(new Date('2026-10-23T09:00:00Z'));
  await press('Прошлый месяц');
  res[k('presetHighlight')] = await page.$eval('#rp-pre button.on', b => b.innerText) === 'Прошлый месяц';
  await page.fill('#rp-from', '2026-09-05');
  res[k('manualClearsHighlight')] = await page.$$eval('#rp-pre button.on', b => b.length) === 0;
  await press('Прошлый месяц');
  res[k('noHScroll1')] = await a.noH();
  // скачать Excel
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#rp-dl')]);
  const dpath = await dl.path();
  const ex = log.find(r => r.p === '/api/admin/reports/export');
  res[k('downloadRequest')] = !!ex && ex.m === 'GET' && ex.q === '?from=2026-09-01&to=2026-09-30' && /^Bearer /.test(ex.auth);
  res[k('downloadFile')] = dl.suggestedFilename() === 'zaedem_otchet_2026-09-01_2026-09-30.xlsx' && fs.readFileSync(dpath).toString('latin1').startsWith('PK');
  await page.waitForFunction(() => /Файл скачан/.test(document.getElementById('rp-msg').innerText));
  res[k('downloadMsg')] = true;
  // отправить бухгалтеру: отказ → без запроса; согласие → POST
  dlg.accept = false; dlg.log.length = 0;
  await page.click('#rp-send'); await page.waitForTimeout(250);
  res[k('sendConfirmAsked')] = dlg.log.length === 1 && /01\.09\.2026 — 30\.09\.2026/.test(dlg.log[0]) && !log.some(r => r.p === '/api/admin/reports/send');
  dlg.accept = true;
  const st0 = log.filter(r => r.p === '/api/admin/reports/status').length;
  await page.click('#rp-send'); await page.waitForFunction(() => /Отправлено/.test(document.getElementById('rp-msg').innerText));
  const sr = log.find(r => r.p === '/api/admin/reports/send');
  const msg = await T(page, '#rp-msg');
  res[k('sendRequest')] = !!sr && sr.m === 'POST' && JSON.stringify(sr.body) === JSON.stringify({ from: '2026-09-01', to: '2026-09-30' });
  res[k('sendMsg')] = /b\*\*\*@zaedem\.by/.test(msg) && /01\.09\.2026 — 30\.09\.2026/.test(msg) && /строк: 14/.test(msg);
  await page.waitForTimeout(300);
  res[k('statusRefreshedAfterSend')] = log.filter(r => r.p === '/api/admin/reports/status').length > st0;
  // автоотправка: что и когда отправлено, следующая
  const auto = await T(page, '#rp-auto');
  res[k('autoState')] = /Автоотправка работает/.test(auto) && /b\*\*\*@zaedem\.by/.test(auto) && /08:00 по Минску/.test(auto) && /Не ушло вовремя: 1/.test(auto);
  const arows = await page.evaluate(() => [...document.querySelectorAll('#rp-auto .tw-x')[0].querySelectorAll('tr')].slice(1).map(tr => tr.innerText.replace(/\s+/g, ' ')));
  res[k('autoLastNext')] = arows.length === 4
    && arows.some(r => /Ежедневный/.test(r) && /Отправлено/.test(r) && /23\.10\.2026/.test(r) && /08:00/.test(r) && /22\.10\.2026/.test(r) && /24 октября 2026 08:00/.test(r))
    && arows.some(r => /Еженедельный/.test(r) && /Не отправлено/.test(r) && /12\.10\.2026 — 18\.10\.2026/.test(r) && /26 октября 2026 08:00/.test(r))
    && arows.some(r => /Ежемесячный/.test(r) && /ещё не отправлялся/.test(r) && /02 ноября 2026 08:00/.test(r) && /01\.10\.2026 — 31\.10\.2026/.test(r))
    && arows.some(r => /Сроки оплаты Агентике/.test(r));
  const hist = await page.evaluate(() => [...document.querySelectorAll('#rp-auto .tw-x')[1].querySelectorAll('tr')].slice(1).map(tr => tr.innerText.replace(/\s+/g, ' ')));
  res[k('autoHistory')] = hist.length === 3 && hist.some(r => /Вручную/.test(r) && /01\.09\.2026 — 30\.09\.2026/.test(r) && /строк: 220/.test(r)) && hist.some(r => /Сроки оплаты/.test(r) && /в день срока/.test(r));
  res[k('noHScroll2')] = await a.noH();
  // пустой период — без запроса
  await page.fill('#rp-from', ''); const n0 = log.length;
  await page.click('#rp-dl'); await page.waitForTimeout(200);
  res[k('emptyPeriod')] = /Выберите период/.test(await T(page, '#rp-msg')) && log.length === n0;
  await page.fill('#rp-from', '2026-09-30'); await page.fill('#rp-to', '2026-09-01');
  await page.click('#rp-send'); await page.waitForTimeout(200);
  res[k('reversedPeriod')] = /позже/.test(await T(page, '#rp-msg')) && log.length === n0;
  res[k('noForbidden')] = log.filter(r => r.status === 403).length === 0;
  res[k('noErrors')] = a.errs.length === 0;
  if (a.errs.length) console.log(a.errs.join('\n'));
  await a.close();

  // ошибки сервера при отправке и выгрузке
  for (const [name, sf, want] of [
    ['send409', { status: 409, body: { error: 'BUH_EMAIL не задан — отправлять некуда' } }, /отправлять некуда/],
    ['send502', { status: 502, body: { error: 'Почта не приняла письмо — повторите позже' } }, /Почта не приняла письмо/],
    ['send400', { status: 400, body: { error: 'Период — не больше 13 месяцев' } }, /13 месяцев/],
  ]) {
    const b = await openApp(vw, vh, { role, sendFail: sf });
    await b.login(); await b.page.waitForSelector('#app', { state: 'visible' });
    await b.page.evaluate(() => showPage('reports', null)); await b.page.waitForSelector('#rp-auto table');
    await b.page.click('#rp-send'); await b.page.waitForFunction(() => document.getElementById('rp-msg').classList.contains('err'));
    res[k(name)] = want.test(await T(b.page, '#rp-msg')) && b.realErrs().length === 0 && (await b.page.$eval('#rp-send', e => !e.disabled));
    await b.close();
  }
  const e1 = await openApp(vw, vh, { role, exportError: 'Период — не больше 13 месяцев' });
  await e1.login(); await e1.page.waitForSelector('#app', { state: 'visible' });
  await e1.page.evaluate(() => showPage('reports', null)); await e1.page.waitForSelector('#rp-auto table');
  await e1.page.click('#rp-dl'); await e1.page.waitForFunction(() => document.getElementById('rp-msg').classList.contains('err'));
  res[k('exportError')] = /13 месяцев/.test(await T(e1.page, '#rp-msg')) && (await e1.page.$eval('#rp-dl', e => !e.disabled)) && e1.realErrs().length === 0;
  await e1.close();

  // отчёты на сервере выключены (404), автоотправка не работает
  const off = await openApp(vw, vh, { role, reportsOff: true });
  await off.login(); await off.page.waitForSelector('#app', { state: 'visible' });
  await off.page.evaluate(() => showPage('reports', null)); await off.page.waitForFunction(() => /BUH_REPORTS/.test(document.getElementById('rp-auto').innerText));
  await off.page.click('#rp-dl'); await off.page.waitForFunction(() => /BUH_REPORTS/.test(document.getElementById('rp-msg').innerText));
  res[k('reportsOff')] = off.realErrs().length === 0 && await off.noH();
  await off.close();
  const bad = await openApp(vw, vh, { role });
  bad.state.statusOverride = Object.assign(STATUS_OK(), { auto: false, schema_ready: false, buh_email: null, last: {}, recent: [], pending: [] });
  await bad.login(); await bad.page.waitForSelector('#app', { state: 'visible' });
  await bad.page.evaluate(() => showPage('reports', null)); await bad.page.waitForSelector('#rp-auto table');
  const bt = await T(bad.page, '#rp-auto');
  res[k('autoOffText')] = /Автоотправка не работает/.test(bt) && /не задан/.test(bt) && /Отправок пока не было/.test(bt) && /ещё не отправлялся/.test(bt) && bad.realErrs().length === 0 && await bad.noH();
  await bad.close();
  return res;
}

// ═══ запуск ═══
(async () => {
  let fail = 0, total = 0;
  const report = (name, vw, vh, r) => {
    const keys = Object.keys(r); total += keys.length;
    for (const key of keys) if (!r[key]) { fail++; console.log(`FAIL ${vw}x${vh} ${name}: ${key}`); }
    console.log(`${vw}x${vh} ${name}: ${keys.filter(x => r[x]).length}/${keys.length} ok`);
  };
  for (const [vw, vh] of [[1366, 768], [390, 844]]) {
    report('роли', vw, vh, await scenRoles(vw, vh));
    report('403', vw, vh, await scenForbidden(vw, vh));
    for (const role of ['accountant', 'support', 'admin']) report('смена пароля ' + role, vw, vh, await scenTmpPassword(vw, vh, role));
    report('VPN', vw, vh, await scenVpn(vw, vh));
    report('сотрудники', vw, vh, await scenStaff(vw, vh));
    for (const role of ['admin', 'accountant']) report('отчёты ' + role, vw, vh, await scenReports(vw, vh, role));
  }
  console.log(`\nВсего проверок: ${total}, не прошло: ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
