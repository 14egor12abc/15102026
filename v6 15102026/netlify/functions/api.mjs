// Основной API мини-приложения: профили, голоса, мэтчи, уведомления
import {
  getConfig, parseInitData, ensureUser, getUser, allUserIds,
  getVotes, setVotes, getMatches, setMatches, linkByCode, saveUser, removePartner,
  tg, json, esc, ratingLine, runSetup, siteUrl, siteAlive, db, CORS, fillTemplate,
  verifyWebSession, signWebSession, createWebCode, consumeWebCode,
  getHidden, getSettings, verifyAdminSession, adminLogin, adminSetPassword, adminHasPassword,
  getCatalogAll, getCustomFilms, getEarned, setEarned, isBanned, userStats, coupleStats, allPairs,
  matchMid, findMatch, once, getAnnounce, setAnnounce, getSeen, markSeen,
  getStop, setStop, pushSwlog, getSwlog, removeSwlog, clearSwlog,
  getPreqs, addPreq, removePreq, startPairing, requestPairing, addPartner,
  getDynamicFilms, getRatingOverrides,
  trackDaily, getCardEdits, getCollections, pushFeedback, verifyPreviewUid,
  getPrefs, setPrefs, getNight, setNight, getRev, bumpRev, bumpPairRev, bumpCoUsers, partnersVoted, pvSignature,
  clearNight, pairKey, dayStr, trackUserActivity, isNightHour, suggestTonight,
  buildDailyDeck, buildDailyPool, dailyKey, DAILY_DECK_SIZE,
  getNotifPrefs, setNotifPrefs, canNotify, notifyUser, muteUser, NOTIF_KINDS, NOTIF_DEFAULT,
  getMood, setMood, moodOfDay, MOODS, MOOD_KEYS, gameState, gameGuess, gameDuel, gameDuelVerdict,
  gameNextGuess, MOOD_GENRES, normFlags, DEFAULT_FLAGS,
  // мэтчи по шардам на пару + «партнёр уже смотрел»
  partnerSeen, addMatch, removeMatchesFor, removeAllMatchesFor, updateMatchesFor, getPairMatches,
  // группы (3+ человек), рефералы, проверка версии клиента
  userGroups, createGroup, joinGroupByCode, leaveGroup, groupsVoted, gvSignature,
  getGroupMatches, getGroup, trackReferral, getRefs, needUpdateInfo, cmpVer,
  partnerStops, groupStops, stopsSig,
  // дедупликация каталога, свои подборки, общий лайк (бот + приложение)
  canonFilmId, getAliasMap, registerLike,
  getUserCols, ucolSave, ucolDelete, ucolAddFilm, ucolRemoveFilm, WH_VERSION,
} from './_shared.mjs';
import { handleAdmin } from './_admin.mjs';
import { BADGES, badgeById, computePersonal, computeCouple, badgeProgress, expandEarned } from './_badges.mjs';
import { CATALOG } from './_catalog.mjs';

/* Версия серверной части. Отдаётся в `ping` и `hello` — по ней страница
   диагностики и клиент понимают, что задеплоено и не разъехались ли версии. */
import { SERVER_VERSION as SV } from './_shared.mjs';
export const SERVER_VERSION = SV;   // реэкспорт: версия объявлена в _shared.mjs (см. комментарий там)

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, error: 'Только POST' }, 405);

  let body;
  try { body = await req.json(); } catch (e) { return json({ ok: false, error: 'Некорректный запрос' }, 400); }

  const cfg = await getConfig();
  if (!cfg.token) return json({ ok: false, error: 'Бот ещё не настроен. Откройте страницу /setup' }, 500);

  const action = String(body.a || '');

  /* ---- диагностика деплоя ----
     Единственное действие, которое не требует ни входа, ни настроенного бота.
     По нему страница /404.html и корневая страница-диагностика отличают
     «серверные функции не задеплоены» (Netlify отдаёт свой HTML-404) от
     «функции на месте, но бот ещё не настроен» (JSON с configured:false). */
  if (action === 'ping') {
    return json({ ok: true, pong: true, configured: !!cfg.token, ver: SERVER_VERSION, time: Date.now() });
  }

  /* ---- вход в админку (сессии ещё нет) ---- */
  if (action === 'admin.login' || action === 'admin.create') {
    if (action === 'admin.create') {
      if (await adminHasPassword()) return json({ ok: false, error: 'Пароль администратора уже создан' }, 403);
      const cr = await adminSetPassword(body.password);
      if (!cr.ok) return json(Object.assign({ ok: false }, cr), 400);
    }
    const lr = await adminLogin(body.password);
    return json(lr.ok ? { ok: true, token: lr.token } : Object.assign({ ok: false }, lr), lr.ok ? 200 : 401);
  }

  /* ---- вход с компьютера по одноразовому коду ---- */
  if (action === 'weblogin') {
    const userId = await consumeWebCode(body.code);
    if (!userId) return json({ ok: false, error: 'Код не подошёл или устарел. Запросите новый в приложении (вкладка «Пара»).' }, 401);
    const u = await getUser(userId);
    if (!u) return json({ ok: false, error: 'Пользователь не найден' }, 404);
    const partners = [];
    for (const pid of (u.partners || [])) { const pu = await getUser(pid); if (pu) partners.push(Object.assign(pub(pu), { prefs: (await getPrefs(pid)).genres })); }
    const all = await getMatches(userId);
    const st0 = await getSettings();
    const [pvoted0, gvoted0, pstops0, gstops0] = await Promise.all([
      partnersVoted(u), groupsVoted(userId), partnerStops(u), groupStops(userId),
    ]);
    return json({
      ok: true,
      session: await signWebSession(userId),
      me: pub(u),
      partners,
      partner: partners[0] || null,
      votes: await getVotes(userId),
      matches: all.filter((m) => (m.by || []).includes(userId)),
      hidden: await getHidden(),
      groups: await groupList(userId),
      refs: await refInfo(userId),
      prefs: await getPrefs(userId),
      stop: await getStop(userId),
      ucols: await getUserCols(userId),
      dedup: await (async () => {
        const alias = await getAliasMap();
        return alias.size ? Object.fromEntries(alias) : null;
      })(),
      pseen: await partnerSeen(u),
      pvoted: pvoted0,
      gvoted: gvoted0,
      pstops: pstops0,
      gstops: gstops0,
      pvSig: pvSignature(pvoted0) + '|' + gvSignature(gvoted0) + '|' + stopsSig(pstops0, gstops0),
      rev: await getRev(userId),
      settings: { syncDeck: st0.syncDeck === true, maintenance: st0.maintenance, texts: st0.texts, flags: st0.flags },
      notifs: await getNotifPrefs(userId),
      needUpdate: needUpdateInfo(st0, String(body.cv || u.clientVersion || '')),
    });
  }

  /* ---- кто вы: Telegram, сессия с компьютера или админ «глазами пользователя» ---- */
  let me = null;
  const tgUser = parseInitData(body.initData, cfg.token);
  if (tgUser) {
    const eu = await ensureUser(tgUser);
    me = eu.user;
    if (eu.isNew) await trackDaily('newUser');
  } else if (body.session) me = await verifyWebSession(body.session);
  else if (body.preview) {
    const puid = await verifyPreviewUid(body.preview);
    if (puid) me = await getUser(puid);
  }

  /* ---- админ-действия (после проверки админ-сессии) ---- */
  if (action.indexOf('admin.') === 0) {
    if (!(await verifyAdminSession(body.adminToken))) return json({ ok: false, error: 'Требуется вход в админку' }, 401);
    const r = await handleAdmin(action.replace(/^admin\./, ''), body, { token: cfg.token, source: cfg.source, site: siteUrl(req) });
    return json(r, r.ok ? 200 : 400);
  }

  if (!me) return json({ ok: false, error: 'Откройте приложение через Telegram или войдите по коду с компьютера' }, 401);
  if (await isBanned(me.id)) return json({ ok: false, error: 'Доступ отключён администратором' }, 403);

  // самолечение: если сохранённый адрес сайта мёртв (сайт переименовали и т.п.) —
  // перерегистрируем вебхук и кнопку под тот адрес, с которого пришёл запрос.
  // Вторая причина перерегистрации: обновился набор allowed_updates (WH_VERSION) —
  // например, после включения инлайн-режима старые деплои сами его подхватывают.
  if (action === 'hello') {
    const here = siteUrl(req);
    try {
      const known = await db().get('config:site');
      if (here && known !== here && !(await siteAlive(known))) {
        await runSetup(cfg.token, here);
        await db().set('config:site', here);
      } else if (here && known === here) {
        const whver = await db().get('config:whver');
        if (String(whver || '') !== String(WH_VERSION)) await runSetup(cfg.token, here);
      }
    } catch (e) { console.warn('bootstrap', e && e.message); }
  }

  try {
    switch (action) {

      /* ---------------- приветствие / состояние ---------------- */
      case 'hello': {
        const st = await getSettings();
        // информация о сессии для админки: последний вход, платформа, язык.
        // ВАЖНО: перечитываем свежую копию пользователя — иначе параллельный
        // запрос (заявка/принятие) мог быть затёрт старой копией (баг задваивания).
        const updated = (await getUser(me.id)) || me;
        updated.lastSeen = Date.now();
        if (body.platform) updated.platform = String(body.platform).slice(0, 24);
        if (body.lang) updated.lang = String(body.lang).slice(0, 12);
        if (body.cv) updated.clientVersion = String(body.cv).slice(0, 12);
        await saveUser(updated);
        await trackDaily('open', me.id);
        me.partners = updated.partners || [];
        const partners = [];
        for (const pid of (updated.partners || [])) {
          const pu = await getUser(pid);
          // prefs партнёра нужны, чтобы общая (синхронная) колода учитывала вкусы обоих
          if (pu) partners.push(Object.assign(pub(pu), { prefs: (await getPrefs(pid)).genres }));
        }
        const votes = await getVotes(updated.id);
        const matches = await getMatches(updated.id);   // только шарды этой пары
        const groups = await groupList(updated.id);
        const cv = String(body.cv || updated.clientVersion || '');
        const upd = needUpdateInfo(st, cv);
        const [pvoted, gvoted, pstops, gstops] = await Promise.all([
          partnersVoted(me), groupsVoted(me.id), partnerStops(me), groupStops(me.id),
        ]);
        const pvSig = pvSignature(pvoted) + '|' + gvSignature(gvoted) + '|' + stopsSig(pstops, gstops);
        return json({
          ok: true,
          me: pub(updated),
          partners,
          partner: partners[0] || null,
          requests: await preqList(me.id, 'in'),
          sent: await preqList(me.id, 'out'),
          votes,
          matches,
          hidden: await getHidden(),
          stop: await getStop(me.id),
          prefs: await getPrefs(updated.id),
          nights: await activeNights(updated),
          groups,
          refs: await refInfo(updated.id),
          needUpdate: upd,
          extra: await (async () => {
            const custom = await getCustomFilms();
            const dyn = await getDynamicFilms();
            const seen = new Set(custom.map((f) => f.id));
            const list = custom.concat(dyn.filter((f) => !seen.has(f.id)));
            // карточки-дубликаты не отдаём: клиент должен видеть один фильм один раз
            const alias = await getAliasMap();
            return alias.size ? list.filter((f) => !alias.has(String(f.id))) : list;
          })(),
          overrides: await getRatingOverrides(),
          edits: await getCardEdits(),
          collections: await getCollections(),
          ucols: await getUserCols(me.id),
          dedup: await (async () => {
            const alias = await getAliasMap();
            return alias.size ? Object.fromEntries(alias) : null;
          })(),
          pseen: await partnerSeen(me),
          daily: await buildDailyDeck(me.id, { me: updated }),
          pvoted,
          gvoted,
          pstops,
          gstops,
          pvSig,
          rev: await getRev(me.id),
          settings: { syncDeck: st.syncDeck === true, maintenance: st.maintenance, texts: st.texts, flags: st.flags },
          notifs: await getNotifPrefs(me.id),
          evening: await getMood(me.id),
          badges: await myBadges(me),
          announce: await (async () => {
            const ann = await getAnnounce();
            if (!ann || !ann.id) return null;
            const seen = await getSeen(me.id);
            return seen.includes(ann.id) ? null : ann;
          })(),
          users: (await allUserIds()).length,
        });
      }

      /* ---------------- голос ---------------- */
      case 'vote': {
        // дедупликация: лайк «карточке-дублю» засчитывается каноническому фильму
        const idRaw = String(body.id || '');
        const id = await canonFilmId(idRaw);
        const ALL = await getCatalogAll();
        const it = ALL[id] || ALL[idRaw];
        if (!it) return json({ ok: false, error: 'Такого фильма нет в каталоге' }, 404);
        // 1 — хочу посмотреть, -1 — мимо, 2 — уже смотрел ранее (свайп ВНИЗ).
        // Голос «2» так же убирает фильм из колоды, но мэтчем не считается.
        const rawV = Number(body.v);
        const v = rawV === 1 ? 1 : rawV === 2 ? 2 : -1;

        /* ---- лайк: ядро общее с инлайн-режимом бота (registerLike) ----
           Запись голоса, журнал, статистика, мэтчи с партнёрами и группами,
           уведомления — всё внутри. Здесь остаётся только обвязка ответа. */
        if (v === 1) {
          const res = await registerLike(me, id, it, {
            track: true,
            notifyPair: (mm, a, b) => withTimeout(notifyMatch(cfg.token, mm, a, b, siteUrl(req)), 8000),
            notifyGroup: (gm) => withTimeout(notifyGroupMatch(cfg.token, gm, siteUrl(req)), 9000),
          });
          if (!res.ok) return json({ ok: false, error: res.error }, 404);
          const newBadges = await syncBadges(me, cfg);
          return json({ ok: true, match: res.match, newMatches: res.newMatches, groupMatch: res.groupMatch, newBadges });
        }

        /* ---- «мимо» и «уже смотрел» ---- */
        const votes = await getVotes(me.id);
        votes[id] = v;
        await setVotes(me.id, votes);
        await pushSwlog(me.id, id, v);
        await trackDaily('swipe', me.id);
        // колода у пары общая: мой голос убирает карточку и у партнёра,
        // поэтому сообщаем ему, что данные изменились
        for (const pid of (me.partners || [])) await bumpRev(pid);
        // групповая колода: любой голос убирает карточку у всех участников
        for (const g of await userGroups(me.id)) {
          for (const uid of (g.members || [])) {
            if (String(uid) !== String(me.id)) await bumpRev(uid);
          }
        }
        await trackUserActivity(me.id, { like: false, nightLike: false });

        const newBadges = await syncBadges(me, cfg);
        return json({ ok: true, match: null, newMatches: [], groupMatch: null, newBadges });
      }

      /* ---------------- отмена голоса ---------------- */
      case 'unvote': {
        const id = await canonFilmId(body.id);
        const votes = await getVotes(me.id);
        delete votes[id];
        await setVotes(me.id, votes);
        await removeSwlog(me.id, id); // фильм вернулся в колоду — убираем строку из журнала
        await removeMatchesFor(me.id, (m) => String(m.id) === String(id));
        // общий объект изменился: у партнёра пропал мэтч и обновилась общая колода
        await bumpCoUsers(me);
        return json({ ok: true, votes, matches: await getMatches(me.id) });
      }

      /* ---------------- убрать из мэтчей ---------------- */
      case 'unmatch': {
        const mid = String(body.mid || '');
        const id = String(body.id || '');
        await removeMatchesFor(me.id, mid ? (m) => matchMid(m) === mid : (m) => String(m.id) === String(id));
        await bumpCoUsers(me);   // вторая сторона убирает мэтч из списка сразу, а не через минуту
        return json({ ok: true, matches: await getMatches(me.id) });
      }

      /* ---------------- отметили «посмотрели» ---------------- */
      case 'watched': {
        const mid = String(body.mid || '');
        const id = String(body.id || '');
        const flag = body.v !== false;
        const pred = mid ? (m) => matchMid(m) === mid : (m) => String(m.id) === String(id);
        const hit = await updateMatchesFor(me.id, pred, () => ({ watched: flag }));
        if (hit) await bumpCoUsers(me);   // «посмотрели» у партнёра появляется сразу
        if (flag && hit) await trackDaily('watch');
        const newBadges = flag ? await syncBadges(me, cfg) : [];
        return json({ ok: true, matches: await getMatches(me.id), match: hit || null, newBadges });
      }

      /* ---------------- оценка «как зашло» ---------------- */
      case 'rate': {
        const mid = String(body.mid || '');
        const id = String(body.id || '');
        const score = Math.max(1, Math.min(5, Math.round(Number(body.score) || 0)));
        if (!score) return json({ ok: false, error: 'Оценка должна быть от 1 до 5' }, 400);
        const pred = mid ? (m) => matchMid(m) === mid : (x) => String(x.id) === String(id);
        const m = await updateMatchesFor(me.id, pred, (x) => ({
          scores: Object.assign({}, x.scores || {}, { [me.id]: score }),
        }));
        if (!m) return json({ ok: false, error: 'Мэтч не найден' }, 404);
        await bumpCoUsers(me);            // оценка видна партнёру без ожидания
        const vals = Object.values(m.scores || {});
        const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
        const newBadges = await syncBadges(me, cfg);
        return json({ ok: true, match: m, avg: Math.round(avg * 10) / 10, newBadges });
      }

      /* ---------------- профиль пары ---------------- */
      case 'couple': {
        const pid = String(body.partnerId || (me.partners || [])[0] || '');
        if (!pid || !(me.partners || []).includes(pid)) return json({ ok: false, error: 'Партнёр не найден' }, 404);
        const partner = await getUser(pid);
        const catalogAll = await getCatalogAll();
        const cs = await coupleStats(me.id, pid, catalogAll);
        const key = 'c:' + [me.id, pid].sort().join('|');
        const earned = expandEarned(await getEarned(key));
        const manual = (await getEarned('mc:' + key)).map((x) => x);
        const matches = await getPairMatches(me.id, pid);
        const genreCount = {};
        matches.forEach((m) => (m.genres || []).forEach((g) => { genreCount[g] = (genreCount[g] || 0) + 1; }));
        const topGenre = Object.entries(genreCount).sort((a, b) => b[1] - a[1])[0];
        return json({
          ok: true,
          partner: partner ? pub(partner) : null,
          stats: cs,
          badges: earned.concat(manual),
          topGenre: topGenre ? topGenre[0] : null,
          watched: matches.filter((m) => m.watched).slice(0, 12),
          since: partner && partner.created ? partner.created : null,
        });
      }

      /* ---------------- награды и топы ---------------- */
      case 'badges': {
        return json({ ok: true, catalog: BADGES, ...(await myBadges(me, true)) });
      }

      /* ---------------- личный стоп-лист ---------------- */
      case 'stop.add': {
        const list = await getStop(me.id);
        if (body.id) { const fid = await canonFilmId(body.id); if (!list.films.includes(fid)) list.films.push(fid); }
        if (body.genre) { if (!list.genres.includes(body.genre)) list.genres.push(String(body.genre)); }
        await setStop(me.id, list);
        await bumpCoUsers(me);   // стоп-лист учитывается в общей колоде пары
        return json({ ok: true, stop: list });
      }
      case 'stop.remove': {
        const list = await getStop(me.id);
        if (body.id) {
          const fid = await canonFilmId(body.id);
          // убираем и канон, и возможный старый дубль-псевдоним
          list.films = list.films.filter((x) => String(x) !== fid && String(x) !== String(body.id));
        }
        if (body.genre) list.genres = list.genres.filter((x) => x !== String(body.genre));
        await setStop(me.id, list);
        await bumpCoUsers(me);
        return json({ ok: true, stop: list });
      }

      /* ---------------- свои подборки пользователя ----------------
         Личные наборы фильмов: «наше с Настей», «на новогодние».
         В отличие от админских подборок, видны только владельцу. */
      case 'ucol.save': {
        const r = await ucolSave(me.id, body);
        return json(r, r.ok ? 200 : 400);
      }
      case 'ucol.delete': {
        const r = await ucolDelete(me.id, body.id);
        return json(r);
      }
      case 'ucol.add': {
        const r = await ucolAddFilm(me.id, body.filmId, { colId: body.colId, title: body.title, emoji: body.emoji });
        return json(r, r.ok ? 200 : 400);
      }
      case 'ucol.remove': {
        const r = await ucolRemoveFilm(me.id, body.colId, body.filmId);
        return json(r, r.ok ? 200 : 400);
      }

      /* ---------------- журнал свайпов ---------------- */
      case 'journal': {
        const ALL = await getCatalogAll();
        const myVotes = await getVotes(me.id);
        const log = await getSwlog(me.id, Number(body.limit) || 60);
        return json({
          ok: true,
          items: log.map((e) => {
            const c = ALL[e.id] || {};
            return { id: e.id, v: e.v, t: e.t, title: c.t || e.id, year: c.y || null, type: c.tp || 'movie', poster: c.p || null, rating: c.r || null, voted: myVotes[e.id] ?? null };
          }),
        });
      }

      /* ---------------- обратная связь ---------------- */
      case 'feedback.send': {
        const text = String(body.text || '').trim();
        if (text.length < 3) return json({ ok: false, error: 'Напишите чуть подробнее (хотя бы пару слов)' }, 400);
        const kind = ['bug', 'idea', 'other'].includes(String(body.kind)) ? String(body.kind) : 'other';
        const contact = String(body.contact || '').trim().slice(0, 120);
        // защита от спама: не чаще одного сообщения в минуту
        const lastFb = Number(await db().get('fb:last:' + me.id) || 0);
        if (Date.now() - lastFb < 60000) return json({ ok: false, error: 'Слишком часто — подождите минуту и отправьте снова' }, 429);
        const rec = await pushFeedback({
          uid: me.id, name: me.first_name || '', username: me.username || '',
          kind, contact, text,
        });
        await db().set('fb:last:' + me.id, String(Date.now()));
        await trackDaily('feedback');
        // мгновенное уведомление админу в Telegram, если задан чат в настройках
        const st = await getSettings();
        if (st.notifyChat) {
          const KIND_LABEL = { bug: '🐞 Ошибка', idea: '💡 Идея', other: '✍️ Сообщение' };
          const who = `${me.first_name || 'пользователь'}${me.username ? ' (@' + me.username + ')' : ''} · id ${me.id}`;
          await tg('sendMessage', {
            chat_id: st.notifyChat, parse_mode: 'HTML',
            text: `${KIND_LABEL[kind]} <b>Обратная связь</b>\n\n${esc(text.slice(0, 1500))}\n\nОт: ${esc(who)}${contact ? '\nКонтакт: ' + esc(contact) : ''}\n\n<i>Ответить: кнопка ниже (прямо из Telegram) или админка → «Обратная связь»</i>`,
            // «✍️ Ответить» — бот спросит текст ответа и отправит его пользователю
            reply_markup: { inline_keyboard: [[{ text: '✍️ Ответить', callback_data: 'fbr:' + rec.id }]] },
          }, cfg.token).catch(() => {});
        }
        return json({ ok: true, id: rec.id });
      }

      /* ---------------- анонс «что нового» показан ---------------- */
      case 'announceSeen': {
        await markSeen(me.id, String(body.id || ''));
        return json({ ok: true });
      }

      /* ---------------- код для входа с компьютера ---------------- */
      case 'webcode': {
        return json({ ok: true, code: await createWebCode(me.id) });
      }

      /* ---------------- заявка в партнёры по коду ---------------- */
      case 'pair': {
        const r = await startPairing(me, body.code);
        if (!r.ok) return json({ ok: false, error: r.error, already: !!r.already });
        const site = siteUrl(req);
        if (r.linked) {
          await notifyPaired(cfg.token, me, r.partner, site);
          await bumpPairRev(me.id, r.partner.id);
          return json({ ok: true, linked: true, partner: pub(r.partner) });
        }
        if (!r.duplicate) await notifyPreq(cfg.token, me, r.partner, site);
        await bumpPairRev(me.id, r.partner.id);
        return json({ ok: true, request: true, duplicate: !!r.duplicate, partner: pub(r.partner) });
      }

      /* ---------------- поиск людей: найти и отправить заявку ----------------
         Показываем только открытые сведения (имя, @username, код) — те же,
         что человек видит в заявках. Себя, забаненных не выдаём. */
      case 'users.find': {
        const q = String(body.q || '').trim().toLowerCase().replace(/^@/, '');
        if (q.length < 2) return json({ ok: true, items: [] });
        const ids = await allUserIds();
        const mine = await getPreqs(me.id);
        const found = [];
        for (const id of ids) {
          if (found.length >= 15) break;
          if (String(id) === String(me.id)) continue;
          if (await isBanned(id)) continue;
          const u = await getUser(id);
          if (!u) continue;
          const name = [u.first_name, u.last_name].filter(Boolean).join(' ').toLowerCase();
          const uname = String(u.username || '').toLowerCase();
          const code = String(u.code || '').toLowerCase();
          let score = -1;
          if (code && code === q) score = 0;
          else if (uname && uname === q) score = 1;
          else if (uname && uname.startsWith(q)) score = 2;
          else if (name.startsWith(q)) score = 3;
          else if (name.includes(q) || uname.includes(q) || code.includes(q)) score = 4;
          if (score < 0) continue;
          let status = 'ok';
          if ((me.partners || []).includes(id)) status = 'partner';
          else if (mine.out.some((r) => r.to === id)) status = 'sent';
          else if (mine.in.some((r) => r.from === id)) status = 'incoming';
          found.push({
            score,
            item: {
              id: u.id, first_name: u.first_name || '', last_name: u.last_name || '',
              username: u.username || '', code: u.code || '', photo_url: u.photo_url || null,
              status,
            },
          });
        }
        found.sort((a, b) => a.score - b.score);
        return json({ ok: true, items: found.map((f) => f.item) });
      }

      /* ---------------- заявка в партнёры найденному человеку ---------------- */
      case 'preq.send': {
        const uid = String(body.userId || '');
        if (!uid) return json({ ok: false, error: 'Не указан пользователь' }, 400);
        if (uid === String(me.id)) return json({ ok: false, error: 'Это же вы сами 🙂' });
        const other = await getUser(uid);
        if (!other) return json({ ok: false, error: 'Пользователь не найден' }, 404);
        if (await isBanned(uid)) return json({ ok: false, error: 'Пользователь недоступен' }, 403);
        const r = await requestPairing(me, other);
        if (!r.ok) return json({ ok: false, error: r.error, already: !!r.already });
        const site = siteUrl(req);
        if (r.linked) {
          await notifyPaired(cfg.token, me, r.partner, site);
          await bumpPairRev(me.id, r.partner.id);
          return json({ ok: true, linked: true, partner: pub(r.partner) });
        }
        if (!r.duplicate) await notifyPreq(cfg.token, me, r.partner, site);
        await bumpPairRev(me.id, r.partner.id);
        return json({ ok: true, request: true, duplicate: !!r.duplicate, partner: pub(r.partner) });
      }

      /* ---------------- принять / отклонить заявку ---------------- */
      case 'preq.accept': {
        const fromId = String(body.fromId || '');
        const reqs = await getPreqs(me.id);
        if (!reqs.in.some((r) => r.from === fromId)) return json({ ok: false, error: 'Заявка не найдена или истекла' }, 404);
        const from = await getUser(fromId);
        if (!from) { await removePreq(fromId, me.id); return json({ ok: false, error: 'Пользователь не найден' }, 404); }
        if ((me.partners || []).includes(fromId)) {
          await removePreq(fromId, me.id);
          return json({ ok: false, error: 'Вы уже партнёры' });
        }
        const ar = await addPartner(me.id, fromId);
        if (!ar.ok) return json({ ok: false, error: ar.error });
        await removePreq(fromId, me.id);
        await notifyPaired(cfg.token, me, from, siteUrl(req));
        await bumpPairRev(me.id, fromId);
        return json({ ok: true, partner: pub(from) });
      }
      case 'preq.decline': {
        const fromId = String(body.fromId || '');
        const reqs = await getPreqs(me.id);
        if (!reqs.in.some((r) => r.from === fromId)) return json({ ok: false, error: 'Заявка не найдена или истекла' }, 404);
        await removePreq(fromId, me.id);
        const from = await getUser(fromId);
        await notifyDeclined(cfg.token, me, from);
        await bumpPairRev(me.id, fromId);
        return json({ ok: true });
      }

      /* ---------------- группы (3+ человек) ---------------- */
      case 'group.create': {
        const r = await createGroup(me.id, body.title);
        if (!r.ok) return json(r, 400);
        return json({ ok: true, groups: await groupList(me.id), group: r.group });
      }
      case 'group.join': {
        const r = await joinGroupByCode(me.id, body.code);
        if (!r.ok) return json(r, 400);
        if (r.joined) {
          // уведомляем остальных участников и поднимаем им rev (колода изменилась)
          for (const uid of (r.group.members || [])) {
            if (String(uid) === String(me.id)) continue;
            await bumpRev(uid);
            await notifyUser(uid, 'group', {
              parse_mode: 'HTML',
              text: `🎭 <b>${esc(me.first_name || 'Новый участник')}</b> присоединился к группе «${esc(r.group.title)}»`,
            }, cfg.token).catch(() => {});
          }
        }
        return json({ ok: true, already: !!r.already, joined: !!r.joined, groups: await groupList(me.id), group: r.group });
      }
      case 'group.leave': {
        const gid = String(body.groupId || '');
        const before = await getGroup(gid);
        const r = await leaveGroup(me.id, gid);
        if (!r.ok) return json(r, 400);
        if (before) {
          for (const uid of (before.members || [])) {
            if (String(uid) !== String(me.id)) await bumpRev(uid);
          }
        }
        return json({ ok: true, groups: await groupList(me.id) });
      }

      /* ---------------- рефералы ----------------
         Засчитываем приглашение один раз и только «свежему» пользователю:
         если аккаунт создан больше 10 минут назад — значит, человек давно
         с нами, ссылка просто открыла приложение. */
      case 'ref.track': {
        const fresh = Date.now() - (Number(me.created) || 0) < 10 * 60e3;
        const referrer = fresh ? await trackReferral(me, String(body.refId || '')) : null;
        if (referrer) {
          await bumpRev(referrer.id);
          await notifyUser(referrer.id, 'admin', {
            parse_mode: 'HTML',
            text: `🎉 <b>По вашей ссылке пришёл ${esc(me.first_name || 'друг')}!</b>\n\n`
              + `Приглашайте ещё: за 3 и 10 друзей дают награды 🏆`,
          }, cfg.token).catch(() => {});
        }
        return json({ ok: true, credited: !!referrer, refs: await refInfo(me.id) });
      }

      /* ---------------- профиль партнёра ----------------
         Только для своих партнёров: статистика, вкус, общие награды и
         что вы уже посмотрели вместе. */
      case 'partner.profile': {
        const pid = String(body.partnerId || '');
        if (!(me.partners || []).includes(pid)) return json({ ok: false, error: 'Это не ваш партнёр' }, 403);
        const pu = await getUser(pid);
        if (!pu) return json({ ok: false, error: 'Пользователь не найден' }, 404);
        const ALL = await getCatalogAll();
        const stats = await userStats(pid);
        const cs = await coupleStats(me.id, pid, ALL);
        const prefs = (await getPrefs(pid)).genres;
        // любимый жанр партнёра — по его лайкам
        const pvotes = await getVotes(pid);
        const gcount = {};
        for (const fid of Object.keys(pvotes)) {
          if (pvotes[fid] !== 1) continue;
          for (const g of ((ALL[fid] || {}).g || [])) gcount[g] = (gcount[g] || 0) + 1;
        }
        const topGenres = Object.entries(gcount).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([g]) => g);
        const pm = await getPairMatches(me.id, pid);
        const gc = {};
        pm.forEach((m) => (m.genres || []).forEach((g) => { gc[g] = (gc[g] || 0) + 1; }));
        const topShared = Object.entries(gc).sort((a, b) => b[1] - a[1])[0];
        const badges = expandEarned(await getEarned('u:' + pid));
        return json({
          ok: true,
          user: Object.assign(pub(pu), { created: pu.created || null, lastSeen: pu.lastSeen || null }),
          stats,
          prefs,
          topGenres,
          couple: cs,
          topSharedGenre: topShared ? topShared[0] : null,
          badges: badges.slice(-14),
          watched: pm.filter((m) => m.watched).slice(0, 10).map((m) => ({
            id: m.id, mid: matchMid(m), title: m.title, year: m.year, poster: m.poster, scores: m.scores || {},
          })),
        });
      }

      /* ---------------- ревизия: сверхдешёвый поллинг real-time ----------------
         Одно чтение из хранилища и два числа в ответе. Клиент опрашивает его
         каждые несколько секунд и делает полный sync только когда rev изменился:
         задержка падает с 15 с до ~3 с, а тяжёлые запросы идут редко. */
      case 'rev': {
        return json({ ok: true, rev: await getRev(me.id), now: Date.now() });
      }

      /* ---------------- лёгкий поллинг: всё обновляется «вживую» ---------------- */
      case 'sync': {
        const partners = [];
        for (const pid of (me.partners || [])) {
          const pu = await getUser(pid);
          if (pu) partners.push(Object.assign(pub(pu), { prefs: (await getPrefs(pid)).genres }));
        }
        const [all, collections, pseen, pv, gv, groups, ps, gs] = await Promise.all([
          getMatches(me.id), getCollections(), partnerSeen(me), partnersVoted(me),
          groupsVoted(me.id), groupList(me.id), partnerStops(me), groupStops(me.id),
        ]);
        return json({
          ok: true,
          partners,
          requests: await preqList(me.id, 'in'),
          sent: await preqList(me.id, 'out'),
          matches: all,
          collections,
          ucols: await getUserCols(me.id),
          pseen,
          groups,
          // полный список голосов партнёра тяжёлый, поэтому в поллинге отдаём
          // только подпись: изменилась — клиент сам запросит hello заново
          pvSig: pvSignature(pv) + '|' + gvSignature(gv) + '|' + stopsSig(ps, gs),
          nights: await activeNights(me),
          rev: await getRev(me.id),
        });
      }

      /* ---------------- «что посмотреть вдвоём» сегодня ---------------- */
      case 'tonight': {
        return json({ ok: true, items: await suggestTonight(me.id) });
      }

      /* ---------------- настройки уведомлений ----------------
         Человек сам решает, что ему присылать. Кнопка «🔕 Не беспокоить»
         под любым уведомлением и /silent в боте дёргают то же действие. */
      case 'notif.get': {
        return json({ ok: true, notifs: await getNotifPrefs(me.id) });
      }
      case 'notif.set': {
        const patchN = {};
        for (const k of NOTIF_KINDS) if (body[k] != null) patchN[k] = !!body[k];
        if (body.quietFrom != null) patchN.quietFrom = String(body.quietFrom);
        if (body.quietTo != null) patchN.quietTo = String(body.quietTo);
        /* Пауза — это просто muteUntil, а не отдельная операция.
           Раньше здесь был ранний `return`, и вместе с паузой молча
           выбрасывались ВСЕ остальные изменения из того же запроса:
           человек выключал тип уведомлений, ставил тихие часы и паузу —
           а сохранялась только пауза. */
        if (body.muteDays != null) {
          const days = Math.max(0, Math.min(30, Number(body.muteDays) || 0));
          patchN.muteUntil = days ? Date.now() + days * 86400e3 : 0;
        } else if (body.muteUntil != null) {
          patchN.muteUntil = Math.max(0, Number(body.muteUntil) || 0);
        }
        const notifs = await setNotifPrefs(me.id, patchN);
        return json({ ok: true, notifs });
      }

      /* ---------------- «какой сегодня вечер?» ----------------
         Один вопрос обоим перед свайпами. Ответ влияет на то, какие жанры
         поднимаются в колоде дня; сам день при этом остаётся общим. */
      case 'mood.set': {
        const mood = await setMood(me.id, String(body.mood || ''));
        if (mood && mood.error) return json({ ok: false, error: mood.error }, 400);
        await bumpCoUsers(me);   // партнёр должен увидеть, что вечер выбран
        return json({ ok: true, evening: mood });
      }
      case 'mood.clear': {
        const mood = await setMood(me.id, '');
        await bumpCoUsers(me);
        return json({ ok: true, evening: mood });
      }

      /* ---------------- игры с партнёром ---------------- */
      case 'game.state': {
        return json(Object.assign({ ok: true }, await gameState(me.id)));
      }
      case 'game.guess': {
        return json(await gameGuess(me.id, String(body.filmId || ''), body.guess, siteUrl(req), cfg.token));
      }
      case 'game.duel': {
        return json(await gameDuel(me.id, siteUrl(req), cfg.token));
      }
      case 'game.duelVote': {
        const r = await gameDuelVerdict(me.id, body.verdict);
        if (r.ok) await bumpCoUsers(me);   // партнёр сразу видит, что ответ готов
        return json(r);
      }
      case 'game.nextGuess': {
        return json(await gameNextGuess(me.id));
      }

      /* ---------------- колода дня ----------------
         Те же карточки, что у партнёра сегодня: клиент кладёт их в начало
         своей личной колоды, поэтому мэтчи случаются регулярно, но свайп
         одного по-прежнему не перелистывает карточку у второго. */
      case 'daily': {
        return json(Object.assign({ ok: true }, await buildDailyDeck(me.id, { me }) || {}));
      }

      /* ---------------- кино-вечер: «планируем смотреть сегодня» ---------------- */
      case 'night.set': {
        const pid = String(body.partnerId || (me.partners || [])[0] || '');
        if (!pid || !(me.partners || []).includes(pid)) return json({ ok: false, error: 'Партнёр не найден' }, 404);
        const mid = String(body.mid || '');
        let title = String(body.title || '').slice(0, 120);
        if (!title && mid) {
          const m = (await getMatches(me.id)).find((x) => matchMid(x) === mid);
          if (m) title = m.title || '';
        }
        const rec = { by: String(me.id), byName: me.first_name || '', ts: Date.now(), date: dayStr(), title, mid: mid || null };
        await setNight(me.id, pid, rec);
        // уведомляем партнёра в боте — не чаще раза в день на инициатора
        let notified = false;
        const nkey = `nnot:${pairKey(me.id, pid)}:${rec.date}:${me.id}`;
        if (await once(nkey)) notified = await notifyNight(cfg.token, me, pid, title, siteUrl(req));
        await bumpPairRev(me.id, pid);
        return json({ ok: true, night: Object.assign({ partnerId: pid }, rec), notified });
      }
      case 'night.clear': {
        const pid = String(body.partnerId || (me.partners || [])[0] || '');
        if (!pid || !(me.partners || []).includes(pid)) return json({ ok: false, error: 'Партнёр не найден' }, 404);
        await clearNight(me.id, pid);
        await bumpPairRev(me.id, pid);
        return json({ ok: true, night: null });
      }

      /* ---------------- предпочтения по жанрам ----------------
         onboarded: true приходит со стартового экрана «Что вам нравится?» —
         больше этот экран человеку не показываем. */
      case 'prefs.set': {
        const patchPrefs = {};
        if (body.genres != null) patchPrefs.genres = body.genres;
        if (body.onboarded != null) patchPrefs.onboarded = !!body.onboarded;
        const prefs = await setPrefs(me.id, patchPrefs);
        await bumpCoUsers(me);   // вкусы учитываются в колоде группы
        return json({ ok: true, prefs });
      }

      /* ---------------- разорвать пару ---------------- */
      case 'unpair': {
        const target = body.partnerId ? String(body.partnerId) : null;
        const list = target ? [target] : (me.partners || []).slice();
        for (const pid of list) await removePartner(me.id, pid);
        // оба клиента должны сразу пересобрать колоду и список партнёров
        for (const pid of list) await bumpPairRev(me.id, pid);
        await bumpCoUsers(me);
        // помечаем, что связь разорвана осознанно: ничего не должно связать обратно
        const fresh = await getUser(me.id);
        fresh.noAuto = true;
        await saveUser(fresh);
        for (const pid of list) {
          const other = await getUser(pid);
          if (other) { other.noAuto = true; await saveUser(other); }
        }
        return json({ ok: true, removed: list });
      }

      /* ---------------- сброс ---------------- */
      case 'reset': {
        await setVotes(me.id, {});
        await clearSwlog(me.id); // журнал очищаем вместе с оценками
        await removeAllMatchesFor(me.id);
        await bumpCoUsers(me);   // у партнёров меняются общие колоды и мэтчи
        return json({ ok: true, votes: {}, matches: [] });
      }

      default:
        return json({ ok: false, error: 'Неизвестное действие: ' + action }, 400);
    }
  } catch (e) {
    console.error('api error', e);
    return json({ ok: false, error: 'Внутренняя ошибка: ' + (e && e.message ? e.message : 'unknown') }, 500);
  }
}

async function myBadges(me, withStats) {
  const personal = expandEarned(await getEarned('u:' + me.id));
  const personalManual = (await getEarned('m:' + me.id)).map((x) => x);
  const couples = [];
  for (const pid of (me.partners || [])) {
    const key = 'c:' + [me.id, pid].sort().join('|');
    const pu = await getUser(pid);
    const cp = {
      partnerId: pid,
      partnerName: pu ? pu.first_name : pid,
      badges: expandEarned(await getEarned(key)).concat(await getEarned('mc:' + key)),
    };
    if (withStats) {
      const cs = await coupleStats(me.id, pid, await getCatalogAll());
      cp.stats = cs;
      cp.progress = {};
      for (const b of BADGES) if (b.scope === 'couple') { const pr = badgeProgress(b.id, cs); if (pr) cp.progress[b.id] = pr; }
    }
    couples.push(cp);
  }
  const lb = await leaderboard();
  const out = { personal: personal.concat(personalManual), couples, leaderboard: lb };
  if (withStats) {
    const us = await userStats(me.id);
    out.stats = us;
    out.progress = {};
    for (const b of BADGES) if (b.scope === 'user') { const pr = badgeProgress(b.id, us); if (pr) out.progress[b.id] = pr; }
  }
  return out;
}

async function leaderboard() {
  const ids = await allUserIds();
  const users = [];
  for (const id of ids) {
    const u = await getUser(id);
    if (!u) continue;
    const earned = (await getEarned('u:' + id)).length + (await getEarned('m:' + id)).length;
    const st = await userStats(id);
    users.push({ id, name: u.first_name || id, username: u.username || '', badges: earned, likes: st.likes, matches: st.matches, watched: st.watched });
  }
  users.sort((a, b) => b.badges - a.badges || b.matches - a.matches);
  const pairs = [];
  for (const [a, b] of await allPairs()) {
    const ua = await getUser(a), ub = await getUser(b);
    const earned = (await getEarned('c:' + [a, b].sort().join('|'))).length + (await getEarned('mc:' + [a, b].sort().join('|'))).length;
    pairs.push({ a, b, name: `${ua ? ua.first_name : a} + ${ub ? ub.first_name : b}`, badges: earned });
  }
  pairs.sort((x, y) => y.badges - x.badges);
  return { users: users.slice(0, 15), pairs: pairs.slice(0, 15) };
}

/* ---------- награды: пересчёт, сохранение, уведомление ---------- */
const bid = (x) => (typeof x === 'string' ? x : x.id);

async function syncBadges(me, cfg) {
  const catalogAll = await getCatalogAll();
  const fresh = [];
  try {
    const us = await userStats(me.id);
    const earnedP = computePersonal(us);
    const storedP = await getEarned('u:' + me.id);
    const haveP = storedP.map(bid);
    const newP = earnedP.filter((b) => !haveP.includes(b));
    if (newP.length) await setEarned('u:' + me.id, storedP.concat(newP.map((id) => ({ id, ts: Date.now() }))));
    newP.forEach((b) => fresh.push({ badge: b, scope: 'user' }));

    for (const pid of (me.partners || [])) {
      const cs = await coupleStats(me.id, pid, catalogAll);
      const earnedC = computeCouple(cs);
      const key = 'c:' + [me.id, pid].sort().join('|');
      const storedC = await getEarned(key);
      const haveC = storedC.map(bid);
      const newC = earnedC.filter((b) => !haveC.includes(b));
      if (newC.length) await setEarned(key, storedC.concat(newC.map((id) => ({ id, ts: Date.now() }))));
      newC.forEach((b) => fresh.push({ badge: b, scope: 'couple', partnerId: pid }));
    }
    for (const f of fresh) {
      const b = badgeById(f.badge);
      const line = b ? `${b.icon} <b>${esc(b.title)}</b> — ${esc(b.desc)}` : String(f.badge);
      const targets = f.scope === 'couple' ? [me.id, f.partnerId] : [me.id];
      for (const uid of targets) {
        if (!uid) continue;
        const key = f.scope === 'couple'
          ? `bnot:c:${[me.id, f.partnerId].sort().join('|')}:${f.badge}:${uid}`
          : `bnot:u:${uid}:${f.badge}`;
        if (!(await once(key))) continue; // защита от дублей
        await withTimeout(tg('sendMessage', {
          chat_id: uid, parse_mode: 'HTML',
          text: `🏆 <b>Новая награда!</b>\n\n${line}${f.scope === 'couple' ? '\n<span class="dim">(парная награда)</span>' : ''}\n\nТак держать 🎬`,
        }, cfg.token), 5000).catch(() => {});
      }
    }
  } catch (e) { console.warn('badges', e && e.message); }
  return fresh.map((f) => Object.assign({}, f, { meta: badgeById(f.badge) || null }));
}

/* ---------- вспомогательное ---------- */
function withTimeout(promise, ms) {
  let t;
  return Promise.race([
    promise.finally(() => clearTimeout(t)),
    new Promise((_, rej) => { t = setTimeout(() => rej(new Error('timeout ' + ms + 'ms')), ms); }),
  ]);
}

function pub(u) {
  return {
    id: u.id, code: u.code, first_name: u.first_name, last_name: u.last_name,
    username: u.username, photo_url: u.photo_url, partners: u.partners || [],
  };
}

/* ---------- группы: компактный список для клиента ---------- */
async function groupList(uid) {
  const out = [];
  for (const g of await userGroups(uid)) {
    const members = [];
    for (const mid of (g.members || [])) {
      const mu = await getUser(mid);
      // prefs участника нужны общей колоде группы: любимые жанры у всех одинаковые
      const prefs = (await getPrefs(mid)).genres;
      if (mu) members.push({ id: mu.id, first_name: mu.first_name || '', photo_url: mu.photo_url || null, prefs });
      else members.push({ id: mid, first_name: '', photo_url: null, prefs });
    }
    out.push({ id: g.id, code: g.code, title: g.title, members, createdBy: g.createdBy || null });
  }
  return out;
}

/* ---------- рефералы: сколько и кого пригласил ---------- */
async function refInfo(uid) {
  const list = await getRefs(uid);
  return { count: list.length, names: list.slice(-8).reverse().map((x) => x.name || 'друг') };
}

/* ---------- уведомление о групповом мэтче ---------- */
async function notifyGroupMatch(token, m, site) {
  const names = [];
  for (const uid of (m.by || [])) {
    const u = await getUser(uid);
    if (u) names.push(u.first_name || 'участник');
  }
  const kb = site
    ? { inline_keyboard: [
        [{ text: '🍿 Открыть приложение', web_app: { url: site + '/?startapp=matches' } }],
        [{ text: '🔕 Не беспокоить', callback_data: 'mute:7' }],
      ] }
    : { inline_keyboard: [[{ text: '🔕 Не беспокоить', callback_data: 'mute:7' }]] };
  for (const uid of (m.by || [])) {
    if (!(await canNotify(uid, 'group'))) continue;
    if (!(await once('gmnot:' + matchMid(m) + ':' + uid))) continue; // не шлём повторно
    await tg('sendMessage', {
      chat_id: uid, parse_mode: 'HTML', reply_markup: kb,
      text: `🎭 <b>ГРУППОВОЙ МЭТЧ!</b>\n\n`
        + `Все участники группы <b>«${esc(m.groupTitle || '')}»</b>${names.length ? ` (${esc(names.join(', '))})` : ''} лайкнули:\n`
        + `<b>«${esc(m.title || '')}»</b> (${m.year || '—'})\n${esc(ratingLine(m) || '')}\n\n`
        + `Договаривайтесь и смотрите вместе 🍿`,
    }, token).catch((e) => console.warn('notifyGroupMatch', e && e.message));
  }
}

async function notifyMatch(token, m, a, b, site) {
  const st = await getSettings();
  const defaultTpl =
    '🎬💘 <b>МЭТЧ!</b>\n\n'
    + 'Вы и {partner} хотите посмотреть:\n'
    + '<b>«{title}»</b> ({year})\n'
    + '{rating}\n\n'
    + 'Осталось выбрать вечер 🍿';
  const tpl = (st.texts && st.texts.match) ? st.texts.match : defaultTpl;
  /* Кнопки под уведомлением о мэтче: весь цикл закрывается прямо в чате —
     отметили просмотр, поставили оценку, убрали, открыли карточку в приложении,
     заглушили пуши. web_app, а не url: только так приложение откроется
     с вашей сессией Telegram. */
  const rows = [
    [
      { text: '✅ Посмотрели', callback_data: 'watched:' + m.id },
      { text: '⭐ Оценить', callback_data: 'rateask:' + m.id },
    ],
    [
      // deep-link на карточку фильма: открывает приложение сразу на нём
      ...(site ? [{ text: '🎬 Открыть карточку', web_app: { url: site + '/?startapp=film_' + encodeURIComponent(m.id) } }] : []),
      { text: '✖️ Убрать', callback_data: 'drop:' + m.id },
    ],
    [
      ...(site ? [{ text: '🍿 Мои мэтчи', web_app: { url: site + '/?startapp=matches' } }] : []),
      // одна кнопка глушит ВСЕ пуши на неделю — человек не отписывается от бота
      { text: '🔕 Не беспокоить', callback_data: 'mute:7' },
    ],
  ];
  const kb = { inline_keyboard: rows.map((row) => row.filter((b) => b && (b.web_app || b.callback_data))).filter((row) => row.length) };
  const targets = [a, b].filter(Boolean);
  for (const u of targets) {
    /* Настройки уведомлений проверяются ДО once(): если человек выключил
       мэтчи, метка «уже уведомлён» не ставится — иначе после включения
       он бы не получил ничего никогда. (Раньше порядок был обратный, и
       метка сгорала впустую — ровно то, от чего предупреждает комментарий.) */
    if (!(await canNotify(u.id, 'match'))) continue;
    if (!(await once('mnot:' + matchMid(m) + ':' + u.id))) continue; // не шлём повторно
    // Текст собираем ВНУТРИ цикла: в {partner} должно попадать имя ВТОРОГО человека.
    // Раньше caption был один на всех и подставлялось всегда имя `b`, из-за чего
    // второй участник получал уведомление со своим собственным именем.
    const other = (a && String(u.id) === String(a.id)) ? b : a;
    const caption = fillTemplate(tpl, {
      title: esc(m.title || ''),
      year: m.year || '—',
      rating: esc(ratingLine(m) || ''),
      partner: esc((other && other.first_name) || 'партнёр'),
    });
    let sent = false;
    if (m.poster) {
      const r = await tg('sendPhoto', {
        chat_id: u.id, photo: m.poster, caption, parse_mode: 'HTML',
        reply_markup: kb, disable_notification: false,
      }, token);
      sent = !!r.ok;
      if (!r.ok && !/bot was blocked|user is deactivated|chat not found/i.test(String(r.description || ''))) {
        console.warn('sendPhoto failed', r.description);
      }
    }
    if (!sent) {
      await tg('sendMessage', { chat_id: u.id, text: caption, parse_mode: 'HTML', reply_markup: kb }, token);
    }
  }
}

/* ---------- заявки и live: уведомления в бот ---------- */
async function preqList(userId, dir) {
  const reqs = await getPreqs(userId);
  const out = [];
  for (const r of (dir === 'in' ? reqs.in : reqs.out)) {
    const u = await getUser(dir === 'in' ? r.from : r.to);
    if (u) out.push({ user: pub(u), ts: r.ts });
  }
  return out;
}

function webKb(text, url) {
  return { inline_keyboard: [[{ text, web_app: { url } }]] };
}
/* Клавиатура с приложением + кнопка «заглушить пуши на неделю».
   Она есть под каждым уведомлением: человек должен иметь способ
   перестать получать сообщения, НЕ отписываясь от бота. */
function webKbMute(text, url) {
  return { inline_keyboard: [
    [{ text, web_app: { url } }],
    [{ text: '🔕 Не беспокоить', callback_data: 'mute:7' }],
  ] };
}

async function notifyPreq(token, from, to, site) {
  if (!(await canNotify(to.id, 'req'))) return false;
  await withTimeout(notifyUser(to.id, 'req', {
    parse_mode: 'HTML',
    text: `💌 <b>Заявка в партнёры</b>\n\n`
      + `<b>${esc(from.first_name || 'Кто-то')}</b> хочет свайпать кино вместе с вами.\n\n`
      + `Откройте приложение — там можно принять или отклонить заявку.`,
    reply_markup: webKbMute('📱 Открыть приложение', site + '/?startapp=preq'),
  }, token), 8000).catch((e) => { console.warn('notifyPreq', e && e.message); return false; });
  return true;
}

async function notifyPaired(token, a, b, site) {
  const kb = webKbMute('🎬 Открыть приложение', site + '/');
  for (const [u, other] of [[a, b], [b, a]]) {
    if (!u) continue;
    if (!(await canNotify(u.id, 'req'))) continue;
    await withTimeout(notifyUser(u.id, 'req', {
      parse_mode: 'HTML',
      text: `💞 <b>Вы теперь партнёры!</b>\n\n`
        + `Вы и <b>${esc((other && other.first_name) || 'партнёр')}</b> теперь свайпаете кино вместе.\n`
        + `Когда оба нажмёте ❤️ на одном фильме — случится мэтч. Удачного вечера 🍿`,
      reply_markup: kb,
    }, token), 8000).catch(() => {});
  }
}

async function notifyDeclined(token, me, other) {
  if (!other) return;
  await withTimeout(notifyUser(other.id, 'req', {
    parse_mode: 'HTML',
    text: `😔 <b>${esc(me.first_name || 'Партнёр')}</b> отклонил(а) вашу заявку в партнёры.`,
  }, token), 8000).catch(() => {});
}

async function notifyNight(token, me, pid, title, site) {
  if (!(await canNotify(pid, 'night'))) return false;
  const r = await withTimeout(notifyUser(pid, 'night', {
    parse_mode: 'HTML',
    text: `🍿 <b>Кино-вечер сегодня!</b>\n\n`
      + `<b>${esc(me.first_name || 'Партнёр')}</b> планирует сегодня вечером смотреть кино вместе.`
      + (title ? `\nНаметили: <b>«${esc(title)}»</b>.` : '')
      + `\n\nОткройте приложение — там можно выбрать фильм вдвоём 🎬`,
    reply_markup: webKbMute('🍿 Открыть приложение', site + '/?startapp=matches'),
  }, token), 8000).catch((e) => { console.warn('notifyNight', e && e.message); return null; });
  return !!(r && r.ok);
}

/* ---------- активные кино-вечера (только сегодняшние) ---------- */
async function activeNights(me) {
  const out = [];
  const today = dayStr();
  for (const pid of (me.partners || [])) {
    const n = await getNight(me.id, pid);
    if (n && n.date === today) out.push(Object.assign({ partnerId: pid }, n));
  }
  return out;
}
