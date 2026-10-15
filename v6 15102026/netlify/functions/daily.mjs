/* ============================================================
   ПЛАНОВАЯ ФУНКЦИЯ: пуш «колода дня обновилась»
   Раз в сутки обоим в паре приходит напоминание, что сегодня
   новые общие карточки. Это главная причина открыть приложение
   завтра — без него колода дня работает вполсилы.

   Расписание Netlify: '0 16 * * *' = 16:00 UTC = 19:00 по Москве.
   Час можно поменять в админке (Настройки → «Пуш о колоде дня»),
   но тогда нужно поправить и cron здесь: Netlify не умеет читать
   расписание из хранилища.

   Отключается тремя способами, любой из них глушит рассылку:
     • админка → Настройки → «Пуш о колоде дня»;
     • feature flag dailyPush / dailyDeck;
     • у самого человека: экран уведомлений в профиле, кнопка
       «🔕 Не беспокоить» под любым уведомлением или /silent в боте.
   ============================================================ */
import { getConfig, db, dailyPush } from './_shared.mjs';

export const config = { schedule: '0 16 * * *' };

export default async function handler(event = {}) {
  // по расписанию у планового вызова есть nextRun; ручной заход просто объясняет, что это
  if (!event || !event.nextRun) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ ok: true, note: 'Это плановая функция пуша о колоде дня (19:00 МСК). Вручную колода дня приходит в приложении.' }),
    };
  }
  const out = { ok: true };
  try {
    const cfg = await getConfig();
    const site = (await db().get('config:site')) || '';
    if (!cfg || !cfg.token) throw new Error('бот не настроен');
    out.daily = await dailyPush(cfg.token, site);
  } catch (e) {
    out.daily = { ok: false, error: e && e.message };
  }
  console.log('daily deck push:', JSON.stringify(out));
  return { statusCode: 200, body: JSON.stringify(out) };
}
