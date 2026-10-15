/* ============================================================
   ПЛАНОВАЯ ФУНКЦИЯ: мониторинг живости (каждые 15 минут)
   Проверяет две вещи:
     1. API сайта отвечает (POST /api, действие `ping`);
     2. хранилище Netlify Blobs читается и пишется.
   При СМЕНЕ состояния шлёт сообщение в Telegram-чат админа
   (Настройки → «Telegram для уведомлений»):
     🔴 — сайт лёг (после двух провалов подряд, чтобы не шуметь
          из-за одной случайной осечки),
     🟢 — снова работает (с длительностью простоя).
   Пока сайт лежит, раз в 6 часов приходит напоминание.
   Текущее состояние всегда доступно JSON-ом по адресу функции.
   Отключается в админке: Настройки → «Мониторинг живости».
   ============================================================ */
import { getConfig, runUptimeCheck, getUptimeState } from './_shared.mjs';

export const config = { schedule: '*/15 * * * *' };

export default async function handler(event = {}) {
  const isScheduled = !!(event && event.nextRun);
  if (!isScheduled) {
    // Открыли руками: показываем последнее состояние, ничего не перепроверяем
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        ok: true,
        note: 'Это плановая функция мониторинга (каждые 15 минут). '
          + 'Уведомления приходят в чат из «Настройки → Telegram для уведомлений».',
        state: await getUptimeState(),
      }),
    };
  }
  const out = { ok: true };
  try {
    const cfg = await getConfig();
    out.uptime = await runUptimeCheck(cfg.token || '', '');
  } catch (e) {
    out.uptime = { ok: false, error: e && e.message };
  }
  console.log('uptime check:', JSON.stringify(out));
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(out),
  };
}
