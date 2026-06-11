// Общая логика для всех админ-страниц: опрос новых заказов и тост-уведомление.
// Подключается через <script src="/admin/_admin.js"></script> в каждой странице.
(function() {
  if (window.__adminInited) return;
  window.__adminInited = true;

  // === Favicon адмінки ===
  // Адмін-сторінки — статичні, без серверної підстановки favicon (вона працює лише
  // на вітрині). Тому кастомну іконку з налаштувань (Зовнішній вигляд → Favicon)
  // ставимо тут. Кеш у localStorage — щоб іконка з'являлась миттєво.
  const FAV_KEY = 'admin_faviconUrl';
  function applyFavicon(url) {
    if (!url) return;
    let l = document.querySelector('link[rel="icon"]');
    if (!l) { l = document.createElement('link'); l.rel = 'icon'; document.head.appendChild(l); }
    if (l.getAttribute('href') !== url) l.setAttribute('href', url);
  }
  try { applyFavicon(localStorage.getItem(FAV_KEY) || ''); } catch {}

  // === Плаваюча кнопка «Відкрити сайт» (нова вкладка) ===
  // Увімкнення і перелік сторінок — у Налаштуваннях (adminSiteBtnEnabled / adminSiteBtnPages).
  // Позиція зберігається СЕРВЕРНО (/api/admin/ui-layout, kind 'siteBtn') ОКРЕМО ДЛЯ КОЖНОЇ
  // СТОРІНКИ (path = ключ сторінки) і синхронізується між компʼютерами. Замочок — один на всі
  // сторінки (path 'lock'). localStorage — лише миттєвий кеш. Позиція — у долях вікна (fx/fy 0..1).
  const SB_CFG_KEY = 'admin_siteBtnCfg';
  function sbPageKey() {
    const m = location.pathname.match(/^\/admin\/?([^/]*)/);
    return (m && m[1] && m[1] !== 'index.html') ? m[1] : 'index';
  }
  const SB_POS_KEY = 'admin_siteBtnPos_' + sbPageKey();
  const SB_LOCK_KEY = 'admin_siteBtnLock';
  let sbPos = null;            // {fx,fy} цієї сторінки; null = типове місце (угорі праворуч)
  let sbLocked = false;
  try {
    const c = JSON.parse(localStorage.getItem(SB_POS_KEY) || 'null');
    if (c && typeof c.fx === 'number' && typeof c.fy === 'number') sbPos = { fx: c.fx, fy: c.fy };
  } catch {}
  try { sbLocked = localStorage.getItem(SB_LOCK_KEY) === '1'; } catch {}
  function sbApplyPos(box) {
    if (!sbPos) return; // типове top/right із CSS
    const w = box.offsetWidth || 140, h = box.offsetHeight || 40;
    const x = Math.max(4, Math.min(sbPos.fx * (window.innerWidth - w), window.innerWidth - w - 4));
    const y = Math.max(4, Math.min(sbPos.fy * (window.innerHeight - h), window.innerHeight - h - 4));
    box.style.left = x + 'px'; box.style.top = y + 'px'; box.style.right = 'auto';
  }
  function sbServerSave(path, value) {
    try {
      fetch('/api/admin/ui-layout', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'siteBtn', path, value }),
      }).catch(() => {});
    } catch {}
  }
  function applySiteBtn(cfg) {
    const show = cfg && cfg.enabled !== false && !(cfg.pages && cfg.pages[sbPageKey()] === false);
    let box = document.getElementById('adminSiteBtn');
    if (!show) { if (box) box.remove(); return; }
    if (box || !document.body) return;

    box = document.createElement('div');
    box.id = 'adminSiteBtn';
    box.style.cssText = 'position:fixed;top:14px;right:14px;z-index:9999;touch-action:none;user-select:none;';
    box.innerHTML = `
      <a href="/" target="_blank" rel="noopener" title="Відкрити сайт у новій вкладці" draggable="false"
        style="display:inline-flex;align-items:center;gap:7px;padding:9px 14px;background:#0b8aff;color:#fff;
        font:600 14px 'Segoe UI',-apple-system,Arial,sans-serif;border-radius:10px;text-decoration:none;
        box-shadow:0 2px 10px rgba(11,138,255,.35);cursor:grab">🌐 Відкрити сайт</a>
      <span data-sb-lock style="position:absolute;bottom:-7px;right:-7px;background:#fff;border:1px solid #e5e7eb;
        border-radius:50%;width:18px;height:18px;line-height:15px;text-align:center;font-size:10px;cursor:pointer;"></span>`;
    document.body.appendChild(box);

    const link = box.querySelector('a');
    const lockEl = box.querySelector('[data-sb-lock]');
    function paintLock() {
      lockEl.textContent = sbLocked ? '🔒' : '🔓';
      lockEl.style.borderColor = sbLocked ? '#f59e0b' : '#e5e7eb';
      lockEl.title = sbLocked ? 'Перетягування заблоковано — натисни, щоб розблокувати' : 'Заблокувати перетягування';
      link.style.cursor = sbLocked ? 'pointer' : 'grab';
    }
    paintLock();
    box.__sync = () => { sbApplyPos(box); paintLock(); }; // виклик після відповіді сервера
    sbApplyPos(box);
    lockEl.addEventListener('click', (e) => {
      e.stopPropagation();
      sbLocked = !sbLocked;
      paintLock();
      try { localStorage.setItem(SB_LOCK_KEY, sbLocked ? '1' : '0'); } catch {}
      sbServerSave('lock', { locked: sbLocked });
    });
    window.addEventListener('resize', () => sbApplyPos(box));

    // Перетягування (pointer events: миша + тач). Якщо тягнули — клік по лінку гасимо.
    let drag = null;
    box.addEventListener('pointerdown', (e) => {
      if (sbLocked || e.target === lockEl) return;
      const r = box.getBoundingClientRect();
      drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, sx: e.clientX, sy: e.clientY, moved: false };
      try { box.setPointerCapture(e.pointerId); } catch {}
    });
    box.addEventListener('pointermove', (e) => {
      if (!drag) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 5) return;
      drag.moved = true;
      const w = box.offsetWidth || 140, h = box.offsetHeight || 40;
      const x = Math.max(4, Math.min(e.clientX - drag.dx, window.innerWidth - w - 4));
      const y = Math.max(4, Math.min(e.clientY - drag.dy, window.innerHeight - h - 4));
      box.style.left = x + 'px'; box.style.top = y + 'px'; box.style.right = 'auto';
    });
    box.addEventListener('pointerup', () => {
      if (drag && drag.moved) {
        const w = box.offsetWidth || 140, h = box.offsetHeight || 40;
        sbPos = {
          fx: Math.max(0, Math.min(1, parseFloat(box.style.left) / Math.max(1, window.innerWidth - w))),
          fy: Math.max(0, Math.min(1, parseFloat(box.style.top) / Math.max(1, window.innerHeight - h))),
        };
        try { localStorage.setItem(SB_POS_KEY, JSON.stringify(sbPos)); } catch {}
        sbServerSave(sbPageKey(), sbPos); // позиція цієї сторінки
        box.__suppressClick = true;
        setTimeout(() => { box.__suppressClick = false; }, 0);
      }
      drag = null;
    });
    link.addEventListener('click', (e) => { if (box.__suppressClick) e.preventDefault(); });
  }
  // Миттєвий показ з кешу, потім оновлення зі свіжих налаштувань
  try { applySiteBtn(JSON.parse(localStorage.getItem(SB_CFG_KEY) || 'null') || { enabled: true }); } catch {}

  // Серверна позиція цієї сторінки + замочок — підтягуємо (сервер головніший за локальний кеш)
  fetch('/api/admin/ui-layout', { credentials: 'include' })
    .then(r => (r.ok ? r.json() : null))
    .then(d => {
      const sb = d && d.ok && d.layout && d.layout.siteBtn;
      if (!sb || typeof sb !== 'object') return;
      const v = sb[sbPageKey()];
      if (v && typeof v.fx === 'number' && typeof v.fy === 'number') {
        sbPos = { fx: v.fx, fy: v.fy };
        try { localStorage.setItem(SB_POS_KEY, JSON.stringify(sbPos)); } catch {}
      }
      const l = sb.lock;
      if (l && typeof l === 'object') {
        sbLocked = !!l.locked;
        try { localStorage.setItem(SB_LOCK_KEY, sbLocked ? '1' : '0'); } catch {}
      }
      const box = document.getElementById('adminSiteBtn');
      if (box && box.__sync) box.__sync();
    })
    .catch(() => {});

  fetch('/api/shop?t=' + Date.now(), { cache: 'no-store' })
    .then(r => r.json())
    .then(s => {
      const u = (s && s.faviconImage) ? String(s.faviconImage) : '';
      if (u) { applyFavicon(u); try { localStorage.setItem(FAV_KEY, u); } catch {} }
      else { try { localStorage.removeItem(FAV_KEY); } catch {} }
      const cfg = { enabled: s && s.adminSiteBtnEnabled !== false, pages: (s && s.adminSiteBtnPages) || {} };
      try { localStorage.setItem(SB_CFG_KEY, JSON.stringify(cfg)); } catch {}
      applySiteBtn(cfg);
    })
    .catch(() => {});

  let POLL_INTERVAL = 60000; // буде перезавантажено з settings нижче
  const LS_KEY = 'admin_lastUnreadCount';
  let lastUnread = parseInt(localStorage.getItem(LS_KEY) || '0', 10);

  // === Оптимістичний лічильник «Непрочитані» ===
  // Сервер (order_meta в KV + інтервал опитування) відстає до хвилини. Тому коли адмін
  // читає/повертає/видаляє замовлення — миттєво коригуємо бейдж локально (override),
  // а коли сервер «наздожене» (поверне інше значення, ніж було) — override знімається.
  const OV_KEY = 'admin_unreadOverride';
  const OV_TTL = 120 * 1000;
  function getUnreadOverride() {
    try {
      const o = JSON.parse(localStorage.getItem(OV_KEY) || 'null');
      if (o && typeof o.expected === 'number' && Date.now() - o.ts < OV_TTL) return o;
    } catch {}
    localStorage.removeItem(OV_KEY);
    return null;
  }
  function applyUnreadBadge(v) {
    document.querySelectorAll('[data-orders-unread]').forEach(el => {
      el.textContent = v;
      el.style.display = v > 0 ? '' : 'none';
    });
  }
  // delta: -1 прочитано / +1 непрочитано / -N bulk. Викликається зі сторінки замовлень.
  window.adjustUnreadBadge = function(delta) {
    let o = getUnreadOverride();
    if (o) {
      o.expected = Math.max(0, o.expected + delta);
      o.ts = Date.now();
    } else {
      o = { baseline: lastUnread, expected: Math.max(0, lastUnread + delta), ts: Date.now() };
    }
    localStorage.setItem(OV_KEY, JSON.stringify(o));
    applyUnreadBadge(o.expected);
  };
  let toastText = '🛍 Нове замовлення #{orderId}';
  let toastEnabled = true;

  // Стиль тоста (вставляем 1 раз)
  const style = document.createElement('style');
  style.textContent = `
    .admin-toast-stack { position: fixed; bottom: 24px; right: 24px; z-index: 9999; display: flex; flex-direction: column-reverse; gap: 8px; pointer-events: none; }
    .admin-order-toast {
      pointer-events: auto;
      background: #16a34a; color: #fff;
      padding: 14px 18px; border-radius: 10px;
      font-size: 14px; font-weight: 600;
      box-shadow: 0 6px 24px rgba(22,163,74,.4);
      cursor: pointer; max-width: 360px;
      animation: orderToastIn .3s;
    }
    .admin-order-toast:hover { filter: brightness(1.06); }
    @keyframes orderToastIn {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
    .admin-order-toast.fade { transition: opacity .4s, transform .4s; opacity: 0; transform: translateX(40px); }
  `;
  document.head.appendChild(style);

  const stack = document.createElement('div');
  stack.className = 'admin-toast-stack';
  document.body.appendChild(stack);

  // Звук уведомления (короткий beep через WebAudio)
  function beep() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.frequency.value = 880; g.gain.value = 0.05;
      o.start();
      setTimeout(() => { o.frequency.value = 1200; }, 100);
      setTimeout(() => { g.gain.value = 0; o.stop(); ctx.close(); }, 220);
    } catch {}
  }

  function showOrderToast(order) {
    const text = (toastText || '🛍 Нове замовлення #{orderId}')
      .replace('{orderId}', order?.id ?? '?')
      .replace('{name}', order?.customerName ?? '')
      .replace('{total}', order?.totalPrice ?? 0);

    const el = document.createElement('div');
    el.className = 'admin-order-toast';
    el.textContent = text;
    el.onclick = () => { location.href = '/admin/orders/'; };
    stack.appendChild(el);
    beep();
    setTimeout(() => {
      el.classList.add('fade');
      setTimeout(() => el.remove(), 450);
    }, 8000);
  }

  async function pollOrders() {
    if (document.visibilityState !== 'visible') return;
    try {
      const r = await fetch('/api/admin/orders-stats', { credentials: 'include', cache: 'no-store' });
      if (r.status === 401) { return; } // не авторизован — пусть страница сама редиректит
      if (!r.ok) return;
      const data = await r.json();
      const stats = data.stats || {};
      const cur = stats.unread || 0;
      if (cur > lastUnread && stats.latestUnread && toastEnabled) {
        showOrderToast(stats.latestUnread);
        // Якщо ми зараз на /admin/orders/ — дозавантажуємо список з ретраями,
        // бо KV.list() бачить нове замовлення із затримкою (eventual consistency).
        if (location.pathname.startsWith('/admin/orders')) {
          if (typeof window.loadOrdersForNew === 'function') window.loadOrdersForNew(stats.total || 0);
          else if (typeof window.loadOrders === 'function') window.loadOrders();
        }
      }
      lastUnread = cur;
      localStorage.setItem(LS_KEY, String(cur));
      // Обновляем индикатор на странице (если есть).
      // Якщо є локальний override (щойно читали/видаляли) і сервер ще віддає старе
      // значення (baseline) — показуємо очікуване, поки KV не наздожене.
      let shown = cur;
      const ov = getUnreadOverride();
      if (ov) {
        if (cur !== ov.baseline) localStorage.removeItem(OV_KEY); // сервер оновився
        else shown = ov.expected;
      }
      applyUnreadBadge(shown);
    } catch {}
  }

  // Подгружаем кастомный текст тоста и флаг включения + синхронизуємо adminLockReorder
  let pollTimer = null;
  fetch('/api/admin/settings', { credentials: 'include' }).then(r => r.ok ? r.json() : null).then(d => {
    if (d?.settings?.newOrderToastText) toastText = d.settings.newOrderToastText;
    if (d?.settings?.newOrderToastEnabled === false) toastEnabled = false;
    if (d?.settings?.adminEscBackEnabled === false) escBackEnabled = false;
    // Cross-device sync блокування переміщення
    if (d?.settings && typeof window.syncLockReorder === 'function') {
      window.syncLockReorder(d.settings);
    }
    // Інтервал з налаштувань
    const sec = parseInt(d?.settings?.adminPollIntervalSec, 10);
    if (sec >= 10 && sec <= 300) POLL_INTERVAL = sec * 1000;
    // Перезапускаємо таймер з новим інтервалом
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(pollOrders, POLL_INTERVAL);
  }).catch(() => {});

  pollTimer = setInterval(pollOrders, POLL_INTERVAL);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pollOrders(); });
  pollOrders();

  // === Esc = «← Назад» (вмикається чекбоксом у Налаштуваннях) ===
  // Якщо на сторінці відкрита панель/модалка — не втручаємось (вона має власний Escape).
  let escBackEnabled = true;
  function isTypingTarget(el) {
    return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
  }
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !escBackEnabled) return;
    if (isTypingTarget(document.activeElement)) return;
    if (document.querySelector('#overlay.show, .overlay.show, #panel.show, .modal.show, dialog[open]')) return;
    // 1) видима кнопка «← Назад…» (напр., редактор товару)
    const backBtn = Array.from(document.querySelectorAll('button'))
      .find(b => b.offsetParent !== null && /^←/.test((b.textContent || '').trim()));
    if (backBtn) { e.preventDefault(); backBtn.click(); return; }
    // 2) хлібні крихти «← Адмінка» на підсторінках
    const crumb = document.querySelector('.crumbs a[href]');
    if (crumb) { e.preventDefault(); location.href = crumb.getAttribute('href'); }
  });
})();
