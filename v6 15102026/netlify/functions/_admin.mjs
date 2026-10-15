// Администраторские действия. Вызываются из api.mjs после проверки админ-сессии.
import { readFileSync } from 'node:fs';
import {
  db,
  tg,
  getUser,
  getUserCols,
  saveUserCols,
  allUserIds,
  getVotes,
  setVotes,
  getMatches,
  setMatches,
  saveUser,
  removePartner,
  getHidden,
  toggleHidden,
  getSettings,
  setSettings,
  runSetup,
  adminSetPassword,
  adminHasPassword,
  verifyAdminSession,
  esc,
  getCustomFilms,
  saveCustomFilms,
  setBanned,
  isBanned,
  getEarned,
  setEarned,
  userStats,
  allPairs,
  setHidden,
  getCatalogAll,
  matchMid,
  findMatch,
  getAnnounce,
  setAnnounce,
  FRIEND_BTN,
  BTN_MATCHES,
  BTN_BADGES,
  BTN_PARTNERS,
  BTN_HELP,
  getBroadcastLog,
  pushBroadcastLog,
  getDynamicFilms,
  saveDynamicFilms,
  getDailySeries,
  getCardEdits,
  setCardEdits,
  getCollections,
  saveCollections,
  getFeedback,
  saveFeedback,
  sendFeedbackReply,
  signPreview,
  getSwlog,
  getStop,
  setStop,
  coupleStats,
  addPartner,
  getPrefs,
  setPrefs,
  getNight,
  getUserActivity,
  getDailyRaw,
  SOURCE_LABEL,
  // новое: авто-подборки, предпросмотр колоды, слияние дублей, глобальный поиск
  buildDeckPreview,
  getPairMatches,
  userGroups,
  saveGroup,
  getGroup,
  allGroupIds,
  getRefs,
  bumpRev,
  // v1.6: общий экспорт (админка + автобэкап), дедупликация каталога
  buildFullExport,
  dedupeReport,
  dedupeRunMerge,
  SERVER_VERSION,
  // v1.8: настройки уведомлений — все пуши админки идут через notifyUser()
  notifyUser,
  canNotify,
  getNotifPrefs,
} from './_shared.mjs';
import { BADGES, badgeById, expandEarned } from './_badges.mjs';
import { CATALOG } from './_catalog.mjs';

/* Версия клиента берётся из исходника приложения — так в админке всегда
   актуальный номер, и его не нужно править вручную при каждом релизе.
   Если файла рядом нет (неожиданная раскладка), подсказка просто пустая. */
let APP_VERSION_HINT = '';
try {
  const src = readFileSync(new URL('../../public/app-core.js', import.meta.url), 'utf8');
  APP_VERSION_HINT = (src.match(/APP_VERSION\s*=\s*'([^']+)'/) || [])[1] || '';
} catch (e) { APP_VERSION_HINT = ''; }
import { refreshRatings, fetchNew, refreshStatus } from './_refresh.mjs';

const pub = (u) => u && ({
  id: u.id, code: u.code, first_name: u.first_name, last_name: u.last_name,
  username: u.username, partners: u.partners || [], created: u.created,
});

export async function handleAdmin(action, body, ctx) {
  const { token, site, source } = ctx;

  switch (action) {

    /* ---------- сводка ---------- */
    case 'status': {
      const ids = await allUserIds();
      const matches = await getMatches();
      const hidden = await getHidden();
      let votesTotal = 0, likes = 0;
      for (const id of ids) {
        const v = await getVotes(id);
        const vals = Object.values(v);
        votesTotal += vals.length;
        likes += vals.filter((x) => x === 1).length;
      }
      const wh = await tg('getWebhookInfo', {}, token);
      const mb = await tg('getChatMenuButton', {}, token);
      const me = await tg('getMe', {}, token);
      return {
        ok: true,
        site,
        tokenSource: source || null,
        tokenSourceLabel: SOURCE_LABEL[source] || 'неизвестного источника',
        users: ids.length,
        votes: votesTotal,
        likes,
        matches: matches.length,
        watched: matches.filter((m) => m.watched).length,
        hidden: hidden.length,
        catalog: Object.keys(CATALOG).length,
        settings: await getSettings(),
        hasAdminPassword: await adminHasPassword(),
        bot: me.ok ? { username: me.result.username, first_name: me.result.first_name } : null,
        webhook: wh.ok ? {
          url: wh.result.url,
          error: wh.result.last_error_message || null,
          pending: wh.result.pending_update_count || 0,
        } : null,
        menuButton: mb.ok ? mb.result : null,
      };
    }

    /* ---------- пользователи (с поиском по нику / ID / коду / имени) ---------- */
    case 'users':
    case 'users.search': {
      const q = String(body.q || '').trim().toLowerCase().replace(/^@/, '');
      const ids = await allUserIds();
      const matches = await getMatches();
      const out = [];
      for (const id of ids) {
        const u = await getUser(id);
        if (!u) continue;
        if (q) {
          const hay = [u.id, u.code, u.username, u.first_name, u.last_name].filter(Boolean).join(' ').toLowerCase();
          if (!hay.includes(q)) continue;
        }
        const v = await getVotes(id);
        const vals = Object.values(v);
        const pnames = [];
        for (const pid of (u.partners || [])) { const pu = await getUser(pid); if (pu) pnames.push(pu.first_name || pid); }
        out.push(Object.assign(pub(u), {
          banned: await isBanned(id),
          platform: u.platform || null,
          lang: u.lang || null,
          lastSeen: u.lastSeen || null,
          partnerNames: pnames,
          votes: vals.length,
          likes: vals.filter((x) => x === 1).length,
          matches: matches.filter((m) => (m.by || []).includes(id)).length,
        }));
        if (out.length >= 100) break;
      }
      out.sort((a, b) => (b.created || 0) - (a.created || 0));
      return { ok: true, users: out, q };
    }

    /* ---------- полная карточка пользователя ---------- */
    case 'users.card': {
      const id = String(body.id || '');
      const u = await getUser(id);
      if (!u) return { ok: false, error: 'Пользователь не найден' };
      const ALL = await getCatalogAll();
      const votes = await getVotes(id);
      const vals = Object.values(votes);
      const allMatches = (await getMatches()).filter((m) => (m.by || []).includes(id));
      const partners = [];
      for (const pid of (u.partners || [])) {
        const pu = await getUser(pid);
        if (!pu) continue;
        partners.push(Object.assign(pub(pu), {
          stats: await coupleStats(id, pid, ALL),
          lastSeen: pu.lastSeen || null,
          banned: await isBanned(pid),
        }));
      }
      const journal = (await getSwlog(id, 30)).map((e) => {
        const c = ALL[e.id] || {};
        return { id: e.id, v: e.v, t: e.t, title: c.t || e.id, year: c.y || null };
      });
      const badges = expandEarned(await getEarned('u:' + id)).concat(await getEarned('m:' + id));
      const fb = (await getFeedback()).filter((f) => String(f.uid) === String(id)).slice(0, 10);
      return {
        ok: true,
        user: Object.assign(pub(u), {
          banned: await isBanned(id), platform: u.platform || null, lang: u.lang || null,
          lastSeen: u.lastSeen || null, created: u.created || null,
        }),
        stats: {
          votes: vals.length,
          likes: vals.filter((x) => x === 1).length,
          dislikes: vals.filter((x) => x === -1).length,
          seen: vals.filter((x) => x === 2).length,
          matches: allMatches.length,
          watched: allMatches.filter((m) => m.watched).length,
          rated: allMatches.reduce((n, m) => n + (m.scores && m.scores[id] ? 1 : 0), 0),
        },
        partners,
        matches: allMatches.slice(0, 40).map((m) => ({
          mid: matchMid(m), id: m.id, title: m.title, year: m.year, type: m.type,
          poster: m.poster, rating: m.rating, ts: m.ts, watched: !!m.watched, scores: m.scores || null,
        })),
        journal,
        badges,
        feedback: fb,
        stop: await getStop(id),
      };
    }

    /* ---------- вход «глазами пользователя» ---------- */
    case 'users.preview': {
      const id = String(body.id || '');
      const u = await getUser(id);
      if (!u) return { ok: false, error: 'Пользователь не найден' };
      const token = await signPreview(id);
      await pushBroadcastLog({ kind: 'preview', to: id, text: 'Админ вошёл «глазами пользователя» ' + (u.first_name || id), sent: 0, failed: 0, total: 1 });
      return { ok: true, token, url: (site || '') + '/?pv=' + encodeURIComponent(token) };
    }

    /* ---------- перенос пары на другого человека ---------- */
    case 'pairs.transfer': {
      const id = String(body.id || '');
      const oldPid = String(body.oldPartnerId || '');
      const to = String(body.newPartner || '').trim();
      const u = await getUser(id);
      if (!u) return { ok: false, error: 'Пользователь не найден' };
      if (!oldPid || !(u.partners || []).includes(oldPid)) return { ok: false, error: 'Такого партнёра у пользователя нет' };
      if (!to) return { ok: false, error: 'Укажите, кому передать пару: Telegram ID, @username или код' };
      let newId = null;
      if (/^\d+$/.test(to)) newId = to;
      else if (/^[A-Z2-9]{4,8}$/i.test(to)) newId = await db().get('c:' + to.toUpperCase());
      if (!newId) {
        const want = to.replace(/^@/, '').toLowerCase();
        if (want) {
          for (const cand of await allUserIds()) {
            const cu = await getUser(cand);
            if (cu && String(cu.username || '').toLowerCase() === want) { newId = cand; break; }
          }
        }
      }
      if (!newId || !(await getUser(newId))) return { ok: false, error: 'Новый партнёр не найден. Он должен хотя бы раз открыть бота.' };
      if (newId === id) return { ok: false, error: 'Нельзя передать пару самому себе' };
      if (newId === oldPid) return { ok: false, error: 'Это тот же самый партнёр' };
      if ((u.partners || []).includes(newId)) return { ok: false, error: 'Такой партнёр уже есть в списке' };
      await removePartner(id, oldPid);
      const r = await addPartner(id, newId);
      if (!r.ok) return { ok: false, error: r.error };
      const nu = await getUser(newId), ou = await getUser(oldPid);
      const nm = (x) => (x && (x.first_name || x.username)) || 'участник';
      await notifyUser(id, 'admin', { text: `👥 Администратор изменил вашу пару: вместо «${nm(ou)}» теперь «${nm(nu)}».` }, token).catch(() => {});
      await notifyUser(newId, 'admin', { text: `👥 Вас добавили в пару с ${nm(u)} — свайпайте вместе и ловите мэтчи!` }, token).catch(() => {});
      await pushBroadcastLog({ kind: 'transfer', to: id, text: `Перенос пары: ${nm(ou)} → ${nm(nu)} (у ${nm(u)})`, sent: 0, failed: 0, total: 1 });
      return { ok: true, partner: pub(nu), removed: oldPid };
    }

    case 'user': {
      const u = await getUser(String(body.id || ''));
      if (!u) return { ok: false, error: 'Пользователь не найден' };
      const partners = [];
      for (const pid of (u.partners || [])) { const pu = await getUser(pid); if (pu) partners.push(pub(pu)); }
      const matches = (await getMatches()).filter((m) => (m.by || []).includes(u.id));
      return { ok: true, user: pub(u), partners, votes: await getVotes(u.id), matches };
    }

    case 'user.reset': {
      const id = String(body.id || '');
      await setVotes(id, {});
      const all = await getMatches();
      await setMatches(all.filter((m) => !(m.by || []).includes(id)));
      return { ok: true };
    }

    case 'user.unlink': {
      const u = await getUser(String(body.id || ''));
      if (!u) return { ok: false, error: 'Пользователь не найден' };
      const targets = body.partnerId ? [String(body.partnerId)] : (u.partners || []).slice();
      for (const pid of targets) await removePartner(u.id, pid);
      return { ok: true, removed: targets };
    }

    /* ---------- мэтчи ---------- */
    case 'matches': {
      const all = await getMatches();
      const names = {};
      for (const m of all) for (const id of (m.by || [])) if (!names[id]) names[id] = await getUser(id);
      return {
        ok: true,
        matches: all.map((m) => Object.assign({}, m, {
          mid: matchMid(m),
          byNames: (m.by || []).map((id) => (names[id] && names[id].first_name) || id),
        })),
      };
    }

    case 'match.delete': {
      const mid = String(body.mid || '');
      const id = String(body.id || '');
      const all = await getMatches();
      const left = mid ? all.filter((m) => matchMid(m) !== mid) : all.filter((m) => m.id !== id);
      await setMatches(left);
      return { ok: true, removed: all.length - left.length };
    }

    case 'match.watched': {
      const all = await getMatches();
      const m = body.mid ? findMatch(all, String(body.mid)) : all.find((x) => x.id === String(body.id));
      if (!m) return { ok: false, error: 'Мэтч не найден' };
      m.watched = body.v !== false;
      await setMatches(all);
      return { ok: true, match: m };
    }

    /* ---------- рассылка ---------- */
    /* Рассылка. Три защиты от «выстрела по своим»:
         • segment — кому слать (all / active / pairs / solo / sleeping);
         • настройки уведомлений каждого получателя (тип `admin`);
         • dry — посчитать аудиторию и НЕ слать (кнопка «Проверить» в админке). */
    case 'broadcast': {
      const text = String(body.text || '').trim();
      if (!text) return { ok: false, error: 'Пустое сообщение' };
      const segment = String(body.segment || 'all');
      const dry = body.dry === true;
      const all = await allUserIds();
      const weekAgo = Date.now() - 7 * 86400e3;
      const twoWeeksAgo = Date.now() - 14 * 86400e3;
      const ids = [];
      const stat = { total: all.length, bySegment: 0, muted: 0, noPrefs: 0 };
      for (const id of all) {
        const u = await getUser(id);
        if (!u) continue;
        const partners = (u.partners || []).length;
        const seen = Number(u.lastSeen) || 0;
        if (segment === 'pairs' && !partners) continue;
        if (segment === 'solo' && partners) continue;
        if (segment === 'active' && seen < twoWeeksAgo) continue;
        if (segment === 'sleeping' && seen >= weekAgo) continue;
        stat.bySegment++;
        if (!(await canNotify(id, 'admin'))) { stat.muted++; continue; }
        ids.push(id);
      }
      if (dry) return { ok: true, dry: true, segment, stat, willSend: ids.length };
      let sent = 0, failed = 0;
      const kb = body.url
        ? { inline_keyboard: [[{ text: body.buttonText || 'Открыть', url: body.url }], [{ text: '🔕 Не беспокоить', callback_data: 'mute:7' }]] }
        : { inline_keyboard: [[{ text: '🔕 Не беспокоить', callback_data: 'mute:7' }]] };
      for (const id of ids) {
        const r = body.photo
          ? await tg('sendPhoto', { chat_id: id, photo: body.photo, caption: text, parse_mode: body.html ? 'HTML' : undefined, reply_markup: kb }, token)
          : await tg('sendMessage', { chat_id: id, text, parse_mode: body.html ? 'HTML' : undefined, reply_markup: kb }, token);
        if (r && r.ok) sent++; else failed++;
        await new Promise((r2) => setTimeout(r2, 60));
      }
      await pushBroadcastLog({ kind: 'broadcast', text, sent, failed, total: ids.length, url: body.url || null, photo: body.photo || null, html: !!body.html });
      return { ok: true, sent, failed, total: ids.length };
    }

    case 'send': {
      const to = String(body.id || '');
      const text = String(body.text || '');
      const r = await tg('sendMessage', {
        chat_id: to, text, parse_mode: body.html ? 'HTML' : undefined,
      }, token);
      await pushBroadcastLog({ kind: 'send', to, text, sent: r.ok ? 1 : 0, failed: r.ok ? 0 : 1, total: 1 });
      return r.ok ? { ok: true } : { ok: false, error: r.description };
    }

    /* ---------- история рассылок и анонсов ---------- */
    case 'broadcasts.list': {
      return { ok: true, items: await getBroadcastLog() };
    }

    /* ---------- каталог ---------- */
    case 'catalog': {
      const q = String(body.q || '').toLowerCase().trim();
      const hidden = await getHidden();
      const votesAgg = {};
      for (const id of await allUserIds()) {
        const v = await getVotes(id);
        for (const [mid, val] of Object.entries(v)) {
          votesAgg[mid] = votesAgg[mid] || { like: 0, dislike: 0, seen: 0 };
          if (val === 1) votesAgg[mid].like++;
          else if (val === 2) votesAgg[mid].seen++;
          else votesAgg[mid].dislike++;
        }
      }
      const ALL = await getCatalogAll();
      const customIds = new Set((await getCustomFilms()).map((f) => f.id));
      const dynIds = new Set((await getDynamicFilms()).map((f) => f.id));
      let list = Object.entries(ALL).map(([id, c]) => Object.assign({ id, hidden: hidden.includes(id), custom: customIds.has(id) || dynIds.has(id), dynamic: dynIds.has(id), stats: votesAgg[id] || { like: 0, dislike: 0, seen: 0 } }, c));
      if (q) list = list.filter((c) => (c.t || '').toLowerCase().includes(q));
      if (body.onlyHidden) list = list.filter((c) => c.hidden);
      list.sort((a, b) => (b.r || 0) - (a.r || 0));
      return { ok: true, items: list.slice(0, body.limit || 300), total: list.length };
    }

    case 'hide': {
      const r = await toggleHidden(String(body.id), body.v !== false);
      return { ok: true, hidden: r.hidden };
    }

    /* ---------- спорные и незаходящие фильмы (кандидаты на скрытие) ---------- */
    case 'catalog.flagged': {
      const hidden = await getHidden();
      const ALL = await getCatalogAll();
      // сколько раз каждый фильм лайкнули / пропустили
      const votesAgg = {};
      for (const id of await allUserIds()) {
        const v = await getVotes(id);
        for (const [mid, val] of Object.entries(v)) {
          votesAgg[mid] = votesAgg[mid] || { like: 0, dislike: 0, seen: 0 };
          if (val === 1) votesAgg[mid].like++;
          else if (val === 2) votesAgg[mid].seen++;
          else votesAgg[mid].dislike++;
        }
      }
      // оценки «как зашло» (1–5) из всех мэтчей по каждому фильму
      const scoreAgg = {};
      for (const m of await getMatches()) {
        if (!m.scores) continue;
        const vals = Object.values(m.scores).map(Number).filter((n) => n >= 1 && n <= 5);
        if (!vals.length) continue;
        (scoreAgg[m.id] = scoreAgg[m.id] || []).push(...vals);
      }
      const out = [];
      for (const [id, c] of Object.entries(ALL)) {
        const st = votesAgg[id] || { like: 0, dislike: 0, seen: 0 };
        const scores = scoreAgg[id] || [];
        let spread = 0, avgScore = null, min = null, max = null;
        if (scores.length >= 2) {
          min = Math.min(...scores); max = Math.max(...scores);
          avgScore = Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10;
          spread = max - min;
        }
        const reasons = [];
        let severity = 0;
        // незаходящий: заметно больше дизлайков, чем лайков
        if (st.dislike >= 3 && st.dislike > st.like) {
          reasons.push(`не заходит: ${st.dislike} ✖ против ${st.like} ❤`);
          severity += (st.dislike - st.like) * 2;
        }
        // спорные оценки: смотрели вместе, но мнения сильно разошлись
        if (scores.length >= 2 && spread >= 3) {
          reasons.push(`разброс оценок ${min}–${max} (средняя ${avgScore})`);
          severity += spread * 2;
        }
        // поляризованный: лайки и дизлайки почти поровну
        if (st.like >= 2 && st.dislike >= 2 && Math.abs(st.like - st.dislike) <= 1) {
          reasons.push(`спорный: ${st.like} ❤ / ${st.dislike} ✖ почти поровну`);
          severity += 3;
        }
        if (!reasons.length) continue;
        out.push({
          id, t: c.t, y: c.y, tp: c.tp, p: c.p, r: c.r,
          like: st.like, dislike: st.dislike, seen: st.seen || 0, total: st.like + st.dislike,
          scoreCount: scores.length, avgScore, min, max, spread,
          hidden: hidden.includes(id), reasons, severity,
        });
      }
      out.sort((a, b) => (b.severity - a.severity) || (b.dislike - a.dislike));
      return { ok: true, items: out, total: out.length, canHide: out.filter((x) => !x.hidden).length };
    }

    case 'catalog.hideMany': {
      const ids = (Array.isArray(body.ids) ? body.ids : []).map(String).filter(Boolean);
      if (!ids.length) return { ok: false, error: 'Не переданы фильмы для скрытия' };
      const list = await getHidden();
      let added = 0;
      for (const id of ids) if (!list.includes(id)) { list.push(id); added++; }
      await setHidden(list);
      return { ok: true, added, hidden: list.length };
    }

    /* ---------- обновить каталог (свежие рейтинги / новинки) без пересборки ---------- */
    case 'catalog.refresh': {
      const mode = ['ratings', 'new', 'all'].includes(body.mode) ? body.mode : 'ratings';
      const batch = Math.max(1, Math.min(60, Number(body.batch) || 30));
      const newBatch = Math.max(1, Math.min(12, Number(body.newBatch) || 6));
      const started = Date.now();
      const out = { ok: true, mode };
      try {
        if (mode === 'ratings' || mode === 'all') out.ratings = await refreshRatings(batch);
        if (mode === 'new' || mode === 'all') out.new = await fetchNew(newBatch);
      } catch (e) {
        return { ok: false, error: 'Не удалось обновить каталог: ' + (e && e.message ? e.message : 'unknown') };
      }
      out.ms = Date.now() - started;
      return out;
    }

    case 'catalog.refresh.status': {
      return await refreshStatus();
    }

    /* ---------- дедупликация каталога (v1.6) ----------
       Один фильм под разными id ломает мэтчи: партнёры лайкают разные
       карточки. Отчёт показывает найденные группы, «склейка» переносит
       голоса/мэтчи/стоп-листы на каноническую карточку и скрывает дубли. */
    case 'catalog.dedup': {
      return await dedupeReport();
    }
    case 'catalog.dedup.run': {
      return await dedupeRunMerge();
    }

    /* ---------- аналитика: графики активности, воронка свайпов, топ фильмов ---------- */
    case 'analytics.stats': {
      const days = Math.max(7, Math.min(120, Number(body.days) || 30));
      const daily = (await getDailySeries(days + 5)).slice(-days);
      const ids = await allUserIds();
      const matches = await getMatches();
      const f = { registered: ids.length, swiped: 0, deep: 0, paired: 0, matched: 0, watched: 0, likes: 0, votes: 0 };
      const perFilm = {};
      const matchByFilm = {};
      const watchedByFilm = {};
      const scoreByFilm = {};
      for (const m of matches) {
        matchByFilm[m.id] = (matchByFilm[m.id] || 0) + 1;
        if (m.watched) watchedByFilm[m.id] = (watchedByFilm[m.id] || 0) + 1;
        if (m.scores) for (const v of Object.values(m.scores)) {
          const n = Number(v);
          if (n >= 1 && n <= 5) (scoreByFilm[m.id] = scoreByFilm[m.id] || []).push(n);
        }
      }
      const matchedUsers = new Set();
      const watchedUsers = new Set();
      for (const m of matches) {
        (m.by || []).forEach((x) => matchedUsers.add(String(x)));
        if (m.watched) (m.by || []).forEach((x) => watchedUsers.add(String(x)));
      }
      for (const id of ids) {
        const v = await getVotes(id);
        const vals = Object.values(v);
        f.votes += vals.length;
        f.likes += vals.filter((x) => x === 1).length;
        if (vals.length) f.swiped++;
        if (vals.length >= 10) f.deep++;
        const u = await getUser(id);
        if (u && (u.partners || []).length) f.paired++;
        if (matchedUsers.has(String(id))) f.matched++;
        if (watchedUsers.has(String(id))) f.watched++;
        for (const [mid, val] of Object.entries(v)) {
          perFilm[mid] = perFilm[mid] || { like: 0, dislike: 0, seen: 0 };
          if (val === 1) perFilm[mid].like++;
          else if (val === 2) perFilm[mid].seen++;
          else perFilm[mid].dislike++;
        }
      }
      const ALL = await getCatalogAll();
      const top = Object.entries(perFilm).map(([id, st]) => {
        const c = ALL[id] || {};
        const scores = scoreByFilm[id] || [];
        return {
          id, t: c.t || id, y: c.y || null, p: c.p || null, r: c.r != null ? c.r : null,
          like: st.like, dislike: st.dislike, seen: st.seen || 0, total: st.like + st.dislike,
          matches: matchByFilm[id] || 0, watched: watchedByFilm[id] || 0,
          avgScore: scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null,
        };
      }).sort((a, b) => (b.total - a.total) || (b.matches - a.matches)).slice(0, 15);
      return { ok: true, daily, funnel: f, top, days };
    }

    /* ---------- редактирование карточки фильма ---------- */
    case 'catalog.card': {
      const id = String(body.id || '');
      const ALL = await getCatalogAll();
      if (!ALL[id]) return { ok: false, error: 'Фильм не найден' };
      const edits = await getCardEdits();
      return { ok: true, id, card: ALL[id], edit: edits[id] || null };
    }

    case 'catalog.edit': {
      const id = String(body.id || '');
      const ALL = await getCatalogAll();
      if (!ALL[id]) return { ok: false, error: 'Фильм не найден' };
      const patch = body.patch || {};
      const clean = {};
      if (patch.t != null) { const t = String(patch.t).trim().slice(0, 120); if (t) clean.t = t; }
      if (patch.y != null) { const y = parseInt(patch.y, 10); clean.y = (y >= 1800 && y <= 2100) ? y : null; }
      if (patch.tp != null) clean.tp = patch.tp === 'series' ? 'series' : 'movie';
      if (patch.p != null) clean.p = String(patch.p).trim().slice(0, 500) || null;
      if (patch.r != null) {
        const r = patch.r === '' ? null : Number(patch.r);
        clean.r = (r != null && isFinite(r) && r >= 0 && r <= 10) ? Math.round(r * 100) / 100 : null;
      }
      if (patch.g != null) {
        clean.g = (Array.isArray(patch.g) ? patch.g : String(patch.g).split(','))
          .map((x) => String(x).trim().toLowerCase()).filter(Boolean).slice(0, 8);
      }
      if (patch.minutes != null) { const mm = parseInt(patch.minutes, 10); clean.minutes = (mm > 0 && mm < 100000) ? mm : null; }
      if (patch.desc != null) clean.desc = String(patch.desc).trim().slice(0, 1200) || null;
      if (patch.tr != null) clean.tr = String(patch.tr).trim().slice(0, 200) || null;
      if (!Object.keys(clean).length) return { ok: false, error: 'Нечего сохранять' };
      const edits = await getCardEdits();
      const merged = Object.assign({}, edits[id] || {}, clean);
      edits[id] = merged;
      await setCardEdits(edits);
      const ALL2 = await getCatalogAll();
      return { ok: true, card: ALL2[id], edit: merged };
    }

    case 'catalog.edit.reset': {
      const id = String(body.id || '');
      const edits = await getCardEdits();
      const had = !!edits[id];
      if (had) { delete edits[id]; await setCardEdits(edits); }
      const ALL = await getCatalogAll();
      return { ok: true, removed: had, card: ALL[id] || null };
    }

    /* ---------- коллекции / подборки ---------- */
    case 'collections.list': {
      const list = await getCollections();
      const ALL = await getCatalogAll();
      return {
        ok: true,
        collections: list.map((col) => Object.assign({}, col, {
          count: (col.items || []).length,
          titles: (col.items || []).slice(0, 6).map((x) => (ALL[x] && ALL[x].t) || x),
        })),
      };
    }

    case 'collections.save': {
      const list = await getCollections();
      const ALL = await getCatalogAll();
      const title = String(body.title || '').trim().slice(0, 60);
      if (!title) return { ok: false, error: 'Укажите название подборки' };
      const items = [...new Set((Array.isArray(body.items) ? body.items : []).map(String))].filter((x) => ALL[x]).slice(0, 200);
      const col = {
        id: String(body.id || '') || ('col' + Date.now().toString(36)),
        title,
        emoji: String(body.emoji || '🍿').slice(0, 8),
        note: String(body.note || '').trim().slice(0, 200),
        items,
        ts: Date.now(),
      };
      const idx = list.findIndex((x) => x.id === col.id);
      if (idx >= 0) { col.created = list[idx].created || col.ts; list[idx] = col; }
      else { col.created = col.ts; list.push(col); }
      await saveCollections(list);
      return { ok: true, collection: col };
    }

    case 'collections.delete': {
      const id = String(body.id || '');
      const list = await getCollections();
      const next = list.filter((x) => x.id !== id);
      if (next.length === list.length) return { ok: false, error: 'Подборка не найдена' };
      await saveCollections(next);
      return { ok: true };
    }

    /* ---------- авто-подборки ----------
       Готовые правила: «Высокий рейтинг», «Комедии», «Ужасы» и т.д.
       Без apply — только предпросмотр (что получится и сколько фильмов),
       с apply — создаёт/обновляет подборки с id 'auto:<ключ>'. */
    case 'collections.auto': {
      const yearNow = new Date().getFullYear();
      const RULES = [
        { key: 'top', emoji: '🔥', title: 'Высокий рейтинг', note: 'Самые оценённые фильмы и сериалы каталога', max: 40, test: (c) => (c.r || 0) >= 8 },
        { key: 'comedy', emoji: '😂', title: 'Смеёмся вместе', note: 'Лучшие комедии для хорошего вечера', max: 40, test: (c) => (c.g || []).includes('комедия') && (c.r || 0) >= 7 },
        { key: 'thrill', emoji: '😱', title: 'Пощекотать нервы', note: 'Ужасы и триллеры, которые не стыдно включить', max: 30, test: (c) => ((c.g || []).includes('ужасы') || (c.g || []).includes('триллер')) && (c.r || 0) >= 6.5 },
        { key: 'love', emoji: '💞', title: 'Романтика', note: 'Мелодрамы для вечера вдвоём', max: 30, test: (c) => (c.g || []).includes('мелодрама') && (c.r || 0) >= 7 },
        { key: 'family', emoji: '👨‍👩‍👧', title: 'Семейный вечер', note: 'Фильмы и мультфильмы для всей семьи', max: 30, test: (c) => (c.g || []).some((g) => ['семейный', 'мультфильм', 'детский'].includes(g)) && (c.r || 0) >= 6.5 },
        { key: 'series', emoji: '📺', title: 'Сериалы на запой', note: 'Топовые сериалы для марафона на выходные', max: 30, test: (c) => c.tp === 'series' && (c.r || 0) >= 8 },
        { key: 'short', emoji: '⏱', title: 'Коротко и ярко', note: 'До 100 минут и рейтинг 7.5+', max: 30, test: (c) => c.tp !== 'series' && c.mi && c.mi <= 100 && (c.r || 0) >= 7.5 },
        { key: 'fresh', emoji: '✨', title: 'Свежее', note: `Новинки ${yearNow - 2} года и моложе`, max: 30, test: (c) => c.y && c.y >= yearNow - 2 },
        { key: 'cult', emoji: '🎬', title: 'Культовая классика', note: 'Фильмы до 2000 года с рейтингом 8.3+', max: 30, test: (c) => c.y && c.y <= 2000 && (c.r || 0) >= 8.3 },
      ];
      const ALL = await getCatalogAll();
      const hidden = new Set(await getHidden());
      const entries = Object.entries(ALL).filter(([id]) => !hidden.has(id));
      const preview = RULES
        .map((rule) => {
          const ids = entries.filter(([, c]) => rule.test(c))
            .sort((x, y) => (y[1].r || 0) - (x[1].r || 0))
            .slice(0, rule.max)
            .map(([id]) => id);
          return { key: rule.key, emoji: rule.emoji, title: rule.title, note: rule.note, items: ids };
        })
        .filter((p) => p.items.length >= 3);
      if (!body.apply) {
        return { ok: true, preview: preview.map((p) => ({ key: p.key, emoji: p.emoji, title: p.title, note: p.note, count: p.items.length, sample: p.items.slice(0, 5).map((id) => ALL[id].t) })) };
      }
      const keys = new Set(Array.isArray(body.keys) && body.keys.length ? body.keys.map(String) : preview.map((p) => p.key));
      const list = await getCollections();
      let created = 0, updated = 0;
      for (const p of preview) {
        if (!keys.has(p.key)) continue;
        const id = 'auto:' + p.key;
        const col = { id, title: p.title, emoji: p.emoji, note: p.note, items: p.items, auto: p.key, ts: Date.now() };
        const idx = list.findIndex((x) => x.id === id);
        if (idx >= 0) { col.created = list[idx].created || col.ts; list[idx] = col; updated++; }
        else { col.created = col.ts; list.push(col); created++; }
      }
      await saveCollections(list);
      return { ok: true, created, updated };
    }

    /* ---------- предпросмотр колоды конкретной пары ----------
       Сервер повторяет клиентский алгоритм (тот же хэш и генератор), поэтому
       порядок карточек здесь — ровно тот, который видит пара в приложении.
       version — версия каталога из /data/movies.json (шлёт админка). */
    case 'pairs.deckPreview': {
      const a = String(body.userA || body.a || ''), b = String(body.userB || body.b || '');
      const ua = await getUser(a), ub = await getUser(b);
      if (!ua || !ub) return { ok: false, error: 'Пользователь пары не найден' };
      const deck = await buildDeckPreview(a, b, String(body.version || ''), Number(body.limit) || 30);
      return {
        ok: true, a: pub(ua), b: pub(ub), version: String(body.version || ''),
        mode: deck.mode, syncDeck: deck.syncDeck,
        deckA: deck.deckA, deckB: deck.deckB, shared: deck.shared,
        genres: deck.genres,   // жанры каталога по популярности — для экрана интересов
        total: deck.total, items: deck.items,
      };
    }

    /* ---------- слияние дублей ----------
       Аккаунт fromId растворяется в intoId: голоса, журнал, мэтчи (с заменой
       участника), партнёры, награды, стоп-лист, жанры, группы и рефералы
       переезжают; код дубля продолжает вести на объединённый аккаунт. */
    case 'users.merge': {
      const fromId = String(body.fromId || ''), intoId = String(body.intoId || '');
      if (!fromId || !intoId) return { ok: false, error: 'Укажите оба аккаунта (кого и в кого)' };
      if (fromId === intoId) return { ok: false, error: 'Нельзя объединить аккаунт сам с собой' };
      const from = await getUser(fromId), into = await getUser(intoId);
      if (!from || !into) return { ok: false, error: 'Пользователь не найден' };

      /* голоса: при конфликте остаётся значение целевого аккаунта */
      const vf = await getVotes(fromId), vi = await getVotes(intoId);
      const votesAdded = Object.keys(vf).filter((k) => !(k in vi)).length;
      await setVotes(intoId, Object.assign({}, vf, vi));
      await db().delete('v:' + fromId);

      /* журнал свайпов */
      try {
        const lf = await getSwlog(fromId, 300), li = await getSwlog(intoId, 300);
        const byFilm = new Map();
        for (const e of li.concat(lf)) if (!byFilm.has(String(e.id))) byFilm.set(String(e.id), e);
        await db().set('swlog:' + intoId, JSON.stringify([...byFilm.values()].sort((x, y) => (y.t || 0) - (x.t || 0)).slice(0, 300)));
        await db().delete('swlog:' + fromId);
      } catch (e) { /* не критично */ }

      /* мэтчи: заменяем участника, переименовываем оценки, склеиваем дубли */
      const all = await getMatches();
      for (const m of all) {
        if ((m.by || []).map(String).includes(fromId)) {
          m.by = [...new Set((m.by || []).map((x) => (String(x) === fromId ? intoId : String(x))))].sort();
          if (!m.groupId) m.mid = `${m.id}|${m.by.join('-')}`;
        }
        if (m.scores && m.scores[fromId] != null) {
          if (m.scores[intoId] == null) m.scores[intoId] = m.scores[fromId];
          delete m.scores[fromId];
        }
      }
      const byMid = new Map();
      for (const m of all) {
        const k = matchMid(m);
        const prev = byMid.get(k);
        if (!prev) { byMid.set(k, m); continue; }
        byMid.set(k, Object.assign({}, prev, {
          watched: !!(prev.watched || m.watched),
          scores: Object.assign({}, m.scores || {}, prev.scores || {}),
        }));
      }
      const matchesMoved = all.filter((m) => (m.by || []).includes(intoId)).length;
      await setMatches([...byMid.values()]);

      /* партнёры дубля → целевому аккаунту */
      let partnersMoved = 0;
      for (const pid of (from.partners || []).slice()) {
        if (String(pid) === intoId) continue;
        const r = await addPartner(intoId, pid);
        if (r.ok) partnersMoved++;
        const pu = await getUser(pid);
        if (pu) { pu.partners = (pu.partners || []).filter((x) => String(x) !== fromId); await saveUser(pu); }
      }

      /* награды */
      const eF = await getEarned('u:' + fromId), eI = await getEarned('u:' + intoId);
      const haveIds = new Set(eI.map((x) => (typeof x === 'string' ? x : x.id)));
      const addE = eF.filter((x) => !haveIds.has(typeof x === 'string' ? x : x.id));
      if (addE.length) await setEarned('u:' + intoId, eI.concat(addE));
      const mF = await getEarned('m:' + fromId);
      if (mF.length) await setEarned('m:' + intoId, (await getEarned('m:' + intoId)).concat(mF));
      await db().delete('bg:u:' + fromId);
      await db().delete('bg:m:' + fromId);

      /* стоп-лист и любимые жанры */
      try {
        const sf = await getStop(fromId), si = await getStop(intoId);
        await setStop(intoId, {
          films: [...new Set([...(si.films || []), ...(sf.films || [])].map(String))],
          genres: [...new Set([...(si.genres || []), ...(sf.genres || [])])],
        });
        await db().delete('stop:' + fromId);
        const pfRaw = await getPrefs(fromId), piRaw = await getPrefs(intoId);
        await setPrefs(intoId, {
          genres: [...new Set([...piRaw.genres, ...pfRaw.genres])],
          onboarded: piRaw.onboarded || pfRaw.onboarded,
        });
        await db().delete('prefs:' + fromId);
      } catch (e) { /* не критично */ }

      /* личные подборки — пользовательский контент, терять нельзя:
         переносим к целевому аккаунту (дубли по названию не плодим) */
      try {
        const cf = await getUserCols(fromId);
        if (cf.length) {
          const ci = await getUserCols(intoId);
          const haveT = new Set(ci.map((c) => String(c.title || '').toLowerCase()));
          const addC = cf.filter((c) => !haveT.has(String(c.title || '').toLowerCase()));
          if (addC.length) await saveUserCols(intoId, ci.concat(addC));
          await db().delete('ucol:' + fromId);
        }
      } catch (e) { /* не критично */ }

      /* активность: максимумы и суммы */
      try {
        const af = await getUserActivity(fromId), ai = await getUserActivity(intoId);
        if (Object.keys(af).length) {
          await db().set('uact:' + intoId, JSON.stringify(Object.assign({}, ai, {
            bestDay: Math.max(ai.bestDay || 0, af.bestDay || 0),
            bestStreak: Math.max(ai.bestStreak || 0, af.bestStreak || 0),
            streakCount: Math.max(ai.streakCount || 0, af.streakCount || 0),
            nightLikes: (ai.nightLikes || 0) + (af.nightLikes || 0),
            likes: (ai.likes || 0) + (af.likes || 0),
          })));
          await db().delete('uact:' + fromId);
        }
      } catch (e) { /* не критично */ }

      /* рефералы */
      try {
        const rf = await getRefs(fromId);
        if (rf.length) {
          const ri = await getRefs(intoId);
          const seenR = new Set(ri.map((x) => String(x.id)));
          for (const x of rf) if (!seenR.has(String(x.id))) ri.push(x);
          await db().set('refs:' + intoId, JSON.stringify(ri.slice(-500)));
          await db().delete('refs:' + fromId);
        }
      } catch (e) { /* не критично */ }

      /* группы: заменяем участие */
      try {
        for (const g of await userGroups(fromId)) {
          const has = (g.members || []).map(String).includes(intoId);
          g.members = has
            ? g.members.filter((x) => String(x) !== fromId)
            : g.members.map((x) => (String(x) === fromId ? intoId : String(x)));
          if (g.members.length) {
            await saveGroup(g);
            const raw = await db().get('gi:' + intoId);
            const gi = raw ? JSON.parse(raw) : [];
            if (!gi.includes(g.id)) await db().set('gi:' + intoId, JSON.stringify(gi.concat(g.id)));
          }
        }
        await db().delete('gi:' + fromId);
      } catch (e) { /* не критично */ }

      /* заявки, код, сам аккаунт */
      await db().delete('preq:' + fromId);
      if (from.code) { try { await db().set('c:' + from.code, intoId); } catch (e) {} }
      await db().delete('u:' + fromId);
      await db().delete('rev:' + fromId);
      const idx = await allUserIds();
      await db().set('users:index', JSON.stringify(idx.filter((x) => String(x) !== fromId)));

      await bumpRev(intoId);
      await tg('sendMessage', {
        chat_id: intoId, parse_mode: 'HTML',
        text: `👥 Администратор объединил ваш аккаунт с «${esc(from.first_name || fromId)}» — голоса, мэтчи и партнёры перенесены к вам.`,
      }, token).catch(() => {});
      await pushBroadcastLog({
        kind: 'merge', to: intoId,
        text: `Слияние: ${from.first_name || fromId} → ${into.first_name || intoId} (голосов +${votesAdded}, партнёров +${partnersMoved})`,
        sent: 0, failed: 0, total: 1,
      });
      return { ok: true, fromId, intoId, votesAdded, partnersMoved, matches: matchesMoved, badgesAdded: addE.length + mF.length };
    }

    /* ---------- глобальный поиск ----------
       Один запрос — люди, пары, фильмы, подборки и обратная связь. */
    case 'global.search': {
      const q = String(body.q || '').trim().toLowerCase().replace(/^@/, '');
      if (q.length < 2) return { ok: false, error: 'Слишком короткий запрос (минимум 2 символа)' };
      const users = [], pairs = [], films = [], cols = [], fb = [];
      for (const id of await allUserIds()) {
        const u = await getUser(id);
        if (!u) continue;
        const hay = [u.id, u.code, u.username, u.first_name, u.last_name].filter(Boolean).join(' ').toLowerCase();
        if (hay.includes(q)) users.push(Object.assign(pub(u), { banned: await isBanned(id), lastSeen: u.lastSeen || null }));
        if (users.length >= 20) break;
      }
      for (const [a, b] of await allPairs()) {
        const ua = await getUser(a), ub = await getUser(b);
        const name = `${(ua && ua.first_name) || a} + ${(ub && ub.first_name) || b}`;
        if (name.toLowerCase().includes(q)) {
          const ms = await getPairMatches(a, b);
          pairs.push({ a, b, name, matches: ms.length, watched: ms.filter((m) => m.watched).length });
        }
        if (pairs.length >= 10) break;
      }
      const ALL = await getCatalogAll();
      for (const [id, c] of Object.entries(ALL)) {
        if (String(c.t || '').toLowerCase().includes(q)) films.push({ id, t: c.t, y: c.y, r: c.r, p: c.p, tp: c.tp });
        if (films.length >= 20) break;
      }
      for (const col of await getCollections()) {
        if (String(col.title || '').toLowerCase().includes(q)) cols.push({ id: col.id, title: col.title, emoji: col.emoji, count: (col.items || []).length });
        if (cols.length >= 10) break;
      }
      for (const f of await getFeedback()) {
        if (String(f.text || '').toLowerCase().includes(q) || String(f.name || '').toLowerCase().includes(q)) {
          fb.push({ id: f.id, ts: f.ts, name: f.name, kind: f.kind, status: f.status, text: String(f.text || '').slice(0, 160) });
        }
        if (fb.length >= 10) break;
      }
      return { ok: true, q, users, pairs, films, collections: cols, feedback: fb };
    }

    /* ---------- обратная связь ---------- */
    case 'feedback.list': {
      return { ok: true, items: await getFeedback() };
    }

    case 'feedback.reply': {
      // та же логика, что у кнопки «✍️ Ответить» в боте — общая функция
      return await sendFeedbackReply(body.id, body.text, token);
    }

    case 'feedback.delete': {
      const fid = String(body.id || '');
      const list = await getFeedback();
      const next = list.filter((x) => x.id !== fid);
      if (next.length === list.length) return { ok: false, error: 'Сообщение не найдено' };
      await saveFeedback(next);
      return { ok: true };
    }

    /* ---------- бот ---------- */
    case 'bot.setup': {
      const r = await runSetup(token, site);
      await db().set('config:site', site);
      return { ok: true, results: r.results, bot: r.bot };
    }

    case 'bot.menu': {
      const s = await getSettings();
      const r = body.on === false
        ? await tg('setChatMenuButton', { menu_button: { type: 'commands' } }, token)
        : await tg('setChatMenuButton', { menu_button: { type: 'web_app', text: s.menuText, web_app: { url: site + '/' } } }, token);
      return r.ok ? { ok: true } : { ok: false, error: r.description };
    }

    case 'bot.webhook.delete': {
      const r = await tg('deleteWebhook', {}, token);
      return r.ok ? { ok: true } : { ok: false, error: r.description };
    }

    case 'bot.commands': {
      const { BOT_COMMANDS } = await import('./_shared.mjs');
      const r = await tg('setMyCommands', { commands: BOT_COMMANDS }, token);
      return r.ok ? { ok: true } : { ok: false, error: r.description };
    }

    /* ---------- настройки ---------- */
    case 'settings.get': return { ok: true, settings: await getSettings(), serverVersion: SERVER_VERSION, clientVersion: APP_VERSION_HINT };
    case 'settings.set': return { ok: true, settings: await setSettings(body.patch || {}), serverVersion: SERVER_VERSION, clientVersion: APP_VERSION_HINT };

    case 'password.set': {
      const r = await adminSetPassword(body.next, body.current);
      if (!r.ok) return r;
      // после смены пароля старые админ-сессии остаются до истечения; это нормально
      return { ok: true };
    }

    /* ---------- экспорт ---------- */
    case 'export': {
      // единый дамп для кнопки «Скачать все данные» и ежедневного автобэкапа
      return { ok: true, export: await buildFullExport(site) };
    }

    /* ---------- правка профиля ---------- */
    case 'user.update': {
      const u = await getUser(String(body.id || ''));
      if (!u) return { ok: false, error: 'Пользователь не найден' };
      if (body.first_name != null) u.first_name = String(body.first_name).slice(0, 64);
      if (body.newCode) {
        const code = String(body.newCode).trim().toUpperCase();
        if (!/^[A-Z2-9]{4,8}$/.test(code)) return { ok: false, error: 'Код: 4-8 символов A-Z, 2-9' };
        const taken = await db().get('c:' + code);
        if (taken && taken !== u.id) return { ok: false, error: 'Такой код уже занят' };
        if (u.code) await db().delete('c:' + u.code);
        await db().set('c:' + code, u.id);
        u.code = code;
      }
      await saveUser(u);
      return { ok: true, user: pub(u) };
    }

    /* ---------- правка голосов вручную ---------- */
    case 'user.setvote': {
      const id = String(body.id || '');
      const mid = String(body.movieId || '');
      const ALL = await getCatalogAll();
      if (!ALL[mid]) return { ok: false, error: 'Фильм не найден' };
      const votes = await getVotes(id);
      const v = Number(body.v);
      if (v === 0) delete votes[mid];
      else if (v === 1 || v === -1 || v === 2) votes[mid] = v;
      else return { ok: false, error: 'v должно быть 1, -1, 2 (уже смотрел) или 0' };
      await setVotes(id, votes);
      return { ok: true, votes };
    }

    /* ---------- создать мэтч вручную ---------- */
    case 'match.create': {
      const a = String(body.userA || ''), b = String(body.userB || ''), mid = String(body.movieId || '');
      const ALL = await getCatalogAll();
      const it = ALL[mid];
      if (!it) return { ok: false, error: 'Фильм не найден' };
      const ua = await getUser(a), ub = await getUser(b);
      if (!ua || !ub) return { ok: false, error: 'Один из пользователей не найден' };
      if (a === b) return { ok: false, error: 'Нельзя создать мэтч с самим собой' };
      const all = await getMatches();
      const key = [a, b].sort().join('|');
      if (all.some((m) => m.id === mid && (m.by || []).slice().sort().join('|') === key)) return { ok: false, error: 'Такой мэтч уже есть' };
      const pair = [a, b].sort();
      const mm = {
        id: mid, mid: `${mid}|${pair.join('-')}`, title: it.t, year: it.y, type: it.tp, poster: it.p, rating: it.r, src: it.s || 'admin',
        genres: it.g || [], ts: Date.now(), by: pair, watched: false, manual: true,
      };
      all.unshift(mm);
      await setMatches(all);
      return { ok: true, match: mm };
    }

    /* ---------- бан ---------- */
    case 'user.ban': {
      const id = String(body.id || '');
      if (!id) return { ok: false, error: 'Не указан пользователь' };
      const v = body.v !== false;
      await setBanned(id, v);
      return { ok: true, banned: v };
    }

    /* ---------- свои фильмы ---------- */
    case 'catalog.add': {
      const t = String(body.t || '').trim();
      if (!t) return { ok: false, error: 'Укажите название' };
      const list = await getCustomFilms();
      const film = {
        id: 'x' + Date.now().toString(36),
        t,
        y: Number(body.y) || null,
        tp: body.tp === 'series' ? 'series' : 'movie',
        p: String(body.p || '').trim() || null,
        r: body.r != null && body.r !== '' ? Number(body.r) : null,
        s: 'admin',
        g: Array.isArray(body.g) ? body.g : String(body.g || '').split(',').map((x) => x.trim()).filter(Boolean),
        minutes: Number(body.minutes) || null,
        desc: String(body.desc || '').trim() || null,
        trailer: String(body.trailer || '').trim() || null,
      };
      list.push(film);
      await saveCustomFilms(list);
      return { ok: true, film };
    }
    case 'catalog.del': {
      const id = String(body.id || '');
      const list = await getCustomFilms();
      const next = list.filter((f) => f.id !== id);
      if (next.length !== list.length) { await saveCustomFilms(next); return { ok: true, removed: 'custom' }; }
      // может быть новинкой, подтянутой «Обновлением каталога»
      const dyn = await getDynamicFilms();
      const nextDyn = dyn.filter((f) => f.id !== id);
      if (nextDyn.length !== dyn.length) { await saveDynamicFilms(nextDyn); return { ok: true, removed: 'dynamic' }; }
      return { ok: false, error: 'Это встроенный фильм — его можно только скрыть' };
    }

    /* ---------- награды ---------- */
    case 'badges.catalog': return { ok: true, badges: BADGES };
    case 'badges.grant': {
      const title = String(body.title || '').trim();
      if (!title) return { ok: false, error: 'Укажите название награды' };
      const custom = { id: 'custom:' + Date.now().toString(36), icon: String(body.icon || '🏅'), title, desc: String(body.note || '').trim() || 'Вручена администратором', manual: true };
      const targets = [];
      if (body.userId) {
        const u = await getUser(String(body.userId));
        if (!u) return { ok: false, error: 'Пользователь не найден' };
        const list = await getEarned('m:' + u.id);
        list.push(custom);
        await setEarned('m:' + u.id, list);
        targets.push(u);
      } else if (body.pairKey) {
        const [a, b] = String(body.pairKey).split('|');
        const ua = await getUser(a), ub = await getUser(b);
        if (!ua || !ub) return { ok: false, error: 'Пара не найдена' };
        const list = await getEarned('mc:' + [a, b].sort().join('|'));
        list.push(custom);
        await setEarned('mc:' + [a, b].sort().join('|'), list);
        targets.push(ua, ub);
      } else {
        return { ok: false, error: 'Выберите пользователя или пару' };
      }
      // поздравляем в боте, чтобы человек увидел награду и «за что»
      const msg = `🎖 <b>Вам вручена награда!</b>\n\n${custom.icon} <b>${esc(custom.title)}</b>\n${esc(custom.desc)}\n\nПосмотреть все награды: вкладка «Награды» или /badges`;
      for (const u of targets) {
        await notifyUser(u.id, 'admin', { parse_mode: 'HTML', text: msg }, token).catch(() => {});
      }
      return { ok: true, badge: custom, notified: targets.length };
    }
    case 'badges.of': {
      const id = String(body.userId || '');
      if (!id) return { ok: false, error: 'Укажите пользователя' };
      const list = expandEarned((await getEarned('u:' + id)).concat(await getEarned('m:' + id)));
      return { ok: true, badges: list };
    }
    case 'badges.revoke': {
      const rid = String(body.badgeId || '');
      const keys = body.userId ? ['u:' + body.userId, 'm:' + body.userId] : (body.pairKey ? ['c:' + body.pairKey, 'mc:' + body.pairKey] : []);
      let removed = 0;
      for (const k of keys) {
        const list = await getEarned(k);
        const next = list.filter((x) => (typeof x === 'string' ? x : x.id) !== rid);
        if (next.length !== list.length) { await setEarned(k, next); removed++; }
      }
      return { ok: true, removed };
    }
    case 'leaderboard': {
      const ids = await allUserIds();
      const users = [];
      for (const id of ids) {
        const u = await getUser(id);
        if (!u) continue;
        const earned = (await getEarned('u:' + id)).length + (await getEarned('m:' + id)).length;
        const st = await userStats(id);
        users.push({ id, name: u.first_name || id, badges: earned, likes: st.likes, matches: st.matches, watched: st.watched });
      }
      users.sort((a, b) => b.badges - a.badges || b.matches - a.matches);
      const pairs = [];
      for (const [a, b] of await allPairs()) {
        const ua = await getUser(a), ub = await getUser(b);
        const key = [a, b].sort().join('|');
        const earned = (await getEarned('c:' + key)).length + (await getEarned('mc:' + key)).length;
        pairs.push({ key, name: `${ua ? ua.first_name : a} + ${ub ? ub.first_name : b}`, badges: earned });
      }
      pairs.sort((x, y) => y.badges - x.badges);
      return { ok: true, users, pairs };
    }

    /* ---------- принудительно обновить клавиатуру у всех ---------- */
    case 'keyboard.refresh': {
      const ids = await allUserIds();
      const kb = {
        keyboard: [
          [{ text: FRIEND_BTN }],
          [{ text: BTN_MATCHES }, { text: BTN_BADGES }],
          [{ text: BTN_PARTNERS }, { text: BTN_HELP }],
        ],
        resize_keyboard: true,
        is_persistent: true,
      };
      let sent = 0;
      for (const id of ids) {
        const r = await tg('sendMessage', {
          chat_id: id, reply_markup: kb,
          text: '⌨️ Клавиатура бота обновлена: кнопки стали новыми, старые исчезли.',
        }, token);
        if (r && r.ok) sent++;
        await new Promise((r2) => setTimeout(r2, 60));
      }
      await pushBroadcastLog({ kind: 'keyboard', text: 'Обновление клавиатуры бота (убрать старую кнопку «Приложение»)', sent, failed: ids.length - sent, total: ids.length });
      return { ok: true, sent, total: ids.length };
    }

    /* ---------- анонс «Что нового» ---------- */
    case 'announce.get': return { ok: true, announce: await getAnnounce() };
    case 'announce.set': {
      const title = String(body.title || '').trim();
      const text = String(body.text || '').trim();
      if (!title && !text) return { ok: false, error: 'Заполните заголовок или текст' };
      const ann = { id: 'a' + Date.now().toString(36), title, text, ts: Date.now() };
      await setAnnounce(ann);
      const userCount = (await allUserIds()).length;
      await pushBroadcastLog({ kind: 'announce', title, text, total: userCount, sent: 0, failed: 0, note: 'анонс в приложении' });
      return { ok: true, announce: ann, reach: userCount };
    }

    /* ---------- полный сброс ---------- */
    case 'wipe': {
      if (String(body.confirm) !== 'WIPE') return { ok: false, error: 'Для подтверждения введите WIPE' };
      const ids = await allUserIds();
      for (const id of ids) {
        await setVotes(id, {});
        await db().delete('bg:u:' + id);
        await db().delete('bg:m:' + id);
        await db().delete('ban:' + id);
      }
      for (const [a, b] of await allPairs()) {
        const key = [a, b].sort().join('|');
        await db().delete('bg:c:' + key);
        await db().delete('bg:mc:' + key);
      }
      // группы тоже стираем: мэтчи компании и индексы участников
      for (const gid of await allGroupIds()) {
        const g = await getGroup(gid);
        for (const uid of ((g && g.members) || [])) await db().delete('gi:' + uid);
        if (g && g.code) await db().delete('gc:' + g.code);
        await db().delete('grp:' + gid);
      }
      await db().set('grp:index', '[]');
      await setMatches([]);
      await setHidden([]);
      await saveCustomFilms([]);
      return { ok: true, users: ids.length };
    }

    default:
      return { ok: false, error: 'Неизвестное админ-действие: ' + action };
  }
}

export { verifyAdminSession, adminHasPassword };
