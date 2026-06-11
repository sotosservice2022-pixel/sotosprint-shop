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
  // Позиція (перетягування) і замочок — локальні для пристрою (localStorage).
  const SB_CFG_KEY = 'admin_siteBtnCfg';
  const SB_POS_KEY = 'admin_siteBtnPos';
  const SB_LOCK_KEY = 'admin_siteBtnLocked';
  function sbPageKey() {
    const m = location.pathname.match(/^\/admin\/?([^/]*)/);
    return (m && m[1] && m[1] !== 'index.html') ? m[1] : 'index';
  }
  function sbClamp(x, y, el) {
    const w = el.offsetWidth || 140, h = el.offsetHeight || 40;
    return [Math.max(4, Math.min(x, window.innerWidth - w - 4)),
            Math.max(4, Math.min(y, window.innerHeight - h - 4))];
  }
  function applySiteBtn(cfg) {
    const show = cfg && cfg.enabled !== false && !(cfg.pages && cfg.pages[sbPageKey()] === false);
    let box = document.getElementById('adminSiteBtn');
    if (!show) { if (box) box.remove(); return; }
    if (box || !document.body) return;

    box = document.createElement('div');
    box.id = 'adminSiteBtn';
    box.style.cssText = 'position:fixed;top:14px;right:14px;z-index:9999;touch-action:none;user-select:none;';
    const locked = () => { try { return localStorage.getItem(SB_LOCK_KEY) === '1'; } catch { return false; } };
    box.innerHTML = `
      <a href="/" target="_blank" rel="noopener" title="Відкрити сайт у новій вкладці" draggable="false"
        style="display:inline-flex;align-items:center;gap:7px;padding:9px 14px;background:#0b8aff;color:#fff;
        font:600 14px 'Segoe UI',-apple-system,Arial,sans-serif;border-radius:10px;text-decoration:none;
        box-shadow:0 2px 10px rgba(11,138,255,.35);cursor:${locked() ? 'pointer' : 'grab'}">🌐 Відкрити сайт</a>
      <span data-sb-lock style="position:absolute;bottom:-7px;right:-7px;background:#fff;border:1px solid #e5e7eb;
        border-radius:50%;width:18px;height:18px;line-height:15px;text-align:center;font-size:10px;cursor:pointer;"></span>`;
    document.body.appendChild(box);

    const link = box.querySelector('a');
    const lockEl = box.querySelector('[data-sb-lock]');
    function paintLock() {
      const on = locked();
      lockEl.textContent = on ? '🔒' : '🔓';
      lockEl.style.borderColor = on ? '#f59e0b' : '#e5e7eb';
      lockEl.title = on ? 'Перетягування заблоковано — натисни, щоб розблокувати' : 'Заблокувати перетягування';
      link.style.cursor = on ? 'pointer' : 'grab';
    }
    paintLock();
    lockEl.addEventListener('click', (e) => {
      e.stopPropagation();
      try { localStorage.setItem(SB_LOCK_KEY, locked() ? '0' : '1'); } catch {}
      paintLock();
    });

    // Збережена позиція (на цьому пристрої)
    try {
      const p = JSON.parse(localStorage.getItem(SB_POS_KEY) || 'null');
      if (p && typeof p.x === 'number') {
        const [x, y] = sbClamp(p.x, p.y, box);
        box.style.left = x + 'px'; box.style.top = y + 'px'; box.style.right = 'auto';
      }
    } catch {}
    window.addEventListener('resize', () => {
      if (box.style.left) {
        const [x, y] = sbClamp(parseFloat(box.style.left), parseFloat(box.style.top), box);
        box.style.left = x + 'px'; box.style.top = y + 'px';
      }
    });

    // Перетягування (pointer events: миша + тач). Якщо тягнули — клік по лінку гасимо.
    let drag = null;
    box.addEventListener('pointerdown', (e) => {
      if (locked() || e.target === lockEl) return;
      const r = box.getBoundingClientRect();
      drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, sx: e.clientX, sy: e.clientY, moved: false };
      try { box.setPointerCapture(e.pointerId); } catch {}
    });
    box.addEventListener('pointermove', (e) => {
      if (!drag) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 5) return;
      drag.moved = true;
      const [x, y] = sbClamp(e.clientX - drag.dx, e.clientY - drag.dy, box);
      box.style.left = x + 'px'; box.style.top = y + 'px'; box.style.right = 'auto';
    });
    box.addEventListener('pointerup', () => {
      if (drag && drag.moved) {
        try { localStorage.setItem(SB_POS_KEY, JSON.stringify({ x: parseFloat(box.style.left), y: parseFloat(box.style.top) })); } catch {}
        box.__suppressClick = true;
        setTimeout(() => { box.__suppressClick = false; }, 0);
      }
      drag = null;
    });
    link.addEventListener('click', (e) => { if (box.__suppressClick) e.preventDefault(); });
  }
  // Миттєвий показ з кешу, потім оновлення зі свіжих налаштувань
  try { applySiteBtn(JSON.parse(localStorage.getItem(SB_CFG_KEY) || 'null') || { enabled: true }); } catch {}

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
