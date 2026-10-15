/* ============================================================
   ПЛАНОВАЯ ФУНКЦИЯ: еженедельный дайджест ботом
   Каждое воскресенье вечером каждому активному пользователю
   приходит итог недели: новые мэтчи, непросмотренное, серия дней
   и предложение на вечер. Неактивным не пишем — не шумим.

   Расписание Netlify: '0 17 * * 0' = воскресенье, 17:00 UTC
   (20:00 по Москве — самое время спланировать кино-вечер).
   Отключается в админке: Настройки → «Еженедельный дайджест».
   Ручная версия для одного человека: команда /week в боте.
   ============================================================ */
import { getConfig, db, weeklyDigest } from './_shared.mjs';

export const config = { schedule: '0 17 * * 0' };

export default async function handler(event = {}) {
  // Запускаем рассылку только по расписанию (у планового вызова есть nextRun).
  if (!event || !event.nextRun) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ ok: true, note: 'Это плановая функция еженедельного дайджеста. Вручную итоги смотрят командой /week в боте.' }),
    };
  }
  const out = { ok: true };
  try {
    const cfg = await getConfig();
    const site = (await db().get('config:site')) || '';
    if (!cfg || !cfg.token) throw new Error('бот не настроен');
    out.digest = await weeklyDigest(cfg.token, site);
  } catch (e) {
    out.digest = { ok: false, error: e && e.message };
  }
  console.log('weekly digest:', JSON.stringify(out));
  return { statusCode: 200, body: JSON.stringify(out) };
}
