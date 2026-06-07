// Допоміжні UI-функції для адмінок: згортання карток + перевпорядкування списків.
// Додай <script src="/admin/_admin-ui.js"></script> у потрібну сторінку.

(function () {
  'use strict';

  // ============ Згортання карток ============
  // Автоматично додає кнопку ▾ у верхній правий кут кожної .card
  // Стан зберігається в localStorage (per-page, per-card-title)

  function getKey() {
    return 'adminCollapse_' + location.pathname;
  }

  function getState() {
    try { return JSON.parse(localStorage.getItem(getKey())) || {}; } catch { return {}; }
  }

  function saveState(state) {
    localStorage.setItem(getKey(), JSON.stringify(state));
  }

  function cardId(card, idx) {
    const h = card.querySelector('h2, h3');
    return h ? h.textContent.trim().slice(0, 60) : 'card-' + idx;
  }

  function injectStyles() {
    if (document.getElementById('admin-ui-styles')) return;
    const css = `
      .card.collapsible { position: relative; }
      .card.collapsible > .card-controls {
        position: absolute; top: 8px; right: 8px;
        display: flex; gap: 2px; align-items: center;
      }
      .card.collapsible > .card-controls button {
        background: none; border: 1px solid transparent; cursor: pointer;
        font-size: 14px; padding: 4px 8px; border-radius: 6px;
        color: #6b7280; transition: background .15s, border-color .15s;
        line-height: 1; min-width: 28px;
      }
      .card.collapsible > .card-controls button:hover { background: #f3f4f6; border-color: #e5e7eb; }
      .card.collapsible > .card-controls button:disabled { opacity: 0.3; cursor: not-allowed; }
      .card.collapsible > .card-controls .card-toggle { font-size: 16px; }
      .card.collapsible.collapsed > *:not(h2):not(h3):not(.card-controls) { display: none !important; }
      .card.collapsible.collapsed > h2,
      .card.collapsible.collapsed > h3 { margin-bottom: 0 !important; }
      .card.collapsible > h2,
      .card.collapsible > h3 { padding-right: 110px; }
      .card.collapsible > h2.clickable,
      .card.collapsible > h3.clickable {
        cursor: pointer;
        user-select: none;
        margin: -8px -8px 4px -8px;
        padding: 8px 110px 8px 8px;
        border-radius: 8px;
        transition: background .15s, color .15s;
      }
      .card.collapsible > h2.clickable:hover,
      .card.collapsible > h3.clickable:hover {
        background: #eff6ff;
        color: #1d4ed8;
      }
      .card.collapsible.collapsed > h2.clickable,
      .card.collapsible.collapsed > h3.clickable {
        margin-bottom: -8px;
      }
      .card.collapsible.collapsed > h2.clickable:hover,
      .card.collapsible.collapsed > h3.clickable:hover {
        background: #dbeafe;
      }

      .admin-ui-bar {
        display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; align-items: center;
      }
      .admin-ui-bar button {
        padding: 5px 12px; font-size: 13px; border: 1px solid #e5e7eb;
        background: #fff; color: #374151; border-radius: 6px; cursor: pointer;
      }
      .admin-ui-bar button:hover { background: #f9fafb; }

      .row-arrows { display: inline-flex; flex-direction: column; gap: 1px; margin-right: 4px; flex-shrink: 0; }
      .row-arrows button {
        width: 24px; height: 18px; border: 1px solid #e5e7eb; background: #f9fafb;
        cursor: pointer; padding: 0; line-height: 1; font-size: 11px; color: #6b7280;
        border-radius: 4px;
      }
      .row-arrows button:hover { background: #f3f4f6; color: #1c2129; }
      .row-arrows button:disabled { opacity: 0.3; cursor: not-allowed; }
    `;
    const style = document.createElement('style');
    style.id = 'admin-ui-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  function getOrderKey() {
    return 'adminOrder_' + location.pathname;
  }
  function getOrder() {
    try { return JSON.parse(localStorage.getItem(getOrderKey())) || []; } catch { return []; }
  }
  function saveOrder(arr) {
    localStorage.setItem(getOrderKey(), JSON.stringify(arr));
  }

  function applyOrder(cards) {
    const order = getOrder();
    if (order.length === 0) return cards;
    const idMap = new Map();
    cards.forEach((c, i) => idMap.set(cardId(c, i), c));
    const ordered = [];
    const seen = new Set();
    for (const id of order) {
      const c = idMap.get(id);
      if (c) { ordered.push(c); seen.add(id); }
    }
    cards.forEach((c, i) => {
      const id = cardId(c, i);
      if (!seen.has(id)) ordered.push(c);
    });
    if (ordered.length > 0) {
      const parent = ordered[0].parentNode;
      // Шукаємо «якір» — елемент після останньої картки (save-bar тощо)
      // щоб вставляти картки ПЕРЕД ним, а не в самий кінець
      const lastOriginal = cards[cards.length - 1];
      const anchor = lastOriginal.nextElementSibling;
      ordered.forEach(c => {
        if (anchor) parent.insertBefore(c, anchor);
        else parent.appendChild(c);
      });
    }
    return ordered;
  }

  function moveCard(card, direction) {
    const all = Array.from(document.querySelectorAll('div.card.collapsible'));
    const idx = all.indexOf(card);
    const target = idx + direction;
    if (target < 0 || target >= all.length) return;

    const sibling = all[target];
    const parent = card.parentNode;
    if (direction < 0) parent.insertBefore(card, sibling);
    else parent.insertBefore(card, sibling.nextSibling);

    const newOrder = Array.from(parent.querySelectorAll(':scope > div.card.collapsible')).map((c, i) => cardId(c, i));
    saveOrder(newOrder);
    updateCardArrows();
  }

  function updateCardArrows() {
    const all = Array.from(document.querySelectorAll('div.card.collapsible'));
    all.forEach((card, idx) => {
      const up = card.querySelector(':scope > .card-controls .card-up');
      const down = card.querySelector(':scope > .card-controls .card-down');
      if (up) up.disabled = idx === 0;
      if (down) down.disabled = idx === all.length - 1;
    });
  }

  function setupCollapsible() {
    injectStyles();
    let cards = Array.from(document.querySelectorAll('div.card')).filter(c => c.querySelector('h2, h3'));
    if (cards.length < 2) return;

    const state = getState();
    cards = applyOrder(cards);

    cards.forEach((card, idx) => {
      if (card.classList.contains('no-collapse')) return;
      if (card.querySelector(':scope > .card-controls')) return;

      card.classList.add('collapsible');
      const id = cardId(card, idx);
      const isCollapsed = !!state[id];
      if (isCollapsed) card.classList.add('collapsed');

      const controls = document.createElement('div');
      controls.className = 'card-controls';

      // ↑ перемістити вище (тільки якщо не заблоковано)
      if (!isReorderLocked()) {
        const upBtn = document.createElement('button');
        upBtn.type = 'button'; upBtn.className = 'card-up'; upBtn.textContent = '▲'; upBtn.title = 'Перемістити вище';
        upBtn.addEventListener('click', (e) => { e.stopPropagation(); moveCard(card, -1); });

        const downBtn = document.createElement('button');
        downBtn.type = 'button'; downBtn.className = 'card-down'; downBtn.textContent = '▼'; downBtn.title = 'Перемістити нижче';
        downBtn.addEventListener('click', (e) => { e.stopPropagation(); moveCard(card, 1); });

        controls.appendChild(upBtn);
        controls.appendChild(downBtn);
      }

      // ▾/▸ згорнути (завжди є)
      const toggleBtn = document.createElement('button');
      toggleBtn.type = 'button'; toggleBtn.className = 'card-toggle';
      toggleBtn.textContent = isCollapsed ? '▸' : '▾';
      toggleBtn.title = isCollapsed ? 'Розгорнути' : 'Згорнути';
      const toggleFn = (e) => {
        if (e) { e.stopPropagation(); }
        card.classList.toggle('collapsed');
        const collapsed = card.classList.contains('collapsed');
        toggleBtn.textContent = collapsed ? '▸' : '▾';
        toggleBtn.title = collapsed ? 'Розгорнути' : 'Згорнути';
        const s = getState();
        if (collapsed) s[id] = true; else delete s[id];
        saveState(s);
      };
      toggleBtn.addEventListener('click', toggleFn);

      // Клік на h2/h3 теж розгортає/згортає
      const heading = card.querySelector(':scope > h2, :scope > h3');
      if (heading) {
        heading.classList.add('clickable');
        heading.title = 'Клік щоб згорнути/розгорнути';
        heading.addEventListener('click', (e) => {
          // Якщо клікнули на посилання чи кнопку всередині — пропускаємо
          if (e.target.closest('a, button, input')) return;
          toggleFn();
        });
      }

      controls.appendChild(toggleBtn);
      card.insertBefore(controls, card.firstChild);
    });

    updateCardArrows();
    addCollapseToolbar();
  }

  function addCollapseToolbar() {
    if (document.querySelector('.admin-ui-bar')) return;
    const wrap = document.querySelector('.wrap');
    if (!wrap) return;
    const firstCard = wrap.querySelector('div.card');
    if (!firstCard) return;
    const bar = document.createElement('div');
    bar.className = 'admin-ui-bar';
    bar.innerHTML = `
      <button type="button" id="ui-collapse-all">▸ Згорнути всі</button>
      <button type="button" id="ui-expand-all">▾ Розгорнути всі</button>
      ${isReorderLocked() ? '' : '<button type="button" id="ui-reset-order" title="Повернути картки до початкового порядку">↻ Скинути порядок</button>'}
      <span style="font-size:12px; color:#6b7280; margin-left:auto;">${isReorderLocked() ? '🔒 Порядок заблоковано' : 'Стан зберігається у браузері'}</span>
    `;
    firstCard.parentNode.insertBefore(bar, firstCard);

    document.getElementById('ui-collapse-all').addEventListener('click', () => {
      const cards = document.querySelectorAll('.card.collapsible');
      const s = {};
      cards.forEach((c, i) => {
        c.classList.add('collapsed');
        const t = c.querySelector(':scope > .card-controls .card-toggle');
        if (t) { t.textContent = '▸'; t.title = 'Розгорнути'; }
        s[cardId(c, i)] = true;
      });
      saveState(s);
      // Блоки зі сторінковою системою згортання (no-collapse + makeCollapsible), напр. товари: категорії, групова зміна цін, редактор.
      document.querySelectorAll('[data-collapse-key]').forEach(c => { if (typeof c.__setCollapsed === 'function') c.__setCollapsed(true); });
    });
    document.getElementById('ui-expand-all').addEventListener('click', () => {
      const cards = document.querySelectorAll('.card.collapsible');
      cards.forEach(c => {
        c.classList.remove('collapsed');
        const t = c.querySelector(':scope > .card-controls .card-toggle');
        if (t) { t.textContent = '▾'; t.title = 'Згорнути'; }
      });
      saveState({});
      document.querySelectorAll('[data-collapse-key]').forEach(c => { if (typeof c.__setCollapsed === 'function') c.__setCollapsed(false); });
    });
    document.getElementById('ui-reset-order')?.addEventListener('click', () => {
      if (!confirm('Скинути порядок карток до початкового? (стан розгорнутості збережеться)')) return;
      localStorage.removeItem(getOrderKey());
      location.reload();
    });
  }

  // ============ Перевпорядкування ============
  // Допоміжна функція для додавання ↑/↓ кнопок до елементів масиву.
  // Виклик: window.adminUI.attachReorder(arr, renderFn);
  // У renderFn робиш: <div class="row-arrows">${window.adminUI.arrowsHtml(idx, arr.length, 'mySwap')}</div>
  // І функцію mySwap(idx, dir) що міняє місцями і renders.

  window.adminUI = {
    arrowsHtml(idx, total, swapFn) {
      return `
        <div class="row-arrows">
          <button type="button" onclick="${swapFn}(${idx}, -1)" ${idx===0?'disabled':''} title="Вгору">▲</button>
          <button type="button" onclick="${swapFn}(${idx}, 1)" ${idx===total-1?'disabled':''} title="Вниз">▼</button>
        </div>
      `;
    },
    swap(arr, idx, dir) {
      const target = idx + dir;
      if (target < 0 || target >= arr.length) return false;
      [arr[idx], arr[target]] = [arr[target], arr[idx]];
      return true;
    },
  };

  // Глобальна синхронізація adminLockReorder з settings KV
  // Виклик: syncLockReorder(settingsObject) — оновлює localStorage і за потреби перезавантажує сторінку
  window.syncLockReorder = function(settings) {
    if (!settings) return;
    const remote = !!settings.adminLockReorder;
    const local = localStorage.getItem('adminLockReorder') === '1';
    if (remote === local) return; // нічого не змінюємо
    if (remote) localStorage.setItem('adminLockReorder', '1');
    else localStorage.removeItem('adminLockReorder');
    // Якщо вже є плитки/картки з кнопками ▲▼ — потрібно перерендерити
    if (document.querySelector('a.card .tile-controls') || document.querySelector('div.card.collapsible .card-up')) {
      // Уникаємо нескінченного циклу: ставимо мітку
      if (sessionStorage.getItem('lockReloadGuard')) return;
      sessionStorage.setItem('lockReloadGuard', '1');
      setTimeout(() => sessionStorage.removeItem('lockReloadGuard'), 5000);
      location.reload();
    }
  };

  // ============ Перевпорядкування плиток на дашборді ============
  function isReorderLocked() {
    return localStorage.getItem('adminLockReorder') === '1';
  }

  function setupTileReorder() {
    const tiles = Array.from(document.querySelectorAll('a.card'));
    if (tiles.length < 2) return;

    // Інжектимо стилі для tile-controls
    if (!document.getElementById('tile-reorder-styles')) {
      const css = `
        a.card { position: relative; }
        a.card .tile-controls {
          position: absolute; top: 8px; right: 8px;
          display: flex; gap: 2px; opacity: 0;
          transition: opacity .15s;
        }
        a.card:hover .tile-controls,
        a.card .tile-controls:hover { opacity: 1; }
        a.card .tile-controls button {
          width: 24px; height: 22px; border: 1px solid #e5e7eb;
          background: rgba(255,255,255,0.95); cursor: pointer; padding: 0;
          line-height: 1; font-size: 11px; color: #6b7280; border-radius: 4px;
        }
        a.card .tile-controls button:hover { background: #f3f4f6; color: #1c2129; }
        a.card .tile-controls button:disabled { opacity: 0.3; cursor: not-allowed; }
        a.card[draggable="true"] .tile-grip {
          position: absolute; top: 8px; left: 8px; font-size: 15px; line-height: 1;
          color: #c0c4cc; opacity: 0; transition: opacity .15s; cursor: grab;
          user-select: none; padding: 2px;
        }
        a.card:hover .tile-grip { opacity: 1; }
        a.card .tile-grip:active { cursor: grabbing; }
        a.card.tile-dragging { opacity: 0.4; outline: 2px dashed #0b8aff; outline-offset: -2px; }
        a.card.tile-drop-before { box-shadow: -4px 0 0 0 #0b8aff; }
        a.card.tile-drop-after { box-shadow: 4px 0 0 0 #0b8aff; }
      `;
      const style = document.createElement('style');
      style.id = 'tile-reorder-styles';
      style.textContent = css;
      document.head.appendChild(style);
    }

    // Застосовуємо збережений порядок
    function tileId(tile) { return tile.getAttribute('href') || tile.querySelector('.title')?.textContent?.trim() || ''; }
    const orderKey = 'adminTilesOrder_' + location.pathname;
    let savedOrder = [];
    try { savedOrder = JSON.parse(localStorage.getItem(orderKey) || '[]'); } catch {}

    if (savedOrder.length > 0) {
      const idMap = new Map(tiles.map(t => [tileId(t), t]));
      const ordered = [];
      const seen = new Set();
      for (const id of savedOrder) {
        const t = idMap.get(id);
        if (t) { ordered.push(t); seen.add(id); }
      }
      tiles.forEach(t => { if (!seen.has(tileId(t))) ordered.push(t); });
      const parent = tiles[0].parentNode;
      ordered.forEach(t => parent.appendChild(t));
    }

    let draggedTile = null;

    function saveCurrentOrder() {
      const parent = document.querySelector('a.card')?.parentNode;
      if (!parent) return;
      const order = Array.from(parent.querySelectorAll(':scope > a.card')).map(tileId);
      localStorage.setItem(orderKey, JSON.stringify(order));
    }

    function clearDropHints() {
      document.querySelectorAll('a.card.tile-drop-before, a.card.tile-drop-after')
        .forEach(t => t.classList.remove('tile-drop-before', 'tile-drop-after'));
    }

    function refresh() {
      const all = Array.from(document.querySelectorAll('a.card'));
      all.forEach((tile, idx) => {
        let ctrl = tile.querySelector(':scope > .tile-controls');
        if (!ctrl) {
          ctrl = document.createElement('div');
          ctrl.className = 'tile-controls';
          ctrl.innerHTML = `
            <button type="button" class="tile-up" title="Перемістити вгору">▲</button>
            <button type="button" class="tile-down" title="Перемістити вниз">▼</button>
          `;
          // Прибираємо обробку кліку щоб не переходити на link
          ctrl.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); });
          tile.appendChild(ctrl);
          ctrl.querySelector('.tile-up').addEventListener('click', e => {
            e.preventDefault(); e.stopPropagation();
            move(tile, -1);
          });
          ctrl.querySelector('.tile-down').addEventListener('click', e => {
            e.preventDefault(); e.stopPropagation();
            move(tile, 1);
          });
          // --- перетягування мишею ---
          if (!tile.querySelector(':scope > .tile-grip')) {
            const grip = document.createElement('span');
            grip.className = 'tile-grip';
            grip.textContent = '⠿';
            grip.title = 'Перетягни щоб змінити порядок';
            tile.appendChild(grip);
          }
          setupTileDrag(tile);
        }
        ctrl.querySelector('.tile-up').disabled = idx === 0;
        ctrl.querySelector('.tile-down').disabled = idx === all.length - 1;
      });
    }

    function setupTileDrag(tile) {
      tile.setAttribute('draggable', 'true');

      tile.addEventListener('dragstart', e => {
        draggedTile = tile;
        try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', tileId(tile)); } catch {}
        // невелика затримка, щоб клас застосувався після створення drag-image
        setTimeout(() => tile.classList.add('tile-dragging'), 0);
      });

      tile.addEventListener('dragend', () => {
        tile.classList.remove('tile-dragging');
        clearDropHints();
        if (draggedTile) saveCurrentOrder();
        draggedTile = null;
        refresh();
      });

      tile.addEventListener('dragover', e => {
        if (!draggedTile || draggedTile === tile) return;
        e.preventDefault();
        try { e.dataTransfer.dropEffect = 'move'; } catch {}
        const rect = tile.getBoundingClientRect();
        const after = (e.clientX - rect.left) > rect.width / 2;
        clearDropHints();
        tile.classList.add(after ? 'tile-drop-after' : 'tile-drop-before');
        const parent = tile.parentNode;
        if (after) parent.insertBefore(draggedTile, tile.nextSibling);
        else parent.insertBefore(draggedTile, tile);
      });

      tile.addEventListener('drop', e => {
        e.preventDefault();
        clearDropHints();
      });
    }

    function move(tile, dir) {
      const all = Array.from(document.querySelectorAll('a.card'));
      const idx = all.indexOf(tile);
      const target = idx + dir;
      if (target < 0 || target >= all.length) return;
      const sibling = all[target];
      const parent = tile.parentNode;
      if (dir < 0) parent.insertBefore(tile, sibling);
      else parent.insertBefore(tile, sibling.nextSibling);
      saveCurrentOrder();
      refresh();
    }

    // Збережений порядок застосовуємо завжди (навіть коли заблоковано),
    // а кнопки ▲▼ / перетягування додаємо лише коли НЕ заблоковано.
    if (!isReorderLocked()) refresh();
  }

  // Дашборд автоматично активує tile reorder
  function autoStart() {
    setupCollapsible();
    setupTileReorder();
  }

  // Запускаємо коли DOM готовий
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoStart);
  } else {
    autoStart();
  }
})();
