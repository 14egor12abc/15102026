/* ============================================================
   ПЛАНОВАЯ ФУНКЦИЯ: раз в сутки освежает рейтинги КиноПоиска
   (следующую порцию каталога по курсору) и раз в неделю подтягивает
   новинки. Работает сама, без пересборки проекта.

   Как это видит Netlify: поле `schedule` ниже = cron-расписание.
   Если плановая функция не запускается — ничего страшного, то же самое
   делает кнопка «Обновить каталог» в админке.
   ============================================================ */
import { refreshRatings, fetchNew } from './_refresh.mjs';
import { fridayReminders, getConfig, db } from './_shared.mjs';

export const config = { schedule: '@daily' };

export default async function handler(event = {}) {
  // Запускаем тяжёлую работу только по расписанию (у планового вызова есть nextRun).
  // Если открыть функцию обычным запросом в браузере — просто подскажем, что делать.
  if (!event || !event.nextRun) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ ok: true, note: 'Это плановая функция обновления каталога. Вручную обновление запускается кнопкой «Обновить каталог» в админке.' }),
    };
  }
  const out = { ok: true };
  try {
    out.ratings = await refreshRatings(60);
  } catch (e) {
    out.ratings = { ok: false, error: e && e.message };
  }
  // по пятницам: новинки (чтобы не дёргать TMDB каждый день) и напоминание парам
  if (new Date().getUTCDay() === 5) {
    try { out.new = await fetchNew(6); } catch (e) { out.new = { ok: false, error: e && e.message }; }
    try {
      const cfg = await getConfig();
      const site = (await db().get('config:site')) || '';
      if (cfg && cfg.token) out.remind = await fridayReminders(cfg.token, site);
    } catch (e) { out.remind = { ok: false, error: e && e.message }; }
  }
  console.log('scheduled catalog refresh:', JSON.stringify(out));
  return { statusCode: 200, body: JSON.stringify(out) };
}
