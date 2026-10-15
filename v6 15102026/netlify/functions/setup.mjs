// Страница авто-настройки: открыли ссылку — бот настроился сам
import { getConfig, db, siteUrl, tg, html, esc, runSetup, SOURCE_LABEL, BOT_USERNAME } from './_shared.mjs';

export default async function handler(req) {
  const site = siteUrl(req);
  const url = new URL(req.url);
  const cfg = await getConfig();

  let form = null;
  if (req.method === 'POST') {
    try { form = Object.fromEntries(new URLSearchParams(await req.text())); } catch (e) { form = {}; }
  }

  const results = [];
  let token = cfg.token;
  let source = cfg.source;

  /* --- самолечение: сохранённый токен отозвали в BotFather — удаляем его
         и берём рабочий (из BOT_TOKEN или из файла), иначе сайт «залипнет»
         на мёртвом токене и заменить его через форму будет невозможно --- */
  if (source === 'store' && token) {
    const alive = await tg('getMe', {}, token);
    if (!alive.ok) {
      try { await db().delete('config:token'); } catch (e) { /* ignore */ }
      const cfg2 = await getConfig();
      token = cfg2.token;
      source = cfg2.source;
      results.push({
        ok: !!token,
        step: 'Сохранённый токен',
        text: token
          ? 'был недействителен (отозван в BotFather) — удалён. Использую токен из: ' + (SOURCE_LABEL[source] || 'файла') + '.'
          : 'был недействителен (отозван в BotFather) — удалён. Введите новый токен в форме ниже.',
      });
    }
  }

  /* --- сохранение токена, если его ввели вручную --- */
  if (form && form.token) {
    const t = String(form.token).trim();
    // если токен уже лежит в хранилище — требуем подтвердить старый (защита от подмены)
    if (source === 'store' && String(form.current || '').trim() !== token) {
      results.push({ ok: false, step: 'Замена токена', text: 'Текущий токен указан неверно — замена отменена.' });
    } else {
      const check = await tg('getMe', {}, t);
      if (!check.ok) {
        results.push({ ok: false, step: 'Проверка токена', text: check.description || 'Токен не подошёл' });
      } else {
        await db().set('config:token', t);
        token = t; source = 'store';
        results.push({ ok: true, step: 'Токен сохранён', text: 'Бот: @' + check.result.username });
      }
    }
  }

  /* --- сброс пароля админки (нужно знать токен бота) --- */
  if (form && form.reset_admin) {
    const t = String(form.token || '').trim();
    const check = t ? await tg('getMe', {}, t) : { ok: false };
    if (!check.ok) {
      results.push({ ok: false, step: 'Сброс пароля админки', text: 'Токен бота неверный — сброс отменён.' });
    } else {
      await db().delete('config:admin_hash');
      await db().delete('config:admin_secret');
      results.push({ ok: true, step: 'Сброс пароля админки', text: 'Пароль удалён. Задайте новый при первом входе в админку.' });
    }
  }

  /* --- сама настройка --- */
  let bot = null;
  if (!token) {
    results.push({ ok: false, step: 'Токен бота', text: 'Не задан. Впишите его в netlify/functions/_config.mjs или введите ниже.' });
  } else {
    const r = await runSetup(token, site);
    results.push(...r.results);
    bot = r.bot;
    if ((process.env.URL || '').replace(/\/$/, '') && site && !process.env.URL.includes(new URL(site).hostname)) {
      results.push({
        ok: false,
        step: 'Адрес сайта в настройках Netlify устарел',
        text: 'Netlify помнит старый адрес (сайт переименовывали). Сделайте: Deploys → Trigger deploy → Deploy site, затем откройте эту страницу ещё раз.',
      });
    }
    if (r.bot) {
      await db().set('config:site', site);
      await db().set('config:username', r.bot.username || '');
    }
  }

  return html(page({ site, results, bot, token, source, username: (bot && bot.username) || BOT_USERNAME }));
}

/* ---------- страница (всё оформление инлайном, внешних ресурсов нет) ---------- */
function page({ site, results, bot, token, source, username }) {
  const bad = results.filter((r) => !r.ok).length;
  const ok = results.filter((r) => r.ok).length;
  const allGood = !!token && bad === 0 && ok > 0;

  const rows = results.map((r) => `
    <div class="row ${r.ok ? 'ok' : 'bad'}">
      <span class="ic">${r.ok ? '✓' : '✕'}</span>
      <div><b>${esc(r.step)}</b><span>${esc(r.text)}</span></div>
    </div>`).join('');

  return `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Настройка бота · КиноФикация</title>
<style>
*{box-sizing:border-box}
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;
 background:#0b0e17;color:#eef1f8;padding:26px 16px 60px;line-height:1.5}
.wrap{max-width:620px;margin:0 auto}
h1{font-size:24px;margin:0 0 4px}
.sub{color:#98a2b8;font-size:14px;margin:0 0 22px}
.card{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:18px;padding:18px;margin-bottom:14px}
.card h2{font-size:13px;text-transform:uppercase;letter-spacing:.9px;color:#98a2b8;margin:0 0 14px}
.row{display:flex;gap:11px;align-items:flex-start;padding:9px 0;border-bottom:1px solid rgba(255,255,255,.06)}
.row:last-child{border-bottom:0}
.row .ic{width:22px;height:22px;border-radius:50%;flex:0 0 auto;display:grid;place-items:center;font-size:12px;font-weight:800;margin-top:1px}
.row.ok .ic{background:rgba(37,211,102,.18);color:#3ddc84}
.row.bad .ic{background:rgba(255,77,106,.18);color:#ff7d93}
.row b{display:block;font-size:14px}
.row span{display:block;font-size:12.5px;color:#98a2b8;word-break:break-all;margin-top:2px}
.banner{border-radius:18px;padding:18px;margin-bottom:16px;font-size:15px;font-weight:600}
.banner.good{background:rgba(37,211,102,.13);border:1px solid rgba(37,211,102,.35);color:#a7f0c4}
.banner.warn{background:rgba(255,200,87,.12);border:1px solid rgba(255,200,87,.35);color:#ffe0a3}
input[type=password],input[type=text]{width:100%;padding:13px 14px;border-radius:13px;border:1px solid rgba(255,255,255,.14);
 background:rgba(0,0,0,.3);color:#eef1f8;font-size:14px;font-family:ui-monospace,Menlo,Consolas,monospace;margin-bottom:10px;outline:none}
input:focus{border-color:#7c5cff}
button{background:linear-gradient(135deg,#7c5cff,#5a3df0);color:#fff;border:0;padding:14px 22px;border-radius:13px;
 font-size:15px;font-weight:700;cursor:pointer;width:100%;text-decoration:none;display:block;text-align:center}
button:hover{filter:brightness(1.1)}
.tgbtn{background:linear-gradient(135deg,#2AABEE,#229ED9);color:#fff;border:0;padding:14px 22px;border-radius:13px;
 font-size:15px;font-weight:700;text-decoration:none;display:block;text-align:center;margin-bottom:12px}
.tgbtn:hover{filter:brightness(1.08)}
a{color:#8fd3ff}
code{background:rgba(0,0,0,.35);padding:2px 7px;border-radius:6px;font-size:12.5px;word-break:break-all;color:#ffc857}
ol{padding-left:20px;margin:10px 0 0}li{margin-bottom:9px;font-size:14px;color:#c4cbdd}
.hint{font-size:12.5px;color:#6b7590;margin:8px 0 0}
details summary{cursor:pointer;font-size:13px;color:#98a2b8;margin-bottom:10px}
.big{font-size:40px;text-align:center;margin-bottom:6px}
</style></head><body><div class="wrap">

<div class="big">🎬</div>
<h1>Настройка бота «КиноФикация»</h1>
<p class="sub">Сайт: <code>${esc(site)}</code></p>

${allGood ? `<div class="banner good">✅ Всё настроено! Бот ${bot ? '@' + esc(bot.username) : ''} готов к работе.<br>
Откройте его в Telegram и нажмите START.</div>` : ''}
${!allGood && bad ? `<div class="banner warn">⚠️ Есть ошибки — смотрите список ниже.</div>` : ''}

<div class="card">
  <h2>Результат настройки</h2>
  ${rows || '<p class="hint">Нажмите кнопку ниже, чтобы настроить бота.</p>'}
  <div style="margin-top:16px">
    <form method="POST" action="/.netlify/functions/setup"><button type="submit">🔄 Настроить заново</button></form>
  </div>
  <p class="hint">Токен берётся из ${esc(SOURCE_LABEL[source] || 'неизвестного источника')}.<br>
  Вебхук: <code>${esc(site)}/.netlify/functions/bot</code></p>
</div>

${source && source !== 'env' ? `<div class="card">
  <h2>💡 Совет: храните токен в переменной окружения</h2>
  <p class="hint" style="margin-top:0">Сейчас токен берётся из: <b>${esc(SOURCE_LABEL[source] || 'неизвестно')}</b>.</p>
  <p class="hint">Надёжнее всего — переменная окружения <code>BOT_TOKEN</code> в настройках Netlify:
  она не потеряется при сбросе хранилища и не лежит в файлах сайта.</p>
  <ol>
    <li>Откройте сайт на <a href="https://app.netlify.com" target="_blank">app.netlify.com</a> → ваш сайт → <b>Site configuration</b> → <b>Environment variables</b>.</li>
    <li>Добавьте переменную: ключ <code>BOT_TOKEN</code>, значение — токен от @BotFather.</li>
    <li><b>Deploys</b> → <b>Trigger deploy</b> → <b>Deploy site</b> (переменные применяются только к новому деплою).</li>
    <li>Откройте эту страницу снова — должно быть написано «Токен берётся из переменной окружения BOT_TOKEN».</li>
  </ol>
</div>` : ''}

<div class="card">
  <h2>Что дальше</h2>
  <a class="tg tgbtn" href="https://t.me/${esc(username)}" target="_blank" rel="noopener">📱 Открыть бота в Telegram</a>
  <ol>
    <li>Откройте <a href="https://t.me/${esc(username)}" target="_blank"><b>@${esc(username)}</b></a> и нажмите <b>START</b>.</li>
    <li>Под полем ввода появится кнопка <b>«🎬 Открыть приложение»</b> — это вход в мини-приложение.
        Такая же кнопка есть в меню слева от поля ввода.</li>
    <li>То же самое сделайте со второго аккаунта (аккаунт девушки).</li>
    <li>Во вкладке <b>«Пара»</b> отправьте заявку партнёру: введите его код
        или пришлите ему ссылку-приглашение. Как только он примет заявку — вы пара.</li>
    <li>Свайпайте! При мэтче обоим придёт уведомление с постером.</li>
  </ol>
</div>

<div class="card">
  <details>
    <summary>Заменить токен бота</summary>
    <form method="POST" action="/.netlify/functions/setup">
      ${source === 'store' ? '<input type="password" name="current" placeholder="Текущий токен (для подтверждения)" autocomplete="off">' : ''}
      <input type="text" name="token" placeholder="Новый токен от @BotFather" required autocomplete="off" spellcheck="false">
      <button type="submit">Заменить токен и перенастроить</button>
    </form>
    ${source === 'env' ? '<p class="hint">Сейчас используется переменная окружения BOT_TOKEN — она имеет приоритет. Менять её нужно в настройках сайта Netlify.</p>' : ''}
    <p class="hint">Токен берётся у <a href="https://t.me/BotFather" target="_blank">@BotFather</a>:
    <code>/mybots</code> → ваш бот → <b>API Token</b>. После замены старый токен перестанет работать.</p>
  </details>
</div>

<div class="card">
  <details>
    <summary>Забыли пароль админки? Сбросить его</summary>
    <form method="POST" action="/.netlify/functions/setup">
      <input type="hidden" name="reset_admin" value="1">
      <input type="password" name="token" placeholder="Токен бота (для подтверждения)" autocomplete="off" required>
      <button type="submit">Сбросить пароль админки</button>
    </form>
    <p class="hint">Пароль админки хранится на сервере в необратимом виде (соль + SHA-256), восстановить его нельзя.
    Эта форма удаляет его целиком — после этого админка попросит создать пароль заново.
    Для подтверждения нужен токен бота.</p>
  </details>
</div>

<p class="hint" style="text-align:center">Эту страницу можно закрыть — она нужна только для настройки.<br>
Если смените адрес сайта — просто откройте её по новому адресу.</p>
</div></body></html>`;
}
