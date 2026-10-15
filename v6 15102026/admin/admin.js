const LS_API="kf_admin_api",LS_TOK="kf_admin_token";let API=localStorage.getItem(LS_API)||location.origin+"/api",TOK=localStorage.getItem(LS_TOK)||"",CURRENT_TAB="dash",SETTINGS_SUB="main",CACHE={};const $=(e,s)=>(s||document).querySelector(e),$$=(e,s)=>[...(s||document).querySelectorAll(e)],esc=e=>String(e??"").replace(/[&<>"']/g,s=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[s]),num=e=>e==null?"—":Number(e).toLocaleString("ru-RU"),dateFmt=e=>e?new Date(e).toLocaleString("ru-RU",{day:"2-digit",month:"2-digit",year:"2-digit",hour:"2-digit",minute:"2-digit"}):"—",sleep=e=>new Promise(s=>setTimeout(s,e));let toastT;function toast(e,s){const a=$("#toast");a.textContent=e,a.className=s||"",clearTimeout(toastT),toastT=setTimeout(()=>a.classList.add("hidden"),3200)}async function raw(e,s){const a=await fetch(API,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(Object.assign({a:e},s||{}))}),t=await a.json().catch(()=>({}));return{status:a.status,json:t}}function netHint(e){return e&&e.message==="Failed to fetch"?"Не могу достучаться до основного сайта ("+API+"). Проверьте: 1) адрес в поле выше; 2) основной сайт обновлён до последней версии проекта (действия admin.* появились только в ней); 3) интернет и адрес открываются в обычной вкладке.":e&&e.message?e.message:"Неизвестная ошибка"}async function call(e,s){let a,t;try{({status:a,json:t}=await raw("admin."+e,Object.assign({adminToken:TOK},s||{})))}catch(i){throw new Error(netHint(i))}if(a===401&&/админку/i.test(t.error||""))throw logout(!1),new Error("Сессия истекла — войдите снова");if(!t||t.ok===!1)throw new Error(t&&t.error||"HTTP "+a);return t}async function downloadBackup(){try{const e=await call("export"),s=new Blob([JSON.stringify(e.export,null,2)],{type:"application/json"}),a=document.createElement("a");a.href=URL.createObjectURL(s),a.download="kinofikacia-backup-"+new Date().toISOString().slice(0,10)+".json",a.click(),URL.revokeObjectURL(a.href),toast("Резервная копия сохранена в загрузки","ok")}catch(e){toast(e.message,"bad")}}function showLogin(e){$("#app").classList.add("hidden"),$("#login").classList.remove("hidden"),$("#apiBase").value=API.replace(/\/api$/,"").replace(/\/$/,"");const s=$("#forgotLink");s&&(s.href=API.replace(/\/api$/,"").replace(/\/$/,"")+"/setup"),e&&($("#loginMsg").textContent=e)}function logout(e=!0){e&&(TOK="",localStorage.removeItem(LS_TOK)),showLogin()}function enterCreateMode(e){$("#pwd2wrap").classList.remove("hidden");const s=$("#pwdLbl");s&&(s.textContent="Придумайте пароль администратора (минимум 6 символов)");const a=$("#loginBtn");a&&(a.textContent="Создать пароль и войти"),$("#loginMsg").textContent=e||"Пароль ещё не создан — введите его в оба поля и нажмите «Создать пароль и войти»";const t=$("#pwd2");if(t&&!t.value)try{t.focus()}catch{}}async function doLogin(){const e=$("#apiBase").value.trim().replace(/\/+$/,"");if(!/^https?:\/\//.test(e)){$("#loginMsg").textContent="Адрес должен начинаться с https://";return}API=e+"/api",localStorage.setItem(LS_API,API);const s=$("#forgotLink");s&&(s.href=e+"/setup");const a=$("#pwd").value;if(!a){$("#loginMsg").textContent="Введите пароль";return}$("#loginMsg").textContent="Проверяем…";try{let t=await raw("admin.login",{password:a});if(t.status===401&&t.json.needCreate){const i=$("#pwd2").value;if(!i||i!==a){enterCreateMode(i?"Пароли не совпадают — введите одинаковый пароль в оба поля":"Пароль админки ещё не создан. Придумайте пароль и введите его в оба поля — он создастся при входе");return}if(t=await raw("admin.create",{password:a}),!t.json.ok&&!/уже создан/i.test(t.json.error||""))throw new Error(t.json.error||"Не удалось создать пароль");t=await raw("admin.login",{password:a})}if(!t.json.ok){const i=t.json.error||"Неверный пароль";/неверный пароль/i.test(i)?$("#loginMsg").innerHTML=esc(i)+'. Если забыли — <a id="forgotLink2" href="'+esc(API.replace(/\/api$/,""))+'/setup" target="_blank">сбросьте пароль на /setup</a> (нужен токен бота).':$("#loginMsg").textContent=i;return}TOK=t.json.token,localStorage.setItem(LS_TOK,TOK),$("#login").classList.add("hidden"),$("#app").classList.remove("hidden"),$("#sitePill").textContent=API.replace("/api",""),bindGlobalSearch(),switchTab("dash"),toast("Вы вошли в админку","ok")}catch(t){$("#loginMsg").textContent=netHint(t)}}function switchTab(e){e==="badges"||e==="bot"?(SETTINGS_SUB=e,e="settings"):SETTINGS_SUB="main",CURRENT_TAB=e,$$("#tabs button").forEach(s=>s.classList.toggle("on",s.dataset.tab===e)),render()}async function render(){const e=$("#content");e.innerHTML='<div class="card"><span class="mut">Загрузка…</span></div>';try{CURRENT_TAB==="dash"?await renderDash(e):CURRENT_TAB==="analytics"?await renderAnalytics(e):CURRENT_TAB==="broadcast"?renderBroadcast(e):CURRENT_TAB==="users"?await renderUsers(e):CURRENT_TAB==="matches"?await renderMatches(e):CURRENT_TAB==="catalog"?await renderCatalog(e):CURRENT_TAB==="feedback"?await renderFeedback(e):CURRENT_TAB==="settings"&&await renderSettings(e)}catch(s){e.innerHTML=`<div class="card"><h2>Ошибка</h2><p class="bad-t">${esc(s.message)}</p>
      <div class="row"><button class="btn btn-ghost btn-sm" onclick="location.reload()">Перезагрузить</button>
      <button class="btn btn-ghost btn-sm" id="relogin">Войти заново</button></div></div>`;const a=$("#relogin");a&&(a.onclick=()=>logout())}}async function renderDash(e){const s=await call("status");CACHE.status=s;const a=s.webhook&&s.webhook.error;e.innerHTML=`
    <div class="grid">
      <div class="stat acc"><b>${num(s.users)}</b><span>пользователей</span></div>
      <div class="stat"><b>${num(s.votes)}</b><span>всего голосов</span></div>
      <div class="stat good"><b>${num(s.likes)}</b><span>лайков</span></div>
      <div class="stat acc"><b>${num(s.matches)}</b><span>мэтчей</span></div>
      <div class="stat good"><b>${num(s.watched)}</b><span>посмотрено</span></div>
      <div class="stat ${s.hidden?"warn":""}"><b>${num(s.hidden)}</b><span>фильмов скрыто</span></div>
      <div class="stat"><b>${num(s.catalog)}</b><span>в каталоге</span></div>
    </div>

    <div class="card" style="margin-top:14px">
      <h2>Бот</h2>
      <dl class="kv">
        <dt>Бот</dt><dd>${s.bot?"@"+esc(s.bot.username)+" · «"+esc(s.bot.first_name)+"»":'<span class="bad-t">недоступен</span>'}</dd>
        <dt>Вебхук</dt><dd><code>${esc(s.webhook?s.webhook.url:"—")}</code></dd>
        <dt>Состояние</dt><dd>${a?'<span class="bad-t">ошибка: '+esc(a)+"</span>":'<span class="ok-t">работает</span>'}</dd>
        <dt>Кнопка-меню</dt><dd>${s.menuButton&&s.menuButton.type==="web_app"?'<span class="ok-t">'+esc(s.menuButton.text)+"</span> → <code>"+esc(s.menuButton.web_app.url)+"</code>":'<span class="warn-t">обычное меню команд</span>'}</dd>
        <dt>Текст кнопки</dt><dd>${esc(s.settings.menuText)}</dd>
        <dt>Связка пар</dt><dd>только вручную: кодом или ссылкой-приглашением</dd>
        <dt>Сайт</dt><dd><code>${esc(s.site)}</code></dd>
        <dt>Режим обслуживания</dt><dd>${s.settings.maintenance&&s.settings.maintenance.on?'<span class="bad-t">ВКЛЮЧЁН: '+esc(s.settings.maintenance.reason||"без причины")+"</span>":'<span class="ok-t">выключен</span>'}</dd>
      </dl>
      <div class="row" style="margin-top:14px">
        <button class="btn btn-primary btn-sm" id="fixBot">🔧 Перенастроить бота</button>
        <button class="btn btn-ghost btn-sm" id="openSite">🌐 Открыть сайт</button>
        <button class="btn btn-ghost btn-sm" id="openBot">🤖 Открыть бота</button>
      </div>
      ${a?'<p class="bad-t" style="margin:10px 0 0">Вебхук сообщает об ошибке — нажмите «Перенастроить бота».</p>':""}
    </div>

    <div class="card">
      <h2>💾 Резервная копия</h2>
      <p class="mut">Один файл со ВСЕМИ данными: пользователи с голосами и настройками, пары и награды,
      мэтчи, коллекции, обратная связь, правки карточек, статистика. Рекомендуем скачивать раз в неделю.</p>
      <div class="row">
        <button class="btn btn-primary btn-sm" id="dashBackup">⬇️ Скачать все данные (JSON)</button>
      </div>
    </div>

    ${s.tokenSource&&s.tokenSource!=="env"?`<div class="card">
      <h2>🔐 Токен бота — совет</h2>
      <p class="mut">Сейчас токен берётся из: <b>${esc(s.tokenSourceLabel||"хранилища")}</b>.
      Надёжнее всего — переменная окружения <code>BOT_TOKEN</code> в Netlify:
      Site configuration → Environment variables → добавьте <code>BOT_TOKEN</code> → Deploys → Trigger deploy → Deploy site.
      Пошаговая инструкция — на странице <a href="${esc(s.site)}/setup" target="_blank">/setup</a>.</p>
    </div>`:""}

    <div class="card">
      <h2>Быстрые действия</h2>
      <div class="row">
        <button class="btn btn-ghost btn-sm" data-go="broadcast">📢 Написать всем</button>
        <button class="btn btn-ghost btn-sm" data-go="users">👥 Пользователи</button>
        <button class="btn btn-ghost btn-sm" data-go="matches">💘 Мэтчи</button>
        <button class="btn btn-ghost btn-sm" data-go="catalog">🎞 Скрыть фильм</button>
        <button class="btn btn-ghost btn-sm" data-go="settings">⚙️ Настройки</button>
      </div>
    </div>`,$("#dashBackup").onclick=downloadBackup,$("#fixBot").onclick=async()=>{if(confirm("Перенастроить бота: вебхук, кнопку-меню и команды под текущий адрес сайта?"))try{const t=await call("bot.setup");toast("Бот перенастроен: "+t.results.filter(i=>i.ok).length+"/"+t.results.length+" шагов ок","ok"),render()}catch(t){toast("Ошибка: "+t.message,"bad")}},$("#openSite").onclick=()=>window.open(s.site,"_blank"),$("#openBot").onclick=()=>window.open("https://t.me/"+(s.bot?s.bot.username:"kino_fik_bot"),"_blank"),$$("#content [data-go]").forEach(t=>t.onclick=()=>switchTab(t.dataset.go))}const FLAG_LABEL={dailyDeck:"🌙 Колода дня — одинаковые карточки в начале колоды у пары",dailyPush:"🔔 Пуш о колоде дня — раз в сутки обоим в паре",mood:"🌙 «Какой сегодня вечер?» — вопрос перед свайпами",games:"🎮 Игры с партнёром — «угадай за партнёра» и «слепая дуэль»",talkTopics:"💬 «О чём поговорить» — вопросы в карточке фильма",guestLink:"🔗 Гостевой вход по ссылке на фильм — друг может сразу предложить пару",genres:"🏷 Экран выбора интересов при первом входе"};function renderBroadcast(e){e.innerHTML=`
    <div class="card">
      <h2>📢 Рассылка</h2>
      <p class="mut">HTML-теги: &lt;b&gt; &lt;i&gt; &lt;a&gt; &lt;code&gt;. Уйдёт только тем, кто не выключил
      «📢 Новости» в настройках уведомлений и не ставил паузу — остальные будут в отчёте как «заглушили».</p>
      <label class="lbl">Кому</label>
      <select id="bcSegment">
        <option value="all">Всем, кто открывал бота</option>
        <option value="active">Активным: заходили за 2 недели</option>
        <option value="pairs">Только парам (есть партнёр)</option>
        <option value="solo">Только одиноким (нет партнёра)</option>
        <option value="sleeping">Спящим: не заходили больше недели</option>
      </select>
      <div class="row" style="margin-top:8px">
        <button class="btn btn-ghost btn-sm" id="bcDry">🔍 Посчитать аудиторию (не отправляя)</button>
        <span class="mut" id="bcDryOut"></span>
      </div>
      <textarea id="bcText" placeholder="Например: Привет! В пятницу вечером выбираем фильм из мэтчей 🍿"></textarea>
      <div class="row" style="margin-top:10px">
        <label class="chk"><input type="checkbox" id="bcHtml" checked> разрешить HTML-разметку</label>
      </div>
      <label class="lbl" style="margin-top:12px">Картинка (ссылка, необязательно)</label>
      <input type="url" id="bcPhoto" placeholder="https://…/poster.jpg">
      <label class="lbl" style="margin-top:12px">Кнопка-ссылка под сообщением (необязательно)</label>
      <div class="row">
        <input type="text" id="bcBtnText" placeholder="Текст кнопки" style="flex:1;min-width:140px">
        <input type="url" id="bcBtnUrl" placeholder="https://…" style="flex:2;min-width:180px">
      </div>
      <div class="row" style="margin-top:14px">
        <button class="btn btn-primary" id="bcSend">📨 Отправить всем</button>
        <span class="mut" id="bcResult"></span>
      </div>
    </div>
    <div class="card">
      <h2>Личное сообщение</h2>
      <div class="row">
        <input type="text" id="pmId" placeholder="Telegram ID или код пользователя" style="flex:1;min-width:140px">
        <input type="text" id="pmText" placeholder="Текст" style="flex:2;min-width:180px">
        <button class="btn btn-ghost" id="pmSend">Отправить</button>
      </div>
      <p class="dim" style="margin:8px 0 0">ID можно посмотреть во вкладке «Пользователи».</p>
    </div>
    <div class="card">
      <h2>🕘 История рассылок и анонсов</h2>
      <p class="mut">Что отправляли, кому и сколько сообщений дошло. Храним последние 60 событий.</p>
      <div class="row" style="margin:6px 0 10px"><button class="btn btn-ghost btn-sm" id="bcHistRefresh">⟳ Обновить</button></div>
      <div id="bcHist"><span class="mut">Загрузка…</span></div>
    </div>`;const s={broadcast:["📢","Рассылка всем"],announce:["✨","Анонс в приложении"],send:["✉️","Личное сообщение"],keyboard:["⌨️","Обновление клавиатуры"],preview:["👁","Вход «глазами пользователя»"],transfer:["🔁","Перенос пары"],feedback:["💬","Ответ на обратную связь"]};async function a(){const o=$("#bcHist");if(o)try{const d=await call("broadcasts.list");if(!d.items||!d.items.length){o.innerHTML='<p class="mut">Пока ничего не отправляли.</p>';return}o.innerHTML=`<div class="tblwrap"><table class="tbl">
        <thead><tr><th>Когда</th><th>Тип</th><th>Содержание</th><th>Дошло</th></tr></thead>
        <tbody>${d.items.map(l=>{const p=s[l.kind]||["•",l.kind||""],u=l.kind==="announce"?`<b>${esc(l.title||"")}</b>${l.text?"<br>"+esc(l.text):""}`:esc(l.text||""),r=l.kind==="announce"?`<span class="mut">увидят ${num(l.total)}</span>`:`<span class="ok-t">${num(l.sent)}</span>${l.failed?` / <span class="bad-t">${num(l.failed)}</span>`:""} <span class="mut">из ${num(l.total)}</span>`;return`<tr>
            <td class="dim">${dateFmt(l.ts)}</td>
            <td>${p[0]} <span class="mut">${esc(p[1])}</span>${l.to?`<br><small class="dim">id ${esc(l.to)}</small>`:""}</td>
            <td class="mut" style="max-width:360px;white-space:pre-wrap">${u}</td>
            <td class="num">${r}</td>
          </tr>`}).join("")}</tbody></table></div>`}catch(d){o.innerHTML='<p class="bad-t">'+esc(d.message)+"</p>"}}a();const t=$("#bcHistRefresh");t&&(t.onclick=a);const i={all:"всем",active:"активным",pairs:"парам",solo:"одиноким",sleeping:"спящим"},n=()=>$("#bcSegment")?$("#bcSegment").value:"all",c=$("#bcDry");c&&(c.onclick=async()=>{c.disabled=!0,$("#bcDryOut").textContent="Считаем…";try{const o=await call("broadcast",{text:$("#bcText").value.trim()||"проверка",segment:n(),dry:!0}),d=o.stat||{};$("#bcDryOut").innerHTML=`в базе <b>${num(d.total||0)}</b> · по сегменту <b>${num(d.bySegment||0)}</b> · заглушили <b>${num(d.muted||0)}</b> · <span class="ok-t">уйдёт <b>${num(o.willSend||0)}</b></span>`}catch(o){$("#bcDryOut").innerHTML='<span class="bad-t">'+esc(o.message)+"</span>"}c.disabled=!1}),$("#bcSend").onclick=async()=>{const o=$("#bcText").value.trim();if(!o){toast("Пустое сообщение","bad");return}if(confirm(`Отправить это сообщение ${i[n()]||"всем"}?`)){$("#bcResult").textContent="Отправляем…";try{const d=await call("broadcast",{text:o,html:$("#bcHtml").checked,segment:n(),photo:$("#bcPhoto").value.trim()||void 0,buttonText:$("#bcBtnText").value.trim()||void 0,url:$("#bcBtnUrl").value.trim()||void 0});$("#bcResult").innerHTML=`<span class="ok-t">дошло: ${num(d.sent)}</span> · <span class="${d.failed?"bad-t":"mut"}">ошибок: ${num(d.failed)}</span> · всего: ${num(d.total)}`+(d.stat?` · заглушили: ${num(d.stat.muted||0)}`:""),toast("Рассылка завершена","ok"),a()}catch(d){$("#bcResult").textContent="Ошибка: "+d.message,toast(d.message,"bad")}}},$("#pmSend").onclick=async()=>{const o=$("#pmId").value.trim(),d=$("#pmText").value.trim();if(!o||!d){toast("Заполните ID и текст","bad");return}try{await call("send",{id:o,text:d}),toast("Отправлено","ok"),$("#pmText").value="",a()}catch(l){toast("Ошибка: "+l.message,"bad")}}}async function renderUsers(e,s){const a=s?await call("users.search",{q:s}):await call("users");e.innerHTML=`
    <div class="card">
      <h2>👥 Пользователи · <span id="usersCount">${a.users.length}</span></h2>
      <div class="row" style="margin-bottom:10px">
        <input type="text" id="userQ" placeholder="🔎 Поиск: имя, @ник, Telegram ID или код…" value="${esc(s||"")}" style="flex:1;min-width:240px" autocomplete="off">
      </div>
      <p class="dim" style="margin:0 0 10px">Кнопка «Карточка» — полная информация о человеке: статистика, партнёры,
      последние свайпы, мэтчи, награды. Оттуда же можно войти «глазами пользователя» и перенести пару.</p>
      <div id="usersBox">${usersTableHTML(a.users)}</div>
    </div>`;let t;$("#userQ").addEventListener("input",i=>{clearTimeout(t);const n=i.target.value;t=setTimeout(async()=>{const c=$("#usersBox");if(c)try{const o=await call("users.search",{q:n});c.innerHTML=usersTableHTML(o.users);const d=$("#usersCount");d&&(d.textContent=o.users.length)}catch(o){c.innerHTML='<p class="bad-t">'+esc(o.message)+"</p>"}},300)}),$("#content").onclick=onUsersClick}function usersTableHTML(e){return e.length?`<div class="tblwrap"><table class="tbl">
    <thead><tr><th>Кто</th><th>Код</th><th>Партнёры</th><th>Голоса</th><th>Лайки</th><th>Мэтчи</th><th>Сессия</th><th></th></tr></thead>
    <tbody>${e.map(s=>`
      <tr data-id="${esc(s.id)}">
        <td><div class="who"><span class="av">${s.photo_url?`<img src="${esc(s.photo_url)}" alt="">`:esc((s.first_name||"?").charAt(0).toUpperCase())}</span>
          <div><b>${esc(s.first_name||"Без имени")}</b><small>${s.username?"@"+esc(s.username)+" · ":""}id ${esc(s.id)}</small></div></div></td>
        <td><code>${esc(s.code||"")}</code></td>
        <td class="mut">${esc((s.partnerNames||[]).join(", ")||"—")}</td>
        <td class="num">${s.votes}</td><td class="num ok-t">${s.likes}</td><td class="num">${s.matches}</td>
        <td class="dim">${s.platform?esc(s.platform)+" · ":""}${s.lastSeen?dateFmt(s.lastSeen):"—"}</td>
        <td><div class="row">
          <button class="btn btn-primary btn-sm" data-act="card">Карточка</button>
          <button class="btn btn-ghost btn-sm" data-act="edit">Правка</button>
          <button class="btn btn-ghost btn-sm" data-act="unlink">Развязать</button>
          <button class="btn btn-danger btn-sm" data-act="reset">Сброс</button>
          <button class="btn btn-sm ${s.banned?"btn-ok":"btn-danger"}" data-act="ban">${s.banned?"Разбанить":"Бан"}</button>
        </div></td>
      </tr>`).join("")}</tbody>
  </table></div>`:'<p class="mut">Никого не найдено.</p>'}async function onUsersClick(e){const s=e.target.closest("[data-act]");if(!s)return;const a=s.closest("tr");if(!a||!a.dataset.id)return;const t=a.dataset.id,i=s.dataset.act;try{if(i==="card")await openUserCard(t);else if(i==="edit")await openUserEdit(t);else if(i==="unlink"){if(!confirm("Развязать все пары этого пользователя?"))return;await call("user.unlink",{id:t}),toast("Пары развязаны","ok"),render()}else if(i==="ban"){const n=s.textContent==="Бан";if(n&&!confirm("Заблокировать пользователю доступ к приложению?"))return;await call("user.ban",{id:t,v:n}),toast(n?"Пользователь забанен":"Пользователь разбанен","ok"),render()}else if(i==="reset"){if(!confirm("Стереть оценки и мэтчи пользователя? Действие необратимо."))return;await call("user.reset",{id:t}),toast("Данные пользователя сброшены","ok"),render()}}catch(n){toast("Ошибка: "+n.message,"bad")}}async function openUserEdit(e){const s=await call("user",{id:e});openModal(`
    <h3>Правка профиля · ${esc(s.user.first_name||"")}</h3>
    <label class="lbl">Отображаемое имя</label>
    <input type="text" id="euName" value="${esc(s.user.first_name||"")}">
    <label class="lbl">Код для связки</label>
    <div class="row"><input type="text" id="euCode" value="${esc(s.user.code||"")}" style="flex:1">
      <button class="btn btn-ghost btn-sm" id="euGen">🎲 Новый</button></div>
    <div class="row" style="margin-top:12px"><button class="btn btn-primary btn-sm" id="euSave">Сохранить</button></div>
    <h3 style="margin-top:18px">Голоса вручную</h3>
    <div class="row"><input type="text" id="euFilm" placeholder="ID фильма (например m278)" style="flex:1">
      <button class="btn btn-ok btn-sm" data-v="1">❤️</button>
      <button class="btn btn-danger btn-sm" data-v="-1">✖️</button>
      <button class="btn btn-ghost btn-sm" data-v="0">Сброс</button></div>
    <p class="dim" style="margin-top:8px">ID фильма можно взять во вкладке «Каталог».</p>`),$("#euGen").onclick=()=>{const a="ABDEFGHJKMNPQRSTUVWXYZ23456789";$("#euCode").value=Array.from({length:6},()=>a[Math.floor(Math.random()*a.length)]).join("")},$("#euSave").onclick=async()=>{try{await call("user.update",{id:e,first_name:$("#euName").value,newCode:$("#euCode").value}),toast("Профиль обновлён","ok"),closeModal(),render()}catch(a){toast(a.message,"bad")}},$$("#modalBody [data-v]").forEach(a=>a.onclick=async()=>{try{await call("user.setvote",{id:e,movieId:$("#euFilm").value.trim(),v:Number(a.dataset.v)}),toast("Голос обновлён","ok")}catch(t){toast(t.message,"bad")}})}async function openUserCard(e){const s=await call("users.card",{id:e}),a=s.user;openModal(`
    <h3>👤 ${esc(a.first_name||"Без имени")} ${a.username?'<span class="dim">@'+esc(a.username)+"</span>":""}
      ${a.banned?'<span class="pill hide">забанен</span>':""}</h3>
    <div class="row" style="margin:10px 0">
      <button class="btn btn-primary btn-sm" id="ucPreview" title="Открыть приложение так, как видит его этот пользователь">👁 Глазами пользователя</button>
      <button class="btn btn-ghost btn-sm" id="ucMsg">✉️ Написать</button>
      <button class="btn btn-ghost btn-sm" id="ucEdit">✏️ Правка</button>
      <button class="btn btn-sm ${a.banned?"btn-ok":"btn-danger"}" id="ucBan">${a.banned?"Разбанить":"Бан"}</button>
      <button class="btn btn-ghost btn-sm" id="ucMerge" title="Объединить с другим аккаунтом (дублем)">🔀 Объединить</button>
      <button class="btn btn-danger btn-sm" id="ucReset">🧹 Сброс</button>
    </div>
    <dl class="kv">
      <dt>Telegram ID</dt><dd><code>${esc(a.id)}</code></dd>
      <dt>Код пары</dt><dd><code>${esc(a.code||"")}</code></dd>
      <dt>Регистрация</dt><dd>${a.created?dateFmt(a.created):"—"}</dd>
      <dt>Последний вход</dt><dd>${a.lastSeen?dateFmt(a.lastSeen):"—"}${a.platform?" · "+esc(a.platform):""}${a.lang?" · "+esc(a.lang):""}</dd>
      <dt>Стоп-лист</dt><dd class="mut">${s.stop&&(s.stop.films||[]).length+(s.stop.genres||[]).length?(s.stop.films||[]).length+" фильмов, "+(s.stop.genres||[]).length+" жанров":"пуст"}</dd>
    </dl>
    <div class="grid" style="margin:12px 0">
      <div class="stat"><b>${num(s.stats.votes)}</b><span>свайпов</span></div>
      <div class="stat good"><b>${num(s.stats.likes)}</b><span>лайков</span></div>
      <div class="stat"><b>${num(s.stats.seen)}</b><span>уже смотрел</span></div>
      <div class="stat acc"><b>${num(s.stats.matches)}</b><span>мэтчей</span></div>
      <div class="stat"><b>${num(s.stats.watched)}</b><span>посмотрено</span></div>
    </div>
    <h3>Партнёры</h3>
    ${s.partners.length?`<div class="tblwrap"><table class="tbl">
      <thead><tr><th>Кто</th><th>Общих мэтчей</th><th>Посмотрено</th><th></th></tr></thead>
      <tbody>${s.partners.map(t=>`<tr data-pid="${esc(t.id)}">
        <td><b>${esc(t.first_name||t.id)}</b>${t.username?' <span class="dim">@'+esc(t.username)+"</span>":""}<br><small class="dim">id ${esc(t.id)}${t.banned?" · забанен":""}</small></td>
        <td class="num">${t.stats?t.stats.matches:"—"}</td>
        <td class="num">${t.stats?t.stats.watched:"—"}</td>
        <td><div class="row">
          <button class="btn btn-ghost btn-sm" data-act="deck" title="Что эта пара увидит в колоде следующим">🎬 Колода</button>
          <button class="btn btn-ghost btn-sm" data-act="transfer" title="Заменить этого партнёра на другого человека">🔁 Перенести</button>
          <button class="btn btn-danger btn-sm" data-act="unlink1">Развязать</button>
        </div></td></tr>`).join("")}</tbody></table></div>
      <p class="dim" style="margin:6px 0 0">«Перенести» — заменить партнёра в паре на другого человека (по ID, @нику или коду).
      Старые общие мэтчи останутся в истории.</p>`:'<p class="mut">Партнёров нет — мэтчи ловить не с кем. Можно связать вручную через «Перенести» или код пары.</p>'}
    <h3 style="margin-top:14px">🏆 Награды · ${s.badges.length}</h3>
    <p class="mut">${s.badges.length?s.badges.map(t=>esc((t.icon||"🏅")+" "+(t.title||t.id))).join(" · "):"пока нет"}</p>
    <h3 style="margin-top:14px">🕘 Последние свайпы</h3>
    ${s.journal.length?`<div class="tblwrap"><table class="tbl"><tbody>${s.journal.slice(0,10).map(t=>`<tr>
      <td style="width:30px">${t.v===1?"❤️":"✖️"}</td><td><b>${esc(t.title)}</b> <span class="dim">${t.year||""}</span></td>
      <td class="dim" style="text-align:right">${dateFmt(t.t)}</td></tr>`).join("")}</tbody></table></div>`:'<p class="mut">Ещё не свайпал.</p>'}
    <h3 style="margin-top:14px">💘 Мэтчи · ${s.matches.length}</h3>
    ${s.matches.length?`<div class="tblwrap"><table class="tbl"><tbody>${s.matches.slice(0,12).map(t=>`<tr>
      <td>${t.poster?`<img class="poster-mini" src="${esc(t.poster)}" alt="" onerror="this.style.visibility='hidden'">`:""}
        <b>${esc(t.title)}</b> <span class="dim">${t.year||""}</span></td>
      <td>${t.watched?'<span class="pill show">посмотрено'+(t.scores&&t.scores[a.id]?" · "+t.scores[a.id]+"★":"")+"</span>":'<span class="pill neutral">в очереди</span>'}</td>
      <td class="dim" style="text-align:right">${dateFmt(t.ts)}</td></tr>`).join("")}</tbody></table></div>`:'<p class="mut">Мэтчей пока нет.</p>'}
    ${s.feedback.length?`<h3 style="margin-top:14px">✍️ Обратная связь · ${s.feedback.length}</h3>`+s.feedback.map(t=>`
      <div class="fb-item"><span class="pill ${t.status==="answered"?"show":"warn"}">${t.status==="answered"?"отвечено":"новое"}</span>
      ${esc(String(t.text||"").slice(0,140))}<br><small class="dim">${dateFmt(t.ts)}</small></div>`).join(""):""}
  `),$("#ucPreview").onclick=async()=>{if(confirm(`Открыть приложение «глазами» этого пользователя?
Ваши действия в нём будут сохраняться В ЕГО профиль.`))try{const t=await call("users.preview",{id:e});t.url&&window.open?window.open(t.url,"_blank"):prompt("Ссылка для входа «глазами пользователя»:",t.url||t.token),toast("Открываем приложение глазами пользователя…","ok")}catch(t){toast(t.message,"bad")}},$("#ucMsg").onclick=async()=>{const t=prompt("Сообщение пользователю (придёт от бота в Telegram):");if(!(!t||!t.trim()))try{await call("send",{id:e,text:t.trim()}),toast("Сообщение отправлено","ok")}catch(i){toast(i.message,"bad")}},$("#ucEdit").onclick=async()=>{closeModal(),await openUserEdit(e)},$("#ucBan").onclick=async()=>{const t=!a.banned;if(!(t&&!confirm("Заблокировать пользователю доступ к приложению?")))try{await call("user.ban",{id:e,v:t}),toast(t?"Пользователь забанен":"Пользователь разбанен","ok"),closeModal(),render()}catch(i){toast(i.message,"bad")}},$("#ucReset").onclick=async()=>{if(confirm("Стереть оценки и мэтчи пользователя? Действие необратимо."))try{await call("user.reset",{id:e}),toast("Данные пользователя сброшены","ok"),closeModal(),render()}catch(t){toast(t.message,"bad")}},$("#ucMerge").onclick=()=>startMerge(e,a.first_name||e),$$('#modalBody [data-act="deck"]').forEach(t=>t.onclick=()=>{openDeckPreview(e,t.closest("tr").dataset.pid)}),$$('#modalBody [data-act="transfer"]').forEach(t=>t.onclick=async()=>{const i=t.closest("tr").dataset.pid,n=prompt(`Кому передать пару?
Telegram ID, @username или код нового партнёра (он должен уже открыть бота):`);if(!(!n||!n.trim()))try{const c=await call("pairs.transfer",{id:e,oldPartnerId:i,newPartner:n.trim()});toast("Пара перенесена: "+(c.partner&&c.partner.first_name||n.trim()),"ok"),closeModal(),render()}catch(c){toast(c.message,"bad")}}),$$('#modalBody [data-act="unlink1"]').forEach(t=>t.onclick=async()=>{const i=t.closest("tr").dataset.pid;if(confirm("Развязать эту пару?"))try{await call("user.unlink",{id:e,partnerId:i}),toast("Пара развязана","ok"),closeModal(),render()}catch(n){toast(n.message,"bad")}})}async function renderMatches(e){const s=await call("matches");e.innerHTML=`
    <div class="card">
      <h2>➕ Создать мэтч вручную</h2>
      <div class="row">
        <input type="text" id="mcA" placeholder="ID пользователя A" style="flex:1;min-width:120px">
        <input type="text" id="mcB" placeholder="ID пользователя B" style="flex:1;min-width:120px">
        <input type="text" id="mcF" placeholder="ID фильма" style="flex:1;min-width:120px">
        <button class="btn btn-primary btn-sm" id="mcGo">Создать</button>
      </div>
      <p class="dim" style="margin:8px 0 0">Мэтч появится у обоих как обычный совместный.</p>
    </div>
    <div class="card">
      <h2>💘 Мэтчи · ${s.matches.length}</h2>
      ${s.matches.length?`<div class="tblwrap"><table class="tbl">
        <thead><tr><th>Фильм</th><th>Пара</th><th>Рейтинг</th><th>Статус</th><th>Когда</th><th></th></tr></thead>
        <tbody>${s.matches.map(a=>`
          <tr data-id="${esc(a.id)}">
            <td><div class="who">${a.poster?`<img class="poster-mini" src="${esc(a.poster)}" alt="" onerror="this.style.visibility='hidden'">`:""}
              <div><b>${esc(a.title)}</b><small>${a.year||""} · ${a.type==="series"?"сериал":"фильм"}</small></div></div></td>
            <td class="mut">${esc((a.byNames||[]).join(" + "))}</td>
            <td class="num">${a.rating?"★ "+Number(a.rating).toFixed(1):"—"}</td>
            <td>${a.watched?'<span class="pill show">посмотрено</span>':'<span class="pill neutral">в очереди</span>'}</td>
            <td class="dim">${dateFmt(a.ts)}</td>
            <td><div class="row">
              <button class="btn btn-ghost btn-sm" data-act="watched">${a.watched?"Вернуть":"✅ Смотрели"}</button>
              <button class="btn btn-danger btn-sm" data-act="del">Удалить</button>
            </div></td>
          </tr>`).join("")}</tbody></table></div>`:'<p class="mut">Мэтчей пока нет.</p>'}
    </div>`,$("#mcGo").onclick=async()=>{try{await call("match.create",{userA:$("#mcA").value.trim(),userB:$("#mcB").value.trim(),movieId:$("#mcF").value.trim()}),toast("Мэтч создан","ok"),render()}catch(a){toast(a.message,"bad")}},$("#content").onclick=onMatchesClick}async function onMatchesClick(e){const s=e.target.closest("[data-act]");if(!s)return;const a=s.closest("tr").dataset.id;try{if(s.dataset.act==="watched"){const t=s.textContent.indexOf("Вернуть")===-1;await call("match.watched",{id:a,v:t}),toast(t?"Отмечено как просмотренное":"Возвращено в очередь","ok"),render()}else{if(!confirm("Удалить этот мэтч у обоих участников?"))return;await call("match.delete",{id:a}),toast("Мэтч удалён","ok"),render()}}catch(t){toast("Ошибка: "+t.message,"bad")}}async function renderCatalog(e,s){const a=await call("catalog",{q:s||"",limit:400});let t=null;try{t=await call("catalog.refresh.status")}catch{t=null}const i=t&&t.targets?Math.round((t.cursor||0)/t.targets*100):0;e.innerHTML=`
    <div class="card">
      <h2>🔄 Обновить каталог</h2>
      <p class="mut">Подтягивает данные без пересборки проекта: свежие рейтинги КиноПоиска для уже имеющихся фильмов
      и новинки, которых ещё нет в каталоге. Результат сразу виден у всех в приложении.</p>
      <dl class="kv" style="margin:10px 0">
        <dt>Рейтинги обновлены</dt><dd>${t&&t.overrides?`<span class="ok-t">${num(t.overrides)}</span> фильмов`:"—"}${t&&t.targets?` <span class="dim">(пройдено ${i}% каталога, дальше — следующий запуск)</span>`:""}</dd>
        <dt>Новинок добавлено</dt><dd>${t&&t.newFilms?`<span class="ok-t">${num(t.newFilms)}</span>`:"пока нет"}</dd>
        <dt>Последний запуск</dt><dd>${t&&t.lastRatings?dateFmt(t.lastRatings):"—"}${t&&t.lastNew?" · новинки "+dateFmt(t.lastNew):""}</dd>
      </dl>
      <div class="row">
        <button class="btn btn-primary btn-sm" id="rfRatings">📈 Обновить рейтинги (порция)</button>
        <button class="btn btn-ghost btn-sm" id="rfNew">✨ Подтянуть новинки</button>
        <span class="mut" id="rfInfo"></span>
      </div>
      <p class="dim" style="margin:8px 0 0">Рейтинги обновляются порциями по ~40 фильмов за раз (чтобы уложиться в лимит времени сервера).
      Нажмите несколько раз, чтобы пройти весь каталог; по расписанию это происходит автоматически раз в сутки.</p>
    </div>
    <div class="card">
      <h2>🎞 Каталог · ${a.total}</h2>
      <div class="row">
        <input type="text" id="catQ" placeholder="Поиск по названию…" value="${esc(s||"")}" style="flex:1;min-width:200px">
        <label class="chk"><input type="checkbox" id="catOnlyHidden"> только скрытые</label>
      </div>
      <p class="dim" style="margin:8px 0 0">Скрытый фильм исчезает из колоды у всех пользователей, пока вы его не вернёте.</p>
    </div>
    <div class="card">
      <div class="tblwrap"><table class="tbl">
        <thead><tr><th>Фильм</th><th>Рейтинг</th><th>❤ / ✖ / 👁</th><th>Статус</th><th></th></tr></thead>
        <tbody>${a.items.map(b=>`
          <tr data-id="${esc(b.id)}">
            <td><div class="who">${b.p?`<img class="poster-mini" src="${esc(b.p)}" alt="" onerror="this.style.visibility='hidden'">`:""}
              <div><b>${esc(b.t)}</b><small>${b.y||""} · ${b.tp==="series"?"сериал":"фильм"} · <code>${esc(b.id)}</code></small></div></div></td>
            <td class="num">${b.r?"★ "+Number(b.r).toFixed(1):"—"}</td>
            <td class="num"><span class="ok-t">${b.stats.like}</span> / <span class="bad-t">${b.stats.dislike}</span> / <span class="dim" title="уже смотрел">${b.stats.seen||0}👁</span></td>
            <td>${b.hidden?'<span class="pill hide">скрыт</span>':'<span class="pill show">в колоде</span>'}</td>
            <td><div class="row">
              <button class="btn btn-ghost btn-sm" data-act="editcard" title="Редактировать карточку">✏️ Правка</button>
              <button class="btn btn-sm ${b.hidden?"btn-ok":"btn-danger"}" data-act="hide">${b.hidden?"Вернуть":"Скрыть"}</button>
              ${b.custom?'<button class="btn btn-danger btn-sm" data-act="delcustom">Удалить</button>':""}
            </div></td>
          </tr>`).join("")}</tbody></table></div>
    </div>
    <div class="card">
      <h2>🚩 Спорные и незаходящие</h2>
      <p class="mut">Фильмы, которые чаще пропускают (много дизлайков) или получили очень разные оценки «как зашло».
      Это кандидаты, чтобы скрыть их из колоды у всех — поодиночке или одной кнопкой.</p>
      <div class="row" style="margin-top:8px">
        <button class="btn btn-ghost btn-sm" id="flagFind">🔎 Найти кандидатов</button>
        <span class="dim" id="flagInfo"></span>
      </div>
      <div id="flagBox" style="margin-top:12px"></div>
    </div>
    <div class="card">
      <h2>🧩 Дубликаты карточек</h2>
      <p class="mut">Один и тот же фильм может попасть в каталог дважды под разными id
      (например, встроенная карточка + добавленная вручную или подтянутая «обновлением каталога»).
      Из-за дублей партнёры лайкают разные карточки — и мэтч не случается.
      Голоса и мэтчи склеиваются автоматически при выдаче, а «склейка» ниже ещё и
      перезаписывает данные физически и скрывает дубли из колоды.</p>
      <div class="row" style="margin-top:8px">
        <button class="btn btn-ghost btn-sm" id="dedupFind">🔍 Найти дубликаты</button>
        <span class="dim" id="dedupInfo"></span>
      </div>
      <div id="dedupBox" style="margin-top:12px"></div>
    </div>
    <div class="card">
      <h2>📚 Коллекции и подборки</h2>
      <p class="mut">Подборка — готовый набор фильмов. У пользователей она появится в фильтрах колоды
      (кнопка-воронка над карточками): выбрал подборку — свайпает только фильмы из неё.
      Например: «Комедии на пятницу», «Марафон ужастиков», «Для вечера вдвоём».</p>
      <div class="row" style="margin:10px 0">
        <button class="btn btn-primary btn-sm" id="colNew">➕ Новая подборка</button>
        <button class="btn btn-ghost btn-sm" id="colAuto" title="Собрать подборки автоматически: высокий рейтинг, жанры, новинки, хронометраж">⚡ Авто-подборки</button>
      </div>
      <p class="dim" style="margin:0 0 8px">Порядок фильмов внутри подборки = порядок карточек в колоде у пользователей
      (подборка не перемешивается — что поставили первым, то и увидят первым).</p>
      <div id="colBox"><span class="mut">Загрузка…</span></div>
    </div>
    <div class="card">
      <h2>➕ Добавить свой фильм</h2>
      <div class="row"><input type="text" id="cfT" placeholder="Название*" style="flex:2;min-width:160px">
        <input type="text" id="cfY" placeholder="Год" style="width:80px">
        <select id="cfTp" style="width:120px"><option value="movie">фильм</option><option value="series">сериал</option></select></div>
      <div class="row" style="margin-top:8px"><input type="url" id="cfP" placeholder="Ссылка на постер" style="flex:2;min-width:160px">
        <input type="text" id="cfR" placeholder="Рейтинг" style="width:90px">
        <input type="text" id="cfMin" placeholder="Минут" style="width:80px"></div>
      <div class="row" style="margin-top:8px"><input type="text" id="cfG" placeholder="Жанры через запятую" style="flex:2;min-width:160px"></div>
      <div class="row" style="margin-top:8px"><input type="text" id="cfTr" placeholder="Трейлер: ссылка YouTube или ключ (например dQw4w9WgXcQ)" style="flex:1"></div>
      <textarea id="cfD" placeholder="Описание" style="margin-top:8px;min-height:64px"></textarea>
      <div class="row" style="margin-top:10px"><button class="btn btn-primary btn-sm" id="cfAdd">Добавить в каталог</button>
        <span class="dim">Появится у всех в колоде сразу.</span></div>
    </div>`;let n;$("#catQ").addEventListener("input",b=>{clearTimeout(n);const h=b.target.value;n=setTimeout(()=>renderCatalog(e,h),300)}),$("#catOnlyHidden").addEventListener("change",async b=>{const h=await call("catalog",{q:$("#catQ").value,onlyHidden:b.target.checked,limit:400});renderCatalogList(e,h,$("#catQ").value,b.target.checked)}),$("#content").onclick=onCatalogClick;const c=$("#flagFind");c&&(c.onclick=loadFlagged);const o=$("#dedupFind");o&&(o.onclick=loadDedup);const d=$("#colNew");d&&(d.onclick=()=>openCollectionEditor(null));const l=$("#colAuto");l&&(l.onclick=openAutoCollections),loadColBox();const p=async(b,h,v)=>{const g=$("#rfInfo"),f=h.textContent;h.disabled=!0,h.textContent="Обновляем…",g&&(g.textContent=v+"…");try{const m=await call("catalog.refresh",{mode:b,batch:30,newBatch:6});let y="";m.ratings&&(y+=`рейтинги: проверено ${m.ratings.checked}, обновлено ${m.ratings.updated}`+(m.ratings.failed?`, ошибок ${m.ratings.failed}`:"")+(m.ratings.wrapped?" (каталог пройден)":"")),m.new&&(y+=`${y?" · ":""}новинки: добавлено ${m.new.added}`+(m.new.titles&&m.new.titles.length?" ("+m.new.titles.slice(0,4).join(", ")+(m.new.titles.length>4?"…":"")+")":""),m.new.source&&(y+=` · источник: ${m.new.source==="wiki"?"Википедия+Викиданные":"TMDB"}`)),toast("Готово: "+(y||"без изменений"),"ok"),m.new&&m.new.note&&g&&(g.textContent="ℹ️ "+m.new.note+(m.new.scanned?` (проверено кандидатов: ${m.new.scanned})`:"")),render()}catch(m){g&&(g.textContent="Ошибка: "+m.message),toast(m.message,"bad"),h.disabled=!1,h.textContent=f}},u=$("#rfRatings");u&&(u.onclick=()=>p("ratings",u,"Обновляем рейтинги КиноПоиска"));const r=$("#rfNew");r&&(r.onclick=()=>{confirm("Подтянуть новинки? Сначала проверяется TMDB; если он недоступен — новинки ищутся через Википедию и Викиданные. Это займёт несколько секунд.")&&p("new",r,"Ищем новинки")})}async function loadFlagged(){const e=$("#flagInfo"),s=$("#flagBox");if(s){e&&(e.textContent="Ищем…"),s.innerHTML='<span class="mut">Считаем…</span>';try{const a=await call("catalog.flagged");if(!a.items||!a.items.length){s.innerHTML='<p class="mut">Пока нет фильмов, которые стоит скрыть. Нужно больше голосов и оценок «как зашло».</p>',e&&(e.textContent="");return}const t=a.items.filter(n=>!n.hidden);e&&(e.textContent=`найдено ${a.items.length} · можно скрыть ${t.length}`),s.innerHTML=`
      ${t.length?`<div class="row" style="margin-bottom:10px">
        <button class="btn btn-danger btn-sm" id="flagHideAll">🙈 Скрыть всех (${t.length}) одной кнопкой</button></div>`:""}
      <div class="tblwrap"><table class="tbl">
        <thead><tr><th>Фильм</th><th>Почему кандидат</th><th>❤ / ✖ / 👁</th><th>Оценки</th><th></th></tr></thead>
        <tbody>${a.items.map(n=>`
          <tr data-id="${esc(n.id)}">
            <td><div class="who">${n.p?`<img class="poster-mini" src="${esc(n.p)}" alt="" onerror="this.style.visibility='hidden'">`:""}
              <div><b>${esc(n.t)}</b><small>${n.y||""} · ${n.tp==="series"?"сериал":"фильм"} · <code>${esc(n.id)}</code></small></div></div></td>
            <td class="mut" style="max-width:300px">${n.reasons.map(esc).join("<br>")}</td>
            <td class="num"><span class="ok-t">${n.like}</span> / <span class="bad-t">${n.dislike}</span> / <span class="dim" title="уже смотрел">${n.seen||0}👁</span></td>
            <td class="num">${n.scoreCount?`${n.avgScore} ★<br><small class="dim">разброс ${n.min}–${n.max}</small>`:"—"}</td>
            <td>${n.hidden?'<span class="pill hide">скрыт</span>':'<button class="btn btn-danger btn-sm" data-act="hideflag">Скрыть</button>'}</td>
          </tr>`).join("")}</tbody></table></div>`;const i=$("#flagHideAll");i&&(i.onclick=async()=>{if(confirm(`Скрыть из колоды у всех: ${t.length} спорных/незаходящих фильмов? Их можно вернуть в любой момент.`))try{const n=await call("catalog.hideMany",{ids:t.map(c=>c.id)});toast(`Скрыто фильмов: ${n.added}`,"ok"),render()}catch(n){toast(n.message,"bad")}})}catch(a){e&&(e.textContent=""),s.innerHTML='<p class="bad-t">'+esc(a.message)+"</p>"}}}async function loadDedup(){const e=$("#dedupInfo"),s=$("#dedupBox");if(s){e&&(e.textContent="Ищем…"),s.innerHTML='<span class="mut">Считаем…</span>';try{const a=await call("catalog.dedup");if(!a.groups||!a.groups.length){s.innerHTML='<p class="mut">Дубликатов нет — каталог чист 🎉</p>',e&&(e.textContent="");return}e&&(e.textContent=`групп: ${a.groups.length} · карточек-дублей: ${a.aliasCount}`),s.innerHTML=`
      <div class="row" style="margin-bottom:10px">
        <button class="btn btn-danger btn-sm" id="dedupRun">🔗 Склеить: голоса и мэтчи — на главную карточку, дубли скрыть</button>
      </div>
      <div class="tblwrap"><table class="tbl">
        <thead><tr><th>Фильм</th><th>Карточки в группе</th></tr></thead>
        <tbody>${a.groups.map(i=>`          <tr>
            <td><b>${esc((i.items.find(n=>n.id===i.canon)||i.items[0]).t)}</b>
              <small class="dim"> · ${(i.items.find(n=>n.id===i.canon)||i.items[0]).y||""}</small></td>
            <td class="mut" style="max-width:420px">${i.items.map(n=>(n.id===i.canon?'<b class="ok-t">'+esc(n.id)+" ✓ главная</b>":"<code>"+esc(n.id)+"</code>")+(n.builtin?"":" <small>(добавлена)</small>")).join("<br>")}</td>
          </tr>`).join("")}</tbody></table></div>`;const t=$("#dedupRun");t&&(t.onclick=async()=>{if(confirm("Склеить дубликаты? Голоса, мэтчи и стоп-листы перенесутся на главные карточки, дубли скроются из колоды. Отменить нельзя.")){t.disabled=!0,t.textContent="Склеиваем…";try{const i=await call("catalog.dedup.run"),n=i.stats||{};toast(`Склеено групп: ${i.groups}. Затронуто: голосов ${n.votes||0}, стоп-листов ${n.stops||0}, журналов ${n.swlogs||0}, подборок ${n.cols||0}, скрыто карточек ${n.hidden||0}`,"ok"),loadDedup()}catch(i){toast(i.message,"bad"),t.disabled=!1,t.textContent="🔗 Склеить"}}})}catch(a){e&&(e.textContent=""),s.innerHTML='<p class="bad-t">'+esc(a.message)+"</p>"}}}function renderCatalogList(e,s,a,t){const i=$("#content tbody");i.innerHTML=s.items.map(n=>`
    <tr data-id="${esc(n.id)}">
      <td><div class="who">${n.p?`<img class="poster-mini" src="${esc(n.p)}" alt="" onerror="this.style.visibility='hidden'">`:""}
        <div><b>${esc(n.t)}</b><small>${n.y||""} · ${n.tp==="series"?"сериал":"фильм"} · <code>${esc(n.id)}</code></small></div></div></td>
      <td class="num">${n.r?"★ "+Number(n.r).toFixed(1):"—"}</td>
      <td class="num"><span class="ok-t">${n.stats.like}</span> / <span class="bad-t">${n.stats.dislike}</span> / <span class="dim" title="уже смотрел">${n.stats.seen||0}👁</span></td>
      <td>${n.hidden?'<span class="pill hide">скрыт</span>':'<span class="pill show">в колоде</span>'}</td>
      <td><div class="row"><button class="btn btn-ghost btn-sm" data-act="editcard" title="Редактировать карточку">✏️</button>
      <button class="btn btn-sm ${n.hidden?"btn-ok":"btn-danger"}" data-act="hide">${n.hidden?"Вернуть":"Скрыть"}</button></div></td>
    </tr>`).join("")||'<tr><td colspan="5" class="mut">Ничего не найдено</td></tr>'}async function onCatalogClick(e){const s=e.target.closest('[data-act="editcard"]');if(s){const d=s.closest("tr");d&&d.dataset.id&&openCardEditor(d.dataset.id);return}const a=e.target.closest('[data-act="hideflag"]');if(a){const d=a.closest("tr").dataset.id;try{await call("hide",{id:d,v:!0}),toast("Фильм скрыт у всех","ok"),loadFlagged()}catch(l){toast(l.message,"bad")}return}const t=e.target.closest('[data-act="delcustom"]');if(t){const d=t.closest("tr").dataset.id;if(!confirm("Удалить этот фильм из каталога навсегда?"))return;try{await call("catalog.del",{id:d}),toast("Фильм удалён","ok"),render()}catch(l){toast(l.message,"bad")}return}if(e.target.closest("#cfAdd")){try{const d=await call("catalog.add",{t:$("#cfT").value,y:$("#cfY").value,tp:$("#cfTp").value,p:$("#cfP").value,r:$("#cfR").value,minutes:$("#cfMin").value,g:$("#cfG").value,desc:$("#cfD").value,trailer:($("#cfTr").value.match(/(?:v=|youtu\.be\/|^)([A-Za-z0-9_-]{6,})$/)||[null,$("#cfTr").value.trim()||null])[1]});toast("Добавлено: "+d.film.t,"ok"),render()}catch(d){toast(d.message,"bad")}return}const n=e.target.closest('[data-act="hide"]');if(!n)return;const c=n.closest("tr").dataset.id,o=n.textContent==="Скрыть";try{await call("hide",{id:c,v:o}),toast(o?"Фильм скрыт у всех":"Фильм возвращён в колоду","ok"),n.closest("tr").querySelector(".pill").outerHTML=o?'<span class="pill hide">скрыт</span>':'<span class="pill show">в колоде</span>',n.textContent=o?"Вернуть":"Скрыть",n.className="btn btn-sm "+(o?"btn-ok":"btn-danger")}catch(d){toast("Ошибка: "+d.message,"bad")}}async function renderBadgesAdmin(e){const s=await call("leaderboard"),a=await call("users"),t=s.pairs||[];e.innerHTML=`
    <div class="card">
      <h2>🏆 Топ людей</h2>
      <div class="tblwrap"><table class="tbl"><thead><tr><th>#</th><th>Кто</th><th>Наград</th><th>Лайков</th><th>Мэтчей</th><th>Просмотров</th></tr></thead>
      <tbody>${s.users.map((c,o)=>`<tr><td class="num">${o+1}</td><td><b>${esc(c.name)}</b></td><td class="num">${c.badges}</td><td class="num">${c.likes}</td><td class="num">${c.matches}</td><td class="num">${c.watched}</td></tr>`).join("")||'<tr><td colspan="6" class="mut">Пока пусто</td></tr>'}</tbody></table></div>
    </div>
    <div class="card">
      <h2>💞 Топ пар</h2>
      <div class="tblwrap"><table class="tbl"><thead><tr><th>#</th><th>Пара</th><th>Наград</th></tr></thead>
      <tbody>${s.pairs.map((c,o)=>`<tr><td class="num">${o+1}</td><td><b>${esc(c.name)}</b></td><td class="num">${c.badges}</td></tr>`).join("")||'<tr><td colspan="3" class="mut">Пока пусто</td></tr>'}</tbody></table></div>
    </div>
    <div class="card">
      <h2>🎖 Вручить награду вручную</h2>
      <div class="row">
        <select id="bgUser" style="flex:1;min-width:160px"><option value="">— кому (пользователь) —</option></select>
        <select id="bgPair" style="flex:1;min-width:160px"><option value="">— или паре —</option></select>
      </div>
      <div class="row" style="margin-top:8px"><input type="text" id="bgIcon" placeholder="Значок (эмодзи)" style="width:110px" value="🏅">
        <input type="text" id="bgTitle" placeholder="Название*" style="flex:1;min-width:140px">
        <input type="text" id="bgNote" placeholder="За что" style="flex:1;min-width:140px"></div>
      <div class="row" style="margin-top:10px"><button class="btn btn-primary btn-sm" id="bgGrant">Вручить</button></div>
    </div>
    <div class="card">
      <h2>🔍 Награды конкретного пользователя</h2>
      <div class="row"><input type="text" id="bgWho" placeholder="Telegram ID" style="flex:1;min-width:150px">
        <button class="btn btn-ghost btn-sm" id="bgShow">Показать</button></div>
      <div id="bgList" style="margin-top:12px"></div>
    </div>`;const i=$("#bgUser"),n=$("#bgPair");i.innerHTML='<option value="">— кому (пользователь) —</option>'+a.users.map(c=>`<option value="${esc(c.id)}">${esc(c.name)} · id ${esc(c.id)}</option>`).join(""),n.innerHTML='<option value="">— или паре —</option>'+t.map(c=>`<option value="${esc(c.key||"")}">${esc(c.name)}</option>`).join(""),i.onchange=()=>{i.value&&(n.value="")},n.onchange=()=>{n.value&&(i.value="")},$("#bgGrant").onclick=async()=>{const c={icon:$("#bgIcon").value||"🏅",title:$("#bgTitle").value,note:$("#bgNote").value};i.value?c.userId=i.value:n.value&&(c.pairKey=n.value);try{const o=await call("badges.grant",c);toast("Награда вручена"+(o.notified?" и отправлено в бот ("+o.notified+")":""),"ok"),$("#bgTitle").value="",$("#bgNote").value=""}catch(o){toast(o.message,"bad")}},$("#bgShow").onclick=async()=>{const c=$("#bgWho").value.trim();if(c)try{const o=await call("badges.of",{userId:c});$("#bgList").innerHTML=o.badges.length?'<div class="tblwrap"><table class="tbl"><thead><tr><th>Награда</th><th>За что</th><th></th></tr></thead><tbody>'+o.badges.map(d=>`<tr data-badge="${esc(d.id)}"><td>${esc(d.icon||"🏆")} <b>${esc(d.title||d.id)}</b></td><td class="mut">${esc(d.desc||"")}</td>
             <td><button class="btn btn-danger btn-sm" data-revoke="${esc(d.id)}">Отозвать</button></td></tr>`).join("")+"</tbody></table></div>":'<p class="mut">Наград пока нет.</p>',$$("#bgList [data-revoke]").forEach(d=>d.onclick=async()=>{confirm("Отозвать награду?")&&(await call("badges.revoke",{userId:c,badgeId:d.dataset.revoke||d.dataset.revoke}),toast("Отозвано","ok"),$("#bgShow").click())})}catch(o){$("#bgList").innerHTML='<p class="bad-t">'+esc(o.message)+"</p>"}}}async function renderBot(e){const s=CACHE.status||await call("status");e.innerHTML=`
    <div class="card">
      <h2>🤖 Управление ботом</h2>
      <dl class="kv">
        <dt>Вебхук</dt><dd><code>${esc(s.webhook?s.webhook.url:"—")}</code></dd>
        <dt>Ошибка</dt><dd>${s.webhook&&s.webhook.error?'<span class="bad-t">'+esc(s.webhook.error)+"</span>":'<span class="ok-t">нет</span>'}</dd>
        <dt>В очереди</dt><dd>${s.webhook?s.webhook.pending:"—"} обновлений</dd>
        <dt>Кнопка-меню</dt><dd>${s.menuButton&&s.menuButton.type==="web_app"?esc(s.menuButton.text)+" → <code>"+esc(s.menuButton.web_app.url)+"</code>":"меню команд"}</dd>
      </dl>
      <div class="row" style="margin-top:14px">
        <button class="btn btn-primary btn-sm" id="bSetup">🔧 Перенастроить всё</button>
        <button class="btn btn-ghost btn-sm" id="bMenuOn">✅ Включить кнопку-меню</button>
        <button class="btn btn-ghost btn-sm" id="bMenuOff">🚫 Выключить кнопку-меню</button>
        <button class="btn btn-ghost btn-sm" id="bCmds">📋 Обновить команды</button>
        <button class="btn btn-ghost btn-sm" id="botKeyboard">⌨️ Обновить клавиатуру у всех</button>
        <button class="btn btn-danger btn-sm" id="bWhDel">⛔ Отключить вебхук</button>
      </div>
      <p class="dim" style="margin:10px 0 0">«Отключить вебхук» остановит бота (перестанет отвечать и слать мэтчи).
      Вернуть — кнопкой «Перенастроить всё».</p>
      <p class="dim" style="margin:8px 0 0">Если у людей под клавиатурой осталась старая кнопка «Приложение» — нажмите
      «Обновить клавиатуру у всех»: бот пришлёт каждому новую клавиатуру, и старая кнопка исчезнет.</p>
    </div>
    <div class="card">
      <h2>Результат последней настройки</h2>
      <div id="botResults" class="mut">Нажмите «Перенастроить всё», чтобы увидеть шаги.</div>
    </div>`;const a=t=>{$("#botResults").innerHTML=t.map(i=>`<div class="row" style="margin:4px 0">
      <span class="${i.ok?"ok-t":"bad-t"}">${i.ok?"✓":"✕"}</span>
      <span><b>${esc(i.step)}</b> — <span class="mut">${esc(i.text)}</span></span></div>`).join("")};$("#bSetup").onclick=async()=>{if(confirm("Перенастроить вебхук, кнопку-меню и команды?"))try{const t=await call("bot.setup");a(t.results),toast("Готово","ok"),CACHE.status=null}catch(t){toast(t.message,"bad")}},$("#bMenuOn").onclick=async()=>{try{await call("bot.menu",{on:!0}),toast("Кнопка-меню включена","ok"),CACHE.status=null,render()}catch(t){toast(t.message,"bad")}},$("#botKeyboard").onclick=async()=>{if(confirm("Отправить всем пользователям новую клавиатуру бота? Старая кнопка «Приложение» исчезнет."))try{const t=await call("keyboard.refresh");a([{ok:!0,step:"Клавиатура обновлена",text:`отправлено ${t.sent||0} из ${t.total||0} пользователей`}]),toast(`Клавиатура обновлена у ${t.sent||0} из ${t.total||0}`,"ok")}catch(t){toast(t.message,"bad")}},$("#bMenuOff").onclick=async()=>{try{await call("bot.menu",{on:!1}),toast("Кнопка-меню выключена","ok"),CACHE.status=null,render()}catch(t){toast(t.message,"bad")}},$("#bCmds").onclick=async()=>{try{await call("bot.commands"),toast("Команды обновлены","ok")}catch(t){toast(t.message,"bad")}},$("#bWhDel").onclick=async()=>{if(confirm("ТОЧНО отключить вебхук? Бот перестанет отвечать, пока вы не нажмёте «Перенастроить всё»."))try{await call("bot.webhook.delete"),toast("Вебхук отключён","ok"),CACHE.status=null,render()}catch(t){toast(t.message,"bad")}}}async function renderSettings(e){const s=[["main","⚙️ Основное"],["badges","🏆 Награды"],["bot","🤖 Бот"]];e.innerHTML=`
    <div class="card" style="padding:10px 14px">
      <div class="row subnav">
        ${s.map(([t,i])=>`<button class="btn btn-sm ${SETTINGS_SUB===t?"btn-primary":"btn-ghost"}" data-sub="${t}">${i}</button>`).join("")}
      </div>
    </div>
    <div id="settingsSub"></div>`,$$("[data-sub]",e).forEach(t=>t.onclick=()=>{SETTINGS_SUB=t.dataset.sub,render()});const a=$("#settingsSub");SETTINGS_SUB==="badges"?await renderBadgesAdmin(a):SETTINGS_SUB==="bot"?await renderBot(a):await renderSettingsMain(a)}async function renderSettingsMain(e){const s=await call("settings.get");e.innerHTML=`
    <div class="card">
      <h2>⚙️ Приложение и бот</h2>
      <label class="lbl">Текст кнопки «Открыть приложение»</label>
      <input type="text" id="stMenu" value="${esc(s.settings.menuText)}" maxlength="40">
      <label class="lbl">Telegram для уведомлений (ваш ID)</label>
      <input type="text" id="stNotify" value="${esc(s.settings.notifyChat||"")}" placeholder="Например: 123456789" maxlength="40">
      <p class="dim" style="margin:4px 0 12px">Сюда бот мгновенно присылает новые сообщения из «Обратной связи».
      Свой ID можно узнать у бота @userinfobot. Пусто — уведомления выключены.</p>
      <div class="row" style="margin:0 0 12px">
        <label class="chk"><input type="checkbox" id="stSync" ${s.settings.syncDeck===!0?"checked":""}>
          общая колода на пару (по умолчанию выключено)</label>
        <p class="dim" style="margin:4px 0 12px">Выключено — у каждого <b>своя</b> колода: лайк одного
        не убирает карточку у второго, порядок подстраивается под его жанры и вкус. Мэтч по-прежнему
        случается, когда оба лайкнули один фильм. Включено — старое поведение: одна колода на двоих,
        карточка уходит, когда её оценил любой из пары. На группы (3+) не влияет — там колода общая всегда.</p>
      </div>
      <div class="row" style="margin:0 0 12px">
        <label class="chk"><input type="checkbox" id="stDigest" ${s.settings.digestOn!==!1?"checked":""}>
          еженедельный дайджест ботом: итоги недели каждое воскресенье вечером</label>
      </div>
      <div class="row" style="margin:0 0 12px">
        <label class="chk"><input type="checkbox" id="stDailyPush" ${s.settings.dailyPushOn!==!1?"checked":""}>
          пуш о колоде дня: раз в сутки обоим в паре</label>
        <p class="dim" style="margin:4px 0 0">Уходит только парам, где оба заходили за последнюю неделю, и только тем,
        кто не выключил «🌙 Колода дня» в настройках уведомлений. Человек может заглушить всё кнопкой
        «🔕 Не беспокоить» под любым уведомлением или командой /silent — отписываться от бота ему не придётся.</p>
      </div>
      <div class="card" style="margin:0 0 12px">
        <h3 style="margin:0 0 8px">🚩 Feature flags</h3>
        <p class="dim" style="margin:0 0 10px">Включают и выключают фичи <b>без деплоя</b>: значение сохраняется здесь и
        приходит приложению. Если что-то сломалось в проде — снимите галочку и сохраните, пересобирать архив не нужно.
        Приложение при выключенном флаге остаётся полностью рабочим — фича просто не показывается.</p>
        ${(s.settings.flags?Object.entries(FLAG_LABEL).filter(([t])=>t in s.settings.flags):[]).map(([t,i])=>`
          <label class="chk" style="display:block;margin:0 0 7px"><input type="checkbox" data-flag="${esc(t)}" ${s.settings.flags[t]!==!1?"checked":""}> ${esc(i)}</label>`).join("")||'<p class="mut">Сервер не вернул список флагов — обновите серверную часть.</p>'}
      </div>
      <div class="row" style="margin:0 0 12px">
        <label class="chk"><input type="checkbox" id="stBackup" ${s.settings.backupOn!==!1?"checked":""}>
          автобэкап раз в сутки: копия всех данных документом в чат выше (05:30 мск) + 7 последних копий на сервере</label>
      </div>
      <div class="row" style="margin:0 0 12px">
        <label class="chk"><input type="checkbox" id="stUptime" ${s.settings.uptimeOn!==!1?"checked":""}>
          мониторинг живости: пинг сайта каждые 15 минут, сообщение в чат выше при падении (🔴) и восстановлении (🟢)</label>
      </div>
      <label class="lbl">Минимальная версия приложения</label>
      <input type="text" id="stMinClient" value="${esc(s.settings.minClient||"")}" placeholder="Например: 1.5.0 (пусто — проверка выключена)" maxlength="12">
      <p class="dim" style="margin:4px 0 12px">Клиенты старее этой версии увидят экран «Пора обновиться» с кнопкой перезагрузки.
      Ставьте номер после релиза важного обновления (текущая версия клиента: <b>${esc(s.clientVersion||"")}</b>${s.serverVersion?" · сервер "+esc(s.serverVersion):""}).</p>
      <p class="dim" style="margin:0 0 12px">Пары связываются только вручную: кодом или ссылкой-приглашением из бота.</p>
      <button class="btn btn-primary btn-sm" id="stSave">Сохранить</button>
    </div>
    <div class="card">
      <h2>✨ Анонс «Что нового»</h2>
      <p class="dim" style="margin:0 0 8px">Каждый пользователь увидит это окно ОДИН раз при следующем входе.
      Новый анонс появится снова у всех.</p>
      <label class="lbl">Заголовок</label>
      <input type="text" id="anTitle" placeholder="Например: Обновление 12 мая">
      <label class="lbl">Текст</label>
      <textarea id="anText" style="min-height:90px" placeholder="Что нового:&#10;— добавлены трейлеры&#10;— исправлены дубли сообщений"></textarea>
      <div class="row" style="margin-top:10px">
        <button class="btn btn-primary btn-sm" id="anSend">📣 Опубликовать</button>
        <button class="btn btn-ghost btn-sm" id="anPreview">Показать текущий</button>
      </div>
      <p class="mut" id="anCur" style="margin-top:8px"></p>
    </div>
    <div class="card">
      <h2>🛠 Режим обслуживания</h2>
      <div class="row" style="margin:0 0 10px">
        <label class="chk"><input type="checkbox" id="mtOn" ${s.settings.maintenance&&s.settings.maintenance.on?"checked":""}>
          включить заглушку в приложении и боте</label>
      </div>
      <label class="lbl">Причина (покажется пользователям)</label>
      <textarea id="mtReason" style="min-height:60px">${esc(s.settings.maintenance&&s.settings.maintenance.reason||"")}</textarea>
      <div class="row" style="margin-top:10px"><button class="btn btn-danger btn-sm" id="mtSave">Применить</button></div>
    </div>
    <div class="card">
      <h2>✍️ Тексты</h2>
      <p class="dim" style="margin:0 0 8px">Плейсхолдеры: {name} {code} {partners} — для /start; {title} {year} {rating} {partner} — для мэтча. Пусто = текст по умолчанию.</p>
      <label class="lbl">Приветствие /start</label>
      <textarea id="txStart" style="min-height:70px">${esc(s.settings.texts&&s.settings.texts.start||"")}</textarea>
      <label class="lbl">Подсказка в приложении</label>
      <input type="text" id="txHint" value="${esc(s.settings.texts&&s.settings.texts.hint||"")}">
      <label class="lbl">Уведомление о мэтче</label>
      <textarea id="txMatch" style="min-height:70px">${esc(s.settings.texts&&s.settings.texts.match||"")}</textarea>
      <div class="row" style="margin-top:10px"><button class="btn btn-primary btn-sm" id="txSave">Сохранить тексты</button></div>
    </div>
    <div class="card">
      <h2>🔑 Пароль админки</h2>
      <div class="row">
        <input type="password" id="pwCur" placeholder="Текущий пароль" style="flex:1;min-width:140px">
        <input type="password" id="pwNew" placeholder="Новый (мин. 6 символов)" style="flex:1;min-width:160px">
        <button class="btn btn-ghost btn-sm" id="pwSave">Сменить</button>
      </div>
    </div>
    <div class="card">
      <h2>☢️ Полная очистка</h2>
      <p class="mut">Стирает ВСЕ голоса, мэтчи, оценки, награды, скрытия и свои фильмы. Пользователи и пары останутся.</p>
      <div class="row">
        <input type="text" id="wipeConf" placeholder="Введите WIPE для подтверждения" style="flex:1;min-width:160px">
        <button class="btn btn-danger btn-sm" id="wipeBtn">Стереть всё</button>
      </div>
    </div>
    <div class="card">
      <h2>🔌 Подключение</h2>
      <label class="lbl">Адрес основного сайта</label>
      <input type="text" id="stApi" value="${esc(API.replace(/\/api$/,""))}">
      <div class="row" style="margin-top:10px">
        <button class="btn btn-ghost btn-sm" id="stApiSave">Сохранить адрес</button>
        <button class="btn btn-ghost btn-sm" id="stExport">⬇️ Экспорт всех данных (JSON)</button>
        <button class="btn btn-danger btn-sm" id="stLogout">Выйти</button>
      </div>
    </div>`,$("#stSave").onclick=async()=>{try{const t={};$$("[data-flag]").forEach(n=>{t[n.dataset.flag]=n.checked});const i=await call("settings.set",{patch:{menuText:$("#stMenu").value.trim()||"🎬 Открыть приложение",syncDeck:$("#stSync").checked,notifyChat:$("#stNotify")?$("#stNotify").value.trim():void 0,digestOn:$("#stDigest")?$("#stDigest").checked:void 0,dailyPushOn:$("#stDailyPush")?$("#stDailyPush").checked:void 0,backupOn:$("#stBackup")?$("#stBackup").checked:void 0,uptimeOn:$("#stUptime")?$("#stUptime").checked:void 0,minClient:$("#stMinClient")?$("#stMinClient").value.trim():void 0,flags:Object.keys(t).length?t:void 0}});toast("Сохранено. Чтобы текст кнопки применился к боту — подраздел «🤖 Бот» → «Перенастроить всё».","ok"),CACHE.status=null}catch(t){toast(t.message,"bad")}},$("#pwSave").onclick=async()=>{try{await call("password.set",{current:$("#pwCur").value,next:$("#pwNew").value}),toast("Пароль изменён","ok"),$("#pwCur").value="",$("#pwNew").value=""}catch(t){toast(t.message,"bad")}},$("#stApiSave").onclick=()=>{const t=$("#stApi").value.trim().replace(/\/+$/,"");if(!/^https?:\/\//.test(t)){toast("Некорректный адрес","bad");return}API=t+"/api",localStorage.setItem(LS_API,API),$("#sitePill").textContent=t,toast("Адрес сохранён","ok"),render()},$("#stExport").onclick=downloadBackup;const a=async()=>{try{const t=await call("announce.get");$("#anCur").textContent=t.announce?`Текущий анонс: «${t.announce.title}» от ${dateFmt(t.announce.ts)}`:"Текущего анонса нет."}catch{}};a(),$("#anSend").onclick=async()=>{if(confirm("Опубликовать анонс? Все пользователи увидят его один раз при входе."))try{await call("announce.set",{title:$("#anTitle").value,text:$("#anText").value}),toast("Анонс опубликован","ok"),$("#anTitle").value="",$("#anText").value="",a()}catch(t){toast(t.message,"bad")}},$("#anPreview").onclick=a,$("#mtSave").onclick=async()=>{try{await call("settings.set",{patch:{maintenance:{on:$("#mtOn").checked,reason:$("#mtReason").value}}}),toast($("#mtOn").checked?"Режим обслуживания включён":"Режим обслуживания выключен","ok"),render()}catch(t){toast(t.message,"bad")}},$("#txSave").onclick=async()=>{try{await call("settings.set",{patch:{texts:{start:$("#txStart").value,hint:$("#txHint").value,match:$("#txMatch").value}}}),toast("Тексты сохранены","ok")}catch(t){toast(t.message,"bad")}},$("#wipeBtn").onclick=async()=>{if($("#wipeConf").value!=="WIPE"){toast("Для подтверждения введите WIPE","bad");return}if(confirm("ТОЧНО стереть все данные приложения? Действие необратимо."))try{const t=await call("wipe",{confirm:"WIPE"});toast("Стерто для "+t.users+" пользователей","ok")}catch(t){toast(t.message,"bad")}},$("#stLogout").onclick=()=>logout()}function lastNDays(e){const s=[],a=new Date;for(let t=e-1;t>=0;t--)s.push(new Date(a.getTime()-t*864e5).toISOString().slice(0,10));return s}function svgBars(e,s){const n=Math.max(1,...e.map(p=>p.value)),c=596/Math.max(1,e.length),o=Math.max(1,Math.ceil(e.length/8)),d=e.map((p,u)=>{const r=Math.round(106*p.value/n),b=Math.round(22+u*c+c*.15),h=128-r;return`<rect x="${b}" y="${h}" width="${Math.max(2,Math.round(c*.7))}" height="${r||(p.value?2:0)}" rx="2" fill="${s}" opacity="${p.value?1:.25}"><title>${esc(p.title||p.label+": "+p.value)}</title></rect>`}).join(""),l=e.map((p,u)=>u%o===0||u===e.length-1?`<text x="${Math.round(22+u*c+c/2)}" y="144" font-size="9" fill="#8b93a7" text-anchor="middle">${esc(p.label)}</text>`:"").join("");return`<svg viewBox="0 0 640 150" class="chart" preserveAspectRatio="xMidYMid meet" role="img">
    <line x1="22" y1="128" x2="618" y2="128" stroke="#2a3145"/>
    ${d}${l}
    <text x="22" y="12" font-size="10" fill="#8b93a7">максимум: ${n}</text></svg>`}function svgLines(e,s){const n=Math.max(1,...e.flatMap(r=>r.values)),c=592/Math.max(1,s.length-1),o=r=>136-Math.round(112*r/n),d=Math.max(1,Math.ceil(s.length/8)),l=e.map(r=>{const b=r.values.map((v,g)=>`${g?"L":"M"}${Math.round(24+g*c)},${o(v)}`).join(" "),h=r.values.map((v,g)=>`<circle cx="${Math.round(24+g*c)}" cy="${o(v)}" r="2.4" fill="${r.color}"><title>${esc(s[g]+" · "+r.name+": "+v)}</title></circle>`).join("");return`<path d="${b}" fill="none" stroke="${r.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>${h}`}).join(""),p=s.map((r,b)=>b%d===0||b===s.length-1?`<text x="${Math.round(24+b*c)}" y="153" font-size="9" fill="#8b93a7" text-anchor="middle">${esc(String(r).slice(5))}</text>`:"").join(""),u=e.map(r=>`<span style="color:${r.color}">●</span> ${esc(r.name)}`).join(" &nbsp;·&nbsp; ");return{svg:`<svg viewBox="0 0 640 160" class="chart" preserveAspectRatio="xMidYMid meet" role="img">
      <line x1="24" y1="136" x2="616" y2="136" stroke="#2a3145"/>
      ${l}${p}<text x="24" y="12" font-size="10" fill="#8b93a7">максимум: ${n}</text></svg>`,legend:u}}async function renderAnalytics(e){const s=await call("analytics.stats",{days:30}),a=lastNDays(30),t={};(s.daily||[]).forEach(r=>{t[r.date]=r});const i=a.map(r=>t[r]||{date:r,users:0,swipers:0,matchers:0,swipes:0,likes:0,matches:0,watched:0,newUsers:0,feedback:0}),n=i[i.length-1]||{},c=i.slice(-7),o=(r,b)=>r.reduce((h,v)=>h+(v[b]||0),0),d=s.funnel||{},l=[["Зарегистрированы",d.registered,"хотя бы раз открыли бота"],["Первый свайп",d.swiped,"оценили хотя бы 1 фильм"],["Втянулись: 10+ свайпов",d.deep,"оценили 10 и больше фильмов"],["Связались с партнёром",d.paired,"состоят в паре"],["Поймали мэтч",d.matched,"есть хотя бы один общий мэтч"],["Посмотрели вместе",d.watched,"отметили мэтч «посмотрено»"]],p=Math.max(1,d.registered||0),u=svgLines([{name:"свайпы",color:"#7c5cff",values:i.map(r=>r.swipes)},{name:"лайки",color:"#3ddc84",values:i.map(r=>r.likes)},{name:"мэтчи",color:"#ff5c8a",values:i.map(r=>r.matches)}],a);e.innerHTML=`
    <div class="grid">
      <div class="stat acc"><b>${num(n.users)}</b><span>активных сегодня</span></div>
      <div class="stat"><b>${num(n.swipes)}</b><span>свайпов сегодня</span></div>
      <div class="stat good"><b>${num(n.matches)}</b><span>мэтчей сегодня</span></div>
      <div class="stat"><b>${num(o(c,"swipes"))}</b><span>свайпов за 7 дней</span></div>
      <div class="stat acc"><b>${num(Math.max(...c.map(r=>r.users)))}</b><span>пик активных за 7 дней</span></div>
      <div class="stat good"><b>${num(o(c,"matches"))}</b><span>мэтчей за 7 дней</span></div>
      <div class="stat warn"><b>${num(o(c,"feedback"))}</b><span>обратной связи за 7 дней</span></div>
    </div>
    <div class="card" style="margin-top:14px">
      <h2>📈 Активность по дням · 30 дней</h2>
      <p class="mut">Сколько уникальных пользователей открывало приложение каждый день. Наведите на столбик — увидите детали.</p>
      ${svgBars(i.map(r=>({label:r.date.slice(5),value:r.users,title:r.date+": "+r.users+" активных · свайпов "+r.swipes+" · мэтчей "+r.matches})),"#7c5cff")}
      <p class="dim">Статистика копится с момента установки этой версии — более ранние дни восстановить нельзя.</p>
    </div>
    <div class="card">
      <h2>Свайпы, лайки и мэтчи по дням</h2>
      <p class="mut">${u.legend}</p>
      ${u.svg}
    </div>
    <div class="card">
      <h2>🫗 Воронка свайпов</h2>
      <p class="mut">Сколько пользователей доходит до каждого шага — от регистрации до совместного просмотра.
      Помогает понять, где люди «отваливаются».</p>
      <div class="funnel">
        ${l.map(r=>{const b=Math.round((r[1]||0)/p*100);return`<div class="fn-row">
            <div class="fn-label"><b>${esc(r[0])}</b><small>${esc(r[2])}</small></div>
            <div class="fn-bar"><span style="width:${Math.max(r[1]?5:0,b)}%"></span></div>
            <div class="fn-val"><b>${num(r[1])}</b> <small class="dim">${b}%</small></div>
          </div>`}).join("")}
      </div>
    </div>
    <div class="card">
      <h2>🔥 Самые свайпаемые фильмы</h2>
      ${s.top&&s.top.length?`<div class="tblwrap"><table class="tbl">
        <thead><tr><th>Фильм</th><th>❤ / ✖ / 👁</th><th>Мэтчей</th><th>Посмотрено</th><th>«Как зашло»</th></tr></thead>
        <tbody>${s.top.map(r=>`<tr>
          <td><div class="who">${r.p?`<img class="poster-mini" src="${esc(r.p)}" alt="" onerror="this.style.visibility='hidden'">`:""}
            <div><b>${esc(r.t)}</b><small>${r.y||""}${r.r?" · ★ "+Number(r.r).toFixed(1):""}</small></div></div></td>
          <td class="num"><span class="ok-t">${r.like}</span> / <span class="bad-t">${r.dislike}</span> / <span class="dim" title="уже смотрел">${r.seen||0}👁</span></td>
          <td class="num">${r.matches}</td><td class="num">${r.watched}</td>
          <td class="num">${r.avgScore?r.avgScore+" ★":"—"}</td></tr>`).join("")}</tbody></table></div>`:'<p class="mut">Пока мало данных — фильмы появятся здесь после первых свайпов.</p>'}
    </div>`}async function renderFeedback(e){const s=await call("feedback.list"),a={bug:["🐞","Ошибка"],idea:["💡","Идея"],other:["✍️","Сообщение"]},t=n=>{const c=a[n.kind]||a.other;return`<div class="fbrow ${n.status==="answered"?"done":""}" data-id="${esc(n.id)}">
      <div class="fbrow-head">
        <b>${c[0]} ${esc(c[1])}</b>
        <span class="pill ${n.status==="answered"?"show":"warn"}">${n.status==="answered"?"отвечено":"новое"}</span>
        <span class="dim" style="margin-left:auto">${dateFmt(n.ts)}</span>
      </div>
      <p class="fbrow-text">${esc(n.text||"")}</p>
      <div class="dim" style="font-size:12px">От: <b>${esc(n.name||"")}</b>${n.username?" @"+esc(n.username):""} · id ${esc(n.uid||"")}${n.contact?" · контакт: "+esc(n.contact):""}</div>
      ${n.reply?`<div class="fbrow-reply">💬 Ваш ответ (${dateFmt(n.answeredTs)}): ${esc(n.reply)}</div>`:""}
      <div class="row" style="margin-top:8px">
        <button class="btn btn-primary btn-sm" data-act="reply">${n.status==="answered"?"💬 Ответить ещё раз":"💬 Ответить"}</button>
        <button class="btn btn-ghost btn-sm" data-act="openuser">👤 Карточка пользователя</button>
        <button class="btn btn-danger btn-sm" data-act="del">Удалить</button>
      </div>
    </div>`};e.innerHTML=`
    <div class="card">
      <h2>✍️ Обратная связь · ${s.items.length}</h2>
      <p class="mut">Сообщения из приложения (вкладка «Пара» → «Обратная связь»). Ответ уходит человеку
      личным сообщением бота. Чтобы новые сообщения мгновенно приходили вам в Telegram —
      укажите свой ID в «Настройки» → «Telegram для уведомлений».</p>
      <div class="row" style="margin:10px 0 14px">
        <button class="btn btn-ghost btn-sm fb-f on" data-f="all">Все</button>
        <button class="btn btn-ghost btn-sm fb-f" data-f="new">Новые</button>
        <button class="btn btn-ghost btn-sm fb-f" data-f="answered">С ответом</button>
      </div>
      <div id="fbBox">${s.items.length?s.items.map(t).join(""):'<p class="mut">Пока пусто — никто ничего не присылал.</p>'}</div>
    </div>`;const i=n=>{$$("#fbBox .fbrow").forEach(c=>{const o=c.classList.contains("done");c.style.display=n==="all"||n==="new"&&!o||n==="answered"&&o?"":"none"}),$$(".fb-f").forEach(c=>c.classList.toggle("on",c.dataset.f===n))};$$(".fb-f").forEach(n=>n.onclick=()=>i(n.dataset.f)),$("#fbBox").onclick=async n=>{const c=n.target.closest("[data-act]");if(!c)return;const d=c.closest(".fbrow").dataset.id,l=s.items.find(p=>p.id===d);if(l)try{if(c.dataset.act==="reply")openModal(`
          <h3>💬 Ответ для ${esc(l.name||l.username||"id "+l.uid)}</h3>
          <p class="mut fbquote">${esc(l.text||"")}</p>
          <textarea id="fbReply" style="min-height:100px" placeholder="Ваш ответ — придёт ему в Telegram от бота">${esc(l.reply||"")}</textarea>
          <div class="row" style="margin-top:10px"><button class="btn btn-primary btn-sm" id="fbReplySend">📨 Отправить ответ</button></div>`),$("#fbReplySend").onclick=async()=>{const p=$("#fbReply").value.trim();if(!p){toast("Пустой ответ","bad");return}try{await call("feedback.reply",{id:d,text:p}),toast("Ответ отправлен в Telegram","ok"),closeModal(),render()}catch(u){toast(u.message,"bad")}};else if(c.dataset.act==="del"){if(!confirm("Удалить это сообщение?"))return;await call("feedback.delete",{id:d}),toast("Удалено","ok"),render()}else c.dataset.act==="openuser"&&await openUserCard(String(l.uid))}catch(p){toast(p.message,"bad")}}}async function openCardEditor(e){const s=await call("catalog.card",{id:e}),a=s.card||{};openModal(`
    <h3>✏️ Карточка: ${esc(a.t||e)}</h3>
    <p class="dim">Поля заполнены текущими значениями — поправьте, что нужно. Изменения сразу видны всем в приложении.
    «Вернуть оригинал» отменит все правки этой карточки.</p>
    ${s.edit?'<p class="warn-t" style="margin:6px 0">⚠ Карточка уже отредактирована вручную.</p>':""}
    <label class="lbl">Название</label>
    <input type="text" id="ceT" value="${esc(a.t||"")}" maxlength="120">
    <div class="row" style="margin-top:8px">
      <div style="flex:1"><label class="lbl">Год</label><input type="text" id="ceY" value="${a.y!=null?esc(a.y):""}"></div>
      <div style="flex:1"><label class="lbl">Тип</label><select id="ceTp"><option value="movie">фильм</option><option value="series">сериал</option></select></div>
      <div style="flex:1"><label class="lbl">Рейтинг 0–10</label><input type="text" id="ceR" value="${a.r!=null?esc(a.r):""}"></div>
      <div style="flex:1"><label class="lbl">Минут</label><input type="text" id="ceMin" value="${a.minutes!=null?esc(a.minutes):""}"></div>
    </div>
    <label class="lbl">Постер (ссылка)</label>
    <input type="url" id="ceP" value="${esc(a.p||"")}">
    <label class="lbl">Жанры (через запятую)</label>
    <input type="text" id="ceG" value="${esc((a.g||[]).join(", "))}">
    <label class="lbl">Трейлер (ключ или ссылка YouTube)</label>
    <input type="text" id="ceTr" value="${esc(a.tr||"")}">
    <label class="lbl">Описание</label>
    <textarea id="ceD" style="min-height:100px">${esc(a.desc||"")}</textarea>
    <div class="row" style="margin-top:12px">
      <button class="btn btn-primary btn-sm" id="ceSave">💾 Сохранить</button>
      <button class="btn btn-ghost btn-sm" id="ceReset">↩️ Вернуть оригинал</button>
    </div>`),$("#ceTp").value=a.tp==="series"?"series":"movie",$("#ceSave").onclick=async()=>{try{await call("catalog.edit",{id:e,patch:{t:$("#ceT").value,y:$("#ceY").value,tp:$("#ceTp").value,r:$("#ceR").value,minutes:$("#ceMin").value,p:$("#ceP").value,g:$("#ceG").value,tr:$("#ceTr").value,desc:$("#ceD").value}}),toast("Карточка сохранена — изменения уже видны в приложении","ok"),closeModal(),render()}catch(t){toast(t.message,"bad")}},$("#ceReset").onclick=async()=>{if(confirm("Вернуть карточку к оригинальному виду? Все ручные правки пропадут."))try{await call("catalog.edit.reset",{id:e}),toast("Оригинал возвращён","ok"),closeModal(),render()}catch(t){toast(t.message,"bad")}}}async function openAutoCollections(){openModal('<h3>⚡ Авто-подборки</h3><p class="mut">Считаем, что можно собрать из каталога…</p>');let e;try{e=await call("collections.auto",{})}catch(a){openModal(`<h3>⚡ Авто-подборки</h3><p class="bad-t">${esc(a.message)}</p>`);return}const s=e.preview||[];if(!s.length){openModal('<h3>⚡ Авто-подборки</h3><p class="mut">Каталог пока слишком мал — нечего собрать.</p>');return}openModal(`
    <h3>⚡ Авто-подборки</h3>
    <p class="dim">Готовые наборы по правилам: высокий рейтинг, жанры, новинки, хронометраж.
    Отметьте нужные — они создадутся одним нажатием (повторный запуск просто обновит состав).</p>
    <div id="autoList">${s.map(a=>`
      <label class="chk" style="display:flex;align-items:flex-start;gap:8px;margin:10px 0">
        <input type="checkbox" data-key="${esc(a.key)}" checked style="margin-top:4px">
        <span><b>${esc(a.emoji||"🍿")} ${esc(a.title)}</b> <span class="dim">· ${a.count} фильмов</span><br>
        <small class="dim">${esc(a.note||"")}: ${esc((a.sample||[]).join(", "))}${a.count>(a.sample||[]).length?"…":""}</small></span>
      </label>`).join("")}</div>
    <div class="row" style="margin-top:14px">
      <button class="btn btn-primary btn-sm" id="autoApply">Создать / обновить выбранные</button>
      <button class="btn btn-ghost btn-sm" id="autoCancel">Отмена</button>
    </div>`),$("#autoCancel").onclick=closeModal,$("#autoApply").onclick=async()=>{const a=$$("#autoList input:checked").map(t=>t.dataset.key);if(!a.length){toast("Отметьте хотя бы одну подборку","bad");return}$("#autoApply").disabled=!0;try{const t=await call("collections.auto",{apply:!0,keys:a});toast(`Готово: создано ${t.created}, обновлено ${t.updated}`,"ok"),closeModal(),loadColBox()}catch(t){$("#autoApply").disabled=!1,toast(t.message,"bad")}}}async function loadColBox(){const e=$("#colBox");if(e)try{const s=await call("collections.list");if(!s.collections.length){e.innerHTML='<p class="mut">Подборок пока нет. Создайте первую — например «Комедии на пятницу».</p>';return}e.innerHTML=`<div class="tblwrap"><table class="tbl">
      <thead><tr><th>Подборка</th><th>Фильмов</th><th>Состав</th><th></th></tr></thead>
      <tbody>${s.collections.map(a=>`<tr data-id="${esc(a.id)}">
        <td><b>${esc(a.emoji||"🍿")} ${esc(a.title)}</b>${a.note?`<br><small class="dim">${esc(a.note)}</small>`:""}</td>
        <td class="num">${a.count}</td>
        <td class="mut" style="max-width:320px">${esc((a.titles||[]).join(", "))}${a.count>(a.titles||[]).length?"…":""}</td>
        <td><div class="row">
          <button class="btn btn-ghost btn-sm" data-act="coledit">✏️ Править</button>
          <button class="btn btn-danger btn-sm" data-act="coldel">Удалить</button>
        </div></td></tr>`).join("")}</tbody></table></div>`,$$('#colBox [data-act="coledit"]').forEach(a=>a.onclick=()=>{const t=s.collections.find(i=>i.id===a.closest("tr").dataset.id);openCollectionEditor(t)}),$$('#colBox [data-act="coldel"]').forEach(a=>a.onclick=async()=>{if(confirm("Удалить подборку? У пользователей она просто исчезнет из фильтров."))try{await call("collections.delete",{id:a.closest("tr").dataset.id}),toast("Подборка удалена","ok"),loadColBox()}catch(t){toast(t.message,"bad")}})}catch(s){e.innerHTML='<p class="bad-t">'+esc(s.message)+"</p>"}}async function openCollectionEditor(e){e=e||{id:"",title:"",emoji:"🍿",note:"",items:[]};const s=(e.items||[]).slice(),a={};try{((await call("catalog",{limit:1e3})).items||[]).forEach(c=>{a[c.id]=c.t})}catch{}openModal(`
    <h3>${e.id?"✏️ Подборка":"➕ Новая подборка"}</h3>
    <p class="dim">Подборка появится у всех в приложении в фильтрах колоды: выбрал — свайпаешь только её фильмы.
    Порядок фильмов здесь = порядок карточек в колоде (двигайте стрелками ↑/↓).</p>
    <div class="row">
      <input type="text" id="coEmoji" value="${esc(e.emoji||"🍿")}" style="width:64px" maxlength="4" title="Эмодзи">
      <input type="text" id="coTitle" value="${esc(e.title||"")}" placeholder="Название* — например: Пятничный вечер" style="flex:1;min-width:170px" maxlength="60">
    </div>
    <label class="lbl">Подпись (необязательно)</label>
    <input type="text" id="coNote" value="${esc(e.note||"")}" placeholder="Короткое описание подборки" maxlength="200">
    <label class="lbl">Фильмы в подборке</label>
    <div class="row"><input type="text" id="coQ" placeholder="🔎 Найти фильм по названию и добавить…" style="flex:1;min-width:200px" autocomplete="off"></div>
    <div id="coResults" class="co-results"></div>
    <div id="coPicked" class="co-picked"></div>
    <div class="row" style="margin-top:14px">
      <button class="btn btn-primary btn-sm" id="coSave">💾 Сохранить подборку</button>
      <span class="dim" id="coCount"></span>
    </div>`);const t=()=>{const n=$("#coCount");n&&(n.textContent=s.length?s.length+" в подборке":"подборка пуста");const c=$("#coPicked");if(!c)return;if(!s.length){c.innerHTML='<p class="mut">Добавьте фильмы через поиск выше.</p>';return}c.innerHTML=s.map((d,l)=>`<span class="co-chip"><i class="co-n">${l+1}.</i> ${esc(a[d]||d)}
      <b data-up="${esc(d)}" title="Поднять выше">↑</b><b data-down="${esc(d)}" title="Опустить ниже">↓</b><b data-rm="${esc(d)}" title="Убрать">✕</b></span>`).join("");const o=(d,l)=>{const p=s.indexOf(d),u=p+l;p<0||u<0||u>=s.length||([s[p],s[u]]=[s[u],s[p]],t())};$$("#coPicked [data-rm]").forEach(d=>d.onclick=()=>{const l=s.indexOf(d.dataset.rm);l>=0&&s.splice(l,1),t()}),$$("#coPicked [data-up]").forEach(d=>d.onclick=()=>o(d.dataset.up,-1)),$$("#coPicked [data-down]").forEach(d=>d.onclick=()=>o(d.dataset.down,1))};let i;$("#coQ").addEventListener("input",n=>{clearTimeout(i);const c=n.target.value.trim();i=setTimeout(async()=>{const o=$("#coResults");if(o){if(c.length<2){o.innerHTML="";return}try{const d=await call("catalog",{q:c,limit:8});o.innerHTML=(d.items||[]).map(l=>`<div class="co-item" data-id="${esc(l.id)}">
          ${l.p?`<img src="${esc(l.p)}" alt="" onerror="this.style.visibility='hidden'">`:""}
          <span><b>${esc(l.t)}</b> <small class="dim">${l.y||""}${l.r?" · ★ "+Number(l.r).toFixed(1):""}</small></span>
          <button class="btn btn-ghost btn-sm">＋</button></div>`).join("")||'<p class="mut">Ничего не найдено</p>',$$("#coResults .co-item").forEach(l=>l.onclick=()=>{const p=l.dataset.id;if(!a[p]){const u=l.querySelector("b");u&&(a[p]=u.textContent)}s.includes(p)||(s.push(p),t())})}catch(d){o.innerHTML='<p class="bad-t">'+esc(d.message)+"</p>"}}},300)}),t(),$("#coSave").onclick=async()=>{const n=$("#coTitle").value.trim();if(!n){toast("Укажите название подборки","bad");return}try{await call("collections.save",{id:e.id||void 0,title:n,emoji:$("#coEmoji").value.trim()||"🍿",note:$("#coNote").value.trim(),items:s}),toast("Подборка сохранена — она уже в фильтрах у пользователей","ok"),closeModal(),loadColBox()}catch(c){toast(c.message,"bad")}}}async function startMerge(e,s){const a=prompt(`Объединить «${s}» с другим аккаунтом (дублем).

ВСЕ данные переедут В ЦЕЛЕВОЙ аккаунт, а «${s}» будет удалён.
Введите Telegram ID, @username или код ЦЕЛЕВОГО аккаунта:`);if(!a||!a.trim())return;const t=a.trim();let i=null;if(/^\d+$/.test(t))try{i=(await call("user",{id:t})).user}catch{}if(!i)try{const c=((await call("users.search",{q:t.replace(/^@/,"")})).users||[]).filter(o=>String(o.id)!==String(e));if(c.length===1)i=c[0];else if(c.length>1){openModal(`<h3>🔀 Кого имели в виду?</h3><p class="dim">Нажмите на целевой аккаунт — данные «${esc(s)}» переедут в него.</p>`+c.slice(0,10).map(o=>`<div class="row" style="margin:8px 0">
            <button class="btn btn-ghost btn-sm" data-pick="${esc(o.id)}" data-name="${esc(o.first_name||o.id)}" style="flex:1;text-align:left">
              ${esc(o.first_name||"Без имени")} ${o.username?'<span class="dim">@'+esc(o.username)+"</span>":""}
              <span class="dim">· id ${esc(o.id)} · ${num(o.votes)} голосов</span></button></div>`).join("")),$$("#modalBody [data-pick]").forEach(o=>o.onclick=()=>doMerge(e,s,o.dataset.pick,o.dataset.name));return}}catch{}if(!i){toast("Целевой аккаунт не найден","bad");return}doMerge(e,s,i.id,i.first_name||i.id)}async function doMerge(e,s,a,t){if(confirm(`ТОЧНО объединить аккаунты?

«${s}» (id ${e}) растворится в «${t}» (id ${a}).
Голоса, мэтчи, партнёры, награды и группы переедут; аккаунт «${s}» будет удалён.
Отменить нельзя.`))try{const i=await call("users.merge",{fromId:e,intoId:a});toast(`Объединено: голосов +${i.votesAdded}, партнёров +${i.partnersMoved}, наград +${i.badgesAdded}`,"ok"),closeModal(),render()}catch(i){toast("Ошибка: "+i.message,"bad")}}function deckTable(e,s){return`<div class="tblwrap"><table class="tbl">
    <thead><tr><th style="width:34px">#</th><th>Фильм</th><th>Рейтинг</th></tr></thead>
    <tbody>${e.map((a,t)=>`<tr>
      <td class="dim">${s+t+1}</td>
      <td><div class="who">${a.p?`<img class="poster-mini" src="${esc(a.p)}" alt="" onerror="this.style.visibility='hidden'">`:""}
        <div><b>${esc(a.t)}</b><small>${a.y||""} · ${a.tp==="series"?"сериал":"фильм"} · <code>${esc(a.id)}</code></small></div></div></td>
      <td class="num">${a.r?"★ "+Number(a.r).toFixed(1):"—"}</td></tr>`).join("")}</tbody></table></div>`}async function openDeckPreview(e,s){openModal('<h3>🎬 Колода пары</h3><p class="mut">Считаем порядок карточек…</p>');try{let a="";try{const d=await fetch(API.replace(/\/api$/,"")+"/data/movies.json");d.ok&&(a=(await d.json()).version||"")}catch{}const t=await call("pairs.deckPreview",{userA:e,userB:s,version:a,limit:40}),i=esc(t.a.first_name||t.a.id),n=esc(t.b.first_name||t.b.id),c=a?"":'<p class="bad-t">Не удалось прочитать версию каталога — порядок может отличаться от пользовательского.</p>';let o;if(t.mode==="independent"&&t.deckA&&t.deckB){const d=p=>{const u=(p.daily||[]).length?`<span style="color:var(--gold)">🌙 ${(p.daily||[]).length} карточек дня в начале</span> · `:"",r=[];return(p.prefs||[]).length&&r.push("🏷 "+p.prefs.map(esc).join(", ")),(p.topGenres||[]).length&&r.push("🎯 по лайкам: "+p.topGenres.map(esc).join(", ")),u&&r.unshift(u),r.length?`<p class="dim" style="margin:4px 0 8px">${r.join(" · ")}</p>`:'<p class="dim" style="margin:4px 0 8px">Любимые жанры не выбраны — обычный случайный порядок.</p>'},l=t.dailyPool&&t.dailyPool.length?`<p class="dim" style="margin:0 0 14px">🌙 <b>Колода дня</b> (${esc(t.dailyDay||"")}): первые ${(t.dailyPool||[]).length} карточек
          у обоих одинаковые — они и дают регулярные мэтчи. Дальше идёт личная часть колоды.</p>`:"";o=`
        <p class="dim">${i} + ${n} · каталог ${esc(a||"—")}</p>
        <p class="dim" style="margin:6px 0 14px">Колоды <b>независимые</b>: каждый листает свою и лайкает сам —
        свайп одного не убирает карточку у второго. Мэтч случается, когда оба лайкнули один и тот же фильм.</p>
        ${l}
        ${c}
        <h3 style="margin:14px 0 2px">👤 ${i} · осталось ${num(t.deckA.total)}${t.deckA.personalized?" · порядок подстроен под вкус":""}</h3>
        ${d(t.deckA)}
        ${deckTable(t.deckA.items,0)}
        <h3 style="margin:18px 0 2px">👤 ${n} · осталось ${num(t.deckB.total)}${t.deckB.personalized?" · порядок подстроен под вкус":""}</h3>
        ${d(t.deckB)}
        ${deckTable(t.deckB.items,0)}
        <p class="dim" style="margin-top:10px">Не учитываются только фильтры экрана (настроение, длительность,
        подборка) и локальный переключатель «🎯 Под мой вкус» — он живёт в браузере пользователя.</p>`}else{const d=t.shared||{total:t.total,items:t.items||[]};o=`
        <p class="dim">${i} + ${n} · осталось карточек: <b>${num(d.total)}</b> · каталог ${esc(a||"—")}</p>
        <p class="dim" style="margin:6px 0 14px">Включена <b>общая колода</b> (настройки → «общая колода на пару»):
        оба видят один и тот же порядок, карточка уходит, когда её оценил любой из пары.</p>
        ${c}
        ${deckTable(d.items||[],0)}`}openModal(`<h3>🎬 Колода пары</h3>${o}
      <div class="row" style="margin-top:12px">
        <button class="btn btn-ghost btn-sm" id="dpBack">← К карточке пользователя</button></div>`),$("#dpBack").onclick=()=>openUserCard(e)}catch(a){openModal(`<h3>🎬 Колода пары</h3><p class="bad-t">${esc(a.message)}</p>`)}}let gsT=null;function bindGlobalSearch(){const e=$("#globalQ");if(!e||e.dataset.bound)return;e.dataset.bound="1";const s=()=>{const a=e.value.trim();a.length<2||doGlobalSearch(a)};e.addEventListener("keydown",a=>{a.key==="Enter"&&(clearTimeout(gsT),s())}),e.addEventListener("input",()=>{clearTimeout(gsT),gsT=setTimeout(s,500)})}async function doGlobalSearch(e){openModal(`<h3>🔎 Поиск: «${esc(e)}»</h3><p class="mut">Ищем…</p>`);let s;try{s=await call("global.search",{q:e})}catch(l){openModal(`<h3>🔎 Поиск: «${esc(e)}»</h3><p class="bad-t">${esc(l.message)}</p>`);return}const a=(l,p)=>p&&p.length?`<h3 style="margin:14px 0 6px">${l} · ${p.length}</h3>${p.join("")}`:"",t=(s.users||[]).map(l=>`<div class="row" style="margin:6px 0">
      <button class="btn btn-ghost btn-sm" data-gsu="${esc(l.id)}" style="flex:1;text-align:left">
        👤 ${esc(l.first_name||"Без имени")} ${l.username?'<span class="dim">@'+esc(l.username)+"</span>":""}
        <span class="dim">· id ${esc(l.id)} · код ${esc(l.code||"")}${l.banned?" · забанен":""}</span></button></div>`),i=(s.pairs||[]).map(l=>`<div class="row" style="margin:6px 0">
      <button class="btn btn-ghost btn-sm" data-gsp="${esc(l.a)}" style="flex:1;text-align:left">
        💞 ${esc(l.name)} <span class="dim">· мэтчей ${l.matches}, посмотрено ${l.watched}</span></button></div>`),n=(s.films||[]).map(l=>`<div class="row" style="margin:6px 0">
      <button class="btn btn-ghost btn-sm" data-gsf="${esc(l.id)}" style="flex:1;text-align:left">
        🎞 ${esc(l.t)} <span class="dim">${l.y||""} · ${l.tp==="series"?"сериал":"фильм"}${l.r?" · ★ "+Number(l.r).toFixed(1):""}</span></button></div>`),c=(s.collections||[]).map(l=>`<div class="row" style="margin:6px 0">
      <span class="mut" style="flex:1">📚 ${esc(l.emoji||"")} ${esc(l.title)} <span class="dim">· ${l.count} фильмов</span></span>
      <button class="btn btn-ghost btn-sm" data-gstab="catalog">К подборкам</button></div>`),o=(s.feedback||[]).map(l=>`<div class="fb-item" style="margin:6px 0">
      ✍️ ${esc(l.name||"аноним")} <span class="dim">${dateFmt(l.ts)}</span><br>
      <small>${esc(l.text||"")}</small></div>`),d=(s.users||[]).length+(s.pairs||[]).length+(s.films||[]).length+(s.collections||[]).length+(s.feedback||[]).length;openModal(`<h3>🔎 Поиск: «${esc(e)}»</h3>`+(d?"":'<p class="mut">Ничего не найдено.</p>')+a("👤 Люди",t)+a("💞 Пары",i)+a("🎞 Фильмы",n)+a("📚 Подборки",c)+a("✍️ Обратная связь",o)),$$("#modalBody [data-gsu]").forEach(l=>l.onclick=()=>openUserCard(l.dataset.gsu)),$$("#modalBody [data-gsp]").forEach(l=>l.onclick=()=>openUserCard(l.dataset.gsp)),$$("#modalBody [data-gsf]").forEach(l=>l.onclick=()=>openCardEditor(l.dataset.gsf)),$$("#modalBody [data-gstab]").forEach(l=>l.onclick=()=>{closeModal(),switchTab(l.dataset.gstab)})}function openModal(e){$("#modalBody").innerHTML=e,$("#modal").classList.remove("hidden")}function closeModal(){$("#modal").classList.add("hidden")}$("#loginBtn").onclick=doLogin,$("#pwd").addEventListener("keydown",e=>{e.key==="Enter"&&doLogin()}),$("#pwd2").addEventListener("keydown",e=>{e.key==="Enter"&&doLogin()}),$("#logoutBtn").onclick=()=>logout(),$("#refreshBtn").onclick=()=>{CACHE={},render(),toast("Обновлено")},$("#modalX").onclick=closeModal,$("#modal").addEventListener("click",e=>{e.target.id==="modal"&&closeModal()}),$$("#tabs button").forEach(e=>e.onclick=()=>switchTab(e.dataset.tab)),TOK?($("#login").classList.add("hidden"),$("#app").classList.remove("hidden"),$("#sitePill").textContent=API.replace("/api",""),bindGlobalSearch(),switchTab("dash")):showLogin(),window.KinoAdmin={call,get state(){return{API,TOK,CURRENT_TAB}}};
