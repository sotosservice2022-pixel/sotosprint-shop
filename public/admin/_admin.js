// Общая логика для всех админ-страниц: опрос новых заказов и тост-уведомление.
// Подключается через <script src="/admin/_admin.js"></script> в каждой странице.
(function() {
  if (window.__adminInited) return;
  window.__adminInited = true;

  let POLL_INTERVAL = 60000; // буде перезавантажено з settings нижче
  const LS_KEY = 'admin_lastUnreadCount';
  let lastUnread = parseInt(localStorage.getItem(LS_KEY) || '0', 10);
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
        // Якщо ми зараз на /admin/orders/ — автоматично перезавантажуємо список
        if (location.pathname.startsWith('/admin/orders') && typeof window.loadOrders === 'function') {
          window.loadOrders();
        }
      }
      lastUnread = cur;
      localStorage.setItem(LS_KEY, String(cur));
      // Обновляем индикатор на странице (если есть)
      document.querySelectorAll('[data-orders-unread]').forEach(el => {
        el.textContent = cur;
        el.style.display = cur > 0 ? '' : 'none';
      });
    } catch {}
  }

  // Подгружаем кастомный текст тоста и флаг включения + синхронизуємо adminLockReorder
  let pollTimer = null;
  fetch('/api/admin/settings', { credentials: 'include' }).then(r => r.ok ? r.json() : null).then(d => {
    if (d?.settings?.newOrderToastText) toastText = d.settings.newOrderToastText;
    if (d?.settings?.newOrderToastEnabled === false) toastEnabled = false;
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
})();
