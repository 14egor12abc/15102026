/* ============================================================
   ОБНОВЛЕНИЕ КАТАЛОГА БЕЗ ПЕРЕСБОРКИ ПРОЕКТА
   Всё, что подтягивает эта функция, сохраняется в Netlify Blobs
   и сразу попадает в приложение (через getCatalogAll и hello).

   Два режима:
     • ratings — свежие рейтинги КиноПоиска для УЖЕ имеющихся фильмов
                 (rating.kinopoisk.ru/<kpId>.xml). Работает быстро и надёжно,
                 поэтому идёт «порциями» по курсору: каждый вызов обновляет
                 следующую пачку, по расписанию каталог освежается целиком.
     • new     — новинки: популярные сейчас фильмы TMDB, которых ещё нет
                 в каталоге. Для каждого ищем id КиноПоиска (Wikidata) и
                 настоящий рейтинг. Это тяжелее, поэтому пачка небольшая.

   Все сетевые вызовы идут через `fetcher` (по умолчанию globalThis.fetch) —
   так функцию можно тестировать на «подставных» ответах.
   ============================================================ */
import { CATALOG } from './_catalog.mjs';
import {
  getRatingOverrides, setRatingOverrides, getRefreshCursor, setRefreshCursor,
  getRefreshMeta, setRefreshMeta, getDynamicFilms, saveDynamicFilms, db,
} from './_shared.mjs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const H = { 'User-Agent': UA, 'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8' };
const WIKIDATA_UA = 'KinoFikBot/1.0 (private Telegram mini-app) node';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withTimeout(promise, ms) {
  let t;
  return Promise.race([
    promise.finally(() => clearTimeout(t)),
    new Promise((_, rej) => { t = setTimeout(() => rej(new Error('timeout')), ms); }),
  ]);
}

/* ============================================================
   РЕЖИМ 1: свежие рейтинги КиноПоиска
   ============================================================ */
export function parseKpXml(xml) {
  const s = String(xml || '');
  const kp = s.match(/<kp_rating[^>]*>\s*([\d.]+)\s*<\/kp_rating>/i);
  const kpVotes = s.match(/<kp_rating[^>]*num_vote="(\d+)"/i);
  const imdb = s.match(/<imdb_rating[^>]*>\s*([\d.]+)\s*<\/imdb_rating>/i);
  const kpVal = kp ? Math.round(parseFloat(kp[1]) * 10) / 10 : null;
  return {
    kp: Number.isFinite(kpVal) && kpVal > 0 ? kpVal : null,
    votes: kpVotes ? parseInt(kpVotes[1], 10) : null,
    imdb: imdb ? Math.round(parseFloat(imdb[1]) * 10) / 10 : null,
  };
}

// фильмы с известным id КиноПоиска, в стабильном порядке
function ratingTargets() {
  return Object.entries(CATALOG)
    .filter(([, c]) => c && c.k)
    .map(([id, c]) => ({ id, kpId: c.k }))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

export async function refreshRatings(batch = 30, fetcher = globalThis.fetch, concurrency = 6) {
  const targets = ratingTargets();
  const meta0 = await getRefreshMeta();
  if (!targets.length) return { ok: true, mode: 'ratings', checked: 0, updated: 0, failed: 0, note: 'Нет фильмов с id КиноПоиска' };
  let cursor = await getRefreshCursor();
  if (!(cursor >= 0) || cursor >= targets.length) cursor = 0;
  const ov = await getRatingOverrides();
  let checked = 0, updated = 0, failed = 0;
  const end = Math.min(targets.length, cursor + Math.max(1, Number(batch) || 30));
  const slice = targets.slice(cursor, end);

  // параллельно, но ограниченным пулом — чтобы уложиться в лимит времени функции
  let idx = 0;
  const worker = async () => {
    while (idx < slice.length) {
      const { id, kpId } = slice[idx++];
      checked++;
      try {
        const r = await withTimeout(fetcher(`https://rating.kinopoisk.ru/${kpId}.xml`, { headers: H }), 6000);
        if (!r || !r.ok) { failed++; continue; }
        const p = parseKpXml(await r.text());
        if (p.kp != null) {
          const prev = ov[id];
          ov[id] = { r: p.kp, votes: p.votes, imdb: p.imdb, ts: Date.now() };
          if (!prev || prev.r !== p.kp) updated++;
        } else failed++;
      } catch (e) { failed++; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, slice.length) }, worker));

  await setRatingOverrides(ov);
  const wrapped = end >= targets.length;
  await setRefreshCursor(wrapped ? 0 : end);
  const meta = Object.assign({}, meta0, {
    lastRatings: Date.now(),
    ratingsOverrides: Object.keys(ov).length,
    ratingsCursor: wrapped ? 0 : end,
    ratingsTargets: targets.length,
  });
  await setRefreshMeta(meta);
  return {
    ok: true, mode: 'ratings', checked, updated, failed, wrapped,
    cursor: wrapped ? 0 : end, targets: targets.length, overrides: Object.keys(ov).length,
  };
}

/* ============================================================
   РЕЖИМ 2: новинки с TMDB
   ============================================================ */
const decode = (s) => String(s)
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&nbsp;/g, ' ').trim();

const isoToMinutes = (iso) => {
  if (!iso) return null;
  const m = String(iso).match(/PT(?:(\d+)H)?(?:(\d+)M)?/i);
  if (!m) return null;
  const v = (+m[1] || 0) * 60 + (+m[2] || 0);
  return v || null;
};

function parseLD(html) {
  const m = String(html).match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (!m) return null;
  const raw = m[1].replace(/\/\* <!\[CDATA\[ \*\//g, '').replace(/\/\* \]\]> \*\//g, '').trim();
  try { return JSON.parse(raw); } catch (e) { return null; }
}
const firstOf = (html, re) => { const m = String(html).match(re); return m ? decode(m[1].replace(/<[^>]+>/g, '')).trim() : null; };

// TMDB периодически меняет вёрстку списка, поэтому надёжнее всего просто
// собрать уникальные id фильмов из ссылок href="/movie/<id>"
function parseMovieIds(text) {
  const ids = [];
  const seen = new Set();
  const re = /href="\/movie\/(\d+)/g;
  let m;
  while ((m = re.exec(String(text)))) {
    const id = m[1];
    if (!seen.has(id)) { seen.add(id); ids.push(id); }
  }
  return ids;
}

const GENRE_FIX = {
  'нф': 'фантастика', 'научная фантастика': 'фантастика', 'sci-fi': 'фантастика',
  'боевик и приключения': 'боевик', 'приключенческий боевик': 'боевик',
  'детский': 'семейный', 'мыльная опера': 'мелодрама', 'аниме': 'мультфильм',
  'анимационный': 'мультфильм', 'комедийный': 'комедия',
};
const DROP_GENRES = new Set(['телевик', 'кино о кино', 'новости', 'реалити', 'разговорное']);
function cleanGenres(g) {
  return [...new Set((g || [])
    .flatMap((x) => String(x).split(/\s+и\s+|\s*,\s*/i))
    .map((x) => x.trim().toLowerCase())
    .map((x) => (x in GENRE_FIX ? GENRE_FIX[x] : x))
    .filter((x) => x && x.length > 1 && !DROP_GENRES.has(x)))];
}

async function fetchDetails(fetcher, id) {
  const r = await withTimeout(fetcher(`https://www.themoviedb.org/movie/${id}?language=ru-RU`, { headers: H }), 8000);
  if (!r || !r.ok) return null;
  const text = await r.text();
  const ld = parseLD(text);
  const out = { tmdbId: +id };
  if (ld) {
    out.title = ld.name || null;
    out.description = (ld.description || '').trim() || null;
    out.genres = Array.isArray(ld.genre) ? ld.genre : (ld.genre ? [ld.genre] : []);
    out.ratingTmdb = ld.aggregateRating?.ratingValue ?? null;
    out.votesTmdb = ld.aggregateRating?.ratingCount ?? null;
    out.countries = (ld.countryOfOrigin || []).map((c) => c.name);
    out.minutes = isoToMinutes(ld.duration);
    const d = (ld.releasedEvent && ld.releasedEvent[0] && ld.releasedEvent[0].startDate) || ld.datePublished || null;
    out.date = typeof d === 'string' ? d.slice(0, 10) : null;
    out.poster = ld.image || null;
  }
  out.originalTitle = firstOf(text, /<strong>Исходное название<\/strong>\s*([^<]+)</);
  out.ageRating = firstOf(text, /<span class="certification">\s*([^<]+?)\s*</);
  if (!out.minutes) { const m = text.match(/(\d+)h\s*(\d+)m/); out.minutes = m ? (+m[1]) * 60 + (+m[2]) : null; }
  const posterHash = (out.poster || '').match(/\/([A-Za-z0-9]+)\.(?:jpg|png)$/);
  out.poster = posterHash ? `https://image.tmdb.org/t/p/w500/${posterHash[1]}.jpg` : (out.poster || null);
  return out;
}

async function kpIdForTmdb(fetcher, tmdbIds) {
  const map = {};
  if (!tmdbIds.length) return map;
  const q = `SELECT ?tmdb ?kp WHERE { VALUES ?tmdb { ${tmdbIds.map((x) => `'${x}'`).join(' ')} } ?item wdt:P4947 ?tmdb. ?item wdt:P2603 ?kp. }`;
  try {
    const r = await withTimeout(fetcher('https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(q), {
      headers: { 'User-Agent': WIKIDATA_UA, Accept: 'application/sparql-results+json' },
    }), 8000);
    if (r && r.ok) {
      const j = await r.json();
      for (const b of (j.results && j.results.bindings ? j.results.bindings : [])) {
        map[String(b.tmdb.value).split('/').pop()] = String(b.kp.value);
      }
    }
  } catch (e) { /* Wikidata может отказать — не критично */ }
  return map;
}

/* ============================================================
   ПЛАН «Б» ДЛЯ НОВИНОК: ВИКИПЕДИЯ + WIKIDATA
   TMDB агрессивно блокирует запросы с серверных IP (403 Cloudflare),
   из-за чего «Подтянуть новинки» в админке возвращал «добавлено 0».
   Если список TMDB получить не удалось, новинки ищутся так:
     1. свежие категории «Фильмы/Мультфильмы <год>» в ру-Википедии
        ∩ самые просматриваемые статьи вчерашнего дня (это и есть
        фильмы, которые сейчас ищут);
     2. из Викиданных берём id КиноПоиска (P2603) и TMDB (P4947),
        дату выхода (P577), хронометраж (P2046), жанры (P136);
     3. постер и описание — из MediaWiki (pageimages + extracts);
     4. настоящий рейтинг — из rating.kinopoisk.ru (как в режиме ratings).
   Список кандидатов кэшируется в Blobs на ~3 дня: повторные нажатия
   кнопки в админке идут быстро и не долбят Википедию.
   ============================================================ */
const WIKI_UA = 'KinoFikBot/1.0 (https://kinofik.app; admin@kinofik.app) node';
const MW_API = 'https://ru.wikipedia.org/w/api.php';
const WD_API = 'https://www.wikidata.org/w/api.php';
const CAND_TTL = 3 * 86400e3;

export function normTitle(s) {
  return String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^0-9a-zа-я\s]/gi, '').replace(/\s+/g, ' ').trim();
}
const chunked = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };

export async function wikiTopTitles(fetcher = globalThis.fetch) {
  // 1) самые просматриваемые статьи за вчера (не готовы — позавчера)
  let top = [];
  for (let back = 1; back <= 2 && !top.length; back++) {
    const d = new Date(Date.now() - back * 86400e3);
    const p = [d.getUTCFullYear(), String(d.getUTCMonth() + 1).padStart(2, '0'), String(d.getUTCDate()).padStart(2, '0')].join('/');
    try {
      const r = await withTimeout(fetcher(`https://wikimedia.org/api/rest_v1/metrics/pageviews/top/ru.wikipedia/all-access/${p}`, {
        headers: { 'User-Agent': WIKI_UA, Accept: 'application/json' },
      }), 6000);
      if (r && r.ok) {
        const j = await r.json();
        top = ((((j.items || [])[0]) || {}).articles || [])
          .map((a) => { try { return decodeURIComponent(String(a.article).replace(/_/g, ' ')); } catch (e) { return String(a.article).replace(/_/g, ' '); } })
          .filter((t) => t && !/^(Главная|Служебная|Special|Википедия|Портал|Шаблон|Категория|Обсуждение|Модуль|Файл)/i.test(t));
      }
    } catch (e) { /* пробуем день раньше */ }
  }
  // 2) категории фильмов и мультфильмов текущего и прошлого года
  const year = new Date().getFullYear();
  const cats = [];
  for (const y of [year, year - 1]) for (const c of ['Фильмы', 'Мультфильмы']) cats.push(`Категория:${c} ${y} года`);
  const catSet = new Set();
  await Promise.all(cats.map(async (c) => {
    try {
      const u = `${MW_API}?action=query&list=categorymembers&cmtitle=${encodeURIComponent(c)}&cmlimit=500&format=json&formatversion=2`;
      const r = await withTimeout(fetcher(u, { headers: { 'User-Agent': WIKI_UA, Accept: 'application/json' } }), 6000);
      if (r && r.ok) {
        const j = await r.json();
        for (const m of ((j.query || {}).categorymembers || [])) if (m && m.title) catSet.add(String(m.title));
      }
    } catch (e) { /* идем дальше без этой категории */ }
  }));
  const hot = top.filter((t) => catSet.has(t));
  const hotSet = new Set(hot);
  const rest = [...catSet].filter((t) => !hotSet.has(t));
  const out = hot.concat(rest);
  // категории недоступны — пробуем весь топ просмотров: не-фильмы
  // отсеются на этапе Викиданных (нет id КиноПоиска/TMDB)
  return out.length ? out : top.slice(0, 60);
}

const SERIES_Q = new Set(['Q5398426', 'Q3553583', 'Q21191270']); // телесериал и похожие

// жанры из Викиданных длиннее каталожных («комедийный фильм» вместо «комедия») —
// приводим к тем же коротким названиям, чтобы фильтры колоды их понимали
const WIKI_GENRE_FIX = {
  'фэнтезийный фильм': 'фэнтези', 'фильм фэнтези': 'фэнтези',
  'научно-фантастический фильм': 'фантастика', 'научная фантастика': 'фантастика',
  'комедийный фильм': 'комедия', 'кинокомедия': 'комедия', 'трагикомедийный фильм': 'трагикомедия',
  'приключенческий фильм': 'приключения', 'приключения': 'приключения',
  'драматический фильм': 'драма', 'фильм-драма': 'драма', 'фильм о взрослении': 'драма',
  'анимационный фильм': 'мультфильм', 'полнометражный анимационный фильм': 'мультфильм', 'мультфильм': 'мультфильм',
  'фильм ужасов': 'ужасы', 'криминальный фильм': 'криминал', 'детективный фильм': 'детектив',
  'семейный фильм': 'семейный', 'спортивный фильм': 'спорт', 'военный фильм': 'военный',
  'исторический фильм': 'история', 'фильм-биография': 'биография', 'биографический фильм': 'биография',
  'романтический фильм': 'мелодрама', 'романтическая комедия': 'мелодрама', 'мелодраматический фильм': 'мелодрама',
  'фильм-триллер': 'триллер', 'триллер': 'триллер', 'боевик': 'боевик', 'фильм-боевик': 'боевик',
};
function wikiGenre(g) {
  const s = String(g || '').trim().toLowerCase();
  if (WIKI_GENRE_FIX[s]) return WIKI_GENRE_FIX[s];
  return s.replace(/\s+(фильм|кино)$/i, '').trim();
}

export async function wikiEntities(fetcher, titles) {
  const ents = [];
  await Promise.all(chunked(titles, 20).map(async (b) => {
    const u = `${WD_API}?action=wbgetentities&sites=ruwiki&props=claims|sitelinks|labels&languages=ru&format=json&formatversion=2&titles=${encodeURIComponent(b.join('|'))}`;
    try {
      const r = await withTimeout(fetcher(u, { headers: { 'User-Agent': WIKI_UA, Accept: 'application/json' } }), 8000);
      if (r && r.ok) {
        const j = await r.json();
        for (const e of Object.values(j.entities || {})) if (e && e.missing === undefined) ents.push(e);
      }
    } catch (e) { /* партия не удалась — пропускаем */ }
  }));
  const vals = (e, pid) => (((e.claims || {})[pid]) || [])
    .map((c) => (c.mainsnak && c.mainsnak.datavalue ? c.mainsnak.datavalue.value : null))
    .filter((v) => v != null);
  const qid = (v) => (v && typeof v === 'object' ? String(v.id || '') : String(v));
  const genreIds = new Set();
  const out = [];
  for (const e of ents) {
    const kp = vals(e, 'P2603').map(String)[0] || null;
    const tmdb = vals(e, 'P4947').map(String)[0] || null;
    const dateV = vals(e, 'P577')[0];
    const minV = vals(e, 'P2046')[0];
    const p31 = vals(e, 'P31').map(qid);
    const genresQ = vals(e, 'P136').map(qid).filter(Boolean);
    genresQ.forEach((g) => genreIds.add(g));
    const title = (((e.labels || {}).ru) || {}).value || (((e.sitelinks || {}).ruwiki) || {}).title || '';
    if (!title || (!kp && !tmdb)) continue;   // без id КиноПоиска/TMDB карточка бесполезна
    out.push({
      title: String(title), kp, tmdb,
      date: dateV && dateV.time ? String(dateV.time).replace(/^\+/, '').slice(0, 10) : null,
      minutes: minV && minV.amount != null ? Math.round(parseFloat(String(minV.amount).replace('+', ''))) : null,
      tp: p31.some((q) => SERIES_Q.has(q)) ? 'series' : 'movie',
      genresQ,
    });
  }
  // названия жанров (Q-id → по-русски) — один дополнительный запрос
  const gmap = {};
  for (const b of chunked([...genreIds], 50)) {
    const u = `${WD_API}?action=wbgetentities&props=labels&languages=ru&format=json&formatversion=2&ids=${encodeURIComponent(b.join('|'))}`;
    try {
      const r = await withTimeout(fetcher(u, { headers: { 'User-Agent': WIKI_UA, Accept: 'application/json' } }), 6000);
      if (r && r.ok) {
        const j = await r.json();
        for (const [id, ent] of Object.entries(j.entities || {})) {
          const v = (((ent.labels || {}).ru) || {}).value;
          if (v) gmap[id] = String(v);
        }
      }
    } catch (e) { /* идем без названий жанров */ }
  }
  for (const o of out) {
    o.genres = cleanGenres(o.genresQ.map((q) => wikiGenre(gmap[q])).filter(Boolean));
    delete o.genresQ;
  }
  return out;
}

export async function wikiImagesAndDescs(fetcher, titles) {
  const map = {};
  await Promise.all(chunked(titles, 20).map(async (b) => {
    const u = `${MW_API}?action=query&prop=pageimages|extracts&piprop=thumbnail|name&pithumbsize=500&pilicense=any`
      + `&exintro=1&explaintext=1&exlimit=20&redirects=1&format=json&formatversion=2&titles=${encodeURIComponent(b.join('|'))}`;
    try {
      const r = await withTimeout(fetcher(u, { headers: { 'User-Agent': WIKI_UA, Accept: 'application/json' } }), 7000);
      if (r && r.ok) {
        const j = await r.json();
        for (const p of ((j.query || {}).pages || [])) {
          map[normTitle(p.title)] = {
            poster: (p.thumbnail && p.thumbnail.source) || null,
            desc: p.extract ? String(p.extract).replace(/\s+/g, ' ').trim() : null,
          };
        }
      }
    } catch (e) { /* идем без постеров */ }
  }));
  return map;
}

async function getNewCandCache() {
  try {
    const raw = await db().get('refresh:newcand');
    const j = raw ? JSON.parse(raw) : null;
    if (j && Array.isArray(j.items) && j.items.length && Date.now() - Number(j.ts || 0) < CAND_TTL) return j.items;
  } catch (e) { /* кэш не читается */ }
  return null;
}
async function setNewCandCache(items) {
  try { await db().set('refresh:newcand', JSON.stringify({ ts: Date.now(), items })); } catch (e) { /* не критично */ }
}

export async function wikiCandidates(fetcher = globalThis.fetch, limit = 24) {
  const cached = await getNewCandCache();
  if (cached) return cached;
  const titles = (await wikiTopTitles(fetcher)).slice(0, 40);
  if (!titles.length) return [];
  const ents = await wikiEntities(fetcher, titles);
  const keep = ents.slice(0, limit);
  if (!keep.length) return [];
  await setNewCandCache(keep);   // страховка: кэш уже есть, даже если не успеем всё
  const im = await wikiImagesAndDescs(fetcher, keep.map((e) => e.title));
  for (const e of keep) {
    const x = im[normTitle(e.title)];
    e.poster = (x && x.poster) || null;
    e.desc = (x && x.desc) || null;
  }
  await setNewCandCache(keep);   // теперь с постерами и описаниями
  return keep;
}

const AGE = { 'G': '0+', 'PG': '6+', 'PG-13': '12+', 'R': '16+', 'NC-17': '18+', 'NR': '16+', '12A': '12+', '15': '16+', '18': '18+', '0+': '0+', '6+': '6+', '12+': '12+', '16+': '16+', '18+': '18+' };

export async function fetchNew(batch = 6, fetcher = globalThis.fetch) {
  const t0 = Date.now();
  // что уже есть в каталоге (статика + динамика): id, kpId и названия
  const have = new Set();
  const haveKp = new Set();
  const haveTitles = new Set();
  for (const id of Object.keys(CATALOG)) {
    const n = String(id).replace(/^[ms]/, ''); if (n) have.add(n);
    const c = CATALOG[id] || {};
    if (c.k) haveKp.add(String(c.k));
    if (c.t) haveTitles.add(normTitle(c.t));
  }
  const dyn = await getDynamicFilms();
  for (const f of dyn) {
    const n = String(f.id || '').replace(/^[ms]/, ''); if (n) have.add(n);
    if (f.tmdbId) have.add(String(f.tmdbId));
    if (f.k) haveKp.add(String(f.k));
    if (f.t) haveTitles.add(normTitle(f.t));
  }

  /* ---------- план А: список популярных фильмов TMDB ----------
     С серверных IP TMDB часто отвечает 403 (Cloudflare) — тогда ids пустой
     и мы переключаемся на план Б (Википедия + Викиданные). */
  let ids = [];
  let tmdbOk = false;
  try {
    const r = await withTimeout(fetcher('https://www.themoviedb.org/movie?language=ru-RU', { headers: H }), 8000);
    if (r && r.ok) { ids = parseMovieIds(await r.text()); tmdbOk = true; }
  } catch (e) { ids = []; }

  if (ids.length) {
    const fresh = ids.filter((id) => !have.has(String(id))).slice(0, Math.max(1, Number(batch) || 6));
    if (!fresh.length) {
      return { ok: true, mode: 'new', scanned: ids.length, added: 0, source: 'tmdb', note: 'Новинок не найдено (всё уже в каталоге)' };
    }
    const kpMap = await kpIdForTmdb(fetcher, fresh);
    const added = [];
    // параллельно обрабатываем карточки, но небольшим пулом (лимит времени функции)
    let idx = 0;
    const worker = async () => {
      while (idx < fresh.length) {
        const id = fresh[idx++];
        try {
          const d = await fetchDetails(fetcher, id);
          if (!d || !d.title) continue;
          const kpId = kpMap[String(id)] || null;
          let kp = null, kpVotes = null;
          if (kpId) {
            try {
              const rr = await withTimeout(fetcher(`https://rating.kinopoisk.ru/${kpId}.xml`, { headers: H }), 6000);
              if (rr && rr.ok) { const p = parseKpXml(await rr.text()); kp = p.kp; kpVotes = p.votes; }
            } catch (e) { /* без рейтинга — не беда */ }
          }
          const rating = kp != null ? kp : (d.ratingTmdb != null ? Math.round(d.ratingTmdb * 10) / 10 : null);
          const src = kp != null ? 'kp' : (d.ratingTmdb != null ? 'tmdb' : null);
          const year = d.date ? +d.date.slice(0, 4) : null;
          const film = {
            id: 'm' + id,
            t: d.title, y: year, tp: 'movie',
            p: d.poster || null, r: rating, s: src,
            g: cleanGenres(d.genres), minutes: d.minutes || null,
            desc: d.description ? String(d.description).slice(0, 520) : null,
            country: (d.countries && d.countries[0]) || null,
            age: AGE[d.ageRating] || d.ageRating || null,
            k: kpId ? +kpId : null, tmdbId: +id, votes: kpVotes || d.votesTmdb || null,
            addedTs: Date.now(), src2: 'refresh',
          };
          if (!dyn.some((x) => x.id === film.id) && !added.some((x) => x.id === film.id)) added.push(film);
        } catch (e) { /* пропускаем проблемную карточку */ }
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, fresh.length) }, worker));
    for (const f of added) if (!dyn.some((x) => x.id === f.id)) dyn.push(f);
    if (added.length) await saveDynamicFilms(dyn);
    const meta = Object.assign({}, await getRefreshMeta(), { lastNew: Date.now(), newTotal: dyn.length, lastNewSource: 'tmdb' });
    await setRefreshMeta(meta);
    return { ok: true, mode: 'new', scanned: ids.length, added: added.length, titles: added.map((f) => f.t), total: dyn.length, source: 'tmdb' };
  }

  /* ---------- план Б: новинки из Википедии и Викиданных ---------- */
  const whyNoTmdb = tmdbOk ? 'TMDB вернул пустой список' : 'TMDB недоступен (блокирует запросы с серверов)';
  let cands = [];
  try { cands = await wikiCandidates(fetcher); } catch (e) { cands = []; }
  if (!cands.length) {
    return { ok: true, mode: 'new', scanned: 0, added: 0, source: 'wiki',
      note: whyNoTmdb + '; кандидатов из Википедии тоже получить не удалось — попробуйте ещё раз через минуту' };
  }
  const freshC = cands.filter((c) => {
    if (c.tmdb && have.has(String(c.tmdb))) return false;
    if (c.kp && haveKp.has(String(c.kp))) return false;
    return !haveTitles.has(normTitle(c.title));
  }).slice(0, Math.max(1, Number(batch) || 6));
  if (!freshC.length) {
    return { ok: true, mode: 'new', scanned: cands.length, added: 0, source: 'wiki',
      note: whyNoTmdb + '; кандидаты из Википедии проверены — все уже есть в каталоге' };
  }
  // холодная сборка кэша кандидатов занимает большую часть лимита времени
  // функции: если мы уже впритык — не рискуем и просим нажать кнопку ещё раз
  // (кэш сохранён, следующий запуск пройдёт быстро)
  if (Date.now() - t0 > 4500) {
    return { ok: true, mode: 'new', scanned: cands.length, added: 0, source: 'wiki',
      note: whyNoTmdb + '; список новых кандидатов (' + freshC.length + ') готов — нажмите «Подтянуть новинки» ещё раз, чтобы добавить их' };
  }
  // настоящие рейтинги КиноПоиска — небольшим пулом
  const added = [];
  let idx2 = 0;
  const worker2 = async () => {
    while (idx2 < freshC.length) {
      const c = freshC[idx2++];
      let kp = null, kpVotes = null;
      if (c.kp) {
        try {
          const rr = await withTimeout(fetcher(`https://rating.kinopoisk.ru/${c.kp}.xml`, { headers: H }), 4000);
          if (rr && rr.ok) { const p = parseKpXml(await rr.text()); kp = p.kp; kpVotes = p.votes; }
        } catch (e) { /* без рейтинга — не беда */ }
      }
      const year = c.date ? +String(c.date).slice(0, 4) : null;
      const film = {
        id: c.tmdb ? 'm' + c.tmdb : 'k' + c.kp,
        t: c.title, y: year, tp: c.tp || 'movie',
        p: c.poster || null, r: kp, s: kp != null ? 'kp' : null,
        g: c.genres || [], minutes: c.minutes || null,
        desc: c.desc ? String(c.desc).slice(0, 520) : null,
        country: null, age: null,
        k: c.kp ? +c.kp : null, tmdbId: c.tmdb ? +c.tmdb : null,
        votes: kpVotes || null,
        addedTs: Date.now(), src2: 'refresh-wiki',
      };
      if (!dyn.some((x) => x.id === film.id) && !added.some((x) => x.id === film.id)) added.push(film);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, freshC.length) }, worker2));
  for (const f of added) if (!dyn.some((x) => x.id === f.id)) dyn.push(f);
  if (added.length) await saveDynamicFilms(dyn);
  const meta = Object.assign({}, await getRefreshMeta(), { lastNew: Date.now(), newTotal: dyn.length, lastNewSource: 'wiki' });
  await setRefreshMeta(meta);
  return {
    ok: true, mode: 'new', scanned: cands.length, added: added.length,
    titles: added.map((f) => f.t), total: dyn.length, source: 'wiki',
    note: whyNoTmdb + ' — новинки добавлены через Википедию и Викиданные',
    ms: Date.now() - t0,
  };
}

/* ---------- общий запуск ---------- */
export async function refreshCatalog(opts = {}) {
  const mode = opts.mode || 'all';
  const out = { ok: true, mode };
  if (mode === 'ratings' || mode === 'all') out.ratings = await refreshRatings(opts.batch || 40, opts.fetcher || globalThis.fetch);
  if (mode === 'new' || mode === 'all') out.new = await fetchNew(opts.newBatch || 8, opts.fetcher || globalThis.fetch);
  return out;
}

export async function refreshStatus() {
  const meta = await getRefreshMeta();
  const ov = await getRatingOverrides();
  const dyn = await getDynamicFilms();
  return {
    ok: true,
    lastRatings: meta.lastRatings || null,
    lastNew: meta.lastNew || null,
    overrides: Object.keys(ov).length,
    newFilms: dyn.length,
    cursor: meta.ratingsCursor || 0,
    targets: meta.ratingsTargets || ratingTargets().length,
  };
}
