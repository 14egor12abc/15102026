// Вебхук Telegram-бота: /start, команды, инлайн-поиск фильмов, кнопки под уведомлениями о мэтчах
import {
  getConfig, siteUrl, tg, json, esc, ensureUser, getUser, startPairing, db,
  getMatches, setMatches, getVotes, setVotes, ratingLine, allUserIds, saveUser,
  MENU_TEXT, getSettings, getEarned, userStats, FRIEND_BTN, fillTemplate, BOT_USERNAME,
  BTN_MATCHES, BTN_BADGES, BTN_PARTNERS, BTN_HELP, matchMid, findMatch, once, suggestTonight,
  removeAllMatchesFor, removeMatchesFor, updateMatchesFor, getWebhookSecret, clearSwlog, bumpCoUsers,
  trackReferral, joinGroupByCode, buildDigestFor,
  getCatalogAll, getHidden, getAliasMap, registerLike,
  getFeedback, sendFeedbackReply,
  // v1.8: настройки уведомлений
  getNotifPrefs, setNotifPrefs, muteUser, canNotify, NOTIF_KINDS, NOTIF_DEFAULT,
  // v1.9: игры с партнёром (в боте — только вход, сами игры живут в приложении)
  gameState,
} from './_shared.mjs';

/* Подписи переключателей на экране уведомлений — одни и те же в боте и в приложении. */
const NOTIF_LABELS = [
  ['match', '💘 Мэтчи', 'когда вы оба лайкнули один фильм'],
  ['daily', '🌙 Колода дня', 'раз в сутки: сегодня новые общие карточки'],
  ['night', '🍿 Кино-вечер', 'партнёр предлагает посмотреть сегодня'],
  ['week', '📬 Итоги недели', 'дайджест по воскресеньям и пятничная подсказка'],
  ['req', '💌 Заявки в партнёры', 'кто-то хочет свайпать с вами'],
  ['group', '🎭 Группы', 'пригласили в компанию, групповой мэтч'],
  ['admin', '📢 Новости', 'рассылки и анонсы от владельца'],
];
import { badgeById } from './_badges.mjs';
import { CATALOG } from './_catalog.mjs';

// Клавиатура бота: вход в приложение (web_app передаёт сессию!) + удобные команды.
// Важно: кнопка входа обязана быть типа web_app — обычная url-ссылка открывает сайт
// без initData, и приложение не понимает, кто вы, и просит код заново.
// Кнопки под клавиатурой: БЕЗ кнопки «Приложение» — вход только через
// кнопку-меню слева от поля ввода (web_app) или по ссылке.
/* Экран уведомлений прямо в боте: ряд кнопок «вкл/выкл» по каждому типу.
   То же самое есть в приложении (профиль → «Уведомления»), но сюда человек
   попадает из кнопки «🔕 Не беспокоить» под надоевшим сообщением — то есть
   ровно в тот момент, когда ему нужно дать выбор, а не заставлять идти в приложение. */
async function sendNotifMenu(chatId, uid, token, editMessageId) {
  const p = await getNotifPrefs(uid);
  const rows = [];
  for (const [key, label, hint] of NOTIF_LABELS) {
    rows.push([{
      text: (p[key] ? '🟢 ' : '⚪️ ') + label,
      callback_data: 'nt:' + key + ':' + (p[key] ? 0 : 1),
    }]);
  }
  const muted = p.muteUntil > Date.now();
  const lines = ['🔔 <b>Уведомления</b>', ''];
  for (const [, label, hint] of NOTIF_LABELS) lines.push(`${label} — ${hint}`);
  lines.push('');
  lines.push(muted
    ? `🔕 Сейчас всё выключено до ${new Date(p.muteUntil + 3 * 3600e3).toISOString().slice(0, 10).split('-').reverse().join('.')}.`
    : 'Нажмите на строку, чтобы включить или выключить тип уведомлений.');
  lines.push('');
  lines.push('<i>Команды: /silent — ничего не присылать 7 дней, /notify — этот экран.</i>');
  rows.push([{ text: muted ? '🔔 Снять паузу' : '🔕 Ничего не присылать 7 дней', callback_data: muted ? 'unmute' : 'mute:7' }]);
  const params = {
    chat_id: chatId, parse_mode: 'HTML', text: lines.join('\n'),
    reply_markup: { inline_keyboard: rows },
  };
  if (editMessageId) params.message_id = editMessageId;
  return editMessageId
    ? tg('editMessageText', params, token).catch(() => tg('sendMessage', params, token))
    : tg('sendMessage', params, token);
}

function mainKeyboard() {
  return {
    keyboard: [
      [{ text: FRIEND_BTN }],
      [{ text: BTN_MATCHES }, { text: BTN_BADGES }],
      [{ text: BTN_PARTNERS }, { text: BTN_HELP }],
    ],
    resize_keyboard: true,
    is_persistent: true,
  };
}

/* ================= ОТВЕТ НА ОТЗЫВ ПРЯМО ИЗ TELEGRAM =================
   Под уведомлением об обратной связи в чате админа есть кнопка «✍️ Ответить».
   Нажал — бот переходит в режим ожидания: следующее обычное сообщение админа
   уходит пользователю личкой (через sendFeedbackReply — ту же функцию, что
   использует админка). Режим живёт 15 минут, отмена — /cancel.
   Состояние храним в Blobs: функции Netlify не держат память между вызовами. */
const REPLY_TTL = 15 * 60e3;
async function getPendingReply(adminChatId) {
  try {
    const raw = await db().get('fb:reply:' + adminChatId);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (Date.now() - Number(p.ts || 0) > REPLY_TTL) { await clearPendingReply(adminChatId); return null; }
    return p;
  } catch (e) { return null; }
}
async function clearPendingReply(adminChatId) {
  try { await db().delete('fb:reply:' + adminChatId); } catch (e) { /* уже удалён */ }
}

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(
      'Это вебхук Telegram-бота. Настройку выполняйте на странице <a href="./setup">/setup</a>.',
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }

  const cfg = await getConfig();
  if (!cfg.token) return json({ ok: false, error: 'no token' }, 500);

  /* ---------- защита вебхука ----------
     Адрес вебхука не секрет (он виден на /setup, плюс есть алиас /bot), а
     bot.mjs доверяет полю `from` из апдейта. Без проверки секрета любой мог бы
     подделать сообщение от чужого имени — например, выполнить /reset за другого
     пользователя. Telegram шлёт secret_token обратно в заголовке.
     Если секрет ещё не выпущен (деплой не проходил /setup после обновления),
     апдейт принимаем, но пишем предупреждение в лог. */
  const whSecret = await getWebhookSecret();
  const gotSecret = req.headers.get('x-telegram-bot-api-secret-token') || '';
  if (whSecret) {
    if (gotSecret !== whSecret) return json({ ok: false, error: 'invalid secret' }, 401);
  } else if (!gotSecret) {
    console.warn('webhook secret не настроен — откройте /setup, чтобы защитить бота');
  }

  let update;
  try { update = await req.json(); } catch (e) { return json({ ok: false }); }

  // Telegram может доставить один и тот же update повторно (таймаут/ретрай) —
  // обрабатываем каждый update_id ровно один раз, чтобы не слать дубли
  if (update.update_id && !(await once('upd:' + update.update_id))) return json({ ok: true });

  try {
    if (update.callback_query) await onCallback(update.callback_query, cfg.token);
    else if (update.inline_query) await onInline(update.inline_query, cfg.token, siteUrl(req));
    else if (update.message) await onMessage(update.message, cfg.token, siteUrl(req));
  } catch (e) {
    console.error('bot error', e);
  }
  // Telegram требует 200 OK, иначе будет слать обновление повторно
  return json({ ok: true });
}

/* ================= сообщения ================= */
async function onMessage(msg, token, site) {
  if (!msg.from) return;
  const settings = await getSettings();
  const MT = settings.menuText || MENU_TEXT;

  if (settings.maintenance && settings.maintenance.on) {
    await tg('sendMessage', {
      chat_id: msg.chat.id, parse_mode: 'HTML',
      text: `🛠 <b>Технические работы</b>\n\n${esc(settings.maintenance.reason || 'Скоро вернёмся!')}`,
    }, token);
    return;
  }
  const chatId = msg.chat.id;
  const text = (msg.text || '').trim();
  const { user: me, isNew } = await ensureUser(msg.from);

  // ответ на отзыв из Telegram: админ нажал «✍️ Ответить» и теперь шлёт текст
  const adminChat = String(settings.notifyChat || '');
  if (adminChat && String(chatId) === adminChat) {
    if (/^\/cancel/i.test(text)) {
      const p0 = await getPendingReply(chatId);
      if (p0) {
        await clearPendingReply(chatId);
        return tg('sendMessage', { chat_id: chatId, text: '↩️ Ответ отменён.' }, token);
      }
    } else if (text && !text.startsWith('/')) {
      const p = await getPendingReply(chatId);
      if (p) {
        await clearPendingReply(chatId);
        const r = await sendFeedbackReply(p.fid, text, token);
        // пометим исходное уведомление, чтобы админ видел: ответ ушёл
        if (r.ok && p.srcChat && p.srcMid && p.srcText) {
          await tg('editMessageText', {
            chat_id: p.srcChat, message_id: p.srcMid, parse_mode: 'HTML',
            text: String(p.srcText).replace(/<i>Ответить:[\s\S]*?<\/i>\s*$/, '') + '\n\n<i>✅ Отвечено из Telegram</i>',
          }, token).catch(() => {});
        }
        return tg('sendMessage', {
          chat_id: chatId, parse_mode: 'HTML',
          text: r.ok
            ? `✅ <b>Ответ отправлен</b>${p.name ? ' пользователю <b>' + esc(p.name) + '</b>' : ''}.\nВ админке сообщение помечено как «отвечено».`
            : `⚠️ Не удалось отправить: ${esc(r.error || 'неизвестная ошибка')}`,
        }, token);
      }
    }
  }

  // переход по ссылке-приглашению: /start pair_XXXXX — создаём ЗАЯВКУ в партнёры
  const pairStart = text.match(/^\/start(?:@\w+)?\s+pair_([A-Za-z0-9]{3,8})$/i);
  if (pairStart) {
    await handlePairRequest(chatId, me, pairStart[1], token, site, MT);
    return;
  }

  // реферальная ссылка: /start ref_<id> — засчитываем приглашение новому пользователю
  const refStart = text.match(/^\/start(?:@\w+)?\s+ref_(\d+)$/i);
  if (refStart && isNew) {
    try {
      const referrer = await trackReferral(me, refStart[1]);
      if (referrer) {
        await tg('sendMessage', {
          chat_id: referrer.id, parse_mode: 'HTML',
          text: `🎉 <b>По вашей ссылке пришёл ${esc(me.first_name || 'друг')}!</b>\n\n`
            + `Приглашайте ещё: за 3 и 10 друзей дают награды 🏆`,
        }, token).catch(() => {});
      }
    } catch (e) { console.warn('ref', e && e.message); }
    // дальше показываем обычное приветствие
  }

  // ссылка-приглашение в группу: /start group_<код>
  const groupStart = text.match(/^\/start(?:@\w+)?\s+group_([A-Za-z0-9]{3,8})$/i);
  if (groupStart) {
    const r = await joinGroupByCode(me.id, groupStart[1]);
    const kb = { inline_keyboard: [[{ text: '🎬 Открыть приложение', web_app: { url: (site || '') + '/' } }]] };
    if (!r.ok) {
      await tg('sendMessage', {
        chat_id: chatId, parse_mode: 'HTML', reply_markup: mainKeyboard(),
        text: `⚠️ ${esc(r.error || 'Не удалось войти в группу')}`,
      }, token).catch(() => {});
      return;
    }
    if (r.joined) {
      for (const uid of (r.group.members || [])) {
        if (String(uid) === String(me.id)) continue;
        await tg('sendMessage', {
          chat_id: uid, parse_mode: 'HTML',
          text: `🎭 <b>${esc(me.first_name || 'Новый участник')}</b> присоединился к группе «${esc(r.group.title)}»`,
        }, token).catch(() => {});
      }
    }
    await tg('sendMessage', {
      chat_id: chatId, parse_mode: 'HTML', reply_markup: kb,
      text: r.already
        ? `🎭 Вы уже в группе <b>«${esc(r.group.title)}»</b>.`
        : `🎭 <b>Вы в группе «${esc(r.group.title)}»!</b>\n\n`
          + `Теперь у вас общая колода на компанию.\n`
          + `Мэтч случится, когда фильм лайкнут <b>все</b> участники 🍿`,
    }, token).catch(() => {});
    return;
  }

  // deep-link на конкретный фильм: t.me/<бот>?startapp=film_<id>
  // («🔗 Другу» из приложения и шеринг мэтчей). В Telegram мини-приложение
  // обычно открывается само, а этот ответ — страховка для десктопа и для тех,
  // кто ещё не запускал бота: показываем карточку и кнопку входа.
  const filmStart = text.match(/^\/start(?:@\w+)?\s+film_([A-Za-z0-9_-]{1,48})$/i);
  if (filmStart) {
    let fid = filmStart[1];
    try { const al = await getAliasMap(); if (al.get(fid)) fid = String(al.get(fid)); } catch (e) { /* без дедупликации */ }
    const ALL = await getCatalogAll();
    const it = ALL[fid];
    if (it) {
      const kb = site
        ? { inline_keyboard: [[{ text: '🍿 Открыть карточку в приложении', web_app: { url: site + '/?startapp=film_' + encodeURIComponent(fid) } }]] }
        : { inline_keyboard: [[{ text: '🍿 Открыть «КиноФикацию»', url: `https://t.me/${BOT_USERNAME}?startapp=film_${encodeURIComponent(fid)}` }]] };
      return tg('sendMessage', {
        chat_id: chatId, parse_mode: 'HTML', reply_markup: kb,
        text: `🎬 <b>${esc(it.t)}</b>${it.y ? ' (' + it.y + ')' : ''}\n\n`
          + [
            it.r != null ? '★ ' + Number(it.r).toFixed(1) : '',
            it.tp === 'series' ? 'сериал' : 'фильм',
            (it.g || []).slice(0, 3).join(', '),
          ].filter(Boolean).map((x) => esc(x)).join(' · ') + '\n\n'
          + `<i>Вам прислали фильм из «КиноФикации». Откройте карточку, чтобы прочитать описание и добавить его в свой список 👇</i>`,
      }, token);
    }
    // фильм не найден (скрыт админом) — покажем обычное приветствие ниже
  }

  /* ---------- настройки уведомлений ---------- */
  if (/^\/notify/.test(text)) {
    return sendNotifMenu(chatId, me.id, token);
  }
  if (/^\/silent(?:@\w+)?(?:\s+(\d{1,2}))?/.test(text)) {
    const days = Math.max(1, Math.min(30, parseInt((text.match(/^\/silent(?:@\w+)?\s+(\d{1,2})/) || [])[1] || '7', 10)));
    const p = await muteUser(me.id, days);
    const until = new Date(p.muteUntil + 3 * 3600e3).toISOString().slice(0, 10).split('-').reverse().join('.');
    return tg('sendMessage', {
      chat_id: chatId, parse_mode: 'HTML',
      text: `🔕 <b>Готово — ничего не присылаем до ${until}</b>\n\n`
        + `Мэтчи, колода дня и рассылки не придут. Приложение работает как обычно,\n`
        + `все мэтчи дождутся вас во вкладке «Мэтчи».\n\n`
        + `Вернуть: /notify или кнопка ниже.`,
      reply_markup: { inline_keyboard: [[{ text: '🔔 Включить обратно', callback_data: 'unmute' }]] },
    }, token);
  }

  /* ---------- игры с партнёром (v1.9) ----------
     В приложении это экран с ДВУМЯ вкладками: «Угадайка» и «Слепая дуэль».
     Из бота даём две отдельные кнопки — так человек сразу попадает в нужную
     игру и видит, что их вообще две. */
  if (/^\/games/.test(text)) {
    const settings = await getSettings();
    if (settings && settings.flags && settings.flags.games === false) {
      return tg('sendMessage', {
        chat_id: chatId, parse_mode: 'HTML', reply_markup: mainKeyboard(),
        text: '🎮 Игры сейчас выключены владельцем приложения. Загляните позже.',
      }, token);
    }
    let st = null;
    try { st = await gameState(me.id); } catch (e) { st = null; }
    const partner = st && st.partner ? st.partner : null;
    const g = (st && st.guess) || {};
    const d = (st && st.duel) || null;
    const pct = g.total ? Math.round((g.score / g.total) * 100) : null;
    const rows = [];
    if (partner) {
      rows.push([{ text: '🎯 Угадай, понравится ли партнёру', web_app: { url: site + '/?startapp=games_guess' } }]);
      rows.push([{ text: '🎭 Слепая дуэль', web_app: { url: site + '/?startapp=games_duel' } }]);
    } else {
      rows.push([{ text: '📱 Открыть приложение', web_app: { url: site + '/?startapp=pair' } }]);
    }
    let lines = [];
    if (partner) {
      lines.push(`Играете с <b>${esc(partner.first_name || 'партнёром')}</b>.`);
      lines.push(pct == null
        ? '🎯 В «угадайке» отвечаете ЗА партнёра — счёт появится после первой проверки.'
        : `🎯 Вы знаете вкус партнёра на <b>${pct}%</b> (${g.score || 0} из ${g.total || 0}).`);
      lines.push(d && d.revealed
        ? '🎭 Раунд «слепой дуэли» сегодня сыгран — новый будет завтра.'
        : (d && d.myVerdict != null
          ? '🎭 Ваш ответ в дуэли записан — ждём ответ партнёра.'
          : '🎭 В «слепой дуэли» фильм скрыт: только жанр, год и рейтинг. Раунд один на сутки.'));
    } else {
      lines.push('Для игр нужен партнёр: отправьте заявку по коду или ссылкой — и откроются обе игры.');
    }
    return tg('sendMessage', {
      chat_id: chatId, parse_mode: 'HTML',
      reply_markup: { inline_keyboard: rows },
      text: `🎮 <b>Игры с партнёром</b>\n\n${lines.join('\n')}\n\n`
        + `<i>В приложении игры лежат в «Мой профиль» → «🎮 Игры с партнёром» и во вкладке «Пара»: там две вкладки, переключайтесь.</i>`,
    }, token);
  }

  if (text === BTN_MATCHES) return sendMatches(chatId, me, token, site, MT);
  if (text === BTN_BADGES) {
    const earned = await getEarned('u:' + me.id);
    const st2 = await userStats(me.id);
    const lines = earned.map((id) => { const b = badgeById(typeof id === 'string' ? id : id.id); return b ? `${b.icon} <b>${esc(b.title)}</b>` : null; }).filter(Boolean);
    return tg('sendMessage', {
      chat_id: chatId, parse_mode: 'HTML', reply_markup: mainKeyboard(),
      text: `🏆 <b>Ваши награды (${earned.length}):</b>\n${lines.join('\n') || 'Пока нет — свайпайте и ловите мэтчи!'}\n\n📊 Лайков: ${st2.likes} · мэтчей: ${st2.matches} · посмотрено: ${st2.watched}`,
    }, token);
  }
  if (text === BTN_PARTNERS) {
    const u2 = await getUser(me.id);
    const names = [];
    for (const pid of (u2 && u2.partners ? u2.partners : [])) { const pu = await getUser(pid); if (pu) names.push(`• ${esc(pu.first_name || pid)}${pu.username ? ' (@' + esc(pu.username) + ')' : ''}`); }
    return tg('sendMessage', {
      chat_id: chatId, parse_mode: 'HTML', reply_markup: mainKeyboard(),
      text: names.length
        ? `💞 <b>Ваши партнёры (${names.length}):</b>\n${names.join('\n')}\n\nДобавить ещё: /pair КОД или «📤 Отправить другу»`
        : `👥 Партнёров пока нет.\nВаш код: <code>${esc(me.code)}</code>\nНажмите «📤 Отправить другу», чтобы позвать человека — по ссылке он свяжется с вами сам.`,
    }, token);
  }
  if (text === BTN_HELP) return sendHelp(chatId, token);

  if (text === FRIEND_BTN) {
    const u = await getUser(me.id);
    const link = `https://t.me/${BOT_USERNAME}?start=pair_${u.code}`;
    const share = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent('Присоединяйся — вместе выбираем кино! 🎬')}`;
    await tg('sendMessage', {
      chat_id: chatId, parse_mode: 'HTML', reply_markup: mainKeyboard(),
      text: `📤 <b>Ваша ссылка-приглашение:</b>\n<code>${esc(link)}</code>\n\n`
        + `Тот, кто откроет её, отправит вам <b>заявку в партнёры</b> — останется принять её в приложении.\n`
        + `Нажмите кнопку ниже, чтобы отправить её любому контакту.`,
      reply_markup: { inline_keyboard: [[{ text: '📤 Отправить другу', url: share }]] },
    }, token);
    return;
  }

  if (/^\/start/.test(text)) {
    // приветствие: показываем партнёров или личный код (пара — только через заявку и подтверждение)
    const fresh = await getUser(me.id);
    const plist = [];
    for (const pid of (fresh && fresh.partners ? fresh.partners : [])) { const pu = await getUser(pid); if (pu) plist.push(pu.first_name || pid); }
    const partnersLine = plist.length
      ? `💞 Ваши партнёры: <b>${esc(plist.join(', '))}</b>`
      : `👥 Партнёров пока нет. Ваш код: <code>${esc(me.code)}</code>`;
    const defaultStart =
      `🎬 <b>КиноФикация</b> — привет, {name}!\n\n`
      + `Это «Тиндер для кино»: листаете карточки фильмов и сериалов, ставите ❤️ или ✖️. `
      + `Как только вы с партнёром оба лайкнете одно и то же — случится <b>мэтч</b>.\n\n`
      + `${partnersLine}\n\n`
      + `Откройте приложение кнопкой-меню слева от поля ввода.\n`
      + `<i>Команды: /tonight, /match, /partners, /pair КОД, /badges, /reset, /help</i>`;
    const startTpl = (settings.texts && settings.texts.start) ? settings.texts.start : defaultStart;
    await tg('sendMessage', {
      chat_id: chatId, parse_mode: 'HTML', reply_markup: mainKeyboard(),
      text: fillTemplate(startTpl, {
        name: esc(me.first_name || 'друг'), code: esc(me.code || ''), partners: esc(plist.join(', ') || '—'),
      }),
    }, token);
    return;
  }

  if (/^\/badges/.test(text)) {
    const earned = await getEarned('u:' + me.id);
    const st = await userStats(me.id);
    const lines = earned.map((id) => { const b = badgeById(typeof id === 'string' ? id : id.id); return b ? `${b.icon} <b>${esc(b.title)}</b>` : null; }).filter(Boolean);
    return tg('sendMessage', {
      chat_id: chatId, parse_mode: 'HTML',
      text: `🏆 <b>Ваши награды (${earned.length}):</b>\n${lines.join('\n') || 'Пока нет — свайпайте и ловите мэтчи!'}\n\n`
        + `📊 Лайков: ${st.likes} · мэтчей: ${st.matches} · посмотрено: ${st.watched}`,
    }, token);
  }
  if (/^\/partners/.test(text)) {
    const u = await getUser(me.id);
    const names = [];
    for (const pid of (u && u.partners ? u.partners : [])) { const pu = await getUser(pid); if (pu) names.push(`• ${esc(pu.first_name || pid)}${pu.username ? ' (@' + esc(pu.username) + ')' : ''}`); }
    return tg('sendMessage', {
      chat_id: chatId, parse_mode: 'HTML',
      text: names.length
        ? `💞 <b>Ваши партнёры (${names.length}):</b>\n${names.join('\n')}\n\nДобавить ещё: /pair КОД`
        : `👥 Партнёров пока нет. Ваш код: <code>${esc(me.code)}</code>\nДобавить: /pair КОД`,
    }, token);
  }
  if (/^\/tonight/.test(text)) return sendTonight(chatId, me, token, site);
  // /match и /matches — одно и то же: общие мэтчи в чат
  if (/^\/match/.test(text)) return sendMatches(chatId, me, token, site, MT);
  if (/^\/help/.test(text)) return sendHelp(chatId, token);

  const pairCmd = text.match(/^\/pair(?:@\w+)?\s+([A-Za-z0-9]{3,8})$/i);
  if (pairCmd) {
    await handlePairRequest(chatId, me, pairCmd[1], token, site, MT);
    return;
  }
  if (/^\/pair/.test(text)) {
    return tg('sendMessage', {
      chat_id: chatId, parse_mode: 'HTML',
      text: `👥 Ваш код: <code>${esc(me.code)}</code>\n\nОтправьте его партнёру — он введёт код во вкладке «Пара» в приложении `
        + `или напишет боту: <code>/pair ${esc(me.code)}</code>`,
    }, token);
  }

  if (/^\/reset/.test(text)) {
    // Без подтверждения один случайный тап по команде из меню стирал все оценки
    // и мэтчи безвозвратно. Теперь спрашиваем.
    return tg('sendMessage', {
      chat_id: chatId, parse_mode: 'HTML',
      text: '🧹 <b>Удалить все ваши оценки и мэтчи?</b>\n\n'
        + 'Действие необратимо: колода начнётся заново, общие списки с партнёрами пропадут.\n'
        + '<i>Данные партнёра при этом останутся его собственными.</i>',
      reply_markup: { inline_keyboard: [[
        { text: '❌ Отмена', callback_data: 'reset:no' },
        { text: '🧹 Да, удалить всё', callback_data: 'reset:yes' },
      ]] },
    }, token);
  }

  if (/^\/diary/.test(text)) {
    return tg('sendMessage', {
      chat_id: chatId, parse_mode: 'HTML', reply_markup: {
        inline_keyboard: [[{ text: '📔 Открыть дневник пары', web_app: { url: site + '/?startapp=diary' } }]],
      },
      text: '📔 <b>Дневник пары</b>\n\nЧто вы посмотрели вместе, какие оценки поставил каждый '
        + 'и совпали ли ваши мнения. Жмите кнопку ниже 👇',
    }, token);
  }

  if (/^\/profile/.test(text)) {
    return tg('sendMessage', {
      chat_id: chatId, parse_mode: 'HTML', reply_markup: {
        inline_keyboard: [[{ text: '👤 Открыть мой профиль', web_app: { url: site + '/?startapp=profile' } }]],
      },
      text: '👤 <b>Мой профиль</b>\n\nВаши свайпы, мэтчи, награды, активность и любимый жанр. Жмите кнопку ниже 👇',
    }, token);
  }

  if (/^\/week/.test(text)) {
    // итоги недели вручную — тот же текст, что приходит по воскресеньям
    const t = await buildDigestFor(me.id);
    return tg('sendMessage', {
      chat_id: chatId, parse_mode: 'HTML', reply_markup: mainKeyboard(),
      text: t || '📬 На этой неделе пока пусто.\n\nСвайпните пару карточек в приложении — и здесь появятся ваши кино-итоги 🎬',
    }, token).catch(() => {});
  }

  if (/^\/code/.test(text)) {
    return tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: `👥 Ваш код для связи: <code>${esc(me.code)}</code>` }, token);
  }

  // обычный текст
  await tg('sendMessage', {
    chat_id: chatId, parse_mode: 'HTML', reply_markup: mainKeyboard(),
    text: `Я не умею читать обычные сообщения 🙂\n\nВесь выбор кино — в мини-приложении. Жмите <b>«${MT}»</b> ниже 👇\n\n`
      + `<i>Или введите /help, чтобы увидеть команды.</i>`,
  }, token);
}

async function sendMatches(chatId, me, token, site) {
  const mine = await getMatches(me.id);   // только шарды своих пар
  if (!mine.length) {
    return tg('sendMessage', {
      chat_id: chatId, parse_mode: 'HTML', reply_markup: mainKeyboard(),
      text: '💔 Мэтчей пока нет.\n\nСвайпайте карточки в приложении — как только вы оба лайкнете один фильм, он появится здесь.',
    }, token);
  }
  const active = mine.filter((m) => !m.watched);
  const lines = mine.slice(0, 40).map((m, i) => {
    const it = CATALOG[m.id] || {};
    return `${i + 1}. ${m.watched ? '✅' : '🎬'} <b>${esc(m.title)}</b>${m.year ? ' (' + m.year + ')' : ''}`
      + (it.tp === 'series' ? ' · сериал' : '') + (m.rating ? ` · ★ ${Number(m.rating).toFixed(1)}` : '');
  }).join('\n');
  await tg('sendMessage', {
    chat_id: chatId, parse_mode: 'HTML',
    text: `🍿 <b>Ваши мэтчи (${active.length} к просмотру, всего ${mine.length})</b>\n\n${lines}`,
    reply_markup: active.length
      ? { inline_keyboard: [[{ text: '🌙 Что посмотреть сегодня', callback_data: 'tonight' }]] }
      : undefined,
  }, token);
}

/* ---------- /tonight: что посмотреть вдвоём сегодня ---------- */
async function sendTonight(chatId, me, token, site) {
  const items = await suggestTonight(me.id);
  if (!items.length) {
    return tg('sendMessage', {
      chat_id: chatId, parse_mode: 'HTML', reply_markup: mainKeyboard(),
      text: '🌙 Пока нечего предложить — все общие мэтчи уже посмотрены или их ещё нет.\n\n'
        + 'Свайпайте карточки в приложении: как только вы оба лайкнете один фильм, я предложу его на вечер 🍿',
    }, token);
  }
  const lines = items.map((m, i) => `${i + 1}. <b>${esc(m.title)}</b>${m.year ? ' (' + m.year + ')' : ''}`
    + (m.type === 'series' ? ' · сериал' : '')
    + (m.rating ? ` · ★ ${Number(m.rating).toFixed(1)}` : '')).join('\n');
  return tg('sendMessage', {
    chat_id: chatId, parse_mode: 'HTML',
    text: `🌙 <b>Сегодня вечером смотрите:</b>\n\n${lines}\n\n<i>Топ-3 ваших общих мэтча, которые ещё не посмотрены — по рейтингу.</i>`,
    reply_markup: { inline_keyboard: [[{ text: '🎬 Выбрать в приложении', web_app: { url: site + '/?startapp=matches' } }]] },
  }, token);
}

function sendHelp(chatId, token) {
  return tg('sendMessage', {
    chat_id: chatId, parse_mode: 'HTML',
    text: `🎬 <b>КиноФикация — как это работает</b>\n\n`
      + `1️⃣ Откройте приложение кнопкой-меню слева от поля ввода.\n`
      + `2️⃣ Свайп <b>вправо</b> — «хочу посмотреть», <b>влево</b> — «мимо», <b>вниз</b> — «уже смотрел» 👁\n`
      + `3️⃣ Когда вы с партнёром оба лайкнете один фильм — <b>мэтч</b>! Я пришлю уведомление обоим.\n`
      + `4️⃣ Все мэтчи копятся во вкладке «Мэтчи» — это ваш общий список на вечер.\n`
      + `5️⃣ Колода у каждого <b>своя</b>: ваш свайп не перелистывает карточку у партнёра, `
      + `а мэтч случается, когда вы оба лайкнули один фильм. Есть и <b>колода дня</b> — общие карточки на сегодня 🌙\n`
      + `6️⃣ Есть <b>группы</b> на 3–8 человек: общая колода на компанию, мэтч — когда лайкнули все 🎭\n\n`
      + `<b>Команды</b>\n`
      + `/tonight — что посмотреть сегодня вдвоём 🌙\n`
      + `/match — общие мэтчи в чат\n`
      + `/matches — то же самое\n`
      + `/week — 📬 мои кино-итоги недели\n`
      + `/games — 🎮 игры с партнёром: «угадайка» и «слепая дуэль»\n`
      + `/diary — 📔 дневник пары: что посмотрели и как каждому зашло\n`
      + `/notify — 🔔 какие уведомления присылать\n`
      + `/silent — 🔕 ничего не присылать 7 дней\n`
      + `/profile — 👤 моя статистика, активность и вкус\n`
      + `/code — мой код для связи с партнёром\n`
      + `/pair КОД — отправить заявку партнёру\n`
      + `/reset — стереть мои оценки и мэтчи (спросит подтверждение)\n`
      + `/help — эта справка\n\n`
      + `<b>В любом чате</b>\n`
      + `Напишите <code>@${BOT_USERNAME} название фильма</code> — бот предложит карточку `
      + `с рейтингом и кнопкой «❤️ в общий список». Если партнёр уже лайкнул фильм — случится мэтч 💞`,
  }, token);
}

/* ================= инлайн-режим: @kino_fik_bot название фильма =================
   Работает в ЛЮБОМ чате: человек пишет юзернейм бота и название — получает
   карточку фильма с рейтингом и кнопкой «добавить в общий список».
   Кнопка ставит ❤️ за автора запроса; если партнёр уже лайкнул — мэтч. */
const normQ = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е')
  .replace(/[^0-9a-zа-я\s]/gi, '').replace(/\s+/g, ' ').trim();

async function searchFilms(q, limit = 20) {
  const ALL = await getCatalogAll();
  const alias = await getAliasMap();
  const hidden = new Set(await getHidden());
  const qq = normQ(q);
  const out = [];
  for (const id of Object.keys(ALL)) {
    if (hidden.has(id) || alias.get(id)) continue;
    const it = ALL[id];
    let score = 0;
    if (qq) {
      const t = normQ(it.t);
      if (t === qq) score = 1000;
      else if (t.startsWith(qq)) score = 800;
      else if (t.includes(' ' + qq)) score = 600;
      else if (t.includes(qq)) score = 400;
      else continue;
    } else score = 1;
    score += Number(it.r) || 0;
    out.push({ id, it, score });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}

async function onInline(iq, token, site) {
  const q = String(iq.query || '').trim();
  const found = await searchFilms(q, q ? 20 : 12);
  const results = found.map(({ id, it }) => ({
    type: 'article',
    id,
    title: `${it.t}${it.y ? ' (' + it.y + ')' : ''}`,
    description: [
      it.r != null ? '★ ' + Number(it.r).toFixed(1) : 'без рейтинга',
      it.tp === 'series' ? 'сериал' : 'фильм',
      (it.g || []).slice(0, 3).join(', '),
    ].filter(Boolean).join(' · '),
    thumb_url: it.p || undefined,
    thumb_width: 200,
    thumb_height: 300,
    input_message_content: {
      message_text: `🎬 <b>${esc(it.t)}</b>${it.y ? ' (' + it.y + ')' : ''}\n`
        + (it.r != null ? `★ ${Number(it.r).toFixed(1)}${it.s === 'kp' ? ' на КиноПоиске' : ''}\n` : '')
        + ((it.g || []).length ? `<i>${esc((it.g || []).slice(0, 4).join(', '))}</i>\n` : '')
        + (it.desc ? '\n' + esc(String(it.desc).slice(0, 220)) + (String(it.desc).length > 220 ? '…' : '') + '\n' : '')
        + `\n<i>через @${BOT_USERNAME} — «КиноФикация»: выбираем кино вместе</i>`,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    },
    reply_markup: {
      inline_keyboard: [
        [{ text: '❤️ Хочу посмотреть — в общий список', callback_data: 'ilv:' + id }],
        ...(site ? [[{ text: '🎬 Открыть «КиноФикацию»', url: site + '/' }]] : []),
      ],
    },
  }));
  const params = { inline_query_id: iq.id, results, cache_time: 60, is_personal: false };
  if (!results.length) {
    params.switch_pm_text = 'Ничего не нашлось — открыть «КиноФикацию»';
    params.switch_pm_parameter = 'start';
  }
  await tg('answerInlineQuery', params, token);
}

/* ================= inline-кнопки ================= */
async function onCallback(cb, token) {
  const data = String(cb.data || '');
  const chatId = cb.message && cb.message.chat ? cb.message.chat.id : cb.from.id;
  const parts = data.split(':');
  const cmd = parts[0];
  const mid = parts[1] || '';
  const { user: me } = await ensureUser(cb.from);

  /* ---------- «🔕 Не беспокоить» под любым уведомлением ----------
     Одна кнопка глушит ВСЕ пуши на N дней. Это важнее, чем кажется:
     без неё человек, которому надоели уведомления, просто отписывается
     от бота — и теряет мэтчи навсегда. */
  if (cmd === 'mute') {
    const days = Math.max(1, Math.min(30, parseInt(mid, 10) || 7));
    const p = await muteUser(me.id, days);
    const until = new Date(p.muteUntil + 3 * 3600e3).toISOString().slice(0, 10).split('-').reverse().join('.');
    await tg('answerCallbackQuery', { callback_query_id: cb.id, text: `Пуши выключены до ${until}` }, token);
    await tg('sendMessage', {
      chat_id: chatId, parse_mode: 'HTML',
      text: `🔕 <b>Уведомления выключены до ${until}</b>\n\n`
        + `Бот не будет присылать ничего — ни мэтчей, ни колоды дня, ни рассылок.\n`
        + `Приложение продолжает работать как обычно.\n\n`
        + `Вернуть: /notify или кнопка ниже.`,
      reply_markup: { inline_keyboard: [[
        { text: '🔔 Включить обратно', callback_data: 'unmute' },
        { text: '⚙️ Настроить по типам', callback_data: 'notifmenu' },
      ]] },
    }, token);
    return;
  }
  if (cmd === 'unmute') {
    await muteUser(me.id, 0);
    await tg('answerCallbackQuery', { callback_query_id: cb.id, text: 'Уведомления включены 🔔' }, token);
    await tg('sendMessage', {
      chat_id: chatId, parse_mode: 'HTML',
      text: '🔔 <b>Уведомления снова включены.</b>\n\nОтдельные типы можно выключить командой /notify.',
    }, token);
    return;
  }
  if (cmd === 'notifmenu') {
    await tg('answerCallbackQuery', { callback_query_id: cb.id }, token);
    return sendNotifMenu(chatId, me.id, token);
  }
  /* отдельные переключатели: nt:<тип>:<0|1> */
  if (cmd === 'nt') {
    const kind = parts[1] || '', on = parts[2] === '1';
    if (NOTIF_KINDS.includes(kind)) {
      await setNotifPrefs(me.id, { [kind]: on });
      await tg('answerCallbackQuery', { callback_query_id: cb.id, text: on ? 'Включено' : 'Выключено' }, token);
      return sendNotifMenu(chatId, me.id, token, cb.message && cb.message.message_id);
    }
  }
  /* «⭐ Оценить» под уведомлением о мэтче — сразу показываем звёзды.
     ВАЖНО: мэтч ищем ЗДЕСЬ, а не берём переменную `m` из конца функции —
     она объявлена ниже через let, и обращение к ней отсюда роняло обработчик
     с ReferenceError (TDZ): кнопка показывала тост, но звёзды не появлялись. */
  if (cmd === 'rateask') {
    await tg('answerCallbackQuery', { callback_query_id: cb.id, text: 'Оцените, как зашло' }, token);
    const mineR = await getMatches(me.id);
    const mR = mineR.find((x) => matchMid(x) === mid) || mineR.find((x) => String(x.id) === String(mid));
    const key = mR ? matchMid(mR) : mid;
    const title = mR ? mR.title : '';
    const stars = [1, 2, 3, 4, 5].map((n) => ({ text: '⭐'.repeat(n), callback_data: `rate:${key}:${n}` }));
    if (cb.message) {
      await tg('editMessageText', {
        chat_id: chatId, message_id: cb.message.message_id, parse_mode: 'HTML',
        text: `⭐ <b>«${esc(title)}»</b>\n\nКак зашло? Оцените от 1 до 5 — оценка попадёт в дневник пары:`,
        reply_markup: { inline_keyboard: [stars] },
      }, token);
    }
    return;
  }

  /* ---------- подтверждение сброса данных ---------- */
  if (cmd === 'reset') {
    if (mid !== 'yes') {
      await tg('answerCallbackQuery', { callback_query_id: cb.id, text: 'Отменено' }, token);
      if (cb.message) await tg('editMessageText', {
        chat_id: chatId, message_id: cb.message.message_id, parse_mode: 'HTML',
        text: '↩️ Ничего не удалено — ваши оценки и мэтчи на месте.',
      }, token);
      return;
    }
    await setVotes(me.id, {});
    await clearSwlog(me.id);            // журнал свайпов — вместе с оценками (как в /reset приложения)
    await removeAllMatchesFor(me.id);
    await bumpCoUsers(me);              // партнёры видят изменения сразу, а не через минуту
    await tg('answerCallbackQuery', { callback_query_id: cb.id, text: 'Данные удалены' }, token);
    if (cb.message) await tg('editMessageText', {
      chat_id: chatId, message_id: cb.message.message_id, parse_mode: 'HTML',
      text: '🧹 Готово: ваши оценки и мэтчи удалены. Карточки начнутся заново.',
    }, token);
    return;
  }

  /* ---------- инлайн-режим: «добавить в общий список» ----------
     Кнопка под карточкой фильма, отправленной через @kino_fik_bot в любом чате.
     Ставит ❤️ автору нажатия; если партнёр уже лайкнул — создаёт мэтч. */
  if (cmd === 'ilv') {
    const ALL = await getCatalogAll();
    const it = ALL[mid];
    if (!it) {
      await tg('answerCallbackQuery', { callback_query_id: cb.id, text: 'Фильм не найден в каталоге' }, token);
      return;
    }
    const v0 = await getVotes(me.id);
    if (v0[mid] === 1) {
      await tg('answerCallbackQuery', { callback_query_id: cb.id, text: 'Уже в вашем списке ❤️' }, token);
      return;
    }
    let site = '';
    try { site = (await db().get('config:site')) || ''; } catch (e) { /* ignore */ }
    const res = await registerLike(me, mid, it, {
      track: true,
      notifyPair: async (mm, a, b) => {
        for (const u of [a, b]) {
          const other = String(u.id) === String(a.id) ? b : a;
          await tg('sendMessage', {
            chat_id: u.id, parse_mode: 'HTML',
            text: `💞 <b>Мэтч из инлайн-поиска!</b>\n\n`
              + `Вы и <b>${esc((other && other.first_name) || 'партнёр')}</b> оба хотите посмотреть:\n`
              + `<b>«${esc(mm.title || '')}»</b>${mm.year ? ' (' + mm.year + ')' : ''}\n\n`
              + `Фильм уже в общем списке — осталось выбрать вечер 🍿`,
            reply_markup: site
              ? { inline_keyboard: [[{ text: '🍿 Открыть приложение', web_app: { url: site + '/?startapp=matches' } }]] }
              : undefined,
          }, token).catch(() => {});
        }
      },
      notifyGroup: async (gm) => {
        for (const uid of (gm.by || [])) {
          if (String(uid) === String(me.id)) continue;
          await tg('sendMessage', {
            chat_id: uid, parse_mode: 'HTML',
            text: `🎭 <b>Групповой мэтч!</b>\n\nВсе участники «${esc(gm.groupTitle || '')}» лайкнули:\n`
              + `<b>«${esc(gm.title || '')}»</b> 🍿`,
          }, token).catch(() => {});
        }
      },
    });
    const matched = res.match || res.groupMatch;
    await tg('answerCallbackQuery', {
      callback_query_id: cb.id,
      text: matched ? '💞 Мэтч! Вы оба хотите это посмотреть' : 'Добавлено в общий список ❤️',
    }, token);
    return;
  }


  /* ---------- «✍️ Ответить» под уведомлением об обратной связи ----------
     Кнопка доступна только в чате админа (id из настроек «Telegram для
     уведомлений»). Включаем режим ожидания: следующее обычное сообщение
     админа уйдёт пользователю. */
  if (cmd === 'fbr') {
    const st = await getSettings();
    const adminChat = String(st.notifyChat || '');
    const isAdmin = adminChat && (String(cb.from.id) === adminChat || String(chatId) === adminChat);
    if (!isAdmin) {
      await tg('answerCallbackQuery', {
        callback_query_id: cb.id,
        text: 'Отвечать может только админ: укажите свой Telegram ID в админке → «Настройки»',
      }, token);
      return;
    }
    const list = await getFeedback();
    const item = list.find((x) => String(x.id) === String(mid));
    if (!item) {
      await tg('answerCallbackQuery', { callback_query_id: cb.id, text: 'Сообщение не найдено (возможно, удалено)' }, token);
      return;
    }
    if (item.status === 'answered') {
      await tg('answerCallbackQuery', { callback_query_id: cb.id, text: 'На это сообщение уже отвечено' }, token);
      return;
    }
    await db().set('fb:reply:' + adminChat, JSON.stringify({
      fid: item.id, uid: item.uid, name: item.name || item.username || '',
      srcChat: cb.message && cb.message.chat ? cb.message.chat.id : null,
      srcMid: cb.message ? cb.message.message_id : null,
      srcText: cb.message ? (cb.message.text || '') : '',
      ts: Date.now(),
    }));
    await tg('answerCallbackQuery', { callback_query_id: cb.id, text: '✍️ Теперь отправьте текст ответа' }, token);
    await tg('sendMessage', {
      chat_id: adminChat, parse_mode: 'HTML',
      text: `✍️ <b>Ответ на отзыв</b>\n\nОт: <b>${esc(item.name || item.username || ('id ' + item.uid))}</b>\n`
        + `Сообщение: <i>${esc(String(item.text || '').slice(0, 400))}</i>\n\n`
        + `Отправьте ответ <b>обычным сообщением</b> — оно уйдёт пользователю в личку от бота.\n`
        + `Жду 15 минут; отмена — /cancel.`,
    }, token).catch(() => {});
    return;
  }

  const mine = await getMatches(me.id);
  let m = mine.find((x) => matchMid(x) === mid);
  if (!m) m = mine.find((x) => String(x.id) === String(mid)); // совместимость со старыми кнопками

  if (cmd === 'watched') {
    if (m) {
      const key = matchMid(m);
      const updated = await updateMatchesFor(me.id, (x) => matchMid(x) === key, (x) => ({ watched: !x.watched }));
      if (updated) m = updated;
    }
    await tg('answerCallbackQuery', { callback_query_id: cb.id, text: m && m.watched ? 'Отмечено как просмотренное ✅' : 'Снята отметка' }, token);
    if (cb.message) {
      if (m && m.watched) {
        const key = matchMid(m);
        const stars = [1, 2, 3, 4, 5].map((n) => ({ text: '⭐'.repeat(n), callback_data: `rate:${key}:${n}` }));
        await tg('editMessageText', {
          chat_id: chatId, message_id: cb.message.message_id, parse_mode: 'HTML',
          text: `✅ <b>«${esc(m.title)}»</b> — посмотрели!\n\nКак зашло? Оцените от 1 до 5:`,
          reply_markup: { inline_keyboard: [stars] },
        }, token);
      } else {
        await tg('editMessageText', {
          chat_id: chatId, message_id: cb.message.message_id, parse_mode: 'HTML',
          text: `↩️ «${esc(m ? m.title : '')}» снова в списке к просмотру`,
        }, token);
      }
    }
    return;
  }

  if (cmd === 'rate') {
    const n = Number(parts[2] || 0);
    if (m && n >= 1 && n <= 5) {
      const key = matchMid(m);
      const updated = await updateMatchesFor(me.id, (x) => matchMid(x) === key,
        (x) => ({ scores: Object.assign({}, x.scores || {}, { [me.id]: n }) }));
      if (updated) m = updated;
      const vals = Object.values(m.scores || {});
      const avg = Math.round((vals.reduce((x, y) => x + y, 0) / vals.length) * 10) / 10;
      await tg('answerCallbackQuery', { callback_query_id: cb.id, text: `Оценка ${n} сохранена` }, token);
      if (cb.message) await tg('editMessageText', {
        chat_id: chatId, message_id: cb.message.message_id, parse_mode: 'HTML',
        text: `✅ <b>«${esc(m.title)}»</b> — посмотрели.\nВаша оценка: ${'⭐'.repeat(n)}\nСредняя по паре: <b>${avg}</b>`,
      }, token);
    } else {
      await tg('answerCallbackQuery', { callback_query_id: cb.id }, token);
    }
    return;
  }

  if (cmd === 'tonight') {
    await tg('answerCallbackQuery', { callback_query_id: cb.id }, token);
    let site = '';
    try { site = (await db().get('config:site')) || ''; } catch (e) { /* ignore */ }
    await sendTonight(chatId, me, token, site);
    return;
  }

  if (cmd === 'drop') {
    const key = m ? matchMid(m) : mid;
    await removeMatchesFor(me.id, (x) => matchMid(x) === key);
    // убираем лайк, чтобы фильм мог вернуться в колоду
    const v = await getVotes(me.id); delete v[m ? m.id : mid]; await setVotes(me.id, v);
    await tg('answerCallbackQuery', { callback_query_id: cb.id, text: 'Убрано из мэтчей' }, token);
    if (cb.message) await tg('deleteMessage', { chat_id: chatId, message_id: cb.message.message_id }, token);
    return;
  }

  await tg('answerCallbackQuery', { callback_query_id: cb.id }, token);
}

/* ---------- заявка в партнёры: общая логика для /start pair_ и /pair ---------- */
async function handlePairRequest(chatId, me, code, token, site, MT) {
  // человек открыл СОБСТВЕННУЮ ссылку-приглашение — подсказываем, что делать, без ошибки
  const self = await getUser(me.id);
  if (self && String(code || '').toUpperCase() === String(self.code || '').toUpperCase()) {
    await tg('sendMessage', {
      chat_id: chatId, parse_mode: 'HTML', reply_markup: mainKeyboard(),
      text: `😄 Это <b>ваша собственная</b> ссылка-приглашение!\n\n`
        + `Отправьте её партнёру (кнопка «📤 Отправить другу» или вкладка «Пара» в приложении).\n`
        + `Когда он откроет ссылку и нажмёт START — вам придёт заявка в партнёры, примите её во вкладке «Пара».`,
    }, token).catch(() => {});
    return;
  }
  const r = await startPairing(me, code);
  const openKb = { inline_keyboard: [[{ text: '📱 Открыть приложение', web_app: { url: site + '/?startapp=preq' } }]] };
  if (r.ok && r.linked) {
    // встречные заявки — сразу партнёры, уведомляем обоих
    for (const [u, other] of [[me, r.partner], [r.partner, me]]) {
      await tg('sendMessage', {
        chat_id: u.id, parse_mode: 'HTML',
        text: `💞 <b>Вы теперь партнёры!</b>\n\nВы и <b>${esc(other.first_name || 'партнёр')}</b> свайпаете кино вместе.\nКогда оба нажмёте ❤️ на одном фильме — случится мэтч 🍿`,
        reply_markup: { inline_keyboard: [[{ text: '🎬 Открыть приложение', web_app: { url: site + '/' } }]] },
      }, token).catch(() => {});
    }
    return;
  }
  if (r.ok && r.request) {
    await tg('sendMessage', {
      chat_id: chatId, parse_mode: 'HTML', reply_markup: mainKeyboard(),
      text: r.duplicate
        ? `⏳ Заявка для <b>${esc(r.partner.first_name || 'партнёра')}</b> уже отправлена — ждём подтверждения.`
        : `💌 <b>Заявка отправлена!</b>\n\n<b>${esc(r.partner.first_name || 'Партнёр')}</b> получит уведомление и сможет принять или отклонить её в приложении.\nКак только примет — вы станете партнёрами, и мы напишем вам обоим.\n\nЖмите «${MT}» 👇`,
    }, token).catch(() => {});
    if (!r.duplicate) {
      await tg('sendMessage', {
        chat_id: r.partner.id, parse_mode: 'HTML', reply_markup: openKb,
        text: `💌 <b>Заявка в партнёры</b>\n\n<b>${esc(me.first_name || 'Кто-то')}</b> хочет свайпать кино вместе с вами.\nОткройте приложение — там можно принять или отклонить заявку.`,
      }, token).catch(() => {});
    }
    return;
  }
  await tg('sendMessage', {
    chat_id: chatId, parse_mode: 'HTML', reply_markup: mainKeyboard(),
    text: r.already
      ? `💞 Вы уже партнёры с <b>${esc((r.partner && r.partner.first_name) || 'этим человеком')}</b>. Можно свайпать!`
      : `⚠️ Не удалось отправить заявку: ${esc(r.error || 'неизвестная ошибка')}`,
  }, token).catch(() => {});
}
