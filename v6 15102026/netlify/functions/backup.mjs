/* ============================================================
   ПЛАНОВАЯ ФУНКЦИЯ: автобэкап раз в сутки
   Дамп всех данных (пользователи, голоса, мэтчи, подборки,
   награды, настройки…) сохраняется:
     • файлом в хранилище Netlify Blobs — последние 7 копий;
     • документом в Telegram-чат админа (Настройки → «Telegram
       для уведомлений»), чтобы копия лежала ещё и вне сайта.
   Расписание: '30 2 * * *' = 02:30 UTC (05:30 по Москве) —
   ночью, когда никто не свайпает.
   Отключается в админке: Настройки → «Автобэкап».
   Ручная копия: админка → «Скачать все данные» (тот же формат).
   ============================================================ */
import { getConfig, db, runAutoBackup, getBackupIndex, getUptimeState } from './_shared.mjs';

export const config = { schedule: '30 2 * * *' };

export default async function handler(event = {}) {
  // Реальную работу делаем только по расписанию (у планового вызова есть nextRun).
  // Обычное открытие в браузере — справочный ответ о состоянии копий.
  if (!event || !event.nextRun) {
    const idx = await getBackupIndex();
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        ok: true,
        note: 'Это плановая функция автобэкапа (ежедневно в 05:30 по Москве). '
          + 'Ручная копия: админка → «Скачать все данные».',
        serverCopies: idx,
        keep: 7,
        uptime: await getUptimeState(),
      }),
    };
  }
  const out = { ok: true };
  try {
    const cfg = await getConfig();
    let site = '';
    try { site = (await db().get('config:site')) || ''; } catch (e) { /* ignore */ }
    out.backup = await runAutoBackup(cfg.token || '', site);
  } catch (e) {
    out.backup = { ok: false, error: e && e.message };
  }
  console.log('auto backup:', JSON.stringify(out));
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(out),
  };
}
