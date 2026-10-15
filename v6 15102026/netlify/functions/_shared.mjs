// Общие helpers для всех функций
import { getStore } from './_blobs.mjs';
import crypto from 'node:crypto';
import { BOT_TOKEN_FALLBACK, BOT_USERNAME, MENU_TEXT } from './_config.mjs';

export { BOT_USERNAME, MENU_TEXT };

export const STORE_NAME = 'kinofik';
let _store = null;
// ленивая инициализация, чтобы функция не падала на этапе импорта
export const db = () => (_store || (_store = getStore(STORE_NAME)));

/* ---------- конфигурация (токен бота) ---------- */
export async function getConfig() {
  const env = (process.env.BOT_TOKEN || '').trim();
  if (env) return { token: env, source: 'env' };
  try {
    const stored = await db().get('config:token');
    if (stored && stored.trim()) return { token: stored.trim(), source: 'store' };
  } catch (e) { /* ignore */ }
  if (BOT_TOKEN_FALLBACK) return { token: BOT_TOKEN_FALLBACK, source: 'fallback' };
  return { token: '', source: null };
}

export const SOURCE_LABEL = {
  env: 'переменной окружения BOT_TOKEN',
  store: 'защищённого хранилища Netlify (задан через /setup)',
  fallback: 'файла netlify/functions/_config.mjs (токен вписан заранее)',
};

/* ---------- полная настройка бота: вебхук + кнопка + команды ----------
   WH_VERSION поднимайте, когда изменился набор allowed_updates или состав
   команд: api.mjs в `hello` сверяет сохранённый config:whver с этой версией
   и при расхождении молча перерегистрирует вебхук (самообновление деплоя).
   2 — добавлен inline-режим (@kino_fik_bot название фильма в любом чате). */
export const WH_VERSION = 2;
export const BOT_COMMANDS = [
  { command: 'tonight', description: '🌙 Что посмотреть сегодня вдвоём' },
  { command: 'match', description: '💞 Общие мэтчи' },
  { command: 'matches', description: '🍿 Наши мэтчи' },
  { command: 'week', description: '📬 Кино-итоги недели' },
  { command: 'code', description: '👥 Мой код для пары' },
  { command: 'pair', description: '💞 Заявка партнёру по коду' },
  { command: 'diary', description: '📔 Дневник пары' },
  { command: 'games', description: '🎮 Игры с партнёром' },
  { command: 'profile', description: '👤 Мой профиль' },
  { command: 'notify', description: '🔔 Какие уведомления присылать' },
  { command: 'silent', description: '🔕 Ничего не присылать 7 дней' },
  { command: 'reset', description: '🧹 Сбросить мои оценки' },
  { command: 'help', description: '❓ Как это работает' },
];

/* ---------- секрет вебхука ----------
   Пустое значение = защита ещё не включена (деплой, где /setup не запускали
   после обновления). bot.mjs в этом случае апдейты принимает, но предупреждает:
   лучше заблокировать бота, чем оставить его открытым без ведома владельца. */
export async function getWebhookSecret() {
  try { return (await db().get('config:whsecret')) || ''; } catch (e) { return ''; }
}
export async function setWebhookSecret(v) {
  try { await db().set('config:whsecret', String(v || '')); } catch (e) { /* не критично */ }
  return v;
}

export async function runSetup(token, site) {
  const out = [];
  const webhookUrl = site + '/.netlify/functions/bot';
  const appUrl = site + '/';

  const me = await tg('getMe', {}, token);
  if (!me.ok) {
    out.push({ ok: false, step: 'Проверка токена', text: me.description || 'Токен недействителен' });
    return { results: out, bot: null };
  }
  out.push({ ok: true, step: 'Бот найден', text: `@${me.result.username} · «${me.result.first_name}»` });

  /* ---------- вебхук + секретный токен ----------
     Без secret_token любой, кто знает адрес сайта, может POST'ом подделать
     апдейт от чужого имени (bot.mjs доверяет полю from). Telegram тогда
     присылает заголовок X-Telegram-Bot-Api-Secret-Token, и мы его сверяем.
     Секрет СОХРАНЯЕМ только после успешного setWebhook: иначе при ошибке
     бот оказался бы заблокирован собственным же фильтром. */
  const secret = crypto.randomBytes(24).toString('base64url');
  const wh = await tg('setWebhook', {
    url: webhookUrl, allowed_updates: ['message', 'callback_query', 'inline_query'], max_connections: 40,
    secret_token: secret,
  }, token);
  if (wh.ok) {
    await setWebhookSecret(secret);
    // помечаем, под какой версией настроек зарегистрирован вебхук —
    // по ней hello понимает, что деплой нужно тихо перенастроить
    try { await db().set('config:whver', String(WH_VERSION)); } catch (e) { /* не критично */ }
  }
  out.push({ ok: !!wh.ok, step: 'Вебхук (бот получает сообщения)', text: wh.ok ? webhookUrl + ' (защищён секретом)' : (wh.description || 'ошибка') });

  const st = await getSettings();
  const mb = await tg('setChatMenuButton', {
    menu_button: { type: 'web_app', text: st.menuText || MENU_TEXT, web_app: { url: appUrl } },
  }, token);
  out.push({ ok: !!mb.ok, step: 'Кнопка слева от поля ввода', text: mb.ok ? `«${MENU_TEXT}»` : (mb.description || 'ошибка') });

  const cmds = await tg('setMyCommands', { commands: BOT_COMMANDS }, token);
  out.push({ ok: !!cmds.ok, step: 'Список команд', text: cmds.ok ? BOT_COMMANDS.map((c) => '/' + c.command).join(' ') : (cmds.description || 'ошибка') });

  const info = await tg('getWebhookInfo', {}, token);
  if (info.ok && info.result) {
    const r = info.result;
    out.push({
      ok: r.url === webhookUrl && !r.last_error_message,
      step: 'Статус вебхука',
      text: r.last_error_message
        ? `ошибка: ${r.last_error_message}`
        : `активен, обновлений в очереди: ${r.pending_update_count || 0}`,
    });
  }

  try {
    const probe = await fetch(site + '/data/movies.json');
    if (probe.ok) {
      const j = await probe.json();
      out.push({ ok: true, step: 'Каталог на сайте', text: `${j.count} фильмов и сериалов` });
    } else {
      out.push({ ok: false, step: 'Каталог на сайте', text: 'файл /data/movies.json не найден' });
    }
  } catch (e) {
    out.push({ ok: false, step: 'Каталог на сайте', text: 'не удалось проверить: ' + e.message });
  }

  return { results: out, bot: me.result };
}

export function siteUrl(req) {
  // ГЛАВНЫЙ источник — адрес, с которого реально пришёл запрос.
  // Он всегда актуален: переживает переименование сайта, кастомные домены и т.п.
  // (process.env.URL вшивается в деплой и устаревает после переименования —
  //  именно из-за этого вебхук однажды указал на мёртвый адрес)
  if (req && typeof req.url === 'string' && /^https?:\/\//i.test(req.url)) {
    try { return new URL(req.url).origin; } catch (e) { /* ниже запасные варианты */ }
  }
  const h = req && req.headers;
  const fwd = h && (h.get ? (h.get('x-forwarded-host') || h.get('host')) : (h['x-forwarded-host'] || h.host));
  if (fwd) return 'https://' + String(fwd).split(',')[0].trim();
  const u = (process.env.URL || process.env.DEPLOY_PRIME_URL || '').trim();
  return u ? u.replace(/\/$/, '') : '';
}

// Жив ли указанный адрес сайта (используем, чтобы понять, надо ли перенастраивать бота)
export async function siteAlive(site) {
  if (!site) return false;
  try {
    const r = await fetch(site + '/data/movies.json', { method: 'HEAD' });
    return r.ok;
  } catch (e) { return false; }
}

/* ---------- Telegram Bot API ---------- */
export async function tg(method, params, token) {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params || {}),
  });
  let j = null;
  try { j = await r.json(); } catch (e) { j = { ok: false, error: 'bad response' }; }
  return j;
}

/* ---------- отправка ФАЙЛА в Telegram (multipart) ----------
   Нужна для автобэкапа: sendDocument с JSON-дампом всех данных.
   FormData/Blob есть и в Node 18+, и в рантайме Netlify Functions. */
export async function tgUpload(method, params, token, fileField, fileName, fileBody, contentType) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(params || {})) {
    if (v == null) continue;
    fd.append(k, typeof v === 'string' ? v : JSON.stringify(v));
  }
  const blob = typeof fileBody === 'string'
    ? new Blob([fileBody], { type: contentType || 'application/octet-stream' })
    : fileBody;
  fd.append(fileField, blob, fileName);
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', body: fd });
  let j = null;
  try { j = await r.json(); } catch (e) { j = { ok: false, error: 'bad response' }; }
  return j;
}

/* ---------- проверка initData из Mini App ---------- */
export function parseInitData(initData, token) {
  if (!initData || !token) return null;
  try {
    const p = new URLSearchParams(initData);
    const hash = p.get('hash');
    if (!hash) return null;
    p.delete('hash');
    const pairs = [...p.entries()].map(([k, v]) => `${k}=${v}`).sort();
    const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
    const calc = crypto.createHmac('sha256', secret).update(pairs.join('\n')).digest('hex');
    if (calc !== hash) return null;

    const authDate = Number(p.get('auth_date') || 0);
    // защита от повтора: не старше 24 часов
    if (authDate && Date.now() / 1000 - authDate > 86400) return null;

    const user = JSON.parse(p.get('user') || 'null');
    if (!user || !user.id) return null;
    return user;
  } catch (e) { return null; }
}

/* ---------- хранилище пользователей ---------- */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // без похожих символов
export function genCode() {
  let s = '';
  const b = crypto.randomBytes(6);
  for (let i = 0; i < 5; i++) s += ALPHABET[b[i] % ALPHABET.length];
  return s;
}

// приводим старого пользователя (partnerId) к новому виду (partners[])
export function normUser(u) {
  if (!u) return u;
  if (!Array.isArray(u.partners)) u.partners = u.partnerId ? [u.partnerId] : [];
  delete u.partnerId;
  // защита от дублей: партнёр не может быть в списке дважды (лечит старые баги)
  u.partners = [...new Set(u.partners.map(String))];
  return u;
}

export async function getUser(id) {
  const raw = await db().get('u:' + id);
  return raw ? normUser(JSON.parse(raw)) : null;
}

export async function allUserIds() {
  const raw = await db().get('users:index');
  return raw ? JSON.parse(raw) : [];
}

export async function ensureUser(tgUser) {
  const id = String(tgUser.id);
  let u = await getUser(id);
  const index = await allUserIds();
  if (!u) {
    let code = genCode();
    for (let i = 0; i < 8; i++) {
      if (!(await db().get('c:' + code))) break;
      code = genCode();
    }
    u = {
      id,
      code,
      first_name: tgUser.first_name || '',
      last_name: tgUser.last_name || '',
      username: tgUser.username || '',
      photo_url: tgUser.photo_url || '',
      partners: [],
      created: Date.now(),
    };
    await db().set('u:' + id, JSON.stringify(u));
    await db().set('c:' + code, id);
    if (!index.includes(id)) { index.push(id); await db().set('users:index', JSON.stringify(index)); }
    return { user: normUser(u), isNew: true };
  }
  // обновляем имя/юзернейм, если изменились
  const fresh = {
    first_name: tgUser.first_name || u.first_name,
    last_name: tgUser.last_name || '',
    username: tgUser.username || '',
    photo_url: tgUser.photo_url || u.photo_url,
  };
  if (fresh.first_name !== u.first_name || fresh.last_name !== (u.last_name || '') || fresh.username !== u.username || fresh.photo_url !== u.photo_url) {
    u = Object.assign(u, fresh);
    await db().set('u:' + id, JSON.stringify(u));
  }
  if (!index.includes(id)) { index.push(id); await db().set('users:index', JSON.stringify(index)); }
  return { user: normUser(u), isNew: false };
}

export async function saveUser(u) { await db().set('u:' + u.id, JSON.stringify(u)); }

/* ---------- авто-пара: если в боте ровно два человека ---------- */
export async function addPartner(aId, bId) {
  const a = await getUser(aId), b = await getUser(bId);
  if (!a || !b) return { ok: false, error: 'Пользователь не найден' };
  a.partners = a.partners || []; b.partners = b.partners || [];
  // проверяем ОБА списка: раньше дубль возникал, если связь была асимметричной
  if (a.partners.includes(bId) && b.partners.includes(aId)) {
    return { ok: false, error: 'Вы уже связаны с этим человеком', partner: b };
  }
  // Set убирает и старые дубли, и не даёт появиться новым при повторных связываниях
  a.partners = [...new Set([...a.partners.map(String), String(bId)])];
  b.partners = [...new Set([...b.partners.map(String), String(aId)])];
  delete a.noAuto; delete b.noAuto;
  await saveUser(a); await saveUser(b);
  return { ok: true, partner: b };
}

export async function removePartner(aId, bId) {
  const a = await getUser(aId), b = await getUser(bId);
  if (!a) return { ok: false, error: 'Пользователь не найден' };
  a.partners = (a.partners || []).filter((x) => x !== bId);
  await saveUser(a);
  if (b) { b.partners = (b.partners || []).filter((x) => x !== aId); await saveUser(b); }
  return { ok: true };
}

export async function linkByCode(me, code) {
  code = String(code || '').trim().toUpperCase();
  if (!code) return { ok: false, error: 'Введите код партнёра' };
  const otherId = await db().get('c:' + code);
  if (!otherId) return { ok: false, error: 'Такого кода нет. Проверьте регистр и символы.' };
  if (otherId === me.id) return { ok: false, error: 'Это ваш собственный код 🙂' };
  return addPartner(me.id, otherId);
}

/* ---------- заявки в партнёры (связь только после подтверждения) ---------- */
const PREQ_TTL = 72 * 3600e3; // заявка живёт 3 дня

export async function getPreqs(userId) {
  try {
    const raw = await db().get('preq:' + userId);
    const o = raw ? JSON.parse(raw) : {};
    const now = Date.now();
    return {
      in: (Array.isArray(o.in) ? o.in : []).filter((r) => r && r.from && now - (r.ts || 0) < PREQ_TTL),
      out: (Array.isArray(o.out) ? o.out : []).filter((r) => r && r.to && now - (r.ts || 0) < PREQ_TTL),
    };
  } catch (e) { return { in: [], out: [] }; }
}
export async function savePreqs(userId, o) { await db().set('preq:' + userId, JSON.stringify(o)); }

export async function addPreq(fromId, toId) {
  const theirs = await getPreqs(toId);
  if (theirs.in.some((r) => r.from === fromId)) return { ok: true, duplicate: true };
  theirs.in.push({ from: fromId, ts: Date.now() });
  if (theirs.in.length > 20) theirs.in = theirs.in.slice(-20);
  await savePreqs(toId, theirs);
  const mine = await getPreqs(fromId);
  mine.out = mine.out.filter((r) => r.to !== toId);
  mine.out.push({ to: toId, ts: Date.now() });
  if (mine.out.length > 20) mine.out = mine.out.slice(-20);
  await savePreqs(fromId, mine);
  return { ok: true };
}

export async function removePreq(fromId, toId) { // убирает заявку from→to у обоих
  const b = await getPreqs(toId);
  b.in = b.in.filter((r) => r.from !== fromId);
  await savePreqs(toId, b);
  const a = await getPreqs(fromId);
  a.out = a.out.filter((r) => r.to !== toId);
  await savePreqs(fromId, a);
}

// ввод кода партнёра: теперь создаёт ЗАЯВКУ, а не связывает мгновенно.
// Если второй уже отправил встречную заявку — оба сразу становятся партнёрами.
/* Общая логика заявки: «я хочу в партнёры к other».
   Используется и для пары по коду (startPairing), и для пары по поиску (preq.send).
   Если встречная заявка уже есть — сразу связываем (linked). */
export async function requestPairing(me, other) {
  const otherId = String(other.id);
  if ((me.partners || []).includes(otherId)) return { ok: false, error: 'Вы уже партнёры 💞', partner: other, already: true };
  const theirs = await getPreqs(otherId);
  if (theirs.out.some((r) => r.to === me.id)) {
    const ar = await addPartner(me.id, otherId);
    if (!ar.ok) return ar;
    await removePreq(me.id, otherId);
    await removePreq(otherId, me.id);
    return { ok: true, linked: true, partner: other };
  }
  const mine = await getPreqs(me.id);
  const dup = mine.out.some((r) => r.to === otherId);
  const pr = await addPreq(me.id, otherId);
  return { ok: true, request: true, duplicate: dup || !!(pr && pr.duplicate), partner: other };
}

export async function startPairing(me, code) {
  code = String(code || '').trim().toUpperCase();
  if (!code) return { ok: false, error: 'Введите код партнёра' };
  const otherId = await db().get('c:' + code);
  if (!otherId) return { ok: false, error: 'Такого кода нет. Проверьте регистр и символы.' };
  if (otherId === me.id) return { ok: false, error: 'Это ваш собственный код 🙂' };
  const other = await getUser(otherId);
  if (!other) return { ok: false, error: 'Пользователь не найден' };
  return requestPairing(me, other);
}

/* ---------- ревизии для обновления в реальном времени ----------
   У каждого пользователя свой счётчик `rev:<userId>`. Клиент раз в несколько
   секунд дёргает дешёвый action `rev` (одно чтение из хранилища) и делает
   полный `sync` только если счётчик изменился. Так задержка падает с 15 с
   до ~3 с, а тяжёлые запросы идут только когда реально что-то случилось. */
export async function getRev(uid) {
  const v = await db().get('rev:' + uid);
  return v ? Number(v) || 0 : 0;
}
export async function bumpRev(uid) {
  if (uid == null) return;
  const next = (await getRev(uid)) + 1;
  try { await db().set('rev:' + uid, String(next)); } catch (e) { /* не критично */ }
  return next;
}
// поднять ревизию обоим в паре (мэтч, заявка, кино-вечер, голос партнёра)
export async function bumpPairRev(a, b) {
  await Promise.all([bumpRev(a), b != null && String(a) !== String(b) ? bumpRev(b) : Promise.resolve(0)]);
}

/* Общий объект изменился (мэтч убран/помечен/оценён, стоп-лист, жанровые
   предпочтения, сброс) — сообщаем ВСЕМ «соавторам»: партнёрам и участникам
   групп. Клиенты опрашивают rev и подхватывают изменения за секунды; без
   этого вторая сторона видела бы устаревшие мэтчи до страховочного sync
   (до минуты), а общие колоды разъезжались бы. */
export async function bumpCoUsers(me) {
  const uid0 = String((me && me.id) || '');
  if (!uid0) return;
  const ids = new Set();
  for (const pid of ((me && me.partners) || [])) if (String(pid) !== uid0) ids.add(pid);
  try {
    for (const g of await userGroups(uid0)) {
      for (const uid of (g.members || [])) if (String(uid) !== uid0) ids.add(uid);
    }
  } catch (e) { /* группы не прочитались — партнёров всё равно оповестим */ }
  for (const uid of ids) await bumpRev(uid);
}

/* ---------- какие фильмы проголосовал каждый партнёр ----------
   Нужно для общей колоды пары: карточка уходит из колоды, когда её оценил
   ЛЮБОЙ из двоих, — иначе наборы у партнёров разъезжались бы. */
export async function partnersVoted(me) {
  const out = {};
  for (const pid of ((me && me.partners) || [])) {
    const pv = await getVotes(pid);
    out[String(pid)] = Object.keys(pv);
  }
  return out;
}
// короткая подпись, чтобы sync не таскал весь список каждый раз
export const pvSignature = (pv) => Object.keys(pv || {})
  .sort().map((k) => k + ':' + (pv[k] || []).length + ':'
    + ((pv[k] || []).reduce((a, x) => (a * 31 + String(x).split('').reduce((s2, c) => s2 + c.charCodeAt(0), 0)) >>> 0, 7)))
  .join('|');

/* ---------- пятничное напоминание ----------
   Раз в неделю пишем парам, у которых накопилось несколько непросмотренных
   мэтчей: «пора выбрать, что смотреть сегодня». Вызывается из плановой
   функции refresh-catalog по пятницам. */
export async function fridayReminders(token, site, minMatches = 3) {
  const pairs = await allPairs();
  const today = dayStr();
  let sent = 0, skipped = 0;
  for (const pr of pairs) {
    const a = pr[0], b = pr[1];
    try {
      const ms = (await getPairMatches(a, b)).filter((m) => !m.watched);
      if (ms.length < minMatches) { skipped++; continue; }
      // защита от повторной отправки в тот же день
      if (!(await once('friday:' + pairKeyOf(a, b) + ':' + today))) { skipped++; continue; }
      const [ua, ub] = await Promise.all([getUser(a), getUser(b)]);
      const kb = { inline_keyboard: [
        [{ text: '🍿 Выбрать на вечер', web_app: { url: (site || '') + '/?startapp=matches' } }],
        [{ text: '🔕 Не беспокоить', callback_data: 'mute:7' }],
      ] };
      for (const [u, other] of [[ua, ub], [ub, ua]]) {
        if (!u) continue;
        if (!(await canNotify(u.id, 'week'))) continue;   // уважаем настройки
        await tg('sendMessage', {
          chat_id: u.id, parse_mode: 'HTML', reply_markup: kb,
          text: '🍿 <b>Пятница!</b>\n\nУ вас с <b>' + esc((other && other.first_name) || 'партнёром') + '</b> '
            + ms.length + ' непросмотренных мэтчей.\nПора выбрать, что смотреть сегодня вечером 👇',
        }, token);
      }
      sent++;
    } catch (e) { skipped++; }
  }
  return { sent, skipped, pairs: pairs.length };
}

/* ---------- что партнёры уже смотрели ----------
   Отдаём только фильмы с голосом 2 («уже смотрел»), чтобы приложение могло
   предупредить: лайкать то, что партнёр уже видел, бессмысленно — мэтча не будет.
   Ключ — id фильма, значение — имена партнёров. */
export async function partnerSeen(me) {
  const pids = ((me && me.partners) || []).map(String);
  if (!pids.length) return {};
  const rows = await Promise.all(pids.map(async (pid) => {
    const [pv, pu] = await Promise.all([getVotes(pid), getUser(pid)]);
    return { ids: Object.keys(pv).filter((k) => pv[k] === 2), nm: (pu && pu.first_name) || 'партнёр' };
  }));
  const out = {};
  for (const { ids, nm } of rows) for (const id of ids) (out[id] = out[id] || []).push(nm);
  return out;
}

/* ---------- голоса ---------- */
export async function getVotes(id) {
  const raw = await db().get('v:' + id);
  if (!raw) return {};
  let v;
  try { v = JSON.parse(raw); } catch (e) { return {}; }
  // дубликаты каталога склеиваются на чтении: голос за карточку-псевдоним
  // засчитывается каноническому фильму (приоритет: смотрел > хочу > мимо)
  const alias = await getAliasMap();
  return alias.size ? remapVotesObj(v, alias) : v;
}
export async function setVotes(id, v) { await db().set('v:' + id, JSON.stringify(v)); }

/* ---------- мэтчи ---------- */
// уникальный ключ мэтча: фильм + конкретная пара (иначе удаление одного мэтча
// задевало вторую пару с тем же фильмом)
export const matchMid = (m) => m.mid || ((m.id || '') + '|' + (m.by || []).slice().sort().join('-'));
export const findMatch = (list, mid) => list.find((m) => matchMid(m) === mid);

/* ---------- хранение мэтчей: один шард на пару ----------
   Раньше мэтчи ВСЕХ пользователей лежали одним массивом в ключе `matches`, и
   любая операция читала и перезаписывала его целиком. Отсюда росли три проблемы:
     • гонка «последняя запись затёрла чужую» (приходилось отдельно лечить дубли);
     • `sync` каждые 15 секунд читал мэтчи всех пользователей проекта;
     • один ключ распухал вместе со всем проектом.
   Теперь мэтчи лежат по шардам `m:<idA|idB>`, а запись идёт через
   compare-and-swap (`onlyIfMatch`) с повтором при гонке.

   Ключи:
     m:<a|b>     — массив мэтчей конкретной пары
     m:index     — все ключи пар (нужны админке, аналитике и экспорту)
     mi:<userId> — ключи пар, в которых участвует пользователь
     matches     — LEGACY: однократно мигрируется и удаляется           */
export const pairKeyOf = (a, b) => [String(a), String(b)].sort().join('|');
const mKey = (pk) => 'm:' + pk;

// Пара мэтча: из `by`, а если его нет — из mid вида "<filmId>|<a>-<b>".
// Групповые мэтчи (3+ человек) живут в шардах "g-<groupId>" — тот же механизм.
export function matchPairKey(m) {
  if (m && m.groupId) return 'g-' + String(m.groupId);
  const gm = String((m && m.mid) || '');
  if (/\|g-/.test(gm)) return 'g-' + gm.split('|g-')[1];
  const by = ((m && m.by) || []).map(String);
  if (by.length >= 2) return pairKeyOf(by[0], by[1]);
  const tail = gm.split('|')[1] || '';
  const parts = tail.split('-');
  return parts.length >= 2 ? pairKeyOf(parts[0], parts[1]) : null;
}

// самолечение: по одному мэтчу на ключ (фильм + пара)
const dedupeByMid = (list) => {
  const seen = new Set();
  return list.filter((m) => {
    const k = matchMid(m);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

async function readShard(pk) {
  const raw = await db().get(mKey(pk));
  if (!raw) return [];
  try { const a = JSON.parse(raw); return Array.isArray(a) ? a : []; } catch (e) { return []; }
}
async function readJsonArray(key) {
  try { const raw = await db().get(key); const a = raw ? JSON.parse(raw) : []; return Array.isArray(a) ? a : []; }
  catch (e) { return []; }
}
const _registeredPairs = new Set();   // кэш в рамках инстанса функции
async function registerPair(pk) {
  if (_registeredPairs.has(pk)) return;
  const idx = await readJsonArray('m:index');
  if (!idx.includes(pk)) await db().set('m:index', JSON.stringify(idx.concat(pk)));
  // для группового шарда список участников берём из записи группы
  const uids = pk.startsWith('g-')
    ? (((await getGroup(pk.slice(2))) || {}).members || [])
    : pk.split('|');
  for (const uid of uids) {
    const mine = await readJsonArray('mi:' + uid);
    if (!mine.includes(pk)) await db().set('mi:' + uid, JSON.stringify(mine.concat(pk)));
  }
  _registeredPairs.add(pk);
}

/* ---------- однократная миграция со старого глобального ключа ----------
   Кэш именно ПРОМИСА, а не флага: параллельные запросы в одном инстансе
   должны дождаться конца миграции, а не прочитать полупустые шарды. */
let _migPromise = null;
async function doMigrateMatches() {
  const raw = await db().get('matches');
  if (raw == null) return;
  let arr = [];
  try { const p = JSON.parse(raw); if (Array.isArray(p)) arr = p; } catch (e) { arr = []; }
  const groups = new Map();
  for (const m of arr) {
    const pk = matchPairKey(m);
    if (!pk) continue;
    if (!groups.has(pk)) groups.set(pk, []);
    groups.get(pk).push(m);
  }
  for (const [pk, list] of groups) {
    await db().set(mKey(pk), JSON.stringify(dedupeByMid(list)));
    await registerPair(pk);
  }
  // Не удаляем безвозвратно: сохраняем старый массив как резервный ключ.
  // Если после перехода на шарды что-то пойдёт не так, данные можно вернуть
  // вручную. Ключ чистится из админки или следующей миграцией.
  try { await db().set('matches:backup', raw); } catch (e) { /* не критично */ }
  await db().delete('matches');
}
function ensureMatchesMigrated() {
  if (!_migPromise) _migPromise = doMigrateMatches().catch((e) => { _migPromise = null; throw e; });
  return _migPromise;
}
// ТОЛЬКО ДЛЯ ТЕСТОВ: сбросить кэш миграции, чтобы в том же процессе проверить
// перенос данных со старого глобального ключа `matches` на шарды.
export function __resetMatchesMigrationForTests() { _migPromise = null; }

/* ---------- чтение ----------
   С userId — только шарды этого пользователя (обычные `sync`/`hello`).
   Без него — все шарды (админка, аналитика, резервная копия). */
/* Ключи шардов пользователя: личный индекс mi:<uid> + шарды ВСЕХ его групп.
   Индекс mi: пополняется в момент записи мэтча, поэтому участника, который
   присоединился к группе позже, в нём может не быть — без второй части он не
   увидел бы мэтчи группы, созданные до его прихода.
   Вторым значением возвращаем набор ТЕКУЩИХ групповых шардов: мэтч группы
   принадлежит группе, а не списку `by` на момент создания. */
async function matchShardKeys(userId) {
  const keys = (await readJsonArray('mi:' + userId)).slice();
  const gset = new Set();
  try {
    for (const g of await userGroups(userId)) {
      const gk = 'g-' + String(g.id);
      gset.add(gk);
      if (!keys.includes(gk)) keys.push(gk);
    }
  } catch (e) { /* нет групп — обойдёмся личным индексом */ }
  return { keys, gset };
}
export async function getMatches(userId) {
  await ensureMatchesMigrated();
  const out = [];
  if (userId == null) {
    const keys = await readJsonArray('m:index');
    const shards = await Promise.all(keys.map((pk) => readShard(pk)));
    for (const arr of shards) for (const m of arr) out.push(m);
  } else {
    const me = String(userId);
    const { keys, gset } = await matchShardKeys(me);
    const shards = await Promise.all(keys.map((pk) => readShard(pk)));
    keys.forEach((pk, i) => {
      for (const m of shards[i]) {
        // групповые мэтчи видны всем ТЕКУЩИМ участникам (даже присоединившимся
        // позже создания мэтча); парные — только участникам пары
        if (gset.has(pk) || (m.by || []).map(String).includes(me)) out.push(m);
      }
    });
  }
  out.sort((a, b) => (b.ts || 0) - (a.ts || 0));   // свежие сверху, как раньше
  let list = dedupeByMid(out);
  // карточки-дубликаты: мэтчи за псевдоним склеиваются с каноническим фильмом
  const alias = await getAliasMap();
  if (alias.size) list = remapMatchList(list, alias);
  return list;
}

// мэтчи одной конкретной пары — для live-комнаты и профиля пары
export async function getPairMatches(a, b) {
  await ensureMatchesMigrated();
  const list = dedupeByMid(await readShard(pairKeyOf(a, b)));
  const alias = await getAliasMap();
  return alias.size ? remapMatchList(list, alias) : list;
}

// Совместимая «записать весь список»: группирует по парам и пишет шарды.
// Используется админкой и сбросами; горячие пути идут через addMatch и друзья.
export async function setMatches(arr) {
  await ensureMatchesMigrated();
  const list = Array.isArray(arr) ? arr : [];
  const groups = new Map();
  for (const m of list) {
    const pk = matchPairKey(m);
    if (!pk) continue;
    if (!groups.has(pk)) groups.set(pk, []);
    groups.get(pk).push(m);
  }
  // шарды, которых в новом списке больше нет, очищаем и убираем из индекса —
  // иначе индекс бесконечно растёт, а админка читает пустые ключи
  for (const pk of await readJsonArray('m:index')) {
    if (groups.has(pk)) continue;
    await db().set(mKey(pk), '[]');
    _registeredPairs.delete(pk);
  }
  for (const [pk, v] of groups) await db().set(mKey(pk), JSON.stringify(dedupeByMid(v)));
  await db().set('m:index', JSON.stringify([...groups.keys()]));
  // персональные индексы mi:<uid> обновляем заново (кэш намеренно сбрасываем)
  for (const pk of groups.keys()) { _registeredPairs.delete(pk); await registerPair(pk); }
}

/* ---------- запись одного шарда через compare-and-swap ----------
   Если между чтением и записью шард успел поменять параллельный запрос
   (партнёры свайпают одновременно) — повторяем попытку. Ровно это убирает
   гонку, из-за которой один мэтч затираал другой. */
async function mutateShard(pk, fn, attempt = 0) {
  const key = mKey(pk);
  const cur = await db().getWithMetadata(key);
  let list = [];
  if (cur && cur.data != null) {
    try { const p = JSON.parse(cur.data); if (Array.isArray(p)) list = p; } catch (e) { list = []; }
  }
  const before = JSON.stringify(list);
  let next;
  try { next = fn(list); } catch (e) { return false; }
  if (!Array.isArray(next) || JSON.stringify(next) === before) return false;
  // ВАЖНО: условная запись в обоих ветвях. Если ключа ещё нет — onlyIfNew,
  // иначе параллельные создатели шарда перезапишут друг друга и часть мэтчей
  // потеряется. Если ключ есть — onlyIfMatch по etag (обычный CAS).
  const res = (cur && cur.etag)
    ? await db().set(key, JSON.stringify(next), { onlyIfMatch: cur.etag })
    : await db().set(key, JSON.stringify(next), { onlyIfNew: true });
  if (res && res.modified === false) return attempt < 5 ? mutateShard(pk, fn, attempt + 1) : false;
  await registerPair(pk);
  return true;
}

// добавить один мэтч (дубликат по mid молча не добавляется)
export async function addMatch(m) {
  if (!m) return false;
  await ensureMatchesMigrated();
  // новый мэтч всегда пишем с каноническим id — дубли больше не размножаются
  const alias = await getAliasMap();
  if (alias.size && alias.get(String(m.id || ''))) m = canonMatchCopy(m, alias);
  const pk = matchPairKey(m);
  if (!pk) return false;
  const mid = matchMid(m);
  return mutateShard(pk, (list) => (list.some((x) => matchMid(x) === mid) ? list : [m].concat(list)));
}

// удалить мэтчи пользователя, подходящие под pred (по умолчанию — все)
// Групповые шарды ('g-…') тоже принадлежат пользователю — они регистрируются
// в mi:<uid> при создании мэтча, поэтому их не отфильтровываем.
const shardOfUser = (pk, me) => pk.startsWith('g-') || pk.split('|').includes(me);
export async function removeMatchesFor(userId, pred) {
  await ensureMatchesMigrated();
  const me = String(userId);
  const alias = await getAliasMap();
  const test = typeof pred === 'function' ? pred : () => true;
  const { keys, gset } = await matchShardKeys(me);
  const own = keys.filter((pk) => shardOfUser(pk, me));
  const results = await Promise.all(own.map((pk) => mutateShard(pk, (list) => {
    // предикат видит КАНОНИЧЕСКИЙ id/mid: клиент оперирует уже склеенными мэтчами.
    // В групповом шарде действие разрешено любому текущему участнику группы.
    const mine = (m) => gset.has(pk) || (m.by || []).map(String).includes(me);
    const left = list.filter((m) => !(test(alias.size ? canonMatchCopy(m, alias) : m) && mine(m)));
    return left.length === list.length ? list : left;
  })));
  return results.filter(Boolean).length;
}

export const removeAllMatchesFor = (userId) => removeMatchesFor(userId, () => true);

// изменить мэтчи пользователя, подходящие под pred; вернёт первый изменённый
export async function updateMatchesFor(userId, pred, patch) {
  await ensureMatchesMigrated();
  const me = String(userId);
  const alias = await getAliasMap();
  let hit = null;
  const { keys, gset } = await matchShardKeys(me);
  for (const pk of keys) {
    if (!shardOfUser(pk, me)) continue;
    await mutateShard(pk, (list) => list.map((m) => {
      // предикат и патч видят канонический id/mid (дубликаты склеены).
      // В групповом шарде действие разрешено любому текущему участнику группы.
      const mc = alias.size ? canonMatchCopy(m, alias) : m;
      const mine = gset.has(pk) || (m.by || []).map(String).includes(me);
      if (!pred(mc) || !mine) return m;
      const next = Object.assign({}, m, patch(mc));
      hit = next;                     // возвращаем уже изменённый мэтч
      return next;
    }));
  }
  return hit;
}

/* ---------- утилиты ---------- */
// Разрешаем запросы с других доменов: админка лежит на отдельном сайте
export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

export const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status,
  headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, CORS),
});

export const html = (body, status = 200) => new Response(body, {
  status,
  headers: Object.assign({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }, CORS),
});

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function ratingLine(m) {
  if (m.rating == null) return '';
  return `★ ${Number(m.rating).toFixed(1)} · ${m.src === 'tmdb' ? 'TMDB' : 'КиноПоиск'}`;
}

/* ============================================================
   СЕССИИ ДЛЯ ВХОДА С КОМПЬЮТЕРА (без Telegram)
   ============================================================ */
async function getSecret(key) {
  let s = await db().get(key);
  if (!s) {
    const cand = crypto.randomBytes(32).toString('hex');
    await db().set(key, cand);
    // два параллельных запроса могли создать разные секреты — перечитываем
    // и используем «победителя», иначе freshly-выданные сессии сразу протухнут
    s = (await db().get(key)) || cand;
  }
  return s;
}
const b36 = (n) => n.toString(36);

export async function signWebSession(userId, days = 30) {
  const secret = await getSecret('config:web_secret');
  const exp = b36(Date.now() + days * 86400e3);
  const sig = crypto.createHmac('sha256', secret).update(`${userId}.${exp}`).digest('hex');
  return `${userId}.${exp}.${sig}`;
}

export async function verifyWebSession(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  const [userId, exp, sig] = parts;
  const secret = await getSecret('config:web_secret');
  const want = crypto.createHmac('sha256', secret).update(`${userId}.${exp}`).digest('hex');
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  if (parseInt(exp, 36) < Date.now()) return null;
  const u = await getUser(userId);
  return u || null;
}

// одноразовый код для входа с компьютера
export async function createWebCode(userId) {
  const code = genCode() + genCode().slice(0, 1); // 6 символов
  await db().set('wc:' + code, JSON.stringify({ userId, exp: Date.now() + 5 * 60e3 }));
  return code;
}
export async function consumeWebCode(code) {
  code = String(code || '').trim().toUpperCase().replace(/\s/g, '');
  if (!code) return null;
  const raw = await db().get('wc:' + code);
  if (!raw) return null;
  await db().delete('wc:' + code);
  const o = JSON.parse(raw);
  if (o.exp < Date.now()) return null;
  return o.userId;
}

/* ============================================================
   АДМИН-ДОСТУП
   ============================================================ */
const hashPwd = (salt, pwd) => crypto.createHash('sha256').update(salt + ':' + pwd).digest('hex');

export async function adminHasPassword() { return !!(await db().get('config:admin_hash')); }

export async function adminSetPassword(password, current) {
  password = String(password || '');
  if (password.length < 6) return { ok: false, error: 'Пароль должен быть не короче 6 символов' };
  const stored = await db().get('config:admin_hash');
  if (stored) {
    const [salt, h] = stored.split('$');
    if (hashPwd(salt, String(current || '')) !== h) return { ok: false, error: 'Текущий пароль неверный' };
  }
  const salt = crypto.randomBytes(8).toString('hex');
  await db().set('config:admin_hash', salt + '$' + hashPwd(salt, password));
  return { ok: true };
}

export async function adminLogin(password) {
  const stored = await db().get('config:admin_hash');
  if (!stored) return { ok: false, needCreate: true, error: 'Пароль администратора ещё не создан' };
  const [salt, h] = stored.split('$');
  if (hashPwd(salt, String(password || '')) !== h) return { ok: false, error: 'Неверный пароль' };
  const secret = await getSecret('config:admin_secret');
  const exp = b36(Date.now() + 30 * 86400e3); // 30 дней — не спрашиваем пароль каждый день
  const sig = crypto.createHmac('sha256', secret).update(exp).digest('hex');
  return { ok: true, token: `${exp}.${sig}` };
}

export async function verifyAdminSession(token) {
  if (!token || typeof token !== 'string') return false;
  const [exp, sig] = String(token).split('.');
  if (!exp || !sig) return false;
  const secret = await getSecret('config:admin_secret');
  const want = crypto.createHmac('sha256', secret).update(exp).digest('hex');
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return false;
  return parseInt(exp, 36) > Date.now();
}

/* ============================================================
   НАСТРОЙКИ ПРИЛОЖЕНИЯ И БОТА
   ============================================================ */
export const FRIEND_BTN = '📤 Отправить другу';
export const BTN_MATCHES = '🍿 Мои мэтчи';
export const BTN_BADGES = '🏆 Награды';
export const BTN_PARTNERS = '👥 Партнёры';
export const BTN_HELP = '❓ Помощь';
/* Версия схемы настроек.
   v2 (1.8.0): колода у пары стала НЕЗАВИСИМОЙ — каждый листает свою и лайкает
   сам, карточка не уходит у второго после чужого свайпа. Раньше по умолчанию
   была общая колода (syncDeck: true), поэтому сайтам, где эту настройку никогда
   явно не трогали, включаем новое поведение одноразовой миграцией.
   Если владелец СОЗНАТЕЛЬНО включал общую колоду в админке (в хранилище лежит
   syncDeck вместе с cfgVer) — его выбор не перебиваем. */
export const SETTINGS_VER = 2;

/* Версия серверной части. Живёт здесь, а не в api.mjs, потому что её читает
   и админка (_admin.mjs): импорт из api.mjs образовал бы цикл
   api.mjs → _admin.mjs → api.mjs, который с top-level await намертво виснет. */
export const SERVER_VERSION = '1.9.1';
/* ============================================================
   FEATURE FLAGS
   Включают и выключают поведение БЕЗ деплоя: значение лежит в
   config:settings, приходит клиенту в `hello` и проверяется на сервере.
   Если фича сломалась в проде — она тушится за минуту галочкой в админке,
   а не пересборкой и перетаскиванием нового архива на Netlify.

   Правило: флаг `false` обязан оставлять приложение полностью рабочим —
   фича просто не показывается. На флаги нельзя завязывать то, без чего
   ломается колода или мэтчи.
   ============================================================ */
export const DEFAULT_FLAGS = {
  dailyDeck: true,     // «колода дня»: одинаковые карточки в начале колоды у пары
  dailyPush: true,     // пуш о колоде дня раз в сутки (плановая функция daily.mjs)
  mood: true,          // «какой сегодня вечер?» — вопрос перед свайпами
  games: true,         // игры с партнёром («угадай за партнёра», «слепая дуэль»)
  talkTopics: true,    // «о чём поговорить» в карточке фильма
  guestLink: true,     // гостевой вход по ссылке на фильм
  genres: true,        // стартовый экран выбора интересов
};
export const FLAG_KEYS = Object.keys(DEFAULT_FLAGS);

/* Нормализация: неизвестные ключи отбрасываем, значения приводим к булеву.
   Отсутствующий ключ = значение по умолчанию (то есть фича включена). */
export function normFlags(f) {
  const out = Object.assign({}, DEFAULT_FLAGS);
  if (f && typeof f === 'object') {
    for (const k of FLAG_KEYS) if (f[k] != null) out[k] = !!f[k];
  }
  return out;
}

const DEFAULT_SETTINGS = {
  menuText: MENU_TEXT,
  syncDeck: false,
  cfgVer: SETTINGS_VER,
  flags: Object.assign({}, DEFAULT_FLAGS),
  maintenance: { on: false, reason: '' },
  texts: { start: '', hint: '', match: '' },
  notifyChat: '',
  minClient: '',   // минимальная версия мини-приложения ('' = проверка выключена)
  digestOn: true,  // еженедельный дайджест ботом
  dailyPushOn: true, // пуш «колода дня обновилась» раз в сутки (daily.mjs)
  dailyPushHour: 19, // час по Москве (cron в daily.mjs: 16:00 UTC = 19:00 МСК)
  backupOn: true,  // автобэкап раз в сутки документом в notifyChat (+ 7 копий в хранилище)
  uptimeOn: true,  // мониторинг живости: пинг /api каждые 15 минут, алерт при падении
};
export async function getSettings() {
  let stored = {};
  try { const raw = await db().get('config:settings'); if (raw) stored = JSON.parse(raw); } catch (e) {}
  const next = Object.assign({}, DEFAULT_SETTINGS, stored);
  next.maintenance = Object.assign({}, DEFAULT_SETTINGS.maintenance, stored.maintenance || {});
  next.texts = Object.assign({}, DEFAULT_SETTINGS.texts, stored.texts || {});
  next.flags = normFlags(stored.flags);
  /* Миграция на v2: в старых настройках ключа syncDeck нет вовсе (он появился
     вместе с общей колодой и по умолчанию был true) — значит владелец его не
     выбирал, ставим независимые колоды и запоминаем, чтобы больше не трогать. */
  if (!next.cfgVer || Number(next.cfgVer) < SETTINGS_VER) {
    if (!Object.prototype.hasOwnProperty.call(stored, 'syncDeck')) next.syncDeck = false;
    next.cfgVer = SETTINGS_VER;
    try { await db().set('config:settings', JSON.stringify(next)); } catch (e) { /* не критично */ }
  }
  next.syncDeck = next.syncDeck === true;   // нормализуем: всё, что не true, — независимые колоды
  return next;
}
export async function setSettings(patch) {
  const cur = await getSettings();
  const next = Object.assign({}, cur, patch || {});
  next.maintenance = Object.assign({}, cur.maintenance, (patch || {}).maintenance || {});
  next.texts = Object.assign({}, cur.texts, (patch || {}).texts || {});
  next.flags = normFlags((patch || {}).flags != null
    ? Object.assign({}, cur.flags, patch.flags)
    : cur.flags);
  if (next.menuText && String(next.menuText).length > 40) next.menuText = String(next.menuText).slice(0, 40);
  if (next.maintenance.reason) next.maintenance.reason = String(next.maintenance.reason).slice(0, 300);
  if (next.notifyChat != null) next.notifyChat = String(next.notifyChat).replace(/[^\d@_-]/g, '').slice(0, 40);
  if (next.minClient != null) next.minClient = String(next.minClient).replace(/[^0-9.]/g, '').slice(0, 12);
  if (next.digestOn != null) next.digestOn = !!next.digestOn;
  if (next.dailyPushOn != null) next.dailyPushOn = !!next.dailyPushOn;
  if (next.dailyPushHour != null) {
    next.dailyPushHour = Math.max(0, Math.min(23, parseInt(next.dailyPushHour, 10) || 0));
  }
  if (next.backupOn != null) next.backupOn = !!next.backupOn;
  if (next.uptimeOn != null) next.uptimeOn = !!next.uptimeOn;
  if ((patch || {}).syncDeck != null) next.syncDeck = !!(patch || {}).syncDeck;
  next.cfgVer = SETTINGS_VER;   // настройка сохранена сознательно — миграция больше не нужна
  delete next.autoPair; // пары связываются только вручную: кодом или ссылкой
  await db().set('config:settings', JSON.stringify(next));
  return next;
}

// идемпотентность: действие проходит только один раз для данного ключа
// (защищает от повторных доставок вебхука и гонок параллельных запросов)
export async function once(key) {
  const k = 'once:' + key;
  // Атомарно: два параллельных запроса (партнёры лайкнули одновременно)
  // раньше оба проходили проверку и слали duplicated уведомление о мэтче.
  // onlyIfNew гарантирует, что «первым» окажется ровно один.
  try {
    const res = await db().set(k, '1', { onlyIfNew: true });
    if (res && res.modified === false) return false;
    if (res && res.modified === true) return true;
  } catch (e) { /* хранилище без условной записи — уходим на запасной путь */ }
  if (await db().get(k)) return false;
  await db().set(k, '1');
  return true;
}

/* ---------- анонсы «Что нового» (показываются один раз на пользователя) ---------- */
export async function getAnnounce() {
  try { const raw = await db().get('config:announce'); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
}
export async function setAnnounce(a) {
  await db().set('config:announce', JSON.stringify(a));
  return a;
}
export async function getSeen(uid) {
  try { const raw = await db().get('seen:' + uid); return raw ? JSON.parse(raw) : []; } catch (e) { return []; }
}
export async function markSeen(uid, id) {
  const list = await getSeen(uid);
  if (!list.includes(id)) { list.push(id); await db().set('seen:' + uid, JSON.stringify(list.slice(-30))); }
  return list;
}

/* ---------- история рассылок, анонсов и личных сообщений ---------- */
// Каждая запись: { id, ts, kind, text, title, sent, failed, total, to, url, photo }
const LOG_KEY = 'log:broadcasts';
const LOG_MAX = 60;
export async function getBroadcastLog() {
  try { const raw = await db().get(LOG_KEY); return raw ? JSON.parse(raw) : []; } catch (e) { return []; }
}
export async function pushBroadcastLog(entry) {
  try {
    const list = await getBroadcastLog();
    const rec = Object.assign({ id: 'L' + Date.now().toString(36) + Math.floor(Math.random() * 1e3).toString(36), ts: Date.now() }, entry || {});
    if (rec.text && String(rec.text).length > 500) rec.text = String(rec.text).slice(0, 500) + '…';
    list.unshift(rec);
    await db().set(LOG_KEY, JSON.stringify(list.slice(0, LOG_MAX)));
    return rec;
  } catch (e) { return null; }
}

/* ---------- личный стоп-лист (фильмы и жанры, которые пользователь не хочет видеть) ---------- */
export async function getStop(uid) {
  try {
    const raw = await db().get('stop:' + uid);
    if (!raw) return { films: [], genres: [] };
    const o = JSON.parse(raw);
    const alias = await getAliasMap();
    // скрытые «дубли» продолжают скрывать фильм и после склейки карточек
    const films = alias.size ? dedupeIds(o.films || [], alias) : (o.films || []);
    return { films, genres: o.genres || [] };
  } catch (e) { return { films: [], genres: [] }; }
}
export async function setStop(uid, list) { await db().set('stop:' + uid, JSON.stringify(list)); return list; }

/* ---------- журнал свайпов ---------- */
export async function pushSwlog(uid, id, v) {
  try {
    const raw = await db().get('swlog:' + uid);
    let list = raw ? JSON.parse(raw) : [];
    // один фильм — одна строка журнала: повторный свайп обновляет запись,
    // а не дублирует её (раньше после «отменить → свайпнуть снова» фильм висел дважды)
    list = list.filter((e) => String(e.id) !== String(id));
    list.unshift({ id, v, t: Date.now() });
    await db().set('swlog:' + uid, JSON.stringify(list.slice(0, 300)));
  } catch (e) {}
}
export async function removeSwlog(uid, id) {
  try {
    const raw = await db().get('swlog:' + uid);
    if (!raw) return;
    const list = (JSON.parse(raw) || []).filter((e) => String(e.id) !== String(id));
    await db().set('swlog:' + uid, JSON.stringify(list));
  } catch (e) {}
}
export async function clearSwlog(uid) {
  try { await db().set('swlog:' + uid, '[]'); } catch (e) {}
}
export async function getSwlog(uid, limit = 60) {
  try {
    const raw = await db().get('swlog:' + uid);
    const list = raw ? JSON.parse(raw) : [];
    const alias = await getAliasMap();
    if (!alias.size) return list.slice(0, limit);
    // дубликаты карточек склеиваем: одна строка на канонический фильм
    const seen = new Set();
    const out = [];
    for (const e of list) {
      const id = alias.get(String(e.id)) || String(e.id);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(Object.assign({}, e, { id }));
    }
    return out.slice(0, limit);
  } catch (e) { return []; }
}

// подстановка плейсхолдеров в редактируемые тексты
export function fillTemplate(tpl, vars) {
  return String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
}

/* ============================================================
   ЕЖЕДНЕВНАЯ СТАТИСТИКА (графики активности в админке)
   ============================================================ */
const DAILY_KEY = 'stats:daily';
const DAILY_MAX_DAYS = 200;
export const dayStr = (ts) => new Date(ts || Date.now()).toISOString().slice(0, 10);

export async function getDailyRaw() {
  try { const raw = await db().get(DAILY_KEY); return raw ? JSON.parse(raw) : {}; } catch (e) { return {}; }
}
async function setDailyRaw(obj) {
  const keys = Object.keys(obj).sort().slice(-DAILY_MAX_DAYS);
  const trimmed = {};
  for (const k of keys) trimmed[k] = obj[k];
  await db().set(DAILY_KEY, JSON.stringify(trimmed));
}
// ev: open|swipe|like|match|watch|feedback|newUser; uid — для подсчёта уникальных
export async function trackDaily(ev, uid) {
  try {
    const all = await getDailyRaw();
    const d = dayStr();
    const rec = all[d] || (all[d] = { u: [], su: [], mu: [], sw: 0, lk: 0, mt: 0, wt: 0, fb: 0, nu: 0 });
    const addU = (arrName) => {
      const arr = rec[arrName] || (rec[arrName] = []);
      if (uid != null && arr.length < 5000 && !arr.includes(String(uid))) arr.push(String(uid));
    };
    if (ev === 'open') addU('u');
    else if (ev === 'swipe') { rec.sw = (rec.sw || 0) + 1; addU('su'); }
    else if (ev === 'like') rec.lk = (rec.lk || 0) + 1;
    else if (ev === 'match') { rec.mt = (rec.mt || 0) + 1; addU('mu'); }
    else if (ev === 'watch') rec.wt = (rec.wt || 0) + 1;
    else if (ev === 'feedback') rec.fb = (rec.fb || 0) + 1;
    else if (ev === 'newUser') rec.nu = (rec.nu || 0) + 1;
    await setDailyRaw(all);
  } catch (e) { /* статистика не должна ломать основной сценарий */ }
}
export async function getDailySeries(days = 60) {
  const all = await getDailyRaw();
  const keys = Object.keys(all).sort().slice(-(days || 60));
  return keys.map((k) => {
    const r = all[k] || {};
    return {
      date: k,
      users: (r.u || []).length, swipers: (r.su || []).length, matchers: (r.mu || []).length,
      swipes: r.sw || 0, likes: r.lk || 0, matches: r.mt || 0, watched: r.wt || 0,
      feedback: r.fb || 0, newUsers: r.nu || 0,
    };
  });
}

/* ============================================================
   ПРЕДПОЧТЕНИЯ ПО ЖАНРАМ (prefs:<uid>) — колода чаще показывает любимое
   ============================================================ */
export async function getPrefs(uid) {
  try {
    const raw = await db().get('prefs:' + uid);
    const o = raw ? JSON.parse(raw) : {};
    const genres = (Array.isArray(o.genres) ? o.genres : []).map(String).slice(0, 6);
    // жанры уже выбраны — значит интересы заданы (аккаунты до версии 1.8.0)
    return { genres, onboarded: o.onboarded === true || genres.length > 0 };
  } catch (e) { return { genres: [], onboarded: false }; }
}
/* prefs.onboarded — прошёл ли человек стартовый выбор интересов. Пока нет,
   приложение показывает экран «Что вам нравится?» и подстраивает колоду
   под выбранные жанры. genres не передан — текущие жанры сохраняются. */
export async function setPrefs(uid, prefs) {
  const cur = await getPrefs(uid);
  const genres = (prefs && prefs.genres != null)
    ? normGenres((prefs.genres || []).map((x) => String(x).trim().toLowerCase().slice(0, 24)).filter(Boolean)).slice(0, 6)
    : cur.genres;
  const onboarded = (prefs && prefs.onboarded != null) ? !!prefs.onboarded : (cur.onboarded || genres.length > 0);
  const next = { genres, onboarded };
  await db().set('prefs:' + uid, JSON.stringify(next));
  return next;
}

/* ============================================================
   КИНО-ВЕЧЕР (night:<пара>) — «планируем смотреть сегодня»
   ============================================================ */
export const pairKey = (a, b) => [a, b].sort().join('|');
export async function getNight(a, b) {
  try { const raw = await db().get('night:' + pairKey(a, b)); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
}
export async function setNight(a, b, rec) { await db().set('night:' + pairKey(a, b), JSON.stringify(rec)); return rec; }
export async function clearNight(a, b) { try { await db().delete('night:' + pairKey(a, b)); } catch (e) { /* ignore */ } }

/* ============================================================
   ЛИЧНАЯ АКТИВНОСТЬ (uact:<uid>): серии дней, рекорды, ночные лайки
   ============================================================ */
export async function getUserActivity(uid) {
  try { const raw = await db().get('uact:' + uid); return raw ? JSON.parse(raw) : {}; } catch (e) { return {}; }
}
export async function trackUserActivity(uid, ev) {
  try {
    const a = await getUserActivity(uid);
    const d = dayStr();
    // свайпы в текущий день + рекорд дня
    if (a.dayDate !== d) { a.dayDate = d; a.daySwipes = 0; }
    a.daySwipes = (a.daySwipes || 0) + 1;
    if (a.daySwipes > (a.bestDay || 0)) { a.bestDay = a.daySwipes; a.bestDayDate = d; }
    // серия дней подряд
    if (a.streakLast !== d) {
      const yest = dayStr(Date.now() - 86400e3);
      a.streakCount = a.streakLast === yest ? (a.streakCount || 0) + 1 : 1;
      a.streakLast = d;
      if (a.streakCount > (a.bestStreak || 0)) a.bestStreak = a.streakCount;
    }
    if (ev && ev.like) {
      a.likes = (a.likes || 0) + 1;
      if (ev.nightLike) a.nightLikes = (a.nightLikes || 0) + 1;
    }
    await db().set('uact:' + uid, JSON.stringify(a));
  } catch (e) { /* активность не должна ломать основной сценарий */ }
}
// «ночь» ≈ 00:00–05:00 по Москве (21:00–02:00 UTC)
export const isNightHour = () => { const h = new Date().getUTCHours(); return h >= 21 || h < 2; };

/* ============================================================
   ПОДБОРКА «СЕГОДНЯ ВЕЧЕРОМ»: топ незамотренных мэтчей по рейтингу
   ============================================================ */
export async function suggestTonight(userId, limit = 3) {
  const mine = (await getMatches(userId)).filter((m) => !m.watched);
  const stop = await getStop(userId);
  const stopFilms = new Set((stop.films || []).map(String));
  const stopGenres = new Set((stop.genres || []).map((x) => String(x).toLowerCase()));
  const cand = mine.filter((m) => {
    if (stopFilms.has(String(m.id))) return false;
    const gs = (m.genres || []).map((x) => String(x).toLowerCase());
    return !gs.some((g) => stopGenres.has(g));
  });
  const ALL = await getCatalogAll();
  const rate = (m) => {
    const r = m.rating != null ? m.rating : ((ALL[m.id] || {}).r);
    const n = Number(r);
    return Number.isFinite(n) ? n : 0;
  };
  cand.sort((x, y) => (rate(y) - rate(x)) || ((y.ts || 0) - (x.ts || 0)));
  return cand.slice(0, limit || 3).map((m) => {
    const it = ALL[m.id] || {};
    return {
      id: m.id, mid: matchMid(m), title: m.title || it.t || String(m.id), year: m.year || it.y || null,
      poster: m.poster || it.p || null, rating: m.rating != null ? m.rating : (it.r != null ? it.r : null),
      src: m.src || it.s || null, genres: m.genres || it.g || [], type: m.type || it.tp || 'movie',
    };
  });
}

/* ============================================================
   ПРАВКИ КАРТОЧЕК АДМИНОМ (catalog:edits)
   { id: { t, y, tp, p, r, g, minutes, desc, tr } } — только изменённые поля
   ============================================================ */
export async function getCardEdits() {
  try { const raw = await db().get('catalog:edits'); return raw ? JSON.parse(raw) : {}; } catch (e) { return {}; }
}
export async function setCardEdits(obj) { await db().set('catalog:edits', JSON.stringify(obj || {})); invalidateCatalogCache(); return obj; }

/* ============================================================
   КОЛЛЕКЦИИ / ПОДБОРКИ
   [{ id, title, emoji, note, items:[id], created, ts }]
   ============================================================ */
export async function getCollections() {
  try {
    const raw = await db().get('collections');
    const list = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) return [];
    // фильмы-дубликаты в подборках заменяются каноническими карточками
    const alias = await getAliasMap();
    if (!alias.size) return list;
    return list.map((c) => (Array.isArray(c.items) && c.items.some((x) => alias.has(String(x)))
      ? Object.assign({}, c, { items: dedupeIds(c.items, alias) })
      : c));
  } catch (e) { return []; }
}
export async function saveCollections(list) {
  const arr = Array.isArray(list) ? list.slice(0, 40) : [];
  await db().set('collections', JSON.stringify(arr));
  return arr;
}

/* ============================================================
   СВОИ ПОДБОРКИ ПОЛЬЗОВАТЕЛЯ (ucol:<userId>)
   [{ id, title, emoji, items:[filmId], created, ts }]
   В отличие от админских, видны только своему владельцу:
   «наше с Настей», «на новогодние», «досмотреть сериалы».
   ============================================================ */
export const UCOL_MAX = 20;          // подборок у одного человека
export const UCOL_ITEMS_MAX = 300;   // фильмов в одной подборке

export async function getUserCols(uid) {
  try {
    const raw = await db().get('ucol:' + uid);
    const a = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(a)) return [];
    const alias = await getAliasMap();
    if (!alias.size) return a;
    return a.map((c) => (Array.isArray(c.items) && c.items.some((x) => alias.has(String(x)))
      ? Object.assign({}, c, { items: dedupeIds(c.items, alias) })
      : c));
  } catch (e) { return []; }
}
export async function saveUserCols(uid, list) {
  const arr = (Array.isArray(list) ? list : []).slice(0, UCOL_MAX);
  await db().set('ucol:' + uid, JSON.stringify(arr));
  return arr;
}
const ucolId = () => 'C' + Date.now().toString(36).toUpperCase()
  + Math.floor(Math.random() * 1296).toString(36).toUpperCase().padStart(2, '0');

// создать (без id) или обновить (с id) подборку
export async function ucolSave(uid, patch) {
  const cols = await getUserCols(uid);
  const title = String((patch && patch.title) || '').trim().slice(0, 40);
  const emoji = String((patch && patch.emoji) || '').trim().slice(0, 8) || '⭐';
  const id = patch && patch.id ? String(patch.id) : '';
  if (id) {
    const c = cols.find((x) => x.id === id);
    if (!c) return { ok: false, error: 'Подборка не найдена' };
    if (title) c.title = title;
    if (patch && patch.emoji) c.emoji = emoji;
    if (patch && Array.isArray(patch.items)) c.items = dedupeIds(patch.items.map(String), null).slice(0, UCOL_ITEMS_MAX);
    c.ts = Date.now();
    return { ok: true, cols: await saveUserCols(uid, cols), col: c };
  }
  if (!title) return { ok: false, error: 'Введите название подборки' };
  if (cols.length >= UCOL_MAX) return { ok: false, error: `У вас уже ${UCOL_MAX} подборок — это предел` };
  const c = {
    id: ucolId(), title, emoji,
    items: (patch && Array.isArray(patch.items)) ? dedupeIds(patch.items.map(String), null).slice(0, UCOL_ITEMS_MAX) : [],
    created: Date.now(), ts: Date.now(),
  };
  cols.push(c);
  return { ok: true, cols: await saveUserCols(uid, cols), col: c };
}
export async function ucolDelete(uid, id) {
  const cols = (await getUserCols(uid)).filter((c) => c.id !== String(id || ''));
  return { ok: true, cols: await saveUserCols(uid, cols) };
}
// добавить фильм в существующую (colId) или новую (title) подборку
export async function ucolAddFilm(uid, filmId, opts) {
  const fid = await canonFilmId(filmId);
  if (!fid) return { ok: false, error: 'Фильм не указан' };
  const cols = await getUserCols(uid);
  let col = opts && opts.colId ? cols.find((c) => c.id === String(opts.colId)) : null;
  if (!col) {
    const title = String((opts && opts.title) || '').trim().slice(0, 40);
    if (!title) return { ok: false, error: 'Подборка не найдена' };
    if (cols.length >= UCOL_MAX) return { ok: false, error: `У вас уже ${UCOL_MAX} подборок — это предел` };
    col = {
      id: ucolId(), title,
      emoji: String((opts && opts.emoji) || '').trim().slice(0, 8) || '⭐',
      items: [], created: Date.now(), ts: Date.now(),
    };
    cols.push(col);
  }
  if (!col.items.includes(fid)) col.items.push(fid);
  col.items = col.items.slice(0, UCOL_ITEMS_MAX);
  col.ts = Date.now();
  return { ok: true, cols: await saveUserCols(uid, cols), colId: col.id };
}
export async function ucolRemoveFilm(uid, colId, filmId) {
  const fid = await canonFilmId(filmId);
  const cols = await getUserCols(uid);
  const col = cols.find((c) => c.id === String(colId || ''));
  if (!col) return { ok: false, error: 'Подборка не найдена' };
  col.items = (col.items || []).filter((x) => String(x) !== fid);
  col.ts = Date.now();
  return { ok: true, cols: await saveUserCols(uid, cols) };
}

/* ============================================================
   ОБРАТНАЯ СВЯЗЬ ИЗ ПРИЛОЖЕНИЯ
   [{ id, ts, uid, name, username, kind, contact, text, status, reply, answeredTs }]
   ============================================================ */
const FB_KEY = 'feedback:list';
const FB_MAX = 300;
export async function getFeedback() {
  try { const raw = await db().get(FB_KEY); return raw ? JSON.parse(raw) : []; } catch (e) { return []; }
}
export async function saveFeedback(list) {
  await db().set(FB_KEY, JSON.stringify((Array.isArray(list) ? list : []).slice(0, FB_MAX)));
}
export async function pushFeedback(entry) {
  const list = await getFeedback();
  const rec = Object.assign(
    { id: 'F' + Date.now().toString(36) + Math.floor(Math.random() * 1e3).toString(36), ts: Date.now(), status: 'new' },
    entry || {},
  );
  if (rec.text) rec.text = String(rec.text).slice(0, 2000);
  list.unshift(rec);
  await saveFeedback(list);
  return rec;
}

/* Ответ на сообщение обратной связи — общий для админки и для бота
   (кнопка «✍️ Ответить» под уведомлением в Telegram). Шлёт пользователю
   личное сообщение от имени бота, помечает сообщение «отвечено» и пишет
   запись в журнал рассылок. */
export async function sendFeedbackReply(fid, text, token) {
  const t = String(text || '').trim();
  if (!t) return { ok: false, error: 'Пустой ответ' };
  const list = await getFeedback();
  const item = list.find((x) => String(x.id) === String(fid));
  if (!item) return { ok: false, error: 'Сообщение не найдено' };
  // force: человек сам написал в поддержку — такой ответ не глушится настройками
  const r = await notifyUser(item.uid, 'admin', {
    parse_mode: 'HTML',
    text: `💬 <b>Ответ от команды КиноФикации</b>\n\n${esc(t.slice(0, 1500))}\n\n<i>на ваше сообщение: «${esc(String(item.text || '').slice(0, 120))}»</i>`,
  }, token, { force: true });
  if (!r || !r.ok) return { ok: false, error: 'Не удалось отправить в Telegram: ' + ((r && r.description) || 'неизвестная ошибка') };
  item.status = 'answered';
  item.reply = t.slice(0, 1500);
  item.answeredTs = Date.now();
  await saveFeedback(list);
  await pushBroadcastLog({ kind: 'feedback', to: String(item.uid), text: t, sent: 1, failed: 0, total: 1 });
  return { ok: true, item };
}

/* ============================================================
   ВХОД АДМИНА «ГЛАЗАМИ ПОЛЬЗОВАТЕЛЯ» (preview-токен)
   ============================================================ */
export async function signPreview(userId, hours = 3) {
  const secret = await getSecret('config:admin_secret');
  const exp = b36(Date.now() + (hours || 3) * 3600e3);
  const sig = crypto.createHmac('sha256', secret).update(`pv.${userId}.${exp}`).digest('hex');
  return `pv.${userId}.${exp}.${sig}`;
}
export async function verifyPreviewUid(token) {
  try {
    if (!token || typeof token !== 'string' || !token.startsWith('pv.')) return null;
    const parts = token.split('.');
    if (parts.length !== 4) return null;
    const [, userId, exp, sig] = parts;
    const secret = await getSecret('config:admin_secret');
    const want = crypto.createHmac('sha256', secret).update(`pv.${userId}.${exp}`).digest('hex');
    if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
    if (parseInt(exp, 36) < Date.now()) return null;
    return userId;
  } catch (e) { return null; }
}

/* ============================================================
   СКРЫТЫЕ ФИЛЬМЫ (управление из админки)
   ============================================================ */
export async function getHidden() {
  try { const raw = await db().get('hidden'); return raw ? JSON.parse(raw) : []; } catch (e) { return []; }
}
export async function setHidden(list) { await db().set('hidden', JSON.stringify(list)); return list; }
export async function toggleHidden(id, hide) {
  const list = await getHidden();
  const has = list.includes(id);
  if (hide && !has) list.push(id);
  if (!hide && has) list.splice(list.indexOf(id), 1);
  await setHidden(list);
  return { hidden: hide === undefined ? has : hide, list };
}

/* ============================================================
   СТАТИСТИКА, НАГРАДЫ, БАН, СВОИ ФИЛЬМЫ
   ============================================================ */
import { CATALOG as STATIC_CATALOG } from './_catalog.mjs';

export async function getCustomFilms() {
  try { const raw = await db().get('custom:films'); return raw ? JSON.parse(raw) : []; } catch (e) { return []; }
}
export async function saveCustomFilms(list) { invalidateCatalogCache(); await db().set('custom:films', JSON.stringify(list)); return list; }

/* ---------- динамический каталог (обновляется без пересборки проекта) ---------- */
// Новые фильмы/сериалы, подтянутые кнопкой «Обновить каталог»
export async function getDynamicFilms() {
  try { const raw = await db().get('catalog:new'); return raw ? JSON.parse(raw) : []; } catch (e) { return []; }
}
export async function saveDynamicFilms(list) {
  // защита от бесконечного роста: храним максимум 400 подтянутых новинок
  const arr = Array.isArray(list) ? list.slice(-400) : [];
  await db().set('catalog:new', JSON.stringify(arr));
  invalidateCatalogCache();
  return arr;
}
// Свежие рейтинги КиноПоиска для уже существующих фильмов: { id: { r, votes, imdb, ts } }
export async function getRatingOverrides() {
  try { const raw = await db().get('catalog:ratings'); return raw ? JSON.parse(raw) : {}; } catch (e) { return {}; }
}
export async function setRatingOverrides(obj) { await db().set('catalog:ratings', JSON.stringify(obj)); invalidateCatalogCache(); return obj; }
// Курсор и метаданные обновления
export async function getRefreshCursor() {
  try { const raw = await db().get('catalog:cursor'); return raw == null ? 0 : Number(raw) || 0; } catch (e) { return 0; }
}
export async function setRefreshCursor(n) { await db().set('catalog:cursor', String(n)); return n; }
export async function getRefreshMeta() {
  try { const raw = await db().get('catalog:meta'); return raw ? JSON.parse(raw) : {}; } catch (e) { return {}; }
}
export async function setRefreshMeta(obj) { await db().set('catalog:meta', JSON.stringify(obj)); return obj; }

// полный каталог: встроенный + добавленные админом + подтянутые обновления + свежие рейтинги
/* ---------- кэш входов каталога ----------
   getCatalogAll() дёргают на каждый vote/hello/sync, а он читал из хранилища
   ЧЕТЫРЕ ключа подряд и каждый раз пересобирал 485 записей. Теперь:
     • четыре чтения идут параллельно (Promise.all), а не последовательно;
     • результат переиспользуется внутри инстанса функции CATALOG_TTL мс;
     • любая правка каталога сбрасывает кэш через invalidateCatalogCache().
   Кэшируем именно ВХОДЫ, а не итоговый объект: getCatalogAll() по-прежнему
   отдаёт свежую копию, поэтому вызывающий код не может испортить кэш. */
const CATALOG_TTL = 3000;
let _catInputs = null, _catInputsAt = 0;
let _dedupe = null, _dedupeAt = 0;   // кэш карты дубликатов (сбрасывается вместе с каталогом)
export function invalidateCatalogCache() { _catInputs = null; _catInputsAt = 0; _dedupe = null; _dedupeAt = 0; }
async function catalogInputs() {
  const now = Date.now();
  if (_catInputs && now - _catInputsAt < CATALOG_TTL) return _catInputs;
  const [extra, dyn, ov, edits] = await Promise.all([
    getCustomFilms(), getDynamicFilms(), getRatingOverrides(), getCardEdits(),
  ]);
  _catInputs = { extra, dyn, ov, edits };
  _catInputsAt = now;
  return _catInputs;
}

/* Жанры каталога: TMDB отдаёт «война» отдельным значением рядом с «военный»,
   и под него попадали вовсе не военные картины. Склеиваем — иначе в фильтрах
   и в выборе интересов два почти пустых жанра вместо одного.
   Клиент делает то же самое в mergeCatalogItems (app-core.js). */
export const GENRE_ALIAS = { 'война': 'военный' };
export function normGenres(list) {
  const out = [];
  for (const g of (list || [])) {
    const ng = GENRE_ALIAS[String(g).toLowerCase()] || String(g);
    if (!out.includes(ng)) out.push(ng);
  }
  return out;
}

export async function getCatalogAll() {
  const { extra, dyn, ov, edits } = await catalogInputs();
  const all = Object.assign({}, STATIC_CATALOG);
  const put = (f) => {
    if (!f || !f.id) return;
    all[f.id] = {
      t: f.t || f.title, y: f.y || f.year || null, tp: f.tp || f.type || 'movie',
      p: f.p || f.poster || null, r: f.r != null ? f.r : (f.rating != null ? f.rating : null),
      s: f.s || f.src || 'admin', g: normGenres(f.g || f.genres || []), minutes: f.minutes || f.mi || null,
      k: f.k || f.kpId || null, desc: f.desc || f.description || null, tr: f.tr || f.trailer || null,
    };
  };
  for (const f of extra) put(f);
  for (const f of dyn) put(f);
  // применяем свежие рейтинги КиноПоиска
  for (const id of Object.keys(ov)) {
    if (!all[id] || ov[id] == null || ov[id].r == null) continue;
    all[id] = Object.assign({}, all[id], { r: ov[id].r, s: 'kp' });
  }
  // правки карточек админом (название, постер, описание и т.д.) — поверх всего
  for (const id of Object.keys(edits)) {
    if (!all[id] || !edits[id]) continue;
    all[id] = Object.assign({}, all[id], edits[id]);
  }
  return all;
}

/* ============================================================
   ДЕДУПЛИКАЦИЯ КАТАЛОГА
   Один и тот же фильм может попасть в каталог дважды под разными id:
   встроенная карточка TMDB + добавленный админом фильм, новинка из
   «Обновить каталог» + старая карточка и т.п. Из-за дублей партнёры
   лайкают РАЗНЫЕ карточки одного фильма — и мэтч «не случается».

   Дубликатом считаем записи, у которых совпал ОДИН из признаков:
     • одинаковый kpId (КиноПоиск);
     • одинаковые нормализованное название + год + тип.
   «Канонической» оставляем одну карточку (приоритет: встроенный каталог →
   наличие kpId → полнота данных), остальные становятся её псевдонимами.

   Карта псевдонимов применяется НА ЧТЕНИИ (голоса, мэтчи, стоп-листы,
   журнал, подборки) и при записи новых голосов/мэтчей — поэтому данные
   склеиваются без немедленной миграции. Полную физическую склейку
   (с перезаписью хранилища и скрытием дублей) делает админ-действие
   catalog.dedup.run — оно же лечит редкий случай «в одном шарде лежат
   и дубль, и канон».
   ============================================================ */
export function normFilmTitle(s) {
  return String(s || '').toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^0-9a-zа-я\s]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// вес карточки-кандидата в канонические: чем больше, тем «настоящее»
function dedupeScore(id, it) {
  let s = 0;
  if (STATIC_CATALOG[id]) s += 1000;   // встроенный каталог = id из movies.json, стабилен
  if (it && it.k) s += 100;            // есть kpId — карточка КиноПоиска
  if (it && it.desc) s += 30;
  if (it && it.p) s += 10;
  if (it && it.r != null) s += 5;
  return s;
}

export function buildDedupe(ALL) {
  const ids = Object.keys(ALL || {});
  const parent = {};
  const find = (x) => { while (parent[x] && parent[x] !== x) x = parent[x]; return x; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[rb] = ra; };
  for (const id of ids) parent[id] = id;
  const byKey = new Map();
  const addKey = (key, id) => {
    if (byKey.has(key)) union(byKey.get(key), id);
    else byKey.set(key, id);
  };
  for (const id of ids) {
    const it = ALL[id];
    const k = it && it.k != null ? String(it.k).trim() : '';
    if (k) addKey('k:' + k, id);
    if (it && it.y && it.t) addKey('t:' + normFilmTitle(it.t) + '|' + Number(it.y) + '|' + (it.tp || 'movie'), id);
  }
  const groups = new Map();
  for (const id of ids) {
    const r = find(id);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(id);
  }
  const alias = new Map();
  const list = [];
  for (const [, members] of groups) {
    if (members.length < 2) continue;
    members.sort((a, b) => (dedupeScore(b, ALL[b]) - dedupeScore(a, ALL[a])) || (a < b ? -1 : 1));
    const canon = members[0];
    for (const a of members.slice(1)) alias.set(a, canon);
    list.push({
      canon,
      aliases: members.slice(1),
      items: members.map((id) => ({
        id, t: ALL[id].t, y: ALL[id].y || null, tp: ALL[id].tp || 'movie',
        k: ALL[id].k || null, builtin: !!STATIC_CATALOG[id],
      })),
    });
  }
  list.sort((a, b) => String(ALL[a.canon].t).localeCompare(String(ALL[b.canon].t), 'ru'));
  return { alias, groups: list };
}

export async function getDedupeInfo() {
  const now = Date.now();
  if (_dedupe && now - _dedupeAt < CATALOG_TTL) return _dedupe;
  const ALL = await getCatalogAll();
  _dedupe = buildDedupe(ALL);
  _dedupeAt = now;
  return _dedupe;
}
export async function getAliasMap() { return (await getDedupeInfo()).alias; }
export async function canonFilmId(id) {
  id = String(id == null ? '' : id);
  const alias = await getAliasMap();
  return alias.get(id) || id;
}

/* ---------- склейка голосов ----------
   Приоритет: «уже смотрел» (2) > «хочу» (1) > «мимо» (-1) — так суммарный
   голос пары не теряется, даже если дубли оценили по-разному. */
const VOTE_PRIO = { 2: 3, 1: 2, '-1': 1 };
export function remapVotesObj(v, alias) {
  const out = {};
  for (const id of Object.keys(v || {})) {
    const c = (alias && alias.get(String(id))) || String(id);
    const val = v[id];
    if (out[c] == null) { out[c] = val; continue; }
    if ((VOTE_PRIO[val] || 0) > (VOTE_PRIO[out[c]] || 0)) out[c] = val;
  }
  return out;
}

/* ---------- склейка мэтчей ---------- */
function canonMidOf(m, alias) {
  const id = String((m && m.id) || '');
  const c = alias.get(id);
  if (!c) return matchMid(m);
  const mid = String(m.mid || '');
  const tail = mid.indexOf('|') >= 0 ? mid.slice(mid.indexOf('|')) : ('|' + ((m.by || []).slice().sort().join('-')));
  return c + tail;
}
// копия мэтча с каноническим id/mid (если псевдоним) — для предикатов и выдачи
export function canonMatchCopy(m, alias) {
  const c = alias.get(String((m && m.id) || ''));
  if (!c) return m;
  return Object.assign({}, m, { id: c, mid: canonMidOf(m, alias) });
}
export function remapMatchList(list, alias) {
  const byMid = new Map();
  for (const m of (list || [])) {
    const mm = canonMatchCopy(m, alias);
    const key = matchMid(mm);
    const ex = byMid.get(key);
    if (!ex) { byMid.set(key, mm); continue; }
    // дубль внутри одной пары: флаг просмотра и оценки объединяем
    ex.watched = !!(ex.watched || mm.watched);
    ex.scores = Object.assign({}, mm.scores || {}, ex.scores || {});
    if (!ex.title && mm.title) ex.title = mm.title;
    if (!ex.poster && mm.poster) ex.poster = mm.poster;
  }
  return [...byMid.values()];
}
// список id с заменой псевдонимов и удалением повторов (подборки, стоп-листы)
export function dedupeIds(items, alias) {
  const seen = new Set();
  const out = [];
  for (const x of (items || [])) {
    const c = (alias && alias.get ? (alias.get(String(x)) || String(x)) : String(x));
    if (!seen.has(c)) { seen.add(c); out.push(c); }
  }
  return out;
}

/* ---------- отчёт о дубликатах и физическая склейка (админка) ---------- */
export async function dedupeReport() {
  const info = await getDedupeInfo();
  return {
    ok: true,
    groups: info.groups,
    aliasCount: info.alias.size,
    aliases: Object.fromEntries(info.alias),
  };
}
export async function dedupeRunMerge() {
  const info = await getDedupeInfo();
  if (!info.alias.size) return { ok: true, nothing: true, groups: 0 };
  const alias = info.alias;
  const stats = { users: 0, votes: 0, matches: 0, stops: 0, swlogs: 0, cols: 0, ucols: 0, hidden: 0 };
  const ids = await allUserIds();
  for (const uid of ids) {
    stats.users++;
    // голоса: getVotes уже отдаёт склеенную копию — записываем её физически
    try {
      const rawV = await db().get('v:' + uid);
      if (rawV) {
        const o = JSON.parse(rawV);
        if (Object.keys(o).some((k) => alias.has(k))) {
          stats.votes++;
          await db().set('v:' + uid, JSON.stringify(await getVotes(uid)));
        }
      }
    } catch (e) { /* не критично */ }
    // стоп-лист
    try {
      const rawS = await db().get('stop:' + uid);
      if (rawS) {
        const s = JSON.parse(rawS);
        if (((s && s.films) || []).some((f) => alias.has(String(f)))) {
          stats.stops++;
          await setStop(uid, await getStop(uid));   // getStop вернул уже заменённые id
        }
      }
    } catch (e) { /* ignore */ }
    // журнал свайпов
    try {
      const rawL = await db().get('swlog:' + uid);
      if (rawL) {
        const l = JSON.parse(rawL);
        if (Array.isArray(l) && l.some((x) => alias.has(String(x && x.id)))) {
          stats.swlogs++;
          await db().set('swlog:' + uid, JSON.stringify(await getSwlog(uid, 300)));
        }
      }
    } catch (e) { /* ignore */ }
    // свои подборки
    try {
      const rawU = await db().get('ucol:' + uid);
      if (rawU) {
        const u = JSON.parse(rawU);
        if (Array.isArray(u) && u.some((c) => (c.items || []).some((x) => alias.has(String(x))))) {
          stats.ucols++;
          await db().set('ucol:' + uid, JSON.stringify(await getUserCols(uid)));
        }
      }
    } catch (e) { /* ignore */ }
  }
  // мэтчи: перезаписываем шарды, только если в них физически есть псевдонимы
  try {
    const idx = await readJsonArray('m:index');
    let touched = 0;
    for (const pk of idx) {
      const raw = await db().get(mKey(pk));
      if (!raw) continue;
      let hit = false;
      for (const a of alias.keys()) if (raw.includes('"' + a + '"')) { hit = true; break; }
      if (hit) touched++;
    }
    if (touched) {
      const all = await getMatches();       // уже склеенный канонический список
      await setMatches(all);
      stats.matches = touched;
    }
  } catch (e) { console.warn('dedupe matches', e && e.message); }
  // админские подборки
  try {
    const cols = await getCollections();
    if (cols.some((c) => (c.items || []).some((x) => alias.has(String(x))))) {
      stats.cols++;
      await db().set('collections', JSON.stringify(cols));
    }
  } catch (e) { /* ignore */ }
  // дубли скрываем из колоды (канон остаётся)
  try {
    const hidden = await getHidden();
    let added = 0;
    for (const a of alias.keys()) if (!hidden.includes(a)) { hidden.push(a); added++; }
    if (added) { await setHidden(hidden); stats.hidden = added; }
  } catch (e) { /* ignore */ }
  return { ok: true, groups: info.groups.length, stats };
}

export async function getEarned(key) {
  try { const raw = await db().get('bg:' + key); return raw ? JSON.parse(raw) : []; } catch (e) { return []; }
}
export async function setEarned(key, list) { await db().set('bg:' + key, JSON.stringify(list)); return list; }

export async function isBanned(id) { return !!(await db().get('ban:' + id)); }
export async function setBanned(id, v) {
  if (v) await db().set('ban:' + id, '1'); else await db().delete('ban:' + id);
  return !!v;
}

export async function userStats(id) {
  const votes = await getVotes(id);
  const vals = Object.values(votes);
  const matches = await getMatches(id);
  const genres = new Set();
  matches.forEach((m) => (m.genres || []).forEach((g) => genres.add(g)));
  // жанры, которые человек ЛАЙКАЛ (для секретной награды «Всеядный»)
  let likedGenres = 0;
  try {
    const ALL = await getCatalogAll();
    const lg = new Set();
    for (const fid of Object.keys(votes)) {
      if (votes[fid] !== 1) continue;
      const it = ALL[fid];
      if (it) (it.g || []).forEach((g) => lg.add(String(g).toLowerCase()));
    }
    likedGenres = lg.size;
  } catch (e) { /* не критично */ }
  const act = await getUserActivity(id);
  const refs = (await getRefs(id)).length;
  return {
    likes: vals.filter((v) => v === 1).length,
    votes: vals.length,
    matches: matches.length,
    watched: matches.filter((m) => m.watched).length,
    ratings: matches.reduce((n, m) => n + (m.scores && m.scores[id] ? 1 : 0), 0),
    genres: genres.size,
    likedGenres,
    refs,
    streak: act.streakCount || 0,
    bestStreak: Math.max(act.bestStreak || 0, act.streakCount || 0),
    bestDay: act.bestDay || 0,
    nightLikes: act.nightLikes || 0,
  };
}

export async function coupleStats(aId, bId, catalogAll) {
  const key = [aId, bId].sort().join('|');
  const matches = await getPairMatches(aId, bId);
  const watched = matches.filter((m) => m.watched);
  const bothRated = matches.some((m) => m.scores && m.scores[aId] && m.scores[bId]);
  const scores = [];
  watched.forEach((m) => { if (m.scores) [aId, bId].forEach((u) => { if (m.scores[u]) scores.push(m.scores[u]); }); });
  const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  const genres = new Set();
  matches.forEach((m) => (m.genres || []).forEach((g) => genres.add(g)));
  let minutes = 0;
  watched.forEach((m) => {
    const c = (catalogAll || {})[m.id];
    if (c && c.minutes) minutes += c.minutes;
    else if (m.type === 'series') minutes += 45;
  });
  // секретная награда «Один вкус»: 10+ мэтчей и оценки всегда сходятся (разница не больше 1)
  let perfectAgreement = false;
  if (matches.length >= 10) {
    const both = matches.filter((m) => m.scores && m.scores[aId] && m.scores[bId]);
    perfectAgreement = both.length >= 5 && both.every((m) => Math.abs(m.scores[aId] - m.scores[bId]) <= 1);
  }
  return { matches: matches.length, watched: watched.length, bothRated, avg, genres: genres.size, minutes, perfectAgreement };
}

// все уникальные пары из пользователей
export async function allPairs() {
  const ids = await allUserIds();
  const seen = new Set();
  const pairs = [];
  for (const id of ids) {
    const u = await getUser(id);
    for (const pid of (u && u.partners ? u.partners : [])) {
      const key = [id, pid].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push(key.split('|'));
    }
  }
  return pairs;
}

/* ============================================================
   ГРУППЫ (3+ человек): общая колода на компанию
   Мэтч случается, когда фильм лайкнули ВСЕ участники группы.
   Ключи:
     grp:<gid>    — { id, code, title, members:[uid], createdBy, created }
     grp:index    — все группы (админка, резервная копия)
     gi:<uid>     — группы пользователя
     gc:<code>    — код → gid (вход по коду / ссылке)
   Групповые мэтчи лежат в тех же шардах, что и парные: 'm:g-<gid>',
   поэтому вся механика (CAS-запись, удаление, оценки) работает без изменений.
   ============================================================ */
export const GROUP_MAX_MEMBERS = 8;
export const GROUP_MAX_PER_USER = 3;

export async function getGroup(gid) {
  try { const raw = await db().get('grp:' + gid); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
}
export async function saveGroup(g) { await db().set('grp:' + g.id, JSON.stringify(g)); }
export async function allGroupIds() { return readJsonArray('grp:index'); }

export async function userGroups(uid) {
  const gids = await readJsonArray('gi:' + String(uid));
  const out = [];
  for (const gid of gids) {
    const g = await getGroup(gid);
    if (g && (g.members || []).map(String).includes(String(uid))) out.push(g);
  }
  return out;
}
async function addUserGroupIndex(uid, gid) {
  const cur = await readJsonArray('gi:' + String(uid));
  if (!cur.includes(gid)) await db().set('gi:' + String(uid), JSON.stringify(cur.concat(gid).slice(0, 12)));
}
export function genGroupCode() {
  let s = '';
  const b = crypto.randomBytes(6);
  for (let i = 0; i < 5; i++) s += ALPHABET[b[i] % ALPHABET.length];
  return s;
}

export async function createGroup(uid, title) {
  const mine = await userGroups(uid);
  if (mine.length >= GROUP_MAX_PER_USER) return { ok: false, error: `Максимум ${GROUP_MAX_PER_USER} группы у одного человека` };
  title = String(title || '').trim().slice(0, 40);
  if (!title) return { ok: false, error: 'Введите название группы' };
  const id = 'G' + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 1296).toString(36).toUpperCase().padStart(2, '0');
  let code = genGroupCode();
  for (let i = 0; i < 8; i++) {
    if (!(await db().get('gc:' + code))) break;
    code = genGroupCode();
  }
  const g = { id, code, title, members: [String(uid)], createdBy: String(uid), created: Date.now() };
  await saveGroup(g);
  await db().set('gc:' + code, id);
  const idx = await readJsonArray('grp:index');
  if (!idx.includes(id)) await db().set('grp:index', JSON.stringify(idx.concat(id)));
  await addUserGroupIndex(uid, id);
  return { ok: true, group: g };
}

export async function joinGroupByCode(uid, code) {
  code = String(code || '').trim().toUpperCase();
  if (!code) return { ok: false, error: 'Введите код группы' };
  const gid = await db().get('gc:' + code);
  if (!gid) return { ok: false, error: 'Группы с таким кодом нет. Проверьте код.' };
  const g = await getGroup(gid);
  if (!g) return { ok: false, error: 'Группа не найдена' };
  if ((g.members || []).map(String).includes(String(uid))) return { ok: true, already: true, group: g };
  if ((g.members || []).length >= GROUP_MAX_MEMBERS) return { ok: false, error: `В группе уже ${GROUP_MAX_MEMBERS} человек — это предел` };
  g.members = (g.members || []).concat(String(uid));
  await saveGroup(g);
  await addUserGroupIndex(uid, g.id);
  return { ok: true, joined: true, group: g };
}

export async function leaveGroup(uid, gid) {
  const g = await getGroup(gid);
  if (!g) return { ok: false, error: 'Группа не найдена' };
  if (!(g.members || []).map(String).includes(String(uid))) return { ok: false, error: 'Вы не в этой группе' };
  g.members = g.members.filter((x) => String(x) !== String(uid));
  const mine = (await readJsonArray('gi:' + String(uid))).filter((x) => x !== gid);
  await db().set('gi:' + String(uid), JSON.stringify(mine));
  if (!g.members.length) {
    // группа пуста — распускаем
    try { await db().delete('grp:' + gid); } catch (e) {}
    try { await db().delete('gc:' + g.code); } catch (e) {}
    const idx = await readJsonArray('grp:index');
    await db().set('grp:index', JSON.stringify(idx.filter((x) => x !== gid)));
    return { ok: true, dissolved: true };
  }
  await saveGroup(g);
  return { ok: true, group: g };
}

export async function getGroupMatches(gid) {
  await ensureMatchesMigrated();
  const list = dedupeByMid(await readShard('g-' + gid));
  const alias = await getAliasMap();
  return alias.size ? remapMatchList(list, alias) : list;
}

// голоса всех участников групп — для общей колоды компании
export async function groupsVoted(uid) {
  const out = {};
  for (const g of await userGroups(uid)) {
    const per = {};
    for (const m of (g.members || [])) per[String(m)] = Object.keys(await getVotes(m));
    out[g.id] = per;
  }
  return out;
}
// короткая подпись gvoted (меняется — клиент перезапрашивает hello)
export function gvSignature(gv) {
  return Object.keys(gv || {}).sort().map((gid) => gid + '=' + Object.keys(gv[gid] || {}).sort()
    .map((u) => u + ':' + (gv[gid][u] || []).length + ':' + ((gv[gid][u] || []).reduce((a, x) => (a * 31 + String(x).split('').reduce((s2, c) => s2 + c.charCodeAt(0), 0)) >>> 0, 7)))
    .join(',')).join('|');
}

/* ============================================================
   РЕФЕРАЛЫ: кто кого пригласил
   refs:<uid> — [{ id, name, ts }] (кого пригласил uid)
   u.refBy    — кто пригласил этого пользователя (один раз и навсегда)
   ============================================================ */
export async function getRefs(uid) {
  try { const raw = await db().get('refs:' + uid); const a = raw ? JSON.parse(raw) : []; return Array.isArray(a) ? a : []; } catch (e) { return []; }
}
// засчитывает приглашение: возвращает referrer-объект, если засчитано
export async function trackReferral(me, refId) {
  refId = String(refId || '');
  if (!refId || !me || String(refId) === String(me.id)) return null;
  if (me.refBy) return null;                      // уже засчитано однажды
  const referrer = await getUser(refId);
  if (!referrer) return null;
  me.refBy = refId;
  await saveUser(me);
  const list = await getRefs(refId);
  if (!list.some((x) => String(x.id) === String(me.id))) {
    list.push({ id: String(me.id), name: me.first_name || '', ts: Date.now() });
    await db().set('refs:' + refId, JSON.stringify(list.slice(-500)));
  }
  return referrer;
}

/* ============================================================
   ПРОВЕРКА ВЕРСИИ КЛИЕНТА
   Админ задаёт minClient в настройках; приложение шлёт свою версию
   в hello. Устаревшим клиентам возвращается needUpdate — приложение
   показывает блокирующий экран с кнопкой «Обновить».
   ============================================================ */
export function cmpVer(a, b) {
  const pa = String(a || '0').split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b || '0').split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}
export function needUpdateInfo(settings, clientVer) {
  const min = String((settings && settings.minClient) || '').trim();
  if (!min) return null;
  if (!clientVer || cmpVer(clientVer, min) < 0) return { min };
  return null;
}

/* ============================================================
   ПРЕДПРОСМОТР КОЛОДЫ (админка)
   С версии 1.8.0 колода у каждого СВОЯ, поэтому превью считается
   отдельно для каждого из двух партнёров и точно повторяет клиентский
   алгоритм: тот же FNV-хэш от ключа «deck:pair:<мой id>:<версия каталога>»,
   тот же mulberry32, тот же Fisher–Yates и те же ступени подъёма
   любимых жанров — админ видит ровно тот порядок, что и пользователь.
   Не учитываются только фильтры экрана (настроение/длительность/подборка)
   и локальный переключатель «🎯 Под мой вкус» (он живёт в браузере
   пользователя, сервер о нём не знает).
   ============================================================ */
export const fnvHash = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return Math.abs(h);
};
export function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* те же константы, что в клиентском app-ui.js — менять только вместе с ними */
const PERS_MIN_LIKES = 3;   // меньше лайков — данных мало, порядок не трогаем
const PERS_TIERS = 3;       // на сколько «ступеней» поднимаем любимые жанры
const PREFS_LIMIT = 18;     // столько жанров показывает выбор интересов

/* жанры каталога по популярности — как popularGenres() в клиенте */
export function catalogGenres(ALL, limit = PREFS_LIMIT) {
  const counts = {};
  for (const id of Object.keys(ALL)) for (const g of (ALL[id].g || [])) counts[g] = (counts[g] || 0) + 1;
  return Object.entries(counts).sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0])).slice(0, limit).map(([g]) => g);
}

/* жанры, которые человек лайкает чаще всего — как genreAffinity() в клиенте */
function affinityOf(ALL, votes) {
  const counts = {};
  let likes = 0;
  for (const id of Object.keys(votes || {})) {
    if (votes[id] !== 1) continue;
    likes++;
    const it = ALL[id];
    if (!it) continue;
    for (const g of (it.g || [])) counts[g] = (counts[g] || 0) + 1;
  }
  const max = Object.keys(counts).reduce((m, g) => Math.max(m, counts[g]), 0);
  return { counts, max, likes };
}

/* колода ОДНОГО человека: его голоса, его стоп-лист, его любимые жанры */
export async function buildUserDeck(userId, version, limit = 30, opt = {}) {
  const ALL = opt.ALL || await getCatalogAll();
  const hidden = opt.hidden || new Set(await getHidden());
  const alias = opt.alias || await getAliasMap();
  const [votes, stop, prefs] = await Promise.all([getVotes(userId), getStop(userId), getPrefs(userId)]);
  const stopFilms = new Set((stop.films || []).map(String));
  const stopGenres = new Set((stop.genres || []).map((g) => String(g).toLowerCase()));
  const pref = new Set((prefs.genres || []).map((g) => String(g).toLowerCase()));

  const ids = Object.keys(ALL).filter((id) => {
    if (hidden.has(id)) return false;
    if (alias.has(id)) return false;              // дубликаты каталога не показываем
    if (stopFilms.has(id)) return false;
    if (votes[id] != null) return false;          // карточка уходит, когда её оценил Я
    const gs = ALL[id].g || [];
    return !gs.some((g) => stopGenres.has(String(g).toLowerCase()));
  });

  /* Колода дня идёт В НАЧАЛО — ровно как в клиенте (pinDaily).
     opt.daily: уже посчитанный пул дня, чтобы не считать его дважды на пару. */
  /* Колода дня клиента всегда считается от ПЕРВОГО партнёра пользователя
     (или от выбранного в переключателе). Если брать того, кто «второй» в
     предпросмотре пары, дневной блок у админа разошёлся бы с реальным. */
  const meUser = opt.me || await getUser(userId);
  const firstPartner = String(((meUser && meUser.partners) || [])[0] || '');
  let dailyIds = [];
  if (firstPartner && firstPartner !== String(userId)) {
    const myDaily = await buildDailyDeck(String(userId), Object.assign({}, opt, { me: meUser, partnerId: firstPartner }));
    dailyIds = ((myDaily && myDaily.items) || []).map(String);
  }

  // сид — от МОЕГО id: у каждого своя колода и свой порядок
  const seed = fnvHash('deck:pair:' + String(userId) + ':' + String(version || ''));
  const rnd = mulberry32(seed);
  for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }

  // подъём любимых жанров — та же устойчивая сортировка, что в клиенте
  const aff = affinityOf(ALL, votes);
  const autoOk = opt.personalize !== false && aff.likes >= PERS_MIN_LIKES && !!aff.max;
  let personalized = false;
  let dailyPinned = [];
  if (autoOk || pref.size) {
    const decorated = ids.map((id, i) => {
      let tier = 0;
      const gs = ALL[id].g || [];
      if (autoOk) {
        let best = 0;
        for (const g of gs) { const c = aff.counts[g] || 0; if (c > best) best = c; }
        tier = best ? Math.max(1, Math.round((best / aff.max) * PERS_TIERS)) : 0;
      }
      // выбранные вручную жанры — выше любых авто-подсказок (явный выбор сильнее)
      if (pref.size && gs.some((g) => pref.has(String(g).toLowerCase()))) tier = Math.max(tier, PERS_TIERS + 2);
      return { id, i, tier };
    });
    decorated.sort((x, y) => (y.tier - x.tier) || (x.i - y.i));
    personalized = decorated.some((d) => d.tier > 0);
    ids.length = 0;
    for (const d of decorated) ids.push(d.id);
  }

  if (dailyIds.length) {
    const byId = new Map(ids.map((id) => [String(id), id]));
    const head = [];
    for (const id of dailyIds) {
      // клиент кладёт в колоду только то, что человек сам не оценил — повторяем
      if (votes[id] != null) continue;
      if (byId.has(String(id))) { head.push(String(id)); byId.delete(String(id)); }
    }
    if (head.length) {
      /* Дневной блок кладём В НАЧАЛО и не трогаем персонализацией — ровно как
         в клиенте: он обязан быть одинаковым у обоих партнёров. Персонализация
         уже применена к ids выше, поэтому хвост остаётся персональным. */
      const rest = ids.filter((id) => byId.has(String(id)));
      ids.length = 0;
      ids.push(...head, ...rest);
      dailyPinned = head;
    }
  }

  return {
    total: ids.length,
    personalized,
    daily: dailyPinned,
    prefs: [...pref],
    topGenres: Object.keys(aff.counts).sort((a, b) => aff.counts[b] - aff.counts[a]).slice(0, 3),
    items: ids.slice(0, Math.max(1, Math.min(100, Number(limit) || 30))).map((id) => ({
      id, t: ALL[id].t, y: ALL[id].y, r: ALL[id].r, p: ALL[id].p, tp: ALL[id].tp,
    })),
  };
}

/* общая (синхронная) колода пары — legacy-режим, если владелец включил его в админке */
export async function buildSharedDeck(aId, bId, version, limit = 30, opt = {}) {
  const ALL = opt.ALL || await getCatalogAll();
  const hidden = opt.hidden || new Set(await getHidden());
  const [va, vb, sa, sb] = await Promise.all([getVotes(aId), getVotes(bId), getStop(aId), getStop(bId)]);
  const stopFilms = new Set([...(sa.films || []), ...(sb.films || [])].map(String));
  const stopGenres = new Set([...(sa.genres || []), ...(sb.genres || [])].map((g) => String(g).toLowerCase()));
  const ids = Object.keys(ALL).filter((id) => {
    if (hidden.has(id)) return false;
    if (stopFilms.has(id)) return false;
    if (va[id] != null || vb[id] != null) return false;
    const gs = ALL[id].g || [];
    return !gs.some((g) => stopGenres.has(String(g).toLowerCase()));
  });
  const seed = fnvHash('deck:pair:' + pairKeyOf(aId, bId) + ':' + String(version || ''));
  const rnd = mulberry32(seed);
  for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
  return {
    total: ids.length,
    items: ids.slice(0, Math.max(1, Math.min(100, Number(limit) || 30))).map((id) => ({
      id, t: ALL[id].t, y: ALL[id].y, r: ALL[id].r, p: ALL[id].p, tp: ALL[id].tp,
    })),
  };
}

/* Что увидит пара: по умолчанию две независимые колоды (по одной на человека),
   в legacy-режиме syncDeck — одна общая. */
export async function buildDeckPreview(aId, bId, version, limit = 30) {
  const st = await getSettings();
  const ALL = await getCatalogAll();
  const hidden = new Set(await getHidden());
  const alias = await getAliasMap();
  const opt = { ALL, hidden, alias };
  if (st.syncDeck === true) {
    const shared = await buildSharedDeck(aId, bId, version, limit, opt);
    return { mode: 'shared', syncDeck: true, shared, genres: catalogGenres(ALL) };
  }
  // колода дня у каждого своя (от его первого партнёра) — buildUserDeck считает сам
  const day = dailyKey();
  const [deckA, deckB] = await Promise.all([
    buildUserDeck(aId, version, limit, opt),
    buildUserDeck(bId, version, limit, opt),
  ]);
  const dailyShared = await buildDailyPool([String(aId), String(bId)], day, opt);
  return {
    mode: 'independent', syncDeck: false, deckA, deckB, genres: catalogGenres(ALL),
    dailyDay: day, dailyPool: dailyShared.pool.slice(0, DAILY_DECK_SIZE),
    // для обратной совместимости со старыми вызовами/тестами
    total: deckA.total, items: deckA.items,
  };
}

/* ============================================================
   «КАКОЙ СЕГОДНЯ ВЕЧЕР?» (mood:<uid>)
   Один вопрос обоим перед свайпами. Это ровно тот разговор, ради
   которого приложение открывают: не «какой фильм», а «чего мы оба
   хотим прямо сейчас».

   Ответ живёт только до конца суток (по Москве) и влияет на то, какие
   жанры поднимаются в колоде дня. Колода дня при этом остаётся ОБЩЕЙ:
   пул фиксируется на сутки, иначе порядок прыгал бы у обоих после
   каждого ответа. Если мнения разошлись — берём объединение жанров.
   ============================================================ */
export const MOODS = {
  fun:    { key: 'fun',    icon: '😂', label: 'Посмеяться',        genres: ['комедия', 'мелодрама', 'музыка', 'семейный'] },
  nerves: { key: 'nerves', icon: '😱', label: 'Пощекотать нервы',  genres: ['ужасы', 'триллер', 'детектив', 'криминал'] },
  think:  { key: 'think',  icon: '🤔', label: 'Подумать',          genres: ['драма', 'история', 'военный', 'документальный'] },
  relax:  { key: 'relax',  icon: '🛋️', label: 'Не думать вообще',  genres: ['боевик', 'приключения', 'фантастика', 'фэнтези'] },
  love:   { key: 'love',   icon: '💞', label: 'Романтики',         genres: ['мелодрама', 'драма', 'комедия'] },
  epic:   { key: 'epic',   icon: '🍿', label: 'Большое кино',      genres: ['фантастика', 'приключения', 'боевик', 'история'] },
};
export const MOOD_KEYS = Object.keys(MOODS);
/* Жанры настроения — то, чем «вечер» отличается от обычного фильтра. */
export const MOOD_GENRES = MOOD_KEYS.reduce((acc, k) => { acc[k] = MOODS[k].genres.slice(); return acc; }, {});

/* Ключ хранилища — evening:<uid>, а НЕ mood:<uid>: в клиенте S.mood занят
   фильтром колоды («Лёгкое / Пожернее»), и одинаковое имя в двух смыслах
   уже один раз нас сломало. */
export async function getMood(uid) {
  try {
    const raw = await db().get('evening:' + uid);
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (!o || !o.day || o.day !== dailyKey()) return null;   // вчерашний ответ протух
    if (!MOODS[o.key]) return null;
    return { key: o.key, day: o.day, ts: Number(o.ts) || 0 };
  } catch (e) { return null; }
}

export async function setMood(uid, key) {
  const k = String(key || '').trim().toLowerCase();
  if (!k) { try { await db().delete('evening:' + uid); } catch (e) {} return null; }
  if (!MOODS[k]) return { error: 'Неизвестное настроение: «' + k.slice(0, 20) + '»' };
  const next = { key: k, day: dailyKey(), ts: Date.now() };
  await db().set('evening:' + uid, JSON.stringify(next));
  return next;
}

/* Какой вечер сейчас у пары: если оба ответили — объединение, если один —
   его выбор, если никто — null (колода дня строится как обычно). */
export async function moodOfDay(aId, bId) {
  const [a, b] = await Promise.all([getMood(aId), getMood(bId)]);
  const keys = [...new Set([a && a.key, b && b.key].filter(Boolean))];
  if (!keys.length) return { keys: [], genres: [], both: false, answered: 0 };
  const genres = [...new Set(keys.reduce((acc, k) => acc.concat(MOOD_GENRES[k] || []), []))];
  return { keys, genres, both: keys.length > 1 || (!!a && !!b), answered: (a ? 1 : 0) + (b ? 1 : 0) };
}

/* ============================================================
   ИГРЫ С ПАРТНЁРОМ (game:<uid>)
   Две механики, которым не нужна новая инфраструктура — только голоса,
   которые и так пишутся:

   🎯 «Угадай, понравится ли партнёру»
      Показываем фильм, который партнёр ЕЩЁ не оценил. Вы жмёте ❤️ или 🚫
      ЗА НЕГО. Как только он оценит фильм сам — сравним и посчитаем счёт.
      Работает асинхронно: угадывать можно сегодня, а проверится через неделю.

   🎭 «Слепая дуэль»
      Обоим приходит ОДИН фильм, но без названия и постера — только жанр,
      год и рейтинг. Каждый ставит «зайдёт / не зайдёт», потом карточка
      открывается и видно, совпали ли вы. Раунд живёт до конца суток.
   ============================================================ */
export const DUEL_TTL = 86400e3;

async function gameRead(uid) {
  try {
    const raw = await db().get('game:' + uid);
    return raw ? JSON.parse(raw) : {};
  } catch (e) { return {}; }
}
async function gameWrite(uid, st) {
  await db().set('game:' + uid, JSON.stringify(st));
  return st;
}

/* Подсчёт «угадаек»: проходим по сохранённым догадкам и сверяем с реальными
   голосами партнёра. Делается на чтении — отдельный воркер не нужен. */
export async function resolveGuesses(uid, partnerId) {
  const st = await gameRead(uid);
  const guesses = st.guesses || {};
  const keys = Object.keys(guesses);
  if (!keys.length) return { st, resolved: 0 };
  const pv = await getVotes(partnerId);
  let resolved = 0;
  let score = Number(st.guessScore) || 0;
  let total = Number(st.guessTotal) || 0;
  for (const fid of keys) {
    const g = guesses[fid];
    const real = pv[fid];
    if (real == null || !g || g.done) continue;
    const hit = (real === 1 && g.v === 1) || (real !== 1 && g.v !== 1);
    g.done = true;
    g.real = real;
    g.resolvedAt = Date.now();
    total++;
    if (hit) score++;
    resolved++;
  }
  if (resolved) {
    st.guesses = guesses;
    st.guessScore = score;
    st.guessTotal = total;
    await gameWrite(uid, st);
  }
  return { st, resolved, score, total };
}

/* Общий счёт дуэлей пары: у обоих должен быть одинаковым, хотя пишет его
   только тот, кто в раунде ответил последним. */
function duelStatsOf(a, b) {
  const sa = (a && a.duelStats) || {};
  const sb = (b && b.duelStats) || {};
  const pick = (k) => Math.max(Number(sa[k]) || 0, Number(sb[k]) || 0);
  return { rounds: pick('rounds'), agree: pick('agree') };
}

export async function gameState(uid) {
  const me = await getUser(uid);
  const st = await gameRead(uid);
  const partners = ((me && me.partners) || []).map(String);
  const pid = partners[0] || null;

  /* Догадки проверяем при каждом открытии игры.
     ВАЖНО: resolveGuesses возвращает СВЕЖЕЕ состояние (оно же записывает
     счёт в хранилище), поэтому дальше используем r.st, а не st — иначе
     ответ уходил со счётом, прочитанным ДО проверки, и только что
     засчитанная догадка не отображалась. */
  let resolvedNow = 0;
  let fresh = st;
  if (pid) { const r = await resolveGuesses(uid, pid); resolvedNow = r.resolved; if (r.st) fresh = r.st; }

  /* Раунд дуэли: протухший чистим и сразу начинаем новый. Без автостарта
     экран игр показывал «Раунд не начался», пока пользователь не нажимал
     кнопку, — а раунд один на сутки, терять показ бессмысленно. */
  let duel = fresh.duel || null;
  let needWrite = false;
  if (duel && (!duel.day || duel.day !== dailyKey() || duel.pair !== duelKeyFor(uid, pid))) {
    duel = null; fresh.duel = null; needWrite = true;   // чистим протухший раунд даже без партнёра
  }
  if (!duel && pid) {
    const picked = await duelFilmFor(uid, pid);
    if (picked) {
      duel = Object.assign({}, picked, { verdict: null, pair: duelKeyFor(uid, pid) });
      fresh.duel = duel;
      needWrite = true;
    }
  }

  /* Фильм для «угадайки» выбираем заранее — как и раунд дуэли.
     Иначе первый вход в игру показывал «Подходящих фильмов пока нет»
     и начать игру из приложения было нельзя: guessFilm появлялся только
     после первого ответа, а ответить без фильма нельзя — замкнутый круг. */
  if (pid && !(fresh.guessFilm && fresh.guessFilm.id)) {
    const gf = await pickGuessFilm(uid);
    if (gf) { fresh.guessFilm = { id: gf.id }; needWrite = true; }
  }
  let guessFilm = null;
  if (fresh.guessFilm && fresh.guessFilm.id) {
    guessFilm = await filmBrief(fresh.guessFilm.id);
    if (!guessFilm && pid) {
      // фильм пропал из каталога (скрыт админом) — берём новый
      fresh.guessFilm = null; needWrite = true;
      const gf2 = await pickGuessFilm(uid);
      if (gf2) { fresh.guessFilm = { id: gf2.id }; guessFilm = await filmBrief(gf2.id); }
    }
  }
  if (needWrite) await gameWrite(uid, fresh);

  const partner = pid ? await getUser(pid) : null;
  const partnerGame = pid ? await gameRead(pid) : {};
  /* Раунд партнёра обязан быть не только про тот же фильм, но и про ТУ ЖЕ
     пару: id совпадает по сиду, а сид считается от дня и состава пары.
     Без проверки пары редкая коллизия сидов показала бы чужой ответ. */
  const partnerDuel = (duel && partnerGame.duel && partnerGame.duel.id === duel.id
    && (!duel.pair || partnerGame.duel.pair === duel.pair)) ? partnerGame.duel : null;
  return {
    ok: true,
    resolvedNow,
    partner: partner ? { id: partner.id, first_name: partner.first_name || '', photo_url: partner.photo_url || null } : null,
    guess: {
      score: Number(fresh.guessScore) || 0,
      total: Number(fresh.guessTotal) || 0,
      pending: Object.keys(fresh.guesses || {}).filter((k) => !(fresh.guesses[k] || {}).done).length,
      film: guessFilm,
    },
    duel: duel ? {
      day: duel.day,
      filmId: duel.id,
      clue: duel.clue,
      myVerdict: duel.verdict != null ? !!duel.verdict : null,
      partnerVerdict: partnerDuel ? (partnerDuel.verdict != null ? !!partnerDuel.verdict : null) : null,
      revealed: await duelReveal(duel, partnerDuel),
      /* Статистика дуэлей нужна экрану игр: без неё вкладка «Слепая дуэль»
         выглядит пустой, когда раунд дня уже сыгран. Счётчик ведёт тот, кто
         ответил ПОСЛЕДНИМ (см. gameDuelVerdict), поэтому берём максимум из
         своего и партнёрского — иначе у ответившего первым всегда было бы 0. */
      stats: duelStatsOf(fresh, partnerGame),
    } : null,
    duelStats: duelStatsOf(fresh, partnerGame),
  };
}

async function filmBrief(id) {
  const ALL = await getCatalogAll();
  const it = ALL[id];
  if (!it) return null;
  return { id, t: it.t, y: it.y, r: it.r, p: it.p, g: it.g || [], tp: it.tp };
}

/* Фильм для «угадайки»: партнёр его ещё не оценил, а у нас есть мнение
   (иначе сравнивать нечего). Берём из персональной колоды — она уже
   отфильтрована по стоп-листам и жанрам человека.
   Фильмы с уже висящими (непроверенными) догадками и явные исключения
   (opt.exclude) не предлагаем — иначе «🔄 Другой фильм» возвращал бы
   ту же карточку, на которую только что ответили. */
export async function pickGuessFilm(uid, opt = {}) {
  const me = await getUser(uid);
  const pid = String(((me && me.partners) || [])[0] || '');
  if (!pid) return null;
  const pv = await getVotes(pid);
  const my = await getVotes(uid);
  const deck = await buildUserDeck(uid, '', 60, {});
  const gSt = await gameRead(uid);
  const rawExcl = Array.isArray(opt.exclude) ? opt.exclude : (opt.exclude ? [opt.exclude] : []);
  const excl = new Set(rawExcl.map(String));
  for (const k of Object.keys(gSt.guesses || {})) {
    if (!(gSt.guesses[k] || {}).done) excl.add(String(k));
  }
  const free = (it) => !excl.has(String(it.id));
  let pool = deck.items.filter((it) => pv[it.id] == null && my[it.id] != null && free(it));
  if (!pool.length) pool = deck.items.filter((it) => pv[it.id] == null && free(it));
  // совсем нечего предложить нового — разрешаем повторно гадать по старым
  if (!pool.length) pool = deck.items.filter((it) => pv[it.id] == null && my[it.id] != null);
  if (!pool.length) pool = deck.items.filter((it) => pv[it.id] == null);
  if (!pool.length) return null;
  const pick = pool[Math.floor(Math.random() * Math.min(pool.length, 12))];
  return pick ? { id: pick.id, t: pick.t, y: pick.y, r: pick.r, p: pick.p, tp: pick.tp } : null;
}

/* «🔄 Другой фильм»: выбираем новую карточку и СОХРАНЯЕМ её текущей.
   Раньше nextGuess только возвращал случайный фильм, ничего не записывая,
   и следующий же game.state показывал прежнюю карточку — кнопка в UI
   выглядела сломанной (фильм не менялся). */
export async function gameNextGuess(uid) {
  const me = await getUser(uid);
  const pid = String(((me && me.partners) || [])[0] || '');
  if (!pid) return { ok: false, error: 'Сначала свяжитесь с партнёром — угадывать не за кого' };
  const st = await gameRead(uid);
  const cur = (st.guessFilm && st.guessFilm.id) || null;
  const film = await pickGuessFilm(uid, { exclude: cur ? [cur] : [] });
  st.guessFilm = film ? { id: film.id } : null;
  await gameWrite(uid, st);
  return { ok: true, film };
}

export async function gameGuess(uid, filmId, guess, site, token) {
  const me = await getUser(uid);
  const pid = String(((me && me.partners) || [])[0] || '');
  if (!pid) return { ok: false, error: 'Сначала свяжитесь с партнёром — угадывать не за кого' };
  const ALL = await getCatalogAll();
  if (!ALL[filmId]) return { ok: false, error: 'Фильм не найден в каталоге' };
  const st = await gameRead(uid);
  st.guesses = st.guesses || {};

  /* Уже проверенную догадку не перезаписываем: счёт (score/total) её
     засчитал, а повторный ответ на тот же фильм посчитал бы фильм ВТОРОЙ
     раз — процент знания вкуса партнёра разъезжался бы с реальностью.
     Возвращаем прошлый результат как есть. */
  const prevG = st.guesses[filmId];
  if (prevG && prevG.done) {
    const real = prevG.real;
    return {
      ok: true, guess: prevG.v, already: true,
      instant: { real, hit: (real === 1) === (prevG.v === 1), score: Number(st.guessScore) || 0, total: Number(st.guessTotal) || 0 },
      next: await pickGuessFilm(uid, { exclude: [filmId] }),
    };
  }

  if (Object.keys(st.guesses).length >= 60) {   // не даём списку гаданий расти бесконечно
    const old = Object.keys(st.guesses).filter((k) => st.guesses[k].done).slice(0, 20);
    for (const k of old) delete st.guesses[k];
    // проверенных нет, а список всё равно раздулся — режем самые старые висяки
    const leftK = Object.keys(st.guesses);
    if (leftK.length >= 60) {
      leftK.sort((a, b) => (st.guesses[a].ts || 0) - (st.guesses[b].ts || 0));
      for (const k of leftK.slice(0, leftK.length - 40)) delete st.guesses[k];
    }
  }
  const v = guess === true || guess === 1 || guess === '1' ? 1 : -1;
  st.guesses[filmId] = { v, ts: Date.now(), done: false };
  await gameWrite(uid, st);

  // если партнёр УЖЕ оценил этот фильм — проверяем сразу
  const pv = await getVotes(pid);
  let instant = null;
  if (pv[filmId] != null) {
    const r = await resolveGuesses(uid, pid);
    const g = (r.st.guesses || {})[filmId];
    instant = { real: pv[filmId], hit: !!(g && g.done && ((pv[filmId] === 1) === (v === 1))), score: r.score, total: r.total };
  }

  // зовём партнёра оценить фильм — иначе догадка так и повиснет
  if (!instant && site && token) {
    const other = await getUser(pid);
    if (other && await once('guessask:' + pid + ':' + filmId + ':' + dailyKey())) {
      await notifyUser(pid, 'admin', {
        parse_mode: 'HTML',
        text: `🎯 <b>${esc((me && me.first_name) || 'Партнёр')} угадывает ваш вкус</b>\n\n`
          + `Оцените «${esc(ALL[filmId].t || 'фильм')}» в приложении — и мы покажем, угадал ли он.`,
        reply_markup: { inline_keyboard: [
          [{ text: '🎬 Оценить', web_app: { url: site + '/?startapp=film_' + encodeURIComponent(filmId) } }],
          [{ text: '🔕 Не беспокоить', callback_data: 'mute:7' }],
        ] },
      }, token).catch(() => {});
    }
  }
  /* Следующая карточка сразу становится текущей: если оставить на экране
     только что угаданный фильм, после ответа UI показывал бы его же —
     казалось, что ответ не записался. */
  const next = await pickGuessFilm(uid, { exclude: [filmId] });
  const st2 = await gameRead(uid);
  st2.guessFilm = next ? { id: next.id } : null;
  await gameWrite(uid, st2);
  return { ok: true, guess: v, instant, next, score: Number(st2.guessScore) || 0, total: Number(st2.guessTotal) || 0 };
}

/* Дуэль: раунд один на пару в сутки.

   ВАЖНО: ключ — ОТСОТИРОВАННАЯ пара id, а не «я + мой первый партнёр».
   Иначе инициатору и его партнёру выпадали разные фильмы: у A первым
   партнёром мог быть C, а у B — A, и сиды не совпадали. Отсортированная
   пара одинакова с обеих сторон, поэтому фильм один и тот же. */
export function duelKeyFor(aId, bId) {
  return [String(aId), String(bId)].sort().join('|');
}
async function duelFilmFor(aId, bId) {
  const day = dailyKey();
  const key = duelKeyFor(aId, bId);
  const rnd = mulberry32(fnvHash('duel:' + day + ':' + key));
  const ALL = await getCatalogAll();
  const hidden = new Set(await getHidden());
  const alias = await getAliasMap();
  const ids = Object.keys(ALL).filter((id) => !hidden.has(id) && !alias.has(id) && (ALL[id].r || 0) >= 6.5);
  if (!ids.length) return null;
  const id = ids[Math.floor(rnd() * ids.length)];
  const it = ALL[id];
  return {
    id, day,
    clue: {
      genres: (it.g || []).slice(0, 3),
      year: it.y,
      rating: it.r != null ? Math.round(it.r * 10) / 10 : null,
      type: it.tp === 'series' ? 'series' : 'movie',
      minutes: it.minutes || null,
    },
  };
}

async function duelReveal(myDuel, partnerDuel) {
  if (!myDuel || myDuel.verdict == null) return null;
  if (!partnerDuel || partnerDuel.verdict == null) return null;
  // раунды обязаны быть про одну и ту же пару (защита от коллизии сидов)
  if (myDuel.pair && partnerDuel.pair && myDuel.pair !== partnerDuel.pair) return null;
  return await filmBrief(myDuel.id);
}

export async function gameDuel(uid, site, token) {
  const me = await getUser(uid);
  const pid = String(((me && me.partners) || [])[0] || '');
  if (!pid) return { ok: false, error: 'Для дуэли нужен партнёр' };
  const st = await gameRead(uid);
  const day = dailyKey();
  if (!st.duel || st.duel.day !== day || st.duel.pair !== duelKeyFor(uid, pid)) {
    const picked = await duelFilmFor(uid, pid);
    if (!picked) return { ok: false, error: 'Не удалось выбрать фильм для дуэли' };
    st.duel = Object.assign({}, picked, { verdict: null, pair: duelKeyFor(uid, pid) });
    await gameWrite(uid, st);
  }
  const body = st.duel;
  const pSt = await gameRead(pid);
  // раунд у партнёра должен быть от той же пары И того же дня — иначе это чужая дуэль
  const pDuel = (pSt.duel && pSt.duel.id === body.id && (!body.pair || pSt.duel.pair === body.pair)) ? pSt.duel : null;
  const partnerDone = !!(pDuel && pDuel.verdict != null);
  return {
    ok: true,
    duel: {
      day: body.day,
      filmId: body.id,
      clue: body.clue,
      myVerdict: body.verdict != null ? !!body.verdict : null,
      partnerVerdict: partnerDone ? !!pDuel.verdict : null,
      /* Раньше здесь фильм открывался, как только ответил ПАРТНЁР, — даже если
         вы свой ответ ещё не поставили (spoiler) и даже если вы ещё не отвечали.
         Теперь правило одно и то же и тут, и в game.state: карточка открывается,
         только когда оба ответа на месте. */
      revealed: await duelReveal(body, pDuel),
    },
  };
}

export async function gameDuelVerdict(uid, verdict) {
  const st = await gameRead(uid);
  if (!st.duel) return { ok: false, error: 'Раунд не начат' };
  const me = await getUser(uid);
  const pid = String(((me && me.partners) || [])[0] || '');
  /* Раунд живёт сутки и принадлежит одной паре. Ответ в протухший раунд
     (экран остался открытым с прошлого дня) засчитывать нельзя: фильм уже
     другой, и счётчик раундов накрутился бы на пустом месте. */
  const day = dailyKey();
  const pairOk = !pid || st.duel.pair === duelKeyFor(uid, pid);
  if (st.duel.day !== day || !pairOk) {
    st.duel = null;
    await gameWrite(uid, st);
    return { ok: false, stale: true, error: 'Раунд устарел — начали новый, ответьте ещё раз' };
  }
  const my = verdict === true || verdict === 1 || verdict === '1' ? 1 : 0;
  st.duel.verdict = my;
  st.duelStats = st.duelStats || { rounds: 0, agree: 0 };
  await gameWrite(uid, st);
  const pSt = pid ? await gameRead(pid) : {};
  /* Партнёр уже ответил? Раньше это проверялось так, будто мой ответ ещё не
     записан, и `both` всегда оказывался false для того, кто отвечает вторым —
     раунд не раскрывался ни у кого. Ответ того же раунда той же пары. */
  const both = !!(pid && pSt.duel && pSt.duel.id === st.duel.id && pSt.duel.day === day
    && pSt.duel.pair === st.duel.pair && pSt.duel.verdict != null);
  let result = null;
  if (both) {
    const agree = Number(pSt.duel.verdict) === Number(my);
    /* Раунд засчитывается в статистику ОДИН раз. Передумать можно (ответ
       перезаписывается, `result` пересчитывается), но без этого флага каждая
       смена мнения добавляла к «сыграно раундов» ещё единицу: три нажатия
       на одном раунде давали rounds=3. Флаг смотрим у обоих — кто-то один
       мог досчитать раунд со своей стороны. */
    const g = await gameRead(uid);
    g.duelStats = g.duelStats || { rounds: 0, agree: 0 };
    const counted = !!(g.duel && g.duel.counted) || !!pSt.duel.counted;
    if (!counted) {
      if (g.duel) g.duel.counted = true;
      g.duelStats.rounds++;
      if (agree) g.duelStats.agree++;
    }
    await gameWrite(uid, g);
    result = { agree, film: await filmBrief(st.duel.id), partnerVerdict: !!Number(pSt.duel.verdict), myVerdict: !!my };
  }
  return { ok: true, both, result };
}

/* ============================================================
   НАСТРОЙКИ УВЕДОМЛЕНИЙ (notif:<uid>)
   Пользователь сам решает, что ему присылаем. Без этого любая новая
   рассылка — риск отписки от бота, а отписка убивает весь продукт:
   без бота нет ни мэтчей, ни колоды дня.

   Ключи:
     match   — мэтч (обоюдный лайк)
     daily   — «колода дня обновилась» (раз в сутки)
     night   — партнёр предлагает кино-вечер
     week    — итоги недели (дайджест)
     admin   — рассылки и анонсы владельца
     group   — события групп (пригласили, групповой мэтч)
     req     — заявки в партнёры
   Плюс muteUntil (пауза до даты) и quiet {from,to} — тихие часы по Москве.

   ВСЕ пуши обязаны идти через notifyUser()/canNotify(). Ответы бота на
   команды человека (bot.mjs) — не пуши, они не глушатся.
   ============================================================ */
export const NOTIF_KINDS = ['match', 'daily', 'night', 'week', 'admin', 'group', 'req'];
export const NOTIF_DEFAULT = {
  match: true, daily: true, night: true, week: true, admin: true, group: true, req: true,
  muteUntil: 0, quietFrom: '', quietTo: '',
};

export async function getNotifPrefs(uid) {
  try {
    const raw = await db().get('notif:' + uid);
    const o = raw ? JSON.parse(raw) : {};
    const out = Object.assign({}, NOTIF_DEFAULT);
    for (const k of NOTIF_KINDS) if (o[k] != null) out[k] = !!o[k];
    out.muteUntil = Number(o.muteUntil) || 0;
    out.quietFrom = typeof o.quietFrom === 'string' ? o.quietFrom : '';
    out.quietTo = typeof o.quietTo === 'string' ? o.quietTo : '';
    return out;
  } catch (e) { return Object.assign({}, NOTIF_DEFAULT); }
}

export async function setNotifPrefs(uid, patch) {
  const cur = await getNotifPrefs(uid);
  const next = Object.assign({}, cur);
  for (const k of NOTIF_KINDS) if ((patch || {})[k] != null) next[k] = !!(patch || {})[k];
  if ((patch || {}).muteUntil != null) next.muteUntil = Math.max(0, Number(patch.muteUntil) || 0);
  if ((patch || {}).quietFrom != null) next.quietFrom = String(patch.quietFrom).slice(0, 5);
  if ((patch || {}).quietTo != null) next.quietTo = String(patch.quietTo).slice(0, 5);
  // «99:99» и прочий мусор не годятся: только реальное время суток
  const okTime = (v) => {
    if (!v) return false;
    const m = String(v).match(/^(\d{1,2})(?::(\d{2}))?$/);
    if (!m) return false;
    return +m[1] <= 23 && (!m[2] || +m[2] <= 59);
  };
  if (!okTime(next.quietFrom)) next.quietFrom = '';
  if (!okTime(next.quietTo)) next.quietTo = '';
  await db().set('notif:' + uid, JSON.stringify(next));
  return next;
}

/* Тихие часы: промежуток может переходить через полночь (23:00–09:00). */
function inQuietHours(p, now) {
  if (!p || !p.quietFrom || !p.quietTo) return false;
  const mins = (v) => { const [h, m] = String(v).split(':'); return (parseInt(h, 10) || 0) * 60 + (parseInt(m || '0', 10) || 0); };
  const mp = mskParts(now);
  const cur = mp.h * 60 + mp.m;
  const from = mins(p.quietFrom), to = mins(p.quietTo);
  if (from === to) return false;
  return from < to ? (cur >= from && cur < to) : (cur >= from || cur < to);
}

/* Можно ли прямо сейчас прислать человеку уведомление этого типа.
   Админский чат (notifyChat) не глушим никогда — это служебный канал. */
export async function canNotify(uid, kind, opt = {}) {
  if (opt.force === true) return true;
  const p = opt.prefs || await getNotifPrefs(uid);
  if (p[kind] === false) return false;
  if (p.muteUntil && p.muteUntil > Date.now()) return false;
  if (inQuietHours(p, opt.now)) return false;
  return true;
}

/* Единая точка отправки пуша. Если уведомление не положено — ничего не шлём
   и возвращаем {skipped}, чтобы вызывающий код не считал это ошибкой. */
export async function notifyUser(uid, kind, params, token, opt = {}) {
  const ok = await canNotify(uid, kind, opt);
  if (!ok) return { ok: false, skipped: true, reason: 'pref' };
  const method = params.photo ? 'sendPhoto' : 'sendMessage';
  const r = await tg(method, Object.assign({ chat_id: uid }, params), token);
  return r && r.ok ? r : { ok: false, error: (r && r.description) || 'send failed', raw: r };
}

/* Пауза «не беспокоить» на N дней — кнопка под любым уведомлением и /silent. */
export async function muteUser(uid, days) {
  const n = Math.max(0, Math.min(30, Number(days) || 0));
  return setNotifPrefs(uid, { muteUntil: n ? Date.now() + n * 86400e3 : 0 });
}

/* ============================================================
   КОЛОДА ДНЯ (с 1.8.0)
   Колоды у пары независимые, и из-за этого мэтчи стали редкими:
   каждый листает своё и может вообще не встретить карточку партнёра.
   «Колода дня» возвращает совпадения, НЕ отнимая независимость:

     • раз в сутки (день считается по Москве) сервер выбирает
       DAILY_DECK_SIZE карточек, ОДИНАКОВЫХ для обоих партнёров —
       сид от даты и состава, поэтому порядок совпадает с обеих сторон;
     • эти карточки клиент кладёт В НАЧАЛО своей личной колоды;
     • остальная колода остаётся личной: лайк партнёра по-прежнему
       не перелистывает вашу карточку;
     • из пула дня исключаются фильмы, которые оценили вы ИЛИ партнёр
       (двое не смотрят одно и то же дважды), и общий стоп-лист пары.

   Для групп (3+ человек) колода и так общая, поэтому колода дня там
   не нужна. Одиноким пользователям (без партнёра) не показываем:
   совпадать не с кем, а смысл фичи — именно в мэтче.
   ============================================================ */
export const DAILY_DECK_SIZE = 6;

/* ---------- московское время ----------
   КРИТИЧНО: в JavaScript `dateObj + число` — это КОНКАТЕНАЦИЯ СТРОК, а не
   сложение (Date приводится к строке через toString, а не к числу). Поэтому
   `new Date(now + 3 * 3600e3)` молча возвращает исходную дату, и «день по
   Москве» на самом деле считался по UTC. Все места, где нужен MSK, обязаны
   идти через mskParts()/mskDay(). */
export const MSK_OFFSET = 3 * 3600 * 1000;
export function mskParts(now) {
  const t = (now instanceof Date) ? now.getTime() : Number(now || Date.now());
  const d = new Date(t + MSK_OFFSET);
  return { h: d.getUTCHours(), m: d.getUTCMinutes(), day: d.toISOString().slice(0, 10), date: d };
}
/* День по Москве: совпадает с логикой дайджеста и напоминаний,
   поэтому «сегодня» у обоих партнёров меняется одновременно. */
export function dailyKey(now) {
  return mskParts(now).day;
}

/* Пул колоды дня: фильмы, которые ещё не оценил НИКТО из участников.

   Пул ФИКСИРУЕТСЯ на сутки в хранилище (`daily:<день>:<состав пары>`).
   Без этого он пересчитывался бы после каждого свайпа: сид зависит от набора
   кандидатов, а набор меняется — и порядок «прыгал» бы у обоих партнёров
   после каждого голоса. Теперь состав дня стабилен, а по мере оценок он
   просто тает; если карточек не хватило, досыпаем из того же детерминированного
   ранжирования и дописываем сохранённый пул. */
/* size — сколько карточек показать в колоде дня.
   poolSize — насколько большой запас под ними: из запаса потом отбираются
   фильмы под «какой сегодня вечер?», поэтому он заметно больше. */
export async function buildDailyPool(partnerIds, day, opt = {}) {
  const ids = [...new Set((partnerIds || []).map((x) => String(x)))].filter(Boolean).sort();
  const ALL = opt.ALL || await getCatalogAll();
  const hidden = opt.hidden || new Set(await getHidden());
  const alias = opt.alias || (opt.noAlias ? new Map() : await getAliasMap());
  const size = Math.max(1, Math.min(20, Number(opt.size) || DAILY_DECK_SIZE));
  const poolSize = Math.max(size, Math.min(60, Number(opt.poolSize) || size * 3));
  if (ids.length < 2) return { day, key: '', items: [], size, pool: [] };

  const key = 'daily:' + day + ':' + ids.join('|');
  const [votesList, stops, prefsList] = await Promise.all([
    Promise.all(ids.map((id) => getVotes(id))),
    Promise.all(ids.map((id) => getStop(id))),
    Promise.all(ids.map((id) => getPrefs(id))),
  ]);
  const voted = new Set();
  for (const v of votesList) for (const fid of Object.keys(v || {})) voted.add(String(fid));
  const stopFilms = new Set();
  const stopGenres = new Set();
  for (const st of stops) {
    for (const f of ((st && st.films) || [])) stopFilms.add(String(f));
    for (const g of ((st && st.genres) || [])) stopGenres.add(String(g).toLowerCase());
  }
  const pref = new Set();
  for (const p of prefsList) for (const g of ((p && p.genres) || [])) pref.add(String(g).toLowerCase());

  const eligible = (id) => {
    if (!ALL[id]) return false;
    if (hidden.has(id) || alias.has(id)) return false;
    if (voted.has(id) || stopFilms.has(id)) return false;
    const gs = ALL[id].g || [];
    return !gs.some((g) => stopGenres.has(String(g).toLowerCase()));
  };

  /* Кандидаты в том порядке, в котором их берём: общие интересы пары выше,
     внутри ступени — детерминированно по сиду дня и состава. */
  const rankCandidates = () => {
    const rnd = mulberry32(fnvHash(key));
    const decorated = Object.keys(ALL).filter(eligible).map((id) => {
      const gs = (ALL[id].g || []).map((g) => String(g).toLowerCase());
      const tier = pref.size && gs.some((g) => pref.has(g)) ? 1 : 0;
      return { id, tier, r: rnd() };
    });
    decorated.sort((x, y) => (y.tier - x.tier) || (x.r - y.r));
    return decorated.map((d) => d.id);
  };

  // сохранённый пул дня (если он уже есть) важнее свежего ранжирования
  let saved = [];
  try { const raw = await db().get('daily:pool:' + key); if (raw) saved = (JSON.parse(raw) || []).map(String); } catch (e) { saved = []; }

  /* Сохраняем ПОЛНЫЙ пул дня один раз и больше его не переписываем:
     при чтении просто отфильтровываем то, что уже оценили. Так порядок дня
     стабилен, а «↩ отменить свайп» возвращает карточку обратно в день
     (если бы мы ужимали сохранённый список, вернуть её было бы неоткуда). */
  let pool = saved;
  if (!pool.length) {
    const seen = new Set();
    for (const id of rankCandidates()) {
      if (pool.length >= poolSize) break;
      if (seen.has(id)) continue;
      seen.add(id); pool.push(id);
    }
    pool = pool.slice(0, poolSize);
    try { await db().set('daily:pool:' + key, JSON.stringify(pool)); } catch (e) { /* не критично */ }
  }
  let items = pool.filter(eligible);
  /* Карточек дня не хватает (пул почти весь оценили за день) — досыпаем из
     того же детерминированного ранжирования и ДОПИСЫВАЕМ сохранённый пул,
     чтобы оба партнёра видели одинаковое пополнение (пул дня обязан совпадать
     с обеих сторон, поэтому досыпка persists, а не считается у каждого своей). */
  if (saved.length && items.length < size) {
    const inPool = new Set(pool.map(String));
    const extra = [];
    for (const id of rankCandidates()) {
      if (items.length + extra.length >= size) break;
      if (inPool.has(String(id))) continue;
      extra.push(id);
    }
    if (extra.length) {
      pool = pool.concat(extra).slice(0, 60);
      try { await db().set('daily:pool:' + key, JSON.stringify(pool)); } catch (e) { /* не критично */ }
      items = pool.filter(eligible);
    }
  }
  return { day, key, size, poolSize, pool, items };
}

/* Колода дня под «какой сегодня вечер?».
   Пул дня фиксирован (иначе порядок прыгал бы у обоих после каждого свайпа),
   а настроение переставляет карточки ВНУТРИ него и отдаёт только первые N.
   Оба партнёра видят один и тот же результат: настроение считается от пары,
   а не от человека. Не совпало ни одного фильма под настроение — отдаём
   обычные первые N, чтобы колода дня не оказалась пустой. */
export function orderDailyByMood(items, moodGenres, size) {
  const list = (items || []).slice();
  const want = new Set((moodGenres || []).map((g) => String(g).toLowerCase()));
  if (!want.size) return list.slice(0, size);
  const hit = [], miss = [];
  for (const it of list) {
    const gs = (it.g || it.genres || []).map((g) => String(g).toLowerCase());
    (gs.some((g) => want.has(g)) ? hit : miss).push(it);
  }
  return hit.length ? hit.slice(0, size) : list.slice(0, size);
}

/* Колода дня конкретного человека: тот же пул, что у партнёра,
   минус карточки, которые оценил ОН сам (своя колода — свои правила). */
export async function buildDailyDeck(userId, opt = {}) {
  const me = opt.me || await getUser(userId);
  if (!me) return null;
  // feature flag: колоду дня можно выключить в админке без деплоя
  const st = opt.settings || await getSettings();
  if (st.flags && st.flags.dailyDeck === false) return null;
  const partners = (me.partners || []).map(String);
  if (!partners.length) return null;
  const day = opt.day || dailyKey();
  /* Группы здесь НЕ блокируют колоду дня: в группе колода и так общая на всех,
     а клиент в групповом режиме просто не подмешивает дневные карточки.
     Раньше участник группы терял колоду дня и с партнёром — зря. */
  const pid = String(opt.partnerId || partners[0]);
  const pool = await buildDailyPool([String(me.id), pid], day, opt);
  const mood = (st.flags && st.flags.mood === false) ? { keys: [], genres: [] } : await moodOfDay(String(me.id), pid);
  const ALL = opt.ALL || await getCatalogAll();
  // opt.me уже прочитан выше — не читаем второй раз

  /* ВАЖНО: колода дня считается из ПОЛНОГО сохранённого пула (pool.pool),
     а не из уже отфильтрованного по голосам (pool.items).

     Иначе получалась ровно та несамостоятельность, от которой мы ушли в 1.8:
     пул фильтровался по голосам ОБОИХ, и стоило одному оценить дневную
     карточку, как она исчезала и у второго — а следом весь день съезжал.
     Теперь день один и тот же у обоих, а свою оценённую карточку человек
     просто не видит: клиент кладёт в колоду только то, что он сам не оценил. */
  const withMeta = pool.pool.map((id) => ({ id, g: (ALL[id] && ALL[id].g) || [] }));
  const items = orderDailyByMood(withMeta, mood.genres, pool.size).map((x) => x.id);
  const votes = opt.votes || await getVotes(String(me.id));
  const other = await getUser(pid);
  return {
    day,
    partnerId: pid,
    partnerName: (other && (other.first_name || other.last_name)) || '',
    size: pool.size,
    items,                                       // ОДИНАКОВ у обоих партнёров
    left: items.filter((id) => votes[id] == null).length,   // сколько из них я ещё не оценил
    mood: (mood && mood.keys) || [],
    moodGenres: (mood && mood.genres) || [],
  };
}

/* ============================================================
   ЕЖЕДНЕВНЫЙ ПУШ «КОЛОДА ДНЯ ОБНОВИЛАСЬ»
   Колода дня — главная причина вернуться завтра, но без напоминания
   о ней человек просто не узнает, что сегодня есть новые карточки.

   Кому пишем: только парам, где ОБА заходили за последнюю неделю.
   Мёртвым аккаунтам не пишем принципиально — иначе это превращается
   в спам и люди отписываются от бота.

   Три уровня согласия, и все обязаны сойтись:
     • dailyPushOn в настройках админки (глобально);
     • feature flag dailyDeck (если колоды дня нет — и пушить нечего);
     • настройка `daily` у самого человека (кнопка «🔕 Не беспокоить»
       под любым уведомлением и экран уведомлений в профиле).

   Отметка once() ставится ТОЛЬКО после успешной отправки: при сетевом
   сбое человек получит свой пуш при следующем запуске, а не потеряет его.
   ============================================================ */
export async function dailyPush(token, site, opt = {}) {
  const st = await getSettings();
  if (st.dailyPushOn === false) return { sent: 0, skipped: 0, failed: 0, off: true };
  if (st.flags && st.flags.dailyPush === false) return { sent: 0, skipped: 0, failed: 0, off: 'flag' };
  if (st.flags && st.flags.dailyDeck === false) return { sent: 0, skipped: 0, failed: 0, off: 'dailyDeck' };

  const ids = await allUserIds();
  const weekAgo = Date.now() - 7 * 86400e3;
  const day = dailyKey();
  let sent = 0, skipped = 0, failed = 0;
  const donePairs = new Set();

  for (const uid of ids) {
    try {
      const u = await getUser(uid);
      if (!u) { skipped++; continue; }
      if ((Number(u.lastSeen) || 0) < weekAgo) { skipped++; continue; }   // спящим не пишем
      const pid = String((u.partners || [])[0] || '');
      if (!pid) { skipped++; continue; }
      const pairKeyStr = [String(uid), pid].sort().join('|');
      if (donePairs.has(pairKeyStr)) continue;    // паре пишем один раз, не каждому отдельно
      donePairs.add(pairKeyStr);

      const other = await getUser(pid);
      if (!other || (Number(other.lastSeen) || 0) < weekAgo) { skipped++; continue; }

      const deck = await buildDailyDeck(String(uid), { me: u, settings: st });
      if (!deck || !(deck.items || []).length) { skipped++; continue; }

      const ALL = await getCatalogAll();
      const moods = (deck.mood || []).map((k) => MOODS[k]).filter(Boolean);
      const titles = deck.items.slice(0, 2).map((id) => '«' + esc((ALL[id] || {}).t || '') + '»').filter((x) => x !== '«»');
      /* Игры: показываем кнопки только если флаг включён, и честно пишем,
         сыгран ли уже раунд дуэли (иначе человек заходит — а там «ждём
         ответа партнёра» и непонятно, что делать). */
      const gamesOn = !(st.flags && st.flags.games === false);
      let duelState = 'new';
      if (gamesOn) {
        const gA = await gameRead(String(uid));
        const gB = await gameRead(pid);
        const dA = gA.duel;
        duelState = (dA && dA.day === day && gB.duel && gB.duel.id === dA.id
          && dA.verdict != null && gB.duel.verdict != null) ? 'done' : 'new';
      }
      const msg = dailyPushMessage(deck, { site: site || '', titles, moods, games: gamesOn, duelState });
      const text = msg.text;
      const kb = msg.kb;

      let okBoth = true;
      for (const id of [String(uid), pid]) {
        if (!(await canNotify(id, 'daily'))) { okBoth = false; break; }
      }
      if (!okBoth) { skipped++; continue; }

      for (const id of [String(uid), pid]) {
        const okey = 'dailypush:' + day + ':' + id;
        /* once() возвращает TRUE тому, кто первый (он и действует) — как во
           fridayReminders и weeklyDigest. Раньше условие здесь было
           перевёрнуто (`if (await once(...)) continue`), из-за чего первый
           (плановый) запуск дня только расставлял отметки и НИКОМУ не слал
           пуш, а отправлял его лишь повторный запуск, которого по cron
           не бывает — то есть колода дня не пушилась вовсе. */
        if (!(await once(okey))) continue;   // уже доставлено — не дублируем
        const r = await tg('sendMessage', {
          chat_id: id, parse_mode: 'HTML', text, reply_markup: kb, disable_notification: true,
        }, token);
        if (r && r.ok) sent++;
        else {
          failed++;
          /* Отметку СНЯТЬ: сбой отправки — не доставка. Иначе человек
             потерял бы свой пуш навсегда (следующий запуск увидел бы
             «уже доставлено»), хотя комментарий выше обещает повтор. */
          try { await db().delete('once:' + okey); } catch (e) { /* не критично */ }
          break;   // не смогли одному — не помечаем и второго, попробуем в следующий запуск
        }
      }
    } catch (e) { failed++; }
  }
  return { sent, skipped, failed, pairs: donePairs.size, day };
}

/* Пуш о колоде дня: текст и кнопки. Вынесено отдельной функцией, чтобы
   форму сообщения можно было проверить тестом, не поднимая двух «живых»
   пользователей в хранилище.

   С 1.9.0 в тот же пуш добавлены кнопки ОБЕИХ игр. Причина ровно та же, по
   которой игры в приложении переехали на вкладки: «Слепая дуэль» — раунд на
   сутки, и если о нём не напомнить, в неё просто не заходят. Отдельный тип
   уведомления заводить не стали — это лишний тумблер и лишний повод для
   отписки; игры едут в уже существующем вечернем сообщении и глушатся
   вместе с ним («🌙 Колода дня» в настройках или «🔕 Не беспокоить»). */
export function dailyPushMessage(deck, opts = {}) {
  const site = String(opts.site || '');
  const titles = opts.titles || [];
  const moods = opts.moods || [];
  const moodLine = moods.length
    ? `\nВечер сегодня: ${moods.map((m) => m.icon + ' ' + m.label.toLowerCase()).join(' + ')}`
    : '';
  const gamesOn = opts.games !== false;
  const duelLine = opts.duelState === 'done'
    ? '\n\n🎭 Раунд «слепой дуэли» сегодня уже сыгран — завтра будет новый.'
    : (gamesOn ? '\n\n🎭 И раунд «слепой дуэли» на сегодня: фильм скрыт, ответьте оба.' : '');
  const text = `🌙 <b>Колода дня обновилась</b>\n\n`
    + `Сегодня ${(deck && deck.items ? deck.items.length : 0)} карточек — <b>одинаковые у вас и у ${esc((deck && deck.partnerName) || 'партнёра')}</b>.`
    + (titles.length ? ` В начале: ${titles.join(', ')}${(deck.items || []).length > 2 ? '…' : ''}.` : '')
    + moodLine
    + `\n\nЛайкните оба — и будет мэтч 💘`
    + duelLine;
  const kb = { inline_keyboard: [
    [{ text: '🌙 Открыть колоду дня', web_app: { url: site + '/?startapp=daily' } }],
  ] };
  if (gamesOn) {
    kb.inline_keyboard.push([
      { text: '🎯 Угадайка', web_app: { url: site + '/?startapp=games_guess' } },
      { text: '🎭 Слепая дуэль', web_app: { url: site + '/?startapp=games_duel' } },
    ]);
  }
  kb.inline_keyboard.push([{ text: '🔕 Не беспокоить', callback_data: 'mute:7' }]);
  return { text, kb };
}

/* ============================================================
   ЕЖЕНЕДЕЛЬНЫЙ ДАЙДЖЕСТ БОТОМ
   Раз в неделю каждому активному пользователю приходит итог:
   новые мэтчи, непросмотренное, серия дней и предложение на вечер.
   Не шумим: если за неделю ничего не происходило — не пишем.
   ============================================================ */
export function isoWeekKey(now) {
  const d = new Date(now || Date.now());
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const w = Math.ceil((((t - y) / 86400000) + y.getUTCDay() + 1) / 7);
  return t.getUTCFullYear() + '-W' + String(w).padStart(2, '0');
}

export async function buildDigestFor(uid) {
  const u = await getUser(uid);
  if (!u) return null;
  const matches = await getMatches(uid);
  const weekAgo = Date.now() - 7 * 86400e3;
  const fresh = matches.filter((m) => (Number(m.ts) || 0) >= weekAgo);
  const unwatched = matches.filter((m) => !m.watched);
  const act = await getUserActivity(uid);
  const streak = act.streakCount || 0;
  // пусто и нечего напомнить — молчим, чтобы не отписывались от бота
  if (!fresh.length && unwatched.length < 3 && streak < 3) return null;
  let suggest = null;
  try { suggest = (await suggestTonight(uid, 1))[0] || null; } catch (e) { /* не критично */ }
  const lines = ['📬 <b>Кино-итоги недели</b>', ''];
  if (fresh.length) {
    const names = fresh.slice(0, 3).map((m) => '«' + esc(m.title || '') + '»').join(', ');
    lines.push(`💘 Новых мэтчей за неделю: <b>${fresh.length}</b>` + (names ? ` — ${names}${fresh.length > 3 ? '…' : ''}` : ''));
  }
  if (unwatched.length) lines.push(`🍿 Непросмотренных мэтчей накопилось: <b>${unwatched.length}</b>`);
  if (streak >= 2) lines.push(`🔥 Серия свайпов: <b>${streak}</b> дн. подряд — так держать!`);
  if (suggest) {
    lines.push('', `🎬 <b>Предложение на вечер:</b> «${esc(suggest.title)}»`
      + (suggest.year ? ` (${suggest.year})` : '')
      + (suggest.rating != null ? ` · ★ ${Number(suggest.rating).toFixed(1)}` : ''));
  }
  const groupN = (await userGroups(uid)).length;
  if (groupN) lines.push(`🎭 Вы в ${groupN} группе(ах) — загляните в общую колоду компании`);
  return lines.join('\n');
}

export async function weeklyDigest(token, site) {
  const st = await getSettings();
  if (st.digestOn === false) return { sent: 0, skipped: 0, failed: 0, off: true };
  const wk = isoWeekKey();
  const ids = await allUserIds();
  let sent = 0, skipped = 0, failed = 0;
  for (const uid of ids) {
    try {
      /* Порядок: содержимое → настройки → отметка → отправка.
         Метка once() ставится ТОЛЬКО когда реально собираемся слать:
         иначе «неделя» сгорала у тех, кто дайджест выключил или кому
         нечего присылать, а сбой отправки лишал дайджеста навсегда. */
      const text = await buildDigestFor(uid);
      if (!text) { skipped++; continue; }
      if (!(await canNotify(uid, 'week'))) { skipped++; continue; }
      if (!(await once('digest:' + uid + ':' + wk))) { skipped++; continue; }
      const kb = { inline_keyboard: [
        [{ text: '🍿 Выбрать кино', web_app: { url: (site || '') + '/?startapp=matches' } }],
        [{ text: '🔕 Не беспокоить', callback_data: 'mute:7' }],
      ] };
      const r = await tg('sendMessage', {
        chat_id: uid, parse_mode: 'HTML', text, reply_markup: kb, disable_notification: true,
      }, token);
      if (r && r.ok) sent++;
      else {
        failed++;
        try { await db().delete('once:digest:' + uid + ':' + wk); } catch (e) { /* не критично */ }
      }
    } catch (e) { failed++; }
  }
  return { sent, skipped, failed, users: ids.length, week: wk };
}

/* ============================================================
   СТОП-ЛИСТЫ УЧАСТНИКОВ ОБЩЕЙ КОЛОДЫ
   Личная колода учитывает только МОЙ стоп-лист, но общая колода
   пары/группы обязана быть одинаковой у всех — поэтому клиент
   получает стоп-листы партнёров/участников и исключает объединение.
   ============================================================ */
export async function partnerStops(me) {
  const out = {};
  for (const pid of ((me && me.partners) || [])) out[String(pid)] = await getStop(pid);
  return out;
}
export async function groupStops(uid) {
  const out = {};
  for (const g of await userGroups(uid)) {
    const per = {};
    for (const m of (g.members || [])) per[String(m)] = await getStop(m);
    out[g.id] = per;
  }
  return out;
}
const stopFlat = (o) => Object.keys(o || {}).sort().map((k) => {
  const v = o[k] || {};
  return k + ':' + (v.films || []).map(String).sort().join(',') + ':' + (v.genres || []).map(String).sort().join(',');
}).join(';');
export function stopsSig(ps, gs) {
  const gPart = Object.keys(gs || {}).sort().map((g) => g + '=' + stopFlat(gs[g])).join('|');
  return String(fnvHash(stopFlat(ps) + '##' + gPart));
}

/* ============================================================
   ПОЛНЫЙ ЭКСПОРТ ДАННЫХ
   Один и тот же дамп используется кнопкой «Скачать все данные»
   в админке и ежедневным автобэкапом (плановая функция backup.mjs).
   ============================================================ */
export function pubUser(u) {
  return u && {
    id: u.id, code: u.code, first_name: u.first_name, last_name: u.last_name,
    username: u.username, photo_url: u.photo_url, partners: u.partners || [],
  };
}
export async function buildFullExport(site) {
  const ids = await allUserIds();
  const users = [];
  for (const id of ids) {
    const u = await getUser(id);
    if (!u) continue;
    users.push(Object.assign(pubUser(u), {
      created: u.created,
      votes: await getVotes(id),
      stop: await getStop(id),
      prefs: (await getPrefs(id)).genres,
      badges: await getEarned('u:' + id),
      manualBadges: await getEarned('m:' + id),
      activity: await getUserActivity(id),
      refBy: u.refBy || null,
      refs: await getRefs(id),
      ucols: await getUserCols(id),
    }));
  }
  const groups = [];
  for (const gid of await allGroupIds()) {
    const g = await getGroup(gid);
    if (g) groups.push(g);
  }
  const pairs = [];
  for (const [a, b] of await allPairs()) {
    const key = [a, b].sort().join('|');
    pairs.push({
      a, b,
      badges: await getEarned('c:' + key),
      manualBadges: await getEarned('mc:' + key),
      night: await getNight(a, b),
    });
  }
  return {
    version: 4,
    generated: new Date().toISOString(),
    site: site || '',
    users,
    pairs,
    groups,
    matches: await getMatches(),
    hidden: await getHidden(),
    settings: await getSettings(),
    collections: await getCollections(),
    feedback: await getFeedback(),
    cardEdits: await getCardEdits(),
    daily: await getDailyRaw(),
  };
}

/* ============================================================
   АВТОБЭКАП ПО РАСПИСАНИЮ (плановая функция backup.mjs)
   Раз в сутки: дамп всех данных → файл в хранилище (последние
   BACKUP_KEEP копий) + документ в Telegram-чат админа (notifyChat).
   Ручная копия по-прежнему доступна кнопкой «Скачать все данные».
   ============================================================ */
export const BACKUP_KEEP = 7;

export async function getBackupIndex() {
  try {
    const raw = await db().get('backup:index');
    const a = raw ? JSON.parse(raw) : [];
    return Array.isArray(a) ? a : [];
  } catch (e) { return []; }
}

export async function runAutoBackup(token, site) {
  const st = await getSettings();
  if (st.backupOn === false) return { ok: true, skipped: 'off' };
  const data = await buildFullExport(site);
  const raw = JSON.stringify(data);
  const date = dayStr();
  await db().set('backup:' + date, raw);
  // индекс копий: храним даты, лишнее удаляем (глубина — BACKUP_KEEP)
  let idx = await getBackupIndex();
  if (!idx.includes(date)) idx.push(date);
  idx = [...new Set(idx.map(String))].sort();
  while (idx.length > BACKUP_KEEP) {
    const old = idx.shift();
    try { await db().delete('backup:' + old); } catch (e) { /* не критично */ }
  }
  await db().set('backup:index', JSON.stringify(idx));
  let sent = false, sendError = null;
  if (st.notifyChat && token) {
    const caption = `💾 Автобэкап «КиноФикации» — ${date}\n\n`
      + `Пользователей: ${data.users.length} · пар: ${data.pairs.length} · групп: ${data.groups.length}\n`
      + `Мэтчей: ${data.matches.length} · размер: ${(raw.length / 1024).toFixed(0)} КБ\n`
      + `На сервере хранится ${idx.length} последних копий.\n\n`
      + `Восстановление: админка → «Скачать все данные» (тот же формат).`;
    const r = await tgUpload('sendDocument', { chat_id: st.notifyChat, caption },
      token, 'document', `kinofikacia-backup-${date}.json`, raw, 'application/json');
    sent = !!(r && r.ok);
    if (!sent) sendError = (r && (r.description || r.error)) || 'неизвестная ошибка';
  }
  return {
    ok: true, date, bytes: raw.length,
    users: data.users.length, matches: data.matches.length,
    sent, sendError, kept: idx.length,
  };
}

/* ============================================================
   МОНИТОРИНГ ЖИВОСТИ (плановая функция uptime.mjs)
   Каждые 15 минут: пинг /api (действие ping) + проверка хранилища.
   Алерт в notifyChat только при СМЕНЕ состояния (упал/ожил), плюс
   напоминание раз в 6 часов, пока лежит. Одна осечка не в счёт —
   «упал» ставится после двух провалов подряд.
   Ключи: uptime:state, uptime:beat
   ============================================================ */
export async function getUptimeState() {
  try { const raw = await db().get('uptime:state'); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
}

export async function runUptimeCheck(token, siteOverride) {
  const st = await getSettings();
  let site = String(siteOverride || '');
  if (!site) { try { site = (await db().get('config:site')) || ''; } catch (e) { /* ignore */ } }
  if (!site) site = String(process.env.URL || process.env.DEPLOY_PRIME_URL || '').replace(/\/$/, '');

  const checks = { api: false, blobs: false, apiMs: null, error: null };
  if (site) {
    try {
      const t0 = Date.now();
      const r = await fetch(site + '/api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ a: 'ping' }),
      });
      const j = await r.json().catch(() => null);
      checks.apiMs = Date.now() - t0;
      // Функции живы, если /api отвечает НАШИМ JSON — даже с ошибкой внутри
      // (например, «бот не настроен» = HTTP 500, но серверная часть работает).
      // «Сайт лёг» — это когда вместо JSON приходит HTML-404 Netlify или сеть недоступна.
      checks.api = !!(j && typeof j === 'object');
      if (checks.api && j.ok !== true) checks.error = 'API ответил ошибкой: ' + (j.error || 'неизвестно');
      if (!checks.api) {
        checks.error = 'HTTP ' + r.status + ' — ответ не похож на наш API (функции не задеплоены?)';
      }
    } catch (e) { checks.error = 'сайт недоступен: ' + ((e && e.message) || 'ошибка сети'); }
  } else {
    checks.error = 'адрес сайта неизвестен — откройте /setup';
  }
  try {
    await db().set('uptime:beat', String(Date.now()));
    checks.blobs = (await db().get('uptime:beat')) != null;
  } catch (e) { checks.blobs = false; }

  const okNow = checks.api && checks.blobs;
  const prev = (await getUptimeState()) || { status: 'ok', fails: 0 };
  const now = Date.now();
  const next = {
    status: prev.status || 'ok',
    since: prev.since || now,
    fails: okNow ? 0 : (prev.fails || 0) + 1,
    lastCheck: now,
    lastOk: okNow ? now : (prev.lastOk || null),
    lastAlert: prev.lastAlert || null,
    checks: { api: checks.api, blobs: checks.blobs, apiMs: checks.apiMs },
  };
  let alert = null;   // 'down' | 'still' | 'up'
  if (okNow) {
    if (next.status !== 'ok') { alert = 'up'; next.status = 'ok'; next.since = now; }
  } else if (next.status === 'ok') {
    if (next.fails >= 2) { alert = 'down'; next.status = 'down'; next.since = prev.lastOk || now; }
  } else if (now - (next.lastAlert || 0) > 6 * 3600e3) {
    alert = 'still';
  }
  if (alert) next.lastAlert = now;
  try { await db().set('uptime:state', JSON.stringify(next)); } catch (e) { /* ignore */ }

  let notified = false;
  if (alert && st.uptimeOn !== false) {
    if (st.notifyChat && token) {
      const downtimeMin = Math.max(1, Math.round((now - (next.since || now)) / 60000));
      const text = alert === 'up'
        ? `🟢 <b>«КиноФикация» снова работает</b>\n\n`
          + `Недоступность длилась ~${downtimeMin} мин.\n`
          + `API отвечает за ${checks.apiMs != null ? checks.apiMs + ' мс' : '—'}.\n${esc(site)}`
        : `🔴 <b>«КиноФикация» не отвечает${alert === 'still' ? ' (всё ещё)' : ''}</b>\n\n`
          + `${esc(checks.error || '')}\n`
          + `API: ${checks.api ? '✅' : '❌'} · хранилище: ${checks.blobs ? '✅' : '❌'}\n`
          + `Сайт: ${esc(site)}\n\n`
          + `Проверка каждые 15 минут; как только сайт оживёт, пришлю 🟢.`;
      const r = await tg('sendMessage', { chat_id: st.notifyChat, parse_mode: 'HTML', text }, token).catch(() => null);
      notified = !!(r && r.ok);
    } else {
      console.warn('uptime: состояние ' + alert + ', но чат для уведомлений не задан (админка → Настройки → Telegram для уведомлений)');
    }
  }
  return { ok: true, status: next.status, alert, notified, checks, state: next };
}

/* ============================================================
   ОБЩИЙ «ЛАЙК» ФИЛЬМА (ядро создания мэтчей)
   Один и тот же код используют приложение (action vote) и бот
   (инлайн-режим: «добавить в общий список» из любого чата).
   notifyPair/notifyGroup — колбэки отправки уведомлений: у API и у
   бота свои тексты, поэтому не зашиваем их сюда.
   ============================================================ */
export async function registerLike(me, filmId, it, opts) {
  const o = opts || {};
  const id = await canonFilmId(filmId);
  const item = it || (await getCatalogAll())[id];
  if (!item) return { ok: false, error: 'Такого фильма нет в каталоге' };

  const votes = await getVotes(me.id);
  const already = votes[id] === 1;
  votes[id] = 1;
  await setVotes(me.id, votes);
  await pushSwlog(me.id, id, 1);
  if (o.track) {
    await trackDaily('swipe', me.id);
    await trackDaily('like');
    await trackUserActivity(me.id, { like: true, nightLike: isNightHour() });
  }
  // колода у пары общая: мой голос убирает карточку и у партнёра
  for (const pid of (me.partners || [])) await bumpRev(pid);

  let match = null;
  const newMatches = [];
  const queue = [];
  let dirty = false;
  for (const pid of (me.partners || [])) {
    const pv = await getVotes(pid);
    if (pv[id] !== 1) continue;
    const pair = [String(me.id), String(pid)].sort();
    const exists = (await getPairMatches(me.id, pid)).some((m) => String(m.id) === String(id));
    if (exists) continue;
    const pu = await getUser(pid);
    if (!pu) continue;
    const mm = {
      id, mid: `${id}|${pair.join('-')}`, title: item.t, year: item.y, type: item.tp, poster: item.p,
      rating: item.r, src: item.s, genres: item.g || [],
      ts: Date.now(), by: pair, watched: false,
    };
    // addMatch пишет шард через compare-and-swap: параллельный лайк дубля не создаст
    if (!(await addMatch(mm))) continue;
    dirty = true;
    newMatches.push(mm);
    queue.push([mm, pu]);
  }
  if (dirty) {
    if (o.track) await trackDaily('match', me.id);
    for (const pid of (me.partners || [])) await bumpRev(pid);
  }
  // ВАЖНО: дожидаемся отправки уведомлений, иначе рантайм «заморозит» функцию раньше
  if (o.notifyPair) {
    for (const [mm, pu] of queue) {
      try { await o.notifyPair(mm, me, pu); } catch (e) { console.warn('notifyPair', e && e.message); }
    }
  }
  match = newMatches[0] || null;

  /* ---- группы (3+ человек): мэтч, когда лайкнули все участники ---- */
  let groupMatch = null;
  for (const g of await userGroups(me.id)) {
    for (const uid of (g.members || [])) {
      if (String(uid) !== String(me.id)) await bumpRev(uid);
    }
    if (groupMatch) continue;
    let allLiked = true;
    for (const uid of (g.members || [])) {
      const mv = String(uid) === String(me.id) ? votes : await getVotes(uid);
      if (mv[id] !== 1) { allLiked = false; break; }
    }
    if (!allLiked) continue;
    if ((await getGroupMatches(g.id)).some((m) => String(m.id) === String(id))) continue;
    const gm = {
      id, mid: `${id}|g-${g.id}`, groupId: g.id, groupTitle: g.title,
      title: item.t, year: item.y, type: item.tp, poster: item.p,
      rating: item.r, src: item.s, genres: item.g || [],
      ts: Date.now(), by: (g.members || []).slice(), watched: false,
    };
    if (!(await addMatch(gm))) continue;
    groupMatch = gm;
    if (o.track) await trackDaily('match', me.id);
    for (const uid of (g.members || [])) await bumpRev(uid);
    if (o.notifyGroup) {
      try { await o.notifyGroup(gm); } catch (e) { console.warn('notifyGroup', e && e.message); }
    }
  }
  return { ok: true, already, match, newMatches, groupMatch };
}
