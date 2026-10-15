// Система наград: каталог значков и их вычисление по данным пользователя/пары
export const BADGES = [
  // ---- личные ----
  { id: 'p_first_like', scope: 'user', icon: '🌱', title: 'Первый лайк', desc: 'Поставить первый лайк' },
  { id: 'p_likes_10', scope: 'user', icon: '👍', title: 'Десяточка', desc: '10 лайков' },
  { id: 'p_likes_50', scope: 'user', icon: '🔥', title: 'Полсотни', desc: '50 лайков' },
  { id: 'p_likes_100', scope: 'user', icon: '💯', title: 'Сотня', desc: '100 лайков' },
  { id: 'p_votes_50', scope: 'user', icon: '🎬', title: 'Киноман', desc: '50 любых голосов' },
  { id: 'p_votes_200', scope: 'user', icon: '🍿', title: 'Кинопедия', desc: '200 любых голосов' },
  { id: 'p_first_match', scope: 'user', icon: '💘', title: 'Первый мэтч', desc: 'Первый совместный мэтч' },
  { id: 'p_matches_10', scope: 'user', icon: '💞', title: 'Сердцеед', desc: '10 мэтчей' },
  { id: 'p_matches_25', scope: 'user', icon: '💖', title: 'Лав-машина', desc: '25 мэтчей' },
  { id: 'p_first_watch', scope: 'user', icon: '📺', title: 'Первый совместный', desc: 'Отметить первый просмотр' },
  { id: 'p_watch_10', scope: 'user', icon: '🛋️', title: 'Диванный критик', desc: '10 просмотренных' },
  { id: 'p_first_rate', scope: 'user', icon: '⭐', title: 'Первая оценка', desc: 'Поставить первую оценку «как зашло»' },
  { id: 'p_rate_5', scope: 'user', icon: '🧐', title: 'Критик', desc: '5 оценок «как зашло»' },
  { id: 'p_genre_5', scope: 'user', icon: '🧭', title: 'Широкий вкус', desc: 'Мэтчи в 5 разных жанрах' },
  // ---- серии дней подряд ----
  { id: 'p_streak_3', scope: 'user', icon: '🔥', title: 'Три дня подряд', desc: 'Свайпать 3 дня подряд' },
  { id: 'p_streak_7', scope: 'user', icon: '📅', title: 'Неделя без пропусков', desc: 'Свайпать 7 дней подряд' },
  { id: 'p_streak_30', scope: 'user', icon: '🌋', title: 'Месяц марафона', desc: 'Свайпать 30 дней подряд' },
  // ---- приглашения друзей ----
  { id: 'p_ref_1', scope: 'user', icon: '📣', title: 'Первый приглашённый', desc: 'Позвать одного друга по своей ссылке' },
  { id: 'p_ref_3', scope: 'user', icon: '🤝', title: 'Вербовщик', desc: '3 друга пришли по вашей ссылке' },
  { id: 'p_ref_10', scope: 'user', icon: '🌟', title: 'Амбассадор кино', desc: '10 друзей пришли по вашей ссылке' },
  // ---- секретные (показываются как «?» пока не заработаны) ----
  { id: 'p_night_owl', scope: 'user', icon: '🦉', title: 'Ночная сова', desc: 'Секретная награда', secret: true, hint: 'Подсказка: кино любят смотреть по ночам…', reveal: '5 лайков, поставленных глубокой ночью' },
  { id: 'p_day_marathon', scope: 'user', icon: '⚡', title: 'Марафонец', desc: 'Секретная награда', secret: true, hint: 'Подсказка: свайпать всё и сразу за один день', reveal: '30 свайпов за один день' },
  { id: 'p_omnivore', scope: 'user', icon: '🍱', title: 'Всеядный', desc: 'Секретная награда', secret: true, hint: 'Подсказка: вкус шире, чем кажется', reveal: 'Лайки в 8 разных жанрах' },
  // ---- парные ----
  { id: 'c_first_match', scope: 'couple', icon: '💞', title: 'Первый общий мэтч', desc: 'Совпадение в паре' },
  { id: 'c_matches_10', scope: 'couple', icon: '❤️', title: 'Десять общих', desc: '10 мэтчей в паре' },
  { id: 'c_matches_25', scope: 'couple', icon: '💍', title: 'Серебряная подборка', desc: '25 мэтчей в паре' },
  { id: 'c_first_watch', scope: 'couple', icon: '🍿', title: 'Первый вечер вместе', desc: 'Первый совместный просмотр' },
  { id: 'c_watch_5', scope: 'couple', icon: '🛋️', title: 'Пять вечеров', desc: '5 совместных просмотров' },
  { id: 'c_watch_20', scope: 'couple', icon: '🏠', title: 'Киносемья', desc: '20 совместных просмотров' },
  { id: 'c_both_rate', scope: 'couple', icon: '⚖️', title: 'Оба оценили', desc: 'Один фильм оценён обоими' },
  { id: 'c_high_5', scope: 'couple', icon: '🌟', title: 'Восторг', desc: 'Средняя совместная оценка 4.5+' },
  { id: 'c_genre_4', scope: 'couple', icon: '🧭', title: 'Четыре жанра вместе', desc: 'Мэтчи в 4 жанрах в паре' },
  { id: 'c_marathon', scope: 'couple', icon: '🎞️', title: 'Марафон', desc: '10+ часов просмотренного вместе' },
  // ---- уровни пары (по числу общих мэтчей) ----
  { id: 'c_lvl_1', scope: 'couple', icon: '🎬', title: 'Киноманы · 1 уровень', desc: 'Первый общий мэтч — уровень получен!' },
  { id: 'c_lvl_2', scope: 'couple', icon: '🎥', title: 'Киноманы · 2 уровень', desc: '5 общих мэтчей' },
  { id: 'c_lvl_3', scope: 'couple', icon: '🏅', title: 'Киноманы · 3 уровень', desc: '10 общих мэтчей' },
  { id: 'c_lvl_4', scope: 'couple', icon: '👑', title: 'Киноманы · 4 уровень', desc: '20 общих мэтчей' },
  { id: 'c_lvl_5', scope: 'couple', icon: '💎', title: 'Киноманы · 5 уровень', desc: '35 общих мэтчей' },
  { id: 'c_same_taste', scope: 'couple', icon: '🎯', title: 'Один вкус', desc: 'Секретная награда', secret: true, hint: 'Подсказка: полное совпадение', reveal: '10+ общих мэтчей — и ваши оценки почти всегда сходятся' },
];

export const badgeById = (id) => BADGES.find((b) => b.id === id);

export function computePersonal(ctx) {
  const out = [];
  const {
    likes = 0, votes = 0, matches = 0, watched = 0, ratings = 0, genres = 0,
    streak = 0, bestDay = 0, nightLikes = 0, likedGenres = 0, refs = 0,
  } = ctx;
  if (likes >= 1) out.push('p_first_like');
  if (likes >= 10) out.push('p_likes_10');
  if (likes >= 50) out.push('p_likes_50');
  if (likes >= 100) out.push('p_likes_100');
  if (votes >= 50) out.push('p_votes_50');
  if (votes >= 200) out.push('p_votes_200');
  if (matches >= 1) out.push('p_first_match');
  if (matches >= 10) out.push('p_matches_10');
  if (matches >= 25) out.push('p_matches_25');
  if (watched >= 1) out.push('p_first_watch');
  if (watched >= 10) out.push('p_watch_10');
  if (ratings >= 1) out.push('p_first_rate');
  if (ratings >= 5) out.push('p_rate_5');
  if (genres >= 5) out.push('p_genre_5');
  // серии дней подряд
  if (streak >= 3) out.push('p_streak_3');
  if (streak >= 7) out.push('p_streak_7');
  if (streak >= 30) out.push('p_streak_30');
  // приглашения друзей
  if (refs >= 1) out.push('p_ref_1');
  if (refs >= 3) out.push('p_ref_3');
  if (refs >= 10) out.push('p_ref_10');
  // секретные
  if (nightLikes >= 5) out.push('p_night_owl');
  if (bestDay >= 30) out.push('p_day_marathon');
  if (likedGenres >= 8) out.push('p_omnivore');
  return out;
}

export function computeCouple(ctx) {
  const out = [];
  const { matches = 0, watched = 0, bothRated = false, avg = 0, genres = 0, minutes = 0, perfectAgreement = false } = ctx;
  if (matches >= 1) out.push('c_first_match');
  if (matches >= 10) out.push('c_matches_10');
  if (matches >= 25) out.push('c_matches_25');
  if (watched >= 1) out.push('c_first_watch');
  if (watched >= 5) out.push('c_watch_5');
  if (watched >= 20) out.push('c_watch_20');
  if (bothRated) out.push('c_both_rate');
  if (avg >= 4.5) out.push('c_high_5');
  if (genres >= 4) out.push('c_genre_4');
  if (minutes >= 600) out.push('c_marathon');
  // уровни пары
  if (matches >= 1) out.push('c_lvl_1');
  if (matches >= 5) out.push('c_lvl_2');
  if (matches >= 10) out.push('c_lvl_3');
  if (matches >= 20) out.push('c_lvl_4');
  if (matches >= 35) out.push('c_lvl_5');
  // секретная: 10+ общих мэтчей и ни одного «промаха» (все лайки совпали)
  if (perfectAgreement) out.push('c_same_taste');
  return out;
}

/* ---------- прогресс получения наград ----------
   Для каждой «пороговой» награды знаем, какой показатель и до какого числа растёт.
   Секретные награды сюда не входят — интригу не раскрываем. */
export const GOALS = {
  p_first_like: { s: 'likes', n: 1, u: 'лайк' },
  p_likes_10: { s: 'likes', n: 10, u: 'лайков' },
  p_likes_50: { s: 'likes', n: 50, u: 'лайков' },
  p_likes_100: { s: 'likes', n: 100, u: 'лайков' },
  p_votes_50: { s: 'votes', n: 50, u: 'голосов' },
  p_votes_200: { s: 'votes', n: 200, u: 'голосов' },
  p_first_match: { s: 'matches', n: 1, u: 'мэтч' },
  p_matches_10: { s: 'matches', n: 10, u: 'мэтчей' },
  p_matches_25: { s: 'matches', n: 25, u: 'мэтчей' },
  p_first_watch: { s: 'watched', n: 1, u: 'просмотр' },
  p_watch_10: { s: 'watched', n: 10, u: 'просмотренных' },
  p_first_rate: { s: 'ratings', n: 1, u: 'оценка' },
  p_rate_5: { s: 'ratings', n: 5, u: 'оценок' },
  p_genre_5: { s: 'genres', n: 5, u: 'жанров' },
  p_streak_3: { s: 'streak', n: 3, u: 'дня подряд' },
  p_streak_7: { s: 'streak', n: 7, u: 'дней подряд' },
  p_streak_30: { s: 'streak', n: 30, u: 'дней подряд' },
  p_ref_1: { s: 'refs', n: 1, u: 'приглашённый' },
  p_ref_3: { s: 'refs', n: 3, u: 'приглашённых' },
  p_ref_10: { s: 'refs', n: 10, u: 'приглашённых' },
  c_first_match: { s: 'matches', n: 1, u: 'общий мэтч' },
  c_matches_10: { s: 'matches', n: 10, u: 'общих мэтчей' },
  c_matches_25: { s: 'matches', n: 25, u: 'общих мэтчей' },
  c_first_watch: { s: 'watched', n: 1, u: 'совместный просмотр' },
  c_watch_5: { s: 'watched', n: 5, u: 'совместных просмотров' },
  c_watch_20: { s: 'watched', n: 20, u: 'совместных просмотров' },
  c_high_5: { s: 'avg', n: 4.5, u: 'средняя оценка' },
  c_genre_4: { s: 'genres', n: 4, u: 'жанра' },
  c_marathon: { s: 'minutes', n: 600, u: 'минут вместе' },
  c_lvl_1: { s: 'matches', n: 1, u: 'общий мэтч' },
  c_lvl_2: { s: 'matches', n: 5, u: 'общих мэтчей' },
  c_lvl_3: { s: 'matches', n: 10, u: 'общих мэтчей' },
  c_lvl_4: { s: 'matches', n: 20, u: 'общих мэтчей' },
  c_lvl_5: { s: 'matches', n: 35, u: 'общих мэтчей' },
};

/* {have, goal, unit, done} или null, если прогресс не показать (секрет/без порога) */
export function badgeProgress(id, stats) {
  const g = GOALS[id];
  const b = badgeById(id);
  if (!g || !stats || (b && b.secret)) return null;
  const raw = g.s === 'avg' ? Number(stats.avg || 0) : Number(stats[g.s] || 0);
  const have = g.s === 'avg' ? Math.round(raw * 10) / 10 : Math.floor(raw);
  return { have, goal: g.n, unit: g.u, done: have >= g.n };
}

/* Сохранённые награды бывают трёх видов: строка-id (старый формат),
   {id, ts} (обычные с датой) и полностью свои объекты (вручённые админом).
   Приводим к единому виду с метаданными из каталога. */
export function expandEarned(list) {
  return (list || []).map((x) => {
    if (typeof x === 'string') return Object.assign({ id: x }, badgeById(x));
    const meta = x && x.id ? badgeById(x.id) : null;
    return meta ? Object.assign({}, meta, x) : x;
  });
}
