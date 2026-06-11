// AGPRNT Замовлення — десктоп-додаток для обробки замовлень.
// Обгортка над адмінкою agprnt.com + те, чого немає в браузері:
//   • сповіщення Windows про нові замовлення (навіть коли вікно згорнуте)
//   • значок у треї з лічильником непрочитаних, оверлей на іконці в панелі задач
//   • автозапуск із Windows (перемикач у меню трея)
// Логін той самий, що в адмінці; сесія зберігається між запусками.
const { app, BrowserWindow, Tray, Menu, Notification, shell, nativeImage, net } = require('electron');
const path = require('path');
const fs = require('fs');

const BASE = 'https://agprnt.com';
const ADMIN_URL = BASE + '/admin/';
const ORDERS_URL = BASE + '/admin/orders/';
const STATS_URL = BASE + '/api/admin/orders-stats';
const POLL_MS = 30 * 1000;

let win = null;
let tray = null;
let lastUnread = -1; // -1 = ще не знаємо (перший опит без сповіщення)
let quitting = false;

// ---- Налаштування (JSON-файл в userData) ----
const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');
function loadSettings() {
  try { return JSON.parse(fs.readFileSync(settingsPath(), 'utf8')); } catch { return {}; }
}
function saveSettings(s) {
  try { fs.writeFileSync(settingsPath(), JSON.stringify(s)); } catch {}
}
let cfg = {};

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 700,
    minHeight: 500,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    autoHideMenuBar: true,
    backgroundColor: '#f5f6f8',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadURL(ORDERS_URL); // одразу на замовлення — додаток для обробки замовлень

  // Зовнішні посилання (вітрина «Відкрити сайт», файли) — у системний браузер
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const u = new URL(url);
      if (u.origin === BASE && u.pathname.startsWith('/admin')) return { action: 'allow' };
    } catch {}
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    try {
      const u = new URL(url);
      if (u.origin !== BASE) { e.preventDefault(); shell.openExternal(url); }
    } catch {}
  });

  // Хрестик — згортаємо в трей (програма продовжує стежити за замовленнями)
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      win.hide();
      if (!cfg.trayTipShown) {
        cfg.trayTipShown = true;
        saveSettings(cfg);
        new Notification({
          title: 'AGPRNT працює у фоні',
          body: 'Стежу за новими замовленнями. Відкрити — клік по іконці у треї.',
        }).show();
      }
    }
  });
}

function showWindow(url) {
  if (!win) { createWindow(); }
  if (url) win.loadURL(url);
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// ---- Трей ----
function updateTray(unread) {
  if (!tray) return;
  tray.setToolTip(unread > 0 ? `AGPRNT — ${unread} непрочитаних замовлень` : 'AGPRNT Замовлення');
  rebuildTrayMenu(unread);
  // Оверлей-крапка на іконці в панелі задач
  if (win) {
    if (unread > 0) {
      win.setOverlayIcon(nativeImage.createFromPath(path.join(__dirname, 'assets', 'dot.png')), `${unread} непрочитаних`);
    } else {
      win.setOverlayIcon(null, '');
    }
  }
}

function rebuildTrayMenu(unread) {
  const auto = app.getLoginItemSettings().openAtLogin;
  const menu = Menu.buildFromTemplate([
    { label: unread > 0 ? `📋 Замовлення (${unread} нових)` : '📋 Замовлення', click: () => showWindow(ORDERS_URL) },
    { label: '🌐 Відкрити сайт', click: () => shell.openExternal(BASE + '/') },
    { type: 'separator' },
    { label: 'Запускати з Windows', type: 'checkbox', checked: auto, click: (item) => {
      app.setLoginItemSettings({ openAtLogin: item.checked });
    } },
    { type: 'separator' },
    { label: 'Вийти', click: () => { quitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png')));
  tray.on('click', () => showWindow());
  tray.on('double-click', () => showWindow());
  updateTray(0);
}

// ---- Опит нових замовлень ----
// Використовуємо сесію вікна (ті ж cookie, що й логін в адмінці).
async function pollOrders() {
  try {
    const res = await net.fetch(STATS_URL, { cache: 'no-store' });
    if (!res.ok) return; // 401 = ще не залогінений — мовчимо
    const d = await res.json();
    if (!d || !d.ok || !d.stats) return;
    const unread = d.stats.unread || 0;

    if (lastUnread >= 0 && unread > lastUnread) {
      const fresh = unread - lastUnread;
      const n = new Notification({
        title: fresh === 1 ? '🛒 Нове замовлення!' : `🛒 Нові замовлення: ${fresh}`,
        body: unread === 1 ? '1 непрочитане замовлення — натисни, щоб відкрити' : `Непрочитаних: ${unread} — натисни, щоб відкрити`,
        icon: path.join(__dirname, 'assets', 'icon.png'),
      });
      n.on('click', () => showWindow(ORDERS_URL));
      n.show();
    }
    lastUnread = unread;
    updateTray(unread);
  } catch {}
}

// ---- Запуск ----
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());

  app.whenReady().then(() => {
    cfg = loadSettings();
    app.setAppUserModelId('com.agprnt.desktop'); // щоб сповіщення мали назву й іконку додатка
    createWindow();
    createTray();
    pollOrders();
    setInterval(pollOrders, POLL_MS);
  });

  app.on('before-quit', () => { quitting = true; });
  app.on('window-all-closed', (e) => { /* живемо у треї */ });
  app.on('activate', () => showWindow());
}
