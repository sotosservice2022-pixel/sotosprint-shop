// Компактний WYSIWYG-редактор тексту — vanilla JS, без залежностей.
// Підключається ПІСЛЯ _richtext-sanitize.js (потрібен window.sanitizeRichHtml/looksLikeRichHtml).
//
// window.initRichText(elOrSelector, {mode}) — вішає редактор на наявний <textarea>/<input>.
//   mode:'full'    — повний тулбар (жирний/курсив/підкр/закресл, списки, розмір, колір, посилання, емодзі, очистити)
//   mode:'compact' — лише жирний/курсив/колір/емодзі
//
// Принцип: оригінальне поле ховаємо, але лишаємо в DOM як НОСІЙ значення. Код збереження сторінки
// читає target.value без змін. На кожен ввід — серіалізуємо contenteditable → sanitizeRichHtml →
// target.value + синтетичний 'input' на target (щоб наявні oninput= прев'ю спрацьовували).
(function () {
  'use strict';

  var FONT_SIZES = [
    { label: 'S', px: 13 },
    { label: 'M', px: 16 },
    { label: 'L', px: 20 },
    { label: 'XL', px: 26 },
  ];

  var EMOJIS = (
    '😀 😃 😄 😁 😊 😍 🥰 😎 🤩 🥳 👍 👏 🙌 🤝 💪 🙏 ✌️ 🤞 ' +
    '❤️ 🧡 💛 💚 💙 💜 🤍 🔥 ⭐ 🌟 ✨ 💯 ✅ ☑️ ✔️ ❗ ❓ ' +
    '🎁 🎉 🎊 🛒 🛍️ 💳 💰 🏷️ 📦 🚚 ⚡ ⏰ 📌 📍 📞 ✉️ ' +
    '🌸 🌺 🌹 🌈 ☀️ 💎 👑 🎨 📷 🖼️ 🏆 🥇 🤗 😉 😘 😇'
  ).split(/\s+/).filter(Boolean);

  // Колірна палітра для кнопки кольору.
  var COLORS = [
    '#000000', '#374151', '#6b7280', '#9ca3af', '#ef4444', '#f97316',
    '#f59e0b', '#eab308', '#22c55e', '#10b981', '#06b6d4', '#0ea5e9',
    '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#ec4899', '#ffffff',
  ];

  var STYLE_ID = '__rt_styles';
  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var css = ''
      + '.rt-wrap{border:1px solid #e5e7eb;border-radius:8px;background:#fff;overflow:hidden;}'
      + '.rt-wrap:focus-within{border-color:#0b8aff;}'
      + '.rt-toolbar{display:flex;flex-wrap:wrap;gap:2px;padding:5px;background:#f9fafb;border-bottom:1px solid #eef0f3;position:sticky;top:0;z-index:2;}'
      + '.rt-btn{min-width:30px;height:30px;padding:0 7px;border:1px solid transparent;border-radius:6px;background:transparent;cursor:pointer;font-size:14px;line-height:1;color:#374151;display:inline-flex;align-items:center;justify-content:center;}'
      + '.rt-btn:hover{background:#eef2f7;}'
      + '.rt-btn.active{background:#dbeafe;border-color:#93c5fd;}'
      + '.rt-btn b{font-weight:800;} .rt-btn i{font-style:italic;} .rt-btn u{text-decoration:underline;} .rt-btn s{text-decoration:line-through;}'
      + '.rt-sep{width:1px;background:#e5e7eb;margin:2px 3px;}'
      + '.rt-edit{min-height:90px;max-height:360px;overflow-y:auto;padding:10px 12px;font-size:16px;line-height:1.5;color:#111827;outline:none;}'
      + '.rt-edit:empty:before{content:attr(data-ph);color:#9ca3af;}'
      + '.rt-edit ul,.rt-edit ol{margin:6px 0;padding-left:24px;} .rt-edit a{color:#0b8aff;}'
      + '.rt-pop{position:absolute;z-index:30;background:#fff;border:1px solid #e5e7eb;border-radius:10px;box-shadow:0 8px 28px rgba(20,30,60,.16);padding:8px;}'
      + '.rt-emoji-grid{display:grid;grid-template-columns:repeat(8,1fr);gap:2px;max-width:300px;}'
      + '.rt-emoji{font-size:20px;width:32px;height:32px;border:none;background:transparent;cursor:pointer;border-radius:6px;}'
      + '.rt-emoji:hover{background:#eef2f7;}'
      + '.rt-color-grid{display:grid;grid-template-columns:repeat(6,1fr);gap:5px;}'
      + '.rt-color{width:26px;height:26px;border:1px solid #d1d5db;border-radius:6px;cursor:pointer;padding:0;}'
      + '.rt-link-row{display:flex;gap:6px;align-items:center;}'
      + '.rt-link-row input{padding:7px 9px;border:1px solid #e5e7eb;border-radius:7px;font-size:14px;min-width:200px;}'
      + '.rt-link-row button{padding:7px 12px;border:none;border-radius:7px;background:#0b8aff;color:#fff;cursor:pointer;font-size:14px;}'
      + '@media(max-width:600px){.rt-btn{min-width:38px;height:38px;}.rt-emoji-grid{grid-template-columns:repeat(6,1fr);}}';
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = css;
    document.head.appendChild(st);
  }

  function exec(cmd, val) {
    try { document.execCommand(cmd, false, val == null ? undefined : val); } catch (e) {}
  }

  // Обгорнути поточне виділення у span з заданим розміром шрифту.
  function applyFontSize(px, editEl) {
    var sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    var range = sel.getRangeAt(0);
    if (!editEl.contains(range.commonAncestorContainer)) return;
    var span = document.createElement('span');
    span.style.fontSize = px + 'px';
    try {
      span.appendChild(range.extractContents());
      range.insertNode(span);
      // прибрати вкладені застарілі font-size у дітях, щоб не конфліктували
      span.querySelectorAll('span[style*="font-size"]').forEach(function (c) {
        if (c !== span) c.style.fontSize = '';
      });
      sel.removeAllRanges();
      var nr = document.createRange();
      nr.selectNodeContents(span);
      sel.addRange(nr);
    } catch (e) {}
  }

  function closePopovers() {
    document.querySelectorAll('.rt-pop').forEach(function (p) { p.remove(); });
  }

  function openPopover(anchorBtn, buildContent) {
    closePopovers();
    var pop = document.createElement('div');
    pop.className = 'rt-pop';
    buildContent(pop);
    document.body.appendChild(pop);
    var r = anchorBtn.getBoundingClientRect();
    var top = r.bottom + window.scrollY + 4;
    var left = r.left + window.scrollX;
    // не вилазити за правий край
    var maxLeft = window.scrollX + document.documentElement.clientWidth - pop.offsetWidth - 8;
    if (left > maxLeft) left = Math.max(window.scrollX + 8, maxLeft);
    pop.style.top = top + 'px';
    pop.style.left = left + 'px';
    // клік поза попапом — закрити
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
    // mousedown+preventDefault — щоб не втратити виділення в полі
    b.addEventListener('mousedown', function (e) { e.preventDefault(); });
    b.addEventListener('click', function (e) { e.preventDefault(); onClick(b); });
    return b;
  }
  function mkSep() { var s = document.createElement('div'); s.className = 'rt-sep'; return s; }

  function buildToolbar(mode, editEl, sync) {
    var bar = document.createElement('div');
    bar.className = 'rt-toolbar';
    var isFull = (mode !== 'compact');

    bar.appendChild(mkBtn('<b>B</b>', 'Жирний', function () { exec('bold'); sync(); }));
    bar.appendChild(mkBtn('<i>I</i>', 'Курсив', function () { exec('italic'); sync(); }));
    if (isFull) {
      bar.appendChild(mkBtn('<u>U</u>', 'Підкреслений', function () { exec('underline'); sync(); }));
      bar.appendChild(mkBtn('<s>S</s>', 'Закреслений', function () { exec('strikeThrough'); sync(); }));
    }

    // Колір
    bar.appendChild(mkSep());
    bar.appendChild(mkBtn('🎨', 'Колір тексту', function (btn) {
      openPopover(btn, function (pop) {
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
            editEl.focus();
            exec('foreColor', col);
            sync();
            closePopovers();
          });
          grid.appendChild(c);
        });
        pop.appendChild(grid);
      });
    }));

    // Розмір шрифту (тільки full)
    if (isFull) {
      bar.appendChild(mkBtn('A↕', 'Розмір шрифту', function (btn) {
        openPopover(btn, function (pop) {
          FONT_SIZES.forEach(function (fs) {
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'rt-btn';
            b.style.fontSize = fs.px + 'px';
            b.textContent = fs.label;
            b.addEventListener('mousedown', function (e) { e.preventDefault(); });
            b.addEventListener('click', function () {
              editEl.focus();
              applyFontSize(fs.px, editEl);
              sync();
              closePopovers();
            });
            pop.appendChild(b);
          });
        });
      }));
    }

    // Списки + посилання (тільки full)
    if (isFull) {
      bar.appendChild(mkSep());
      bar.appendChild(mkBtn('• —', 'Маркований список', function () { exec('insertUnorderedList'); sync(); }));
      bar.appendChild(mkBtn('1.', 'Нумерований список', function () { exec('insertOrderedList'); sync(); }));
      bar.appendChild(mkSep());
      bar.appendChild(mkBtn('🔗', 'Посилання', function (btn) {
        // зберегти виділення (range), бо інпут забере фокус
        var sel = window.getSelection();
        var savedRange = (sel && sel.rangeCount && !sel.isCollapsed && editEl.contains(sel.getRangeAt(0).commonAncestorContainer))
          ? sel.getRangeAt(0).cloneRange() : null;
        openPopover(btn, function (pop) {
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
            editEl.focus();
            if (savedRange) {
              var s = window.getSelection();
              s.removeAllRanges();
              s.addRange(savedRange);
            }
            if (!savedRange || savedRange.collapsed) {
              // нема виділення — вставимо сам URL як текст-посилання
              exec('insertHTML', '<a href="' + url.replace(/"/g, '%22') + '">' + url.replace(/</g, '&lt;') + '</a>');
            } else {
              exec('createLink', url);
            }
            sync();
            closePopovers();
          }
          ok.addEventListener('mousedown', function (e) { e.preventDefault(); });
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
      openPopover(btn, function (pop) {
        var grid = document.createElement('div');
        grid.className = 'rt-emoji-grid';
        EMOJIS.forEach(function (em) {
          var b = document.createElement('button');
          b.type = 'button';
          b.className = 'rt-emoji';
          b.textContent = em;
          b.addEventListener('mousedown', function (e) { e.preventDefault(); });
          b.addEventListener('click', function () {
            editEl.focus();
            exec('insertText', em);
            sync();
            closePopovers();
          });
          grid.appendChild(b);
        });
        pop.appendChild(grid);
      });
    }));

    // Очистити форматування (тільки full)
    if (isFull) {
      bar.appendChild(mkSep());
      bar.appendChild(mkBtn('🧹', 'Очистити форматування', function () {
        exec('removeFormat');
        exec('unlink');
        sync();
      }));
    }

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

    var wrap = document.createElement('div');
    wrap.className = 'rt-wrap';

    var edit = document.createElement('div');
    edit.className = 'rt-edit';
    edit.contentEditable = 'true';
    edit.setAttribute('data-ph', target.getAttribute('placeholder') || 'Введіть текст…');

    // Завантажити поточне target.value у редактор: HTML (санітизовано) або plain (екрановано, \n→<br>).
    // Винесено у функцію, щоб зовнішній код міг перезавантажити редактор (наприклад loadHeroBanner,
    // який переписує .value при перемиканні категорії). Доступно як target._rtReload().
    function loadValue() {
      var initial = target.value || '';
      if (window.looksLikeRichHtml(initial)) {
        edit.innerHTML = window.sanitizeRichHtml(initial, { mode: mode });
      } else {
        edit.innerHTML = String(initial)
          .replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; })
          .replace(/\r?\n/g, '<br>');
      }
    }
    loadValue();

    function sync() {
      var clean = window.sanitizeRichHtml(edit.innerHTML, { mode: mode });
      target.value = clean;
      // синтетичний input — щоб наявні oninput= прев'ю спрацьовували
      target.dispatchEvent(new Event('input', { bubbles: true }));
    }

    edit.addEventListener('input', sync);
    edit.addEventListener('blur', sync);
    // вставка — даємо браузеру вставити, потім чистимо
    edit.addEventListener('paste', function () { setTimeout(sync, 0); });

    var bar = buildToolbar(mode, edit, sync);
    wrap.appendChild(bar);
    wrap.appendChild(edit);

    // ховаємо оригінал, лишаємо в DOM як носій значення
    target.style.display = 'none';
    target.parentNode.insertBefore(wrap, target);

    // зовнішній код може перезавантажити редактор після зміни target.value напряму
    target._rtReload = loadValue;

    return { target: target, editEl: edit, sync: sync, reload: loadValue };
  };
})();
