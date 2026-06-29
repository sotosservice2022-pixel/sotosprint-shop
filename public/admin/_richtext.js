// Компактний WYSIWYG-редактор тексту — vanilla JS, без залежностей.
// Підключається ПІСЛЯ _richtext-sanitize.js (потрібен window.sanitizeRichHtml/looksLikeRichHtml).
//
// window.initRichText(elOrSelector, {mode}) — вішає редактор на наявний <textarea>/<input>.
//   mode:'full'    — повний тулбар (жирний/курсив/підкр/закресл, шрифт, розмір, колір, списки, посилання, емодзі, очистити)
//   mode:'compact' — жирний/курсив/шрифт/розмір/колір/емодзі
//
// Принцип: оригінальне поле ховаємо, лишаємо в DOM як НОСІЙ значення. Код збереження сторінки
// читає target.value без змін. На кожен ввід — серіалізуємо contenteditable → sanitizeRichHtml →
// target.value + синтетичний 'input' (щоб наявні oninput= прев'ю спрацьовували).
//
// КЛЮЧОВЕ: всі дії з кольором/розміром/шрифтом/посиланням/емодзі застосовуємо до ЗБЕРЕЖЕНОГО
// виділення (Range). Кнопки/попапи на mousedown НЕ забирають фокус (preventDefault), а перед
// командою ми відновлюємо Range — інакше виділення «злітає» і форматування йде в нікуди.
(function () {
  'use strict';

  var FONT_SIZES = [
    { label: 'Дрібний', px: 13 },
    { label: 'Звичайний', px: 16 },
    { label: 'Великий', px: 20 },
    { label: 'Дуже великий', px: 26 },
    { label: 'Заголовок', px: 32 },
  ];

  // Шрифти як «в офісі» — лише системні/веб-безпечні стеки (без зовнішніх завантажень).
  var FONTS = [
    { label: 'За замовчуванням', css: '' },
    { label: 'Arial', css: 'Arial, Helvetica, sans-serif' },
    { label: 'Times New Roman', css: '"Times New Roman", Times, serif' },
    { label: 'Georgia', css: 'Georgia, serif' },
    { label: 'Courier', css: '"Courier New", Courier, monospace' },
    { label: 'Verdana', css: 'Verdana, Geneva, sans-serif' },
    { label: 'Tahoma', css: 'Tahoma, Geneva, sans-serif' },
    { label: 'Trebuchet', css: '"Trebuchet MS", Helvetica, sans-serif' },
    { label: 'Comic Sans', css: '"Comic Sans MS", cursive' },
    { label: 'Impact', css: 'Impact, Charcoal, sans-serif' },
  ];

  var EMOJIS = (
    '😀 😃 😄 😁 😊 😍 🥰 😎 🤩 🥳 👍 👏 🙌 🤝 💪 🙏 ✌️ 🤞 ' +
    '❤️ 🧡 💛 💚 💙 💜 🤍 🔥 ⭐ 🌟 ✨ 💯 ✅ ☑️ ✔️ ❗ ❓ ' +
    '🎁 🎉 🎊 🛒 🛍️ 💳 💰 🏷️ 📦 🚚 ⚡ ⏰ 📌 📍 📞 ✉️ ' +
    '🌸 🌺 🌹 🌈 ☀️ 💎 👑 🎨 📷 🖼️ 🏆 🥇 🤗 😉 😘 😇'
  ).split(/\s+/).filter(Boolean);

  var COLORS = [
    '#000000', '#374151', '#6b7280', '#9ca3af', '#ef4444', '#f97316',
    '#f59e0b', '#eab308', '#22c55e', '#10b981', '#06b6d4', '#0ea5e9',
    '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#ec4899', '#ffffff',
  ];

  var STYLE_ID = '__rt_styles';
  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var css = ''
      + '.rt-wrap{border:1px solid #e5e7eb;border-radius:8px;background:#fff;overflow:visible;}'
      + '.rt-wrap:focus-within{border-color:#0b8aff;}'
      + '.rt-toolbar{display:flex;flex-wrap:wrap;gap:2px;padding:5px;background:#f9fafb;border-bottom:1px solid #eef0f3;border-radius:8px 8px 0 0;}'
      + '.rt-btn{min-width:32px;height:32px;padding:0 8px;border:1px solid transparent;border-radius:6px;background:transparent;cursor:pointer;font-size:14px;line-height:1;color:#374151;display:inline-flex;align-items:center;justify-content:center;}'
      + '.rt-btn:hover{background:#eef2f7;}'
      + '.rt-btn b{font-weight:800;} .rt-btn i{font-style:italic;} .rt-btn u{text-decoration:underline;} .rt-btn s{text-decoration:line-through;}'
      + '.rt-sep{width:1px;background:#e5e7eb;margin:2px 3px;}'
      + '.rt-edit{min-height:90px;max-height:360px;overflow-y:auto;padding:10px 12px;font-size:16px;line-height:1.5;color:#111827;outline:none;}'
      + '.rt-edit:empty:before{content:attr(data-ph);color:#9ca3af;}'
      + '.rt-edit ul,.rt-edit ol{margin:6px 0;padding-left:24px;} .rt-edit a{color:#0b8aff;}'
      // z-index дуже високий — щоб попап не ховався під повноекранним оверлеєм редактора товару (z-index:1000)
      + '.rt-pop{position:fixed;z-index:100000;background:#fff;border:1px solid #e5e7eb;border-radius:10px;box-shadow:0 8px 28px rgba(20,30,60,.18);padding:8px;max-width:92vw;}'
      + '.rt-emoji-grid{display:grid;grid-template-columns:repeat(8,1fr);gap:2px;max-width:300px;}'
      + '.rt-emoji{font-size:20px;width:32px;height:32px;border:none;background:transparent;cursor:pointer;border-radius:6px;}'
      + '.rt-emoji:hover{background:#eef2f7;}'
      + '.rt-color-grid{display:grid;grid-template-columns:repeat(6,1fr);gap:5px;}'
      + '.rt-color{width:28px;height:28px;border:1px solid #d1d5db;border-radius:6px;cursor:pointer;padding:0;}'
      + '.rt-menu{display:flex;flex-direction:column;gap:1px;min-width:170px;max-height:280px;overflow-y:auto;}'
      + '.rt-menu-item{text-align:left;padding:8px 12px;border:none;background:transparent;cursor:pointer;border-radius:6px;font-size:15px;color:#111827;white-space:nowrap;}'
      + '.rt-menu-item:hover{background:#eef2f7;}'
      + '.rt-link-row{display:flex;gap:6px;align-items:center;}'
      + '.rt-link-row input{padding:8px 10px;border:1px solid #e5e7eb;border-radius:7px;font-size:15px;min-width:220px;}'
      + '.rt-link-row button{padding:8px 14px;border:none;border-radius:7px;background:#0b8aff;color:#fff;cursor:pointer;font-size:15px;}'
      + '@media(max-width:600px){.rt-btn{min-width:40px;height:40px;}.rt-emoji-grid{grid-template-columns:repeat(6,1fr);}.rt-link-row input{min-width:0;flex:1;}}';
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = css;
    document.head.appendChild(st);
  }

  function exec(cmd, val) {
    try { document.execCommand(cmd, false, val == null ? undefined : val); } catch (e) {}
  }

  function closePopovers() {
    document.querySelectorAll('.rt-pop').forEach(function (p) { p.remove(); });
  }

  // === Кожен редактор інкапсульований у RT (своє збережене виділення) ===
  function RT(target, mode) {
    var self = this;
    this.target = target;
    this.mode = mode;
    this.savedRange = null;
    this.undoStack = [];
    this.redoStack = [];
    this._lastRecorded = null;
    this._typingTimer = null;

    var edit = document.createElement('div');
    edit.className = 'rt-edit';
    edit.contentEditable = 'true';
    edit.setAttribute('data-ph', target.getAttribute('placeholder') || 'Введіть текст…');
    this.edit = edit;

    // зберігаємо виділення щоразу, коли воно змінюється всередині поля
    edit.addEventListener('keyup', function () { self.saveSelection(); });
    edit.addEventListener('mouseup', function () { self.saveSelection(); });
    edit.addEventListener('input', function () {
      self.saveSelection();
      self.sync();
      // запис історії з дебаунсом (щоб набір тексту не плодив сотні станів)
      clearTimeout(self._typingTimer);
      self._typingTimer = setTimeout(function () { self.record(); }, 500);
    });
    edit.addEventListener('blur', function () { self.sync(); });
    edit.addEventListener('paste', function () { setTimeout(function () { self.sync(); self.record(); }, 0); });
    // Ctrl/Cmd+Z — відмінити, Ctrl+Y або Shift+Ctrl/Cmd+Z — повторити
    edit.addEventListener('keydown', function (e) {
      var z = (e.key === 'z' || e.key === 'Z'), y = (e.key === 'y' || e.key === 'Y');
      if ((e.ctrlKey || e.metaKey) && z && !e.shiftKey) { e.preventDefault(); self.undo(); }
      else if ((e.ctrlKey || e.metaKey) && (y || (z && e.shiftKey))) { e.preventDefault(); self.redo(); }
      // Enter у compact-режимі: вставляємо чистий <br>, а не <div>/<p>. У compact санітайзер
      // не дозволяє блокові теги, тож браузерний <div> від Enter інакше втрачав би перенос
      // (і перебудова DOM збивала раніше застосований шрифт). Shift+Enter і так дає <br>.
      else if (e.key === 'Enter' && !e.shiftKey && self.mode === 'compact') {
        e.preventDefault();
        exec('insertLineBreak');
        self.saveSelection();
        self.sync();
        self.record();
      }
    });
    // Надійно: будь-яка зміна виділення в документі, що потрапляє в наше поле — зберігаємо одразу.
    // Це усуває «перша дія не спрацьовує» (коли клікнув у поле, але keyup/mouseup ще не було).
    // Слухач самовидаляється, якщо поле прибрано з DOM (редактор товару перестворюється) — без витоку.
    function onSelChange() {
      if (!document.body.contains(self.edit)) { document.removeEventListener('selectionchange', onSelChange); return; }
      var sel = window.getSelection();
      if (sel && sel.rangeCount) {
        var r = sel.getRangeAt(0);
        if (self.edit.contains(r.commonAncestorContainer)) self.savedRange = r.cloneRange();
      }
    }
    document.addEventListener('selectionchange', onSelChange);

    this.loadValue();
  }

  RT.prototype.loadValue = function () {
    var initial = this.target.value || '';
    if (window.looksLikeRichHtml(initial)) {
      this.edit.innerHTML = window.sanitizeRichHtml(initial, { mode: this.mode });
    } else {
      this.edit.innerHTML = String(initial)
        .replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; })
        .replace(/\r?\n/g, '<br>');
    }
    // початковий стан для історії
    this.undoStack = [this.edit.innerHTML];
    this.redoStack = [];
    this._lastRecorded = this.edit.innerHTML;
  };

  RT.prototype.sync = function () {
    var clean = window.sanitizeRichHtml(this.edit.innerHTML, { mode: this.mode });
    this.target.value = clean;
    this.target.dispatchEvent(new Event('input', { bubbles: true }));
  };

  // Записати поточний стан у стек «відмінити» (якщо змінився). Чистить redo.
  RT.prototype.record = function () {
    var html = this.edit.innerHTML;
    if (html === this._lastRecorded) return;
    this.undoStack.push(html);
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack = [];
    this._lastRecorded = html;
  };

  RT.prototype.undo = function () {
    clearTimeout(this._typingTimer);
    // якщо останній набраний стан ще не записаний — зафіксувати
    if (this.edit.innerHTML !== this._lastRecorded) this.record();
    if (this.undoStack.length <= 1) return; // лишаємо найперший стан
    var cur = this.undoStack.pop();
    this.redoStack.push(cur);
    var prev = this.undoStack[this.undoStack.length - 1];
    this.edit.innerHTML = prev;
    this._lastRecorded = prev;
    this.sync();
  };

  RT.prototype.redo = function () {
    if (!this.redoStack.length) return;
    var html = this.redoStack.pop();
    this.undoStack.push(html);
    this.edit.innerHTML = html;
    this._lastRecorded = html;
    this.sync();
  };

  // Зберегти поточний Range, якщо він усередині нашого поля.
  RT.prototype.saveSelection = function () {
    var sel = window.getSelection();
    if (sel && sel.rangeCount) {
      var r = sel.getRangeAt(0);
      if (this.edit.contains(r.commonAncestorContainer)) {
        this.savedRange = r.cloneRange();
      }
    }
  };

  // Відновити збережений Range (фокус назад у поле).
  RT.prototype.restoreSelection = function () {
    this.edit.focus();
    if (this.savedRange) {
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(this.savedRange);
    }
  };

  RT.prototype.hasSelection = function () {
    return this.savedRange && !this.savedRange.collapsed;
  };

  // Виконати execCommand-команду на збереженому виділенні.
  RT.prototype.run = function (cmd, val) {
    this.restoreSelection();
    exec(cmd, val);
    this.saveSelection();
    this.sync();
    this.record();
  };

  // Обгорнути збережене виділення у <span> з заданою CSS-властивістю (колір/розмір/шрифт).
  // Це надійніше за execCommand('foreColor') (той робить <font>, який вирізає санітайзер).
  RT.prototype.applyStyle = function (prop, value) {
    this.restoreSelection();
    var sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    var range = sel.getRangeAt(0);
    if (!this.edit.contains(range.commonAncestorContainer)) return;
    var span = document.createElement('span');
    span.style[prop] = value;
    try {
      span.appendChild(range.extractContents());
      // прибрати ту саму властивість у вкладених span, щоб нова перемогла
      span.querySelectorAll('span').forEach(function (c) {
        if (c !== span && c.style && c.style[prop]) c.style[prop] = '';
      });
      range.insertNode(span);
      sel.removeAllRanges();
      var nr = document.createRange();
      nr.selectNodeContents(span);
      sel.addRange(nr);
      this.savedRange = nr.cloneRange();
    } catch (e) {}
    this.sync();
    this.record();
  };

  // Вставити текст (емодзі) у збережену позицію.
  RT.prototype.insertText = function (text) {
    this.restoreSelection();
    exec('insertText', text);
    this.saveSelection();
    this.sync();
    this.record();
  };

  // Обхід вузла → плоский текст зі збереженими переносами (<br> і кінці блоків p/li/div → \n).
  function nodeToTextWithBreaks(node, lines) {
    var nodes = node.childNodes;
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n.nodeType === 3) { // текст
        lines[lines.length - 1] += n.nodeValue.replace(/\r?\n/g, ' ');
      } else if (n.nodeType === 1) {
        var tag = n.tagName;
        if (tag === 'BR') { lines.push(''); }
        else if (tag === 'P' || tag === 'LI' || tag === 'DIV' || tag === 'UL' || tag === 'OL') {
          if (lines[lines.length - 1] !== '') lines.push('');
          nodeToTextWithBreaks(n, lines);
          lines.push('');
        } else {
          nodeToTextWithBreaks(n, lines); // інлайн (span/b/i/a…) — без переносу
        }
      }
    }
  }

  // Скинути форматування ВСЬОГО поля до чистого тексту зі збереженими переносами рядків/абзаців.
  // Передбачувано (без склеювання слів у рядок) — фактично «повернути до простого тексту».
  RT.prototype.clearFormatting = function () {
    this.record(); // зберегти стан для «відмінити»
    var lines = [''];
    nodeToTextWithBreaks(this.edit, lines);
    // прибрати порожні рядки на краях
    while (lines.length && lines[0] === '') lines.shift();
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    var html = lines.map(function (line) {
      return line.replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; });
    }).join('<br>');
    this.edit.innerHTML = html;
    this.savedRange = null;
    this.sync();
    this.record();
  };

  // Вставити посилання.
  RT.prototype.insertLink = function (url) {
    this.restoreSelection();
    if (this.hasSelection()) {
      exec('createLink', url);
    } else {
      exec('insertHTML', '<a href="' + url.replace(/"/g, '%22') + '">' + url.replace(/[<>&]/g, function (c) {
        return ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c];
      }) + '</a>');
    }
    this.saveSelection();
    this.sync();
    this.record();
  };

  // === UI ===
  function openPopover(rt, anchorBtn, buildContent) {
    closePopovers();
    var pop = document.createElement('div');
    pop.className = 'rt-pop';
    // попап на mousedown не забирає фокус/виділення
    pop.addEventListener('mousedown', function (e) {
      if (e.target.tagName !== 'INPUT') e.preventDefault();
    });
    buildContent(pop);
    document.body.appendChild(pop);
    // position:fixed → координати viewport (getBoundingClientRect без scroll)
    var r = anchorBtn.getBoundingClientRect();
    var top = r.bottom + 4;
    var left = r.left;
    var maxLeft = document.documentElement.clientWidth - pop.offsetWidth - 8;
    if (left > maxLeft) left = Math.max(8, maxLeft);
    var maxTop = document.documentElement.clientHeight - pop.offsetHeight - 8;
    if (top > maxTop) top = Math.max(8, r.top - pop.offsetHeight - 4);
    pop.style.top = top + 'px';
    pop.style.left = left + 'px';
    setTimeout(function () {
      document.addEventListener('mousedown', function onDoc(e) {
        if (!pop.contains(e.target) && e.target !== anchorBtn) {
          pop.remove();
          document.removeEventListener('mousedown', onDoc);
        }
      });
    }, 0);
    return pop;
  }

  function mkBtn(html, title, onClick) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'rt-btn';
    b.innerHTML = html;
    b.title = title;
    b.addEventListener('mousedown', function (e) { e.preventDefault(); });
    b.addEventListener('click', function (e) { e.preventDefault(); onClick(b); });
    return b;
  }
  function mkSep() { var s = document.createElement('div'); s.className = 'rt-sep'; return s; }

  function buildToolbar(rt) {
    var mode = rt.mode;
    var bar = document.createElement('div');
    bar.className = 'rt-toolbar';
    var isFull = (mode !== 'compact');

    // Відмінити / Повторити
    bar.appendChild(mkBtn('↶', 'Відмінити (Ctrl+Z)', function () { rt.undo(); }));
    bar.appendChild(mkBtn('↷', 'Повторити (Ctrl+Y)', function () { rt.redo(); }));
    bar.appendChild(mkSep());

    bar.appendChild(mkBtn('<b>B</b>', 'Жирний', function () { rt.run('bold'); }));
    bar.appendChild(mkBtn('<i>I</i>', 'Курсив', function () { rt.run('italic'); }));
    if (isFull) {
      bar.appendChild(mkBtn('<u>U</u>', 'Підкреслений', function () { rt.run('underline'); }));
      bar.appendChild(mkBtn('<s>S</s>', 'Закреслений', function () { rt.run('strikeThrough'); }));
    }

    // Шрифт (як в офісі)
    bar.appendChild(mkSep());
    bar.appendChild(mkBtn('🔤 Шрифт', 'Шрифт', function (btn) {
      openPopover(rt, btn, function (pop) {
        var menu = document.createElement('div');
        menu.className = 'rt-menu';
        FONTS.forEach(function (f) {
          var item = document.createElement('button');
          item.type = 'button';
          item.className = 'rt-menu-item';
          item.textContent = f.label;
          if (f.css) item.style.fontFamily = f.css;
          item.addEventListener('mousedown', function (e) { e.preventDefault(); });
          item.addEventListener('click', function () {
            if (f.css) rt.applyStyle('fontFamily', f.css);
            else rt.applyStyle('fontFamily', 'inherit');
            closePopovers();
          });
          menu.appendChild(item);
        });
        pop.appendChild(menu);
      });
    }));

    // Розмір
    bar.appendChild(mkBtn('🅰 Розмір', 'Розмір шрифту', function (btn) {
      openPopover(rt, btn, function (pop) {
        var menu = document.createElement('div');
        menu.className = 'rt-menu';
        FONT_SIZES.forEach(function (fs) {
          var item = document.createElement('button');
          item.type = 'button';
          item.className = 'rt-menu-item';
          item.textContent = fs.label;
          item.style.fontSize = Math.min(fs.px, 22) + 'px';
          item.addEventListener('mousedown', function (e) { e.preventDefault(); });
          item.addEventListener('click', function () {
            rt.applyStyle('fontSize', fs.px + 'px');
            closePopovers();
          });
          menu.appendChild(item);
        });
        pop.appendChild(menu);
      });
    }));

    // Колір
    bar.appendChild(mkBtn('🎨 Колір', 'Колір тексту', function (btn) {
      openPopover(rt, btn, function (pop) {
        var grid = document.createElement('div');
        grid.className = 'rt-color-grid';
        COLORS.forEach(function (col) {
          var c = document.createElement('button');
          c.type = 'button';
          c.className = 'rt-color';
          c.style.background = col;
          c.title = col;
          c.addEventListener('mousedown', function (e) { e.preventDefault(); });
          c.addEventListener('click', function () {
            rt.applyStyle('color', col);
            closePopovers();
          });
          grid.appendChild(c);
        });
        pop.appendChild(grid);
      });
    }));

    // Списки + посилання (тільки full)
    if (isFull) {
      bar.appendChild(mkSep());
      bar.appendChild(mkBtn('• —', 'Маркований список', function () { rt.run('insertUnorderedList'); }));
      bar.appendChild(mkBtn('1.', 'Нумерований список', function () { rt.run('insertOrderedList'); }));
      bar.appendChild(mkBtn('🔗', 'Посилання', function (btn) {
        openPopover(rt, btn, function (pop) {
          var row = document.createElement('div');
          row.className = 'rt-link-row';
          var inp = document.createElement('input');
          inp.type = 'url';
          inp.placeholder = 'https://…';
          var ok = document.createElement('button');
          ok.type = 'button';
          ok.textContent = 'OK';
          function apply() {
            var url = inp.value.trim();
            if (!/^(https?:|mailto:|tel:)/i.test(url)) { inp.focus(); return; }
            rt.insertLink(url);
            closePopovers();
          }
          ok.addEventListener('click', apply);
          inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); apply(); } });
          row.appendChild(inp);
          row.appendChild(ok);
          pop.appendChild(row);
          setTimeout(function () { inp.focus(); }, 0);
        });
      }));
    }

    // Емодзі
    bar.appendChild(mkSep());
    bar.appendChild(mkBtn('😊', 'Емодзі', function (btn) {
      openPopover(rt, btn, function (pop) {
        var grid = document.createElement('div');
        grid.className = 'rt-emoji-grid';
        EMOJIS.forEach(function (em) {
          var b = document.createElement('button');
          b.type = 'button';
          b.className = 'rt-emoji';
          b.textContent = em;
          b.addEventListener('mousedown', function (e) { e.preventDefault(); });
          b.addEventListener('click', function () {
            rt.insertText(em);
            closePopovers();
          });
          grid.appendChild(b);
        });
        pop.appendChild(grid);
      });
    }));

    // Очистити форматування (в усіх режимах)
    bar.appendChild(mkSep());
    bar.appendChild(mkBtn('🧹', 'Очистити форматування', function () {
      rt.clearFormatting();
    }));

    return bar;
  }

  window.initRichText = function (elOrSelector, opts) {
    if (!window.sanitizeRichHtml) {
      console.warn('[richtext] sanitizeRichHtml не завантажено — підключи _richtext-sanitize.js перед _richtext.js');
      return;
    }
    var target = (typeof elOrSelector === 'string')
      ? document.querySelector(elOrSelector)
      : elOrSelector;
    if (!target) return;
    if (target.dataset.rtInit === '1') return; // ідемпотентність
    target.dataset.rtInit = '1';

    var mode = (opts && opts.mode) || 'full';
    injectStyles();

    var rt = new RT(target, mode);

    var wrap = document.createElement('div');
    wrap.className = 'rt-wrap';
    wrap.appendChild(buildToolbar(rt));
    wrap.appendChild(rt.edit);

    target.style.display = 'none';
    target.parentNode.insertBefore(wrap, target);

    // зовнішній код може перезавантажити редактор після зміни target.value напряму
    target._rtReload = function () { rt.loadValue(); };

    return { target: target, editEl: rt.edit, sync: function () { rt.sync(); }, reload: function () { rt.loadValue(); } };
  };
})();
