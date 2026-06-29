// Спільний санітайзер rich-text HTML — ЄДИНЕ джерело правди для адмінки і вітрини.
// Підключається і в адмінці (перед _richtext.js), і у вітрині (перед інлайн-скриптом).
// Чистить HTML за БІЛИМ СПИСКОМ через DOMParser (НЕ регекс — регекс-санітайзери обходяться).
//
// window.sanitizeRichHtml(html, {mode}) → безпечний HTML-рядок.
//   mode:'full'    — повний набір тегів (опис товару, контент пункту меню)
//   mode:'compact' — лише акцент: b/strong/i/em/span(color,font-size)/br (короткі поля)
(function () {
  'use strict';

  // Дозволені теги для FULL. div нормалізуємо в p. Невідомі форматні теги — розгортаємо (лишаємо текст).
  var ALLOWED_FULL = {
    B: 1, STRONG: 1, I: 1, EM: 1, U: 1, STRIKE: 1, S: 1,
    BR: 1, P: 1, UL: 1, OL: 1, LI: 1, A: 1, SPAN: 1,
  };
  // COMPACT — лише інлайн-акцент (без списків, абзаців, посилань).
  var ALLOWED_COMPACT = { B: 1, STRONG: 1, I: 1, EM: 1, SPAN: 1, BR: 1 };

  // Теги, що видаляються РАЗОМ із вмістом (небезпечні / непотрібні).
  var DROP_WITH_CONTENT = {
    SCRIPT: 1, STYLE: 1, IFRAME: 1, OBJECT: 1, EMBED: 1, SVG: 1, MATH: 1,
    LINK: 1, META: 1, FORM: 1, INPUT: 1, TEXTAREA: 1, BUTTON: 1, SELECT: 1,
    IMG: 1, VIDEO: 1, AUDIO: 1, CANVAS: 1, NOSCRIPT: 1, TEMPLATE: 1, HEAD: 1,
  };

  // Дозволені іменовані кольори (плюс #hex / rgb()/rgba()).
  var NAMED_COLORS = {
    black:1, white:1, red:1, green:1, blue:1, yellow:1, orange:1, purple:1,
    pink:1, gray:1, grey:1, brown:1, cyan:1, magenta:1, lime:1, navy:1,
    teal:1, olive:1, maroon:1, silver:1, gold:1, violet:1, indigo:1,
    coral:1, salmon:1, crimson:1, turquoise:1, transparent:1,
  };

  function isSafeColor(v) {
    v = String(v || '').trim().toLowerCase();
    if (!v) return false;
    if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/.test(v)) return true;
    if (/^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/.test(v)) return true;
    if (/^rgba\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*(0|1|0?\.\d+)\s*\)$/.test(v)) return true;
    if (NAMED_COLORS[v]) return true;
    return false;
  }

  function isSafeFontSize(v) {
    v = String(v || '').trim().toLowerCase();
    var m = v.match(/^(\d{1,3})px$/);
    if (!m) return false;
    var n = parseInt(m[1], 10);
    return n >= 8 && n <= 48;
  }

  // font-family: лише безпечні символи (літери/цифри/пробіл/кома/лапки/дефіс), без url()/expression.
  // Шрифт нічого не виконує — достатньо обмежити набір символів і довжину.
  function isSafeFontFamily(v) {
    v = String(v || '').trim();
    if (!v || v.length > 80) return false;
    return /^[\w ,'"\-]+$/.test(v);
  }

  // Лишаємо у style лише color / font-size / font-family (безпечні значення). Решта — геть.
  function filterStyle(styleStr) {
    var out = [];
    String(styleStr || '').split(';').forEach(function (decl) {
      var idx = decl.indexOf(':');
      if (idx < 0) return;
      var prop = decl.slice(0, idx).trim().toLowerCase();
      var val = decl.slice(idx + 1).trim();
      if (/url\(|expression|javascript:/i.test(val)) return; // підозрілі значення
      if (prop === 'color' && isSafeColor(val)) out.push('color:' + val);
      else if (prop === 'font-size' && isSafeFontSize(val)) out.push('font-size:' + val);
      else if (prop === 'font-family' && isSafeFontFamily(val)) out.push('font-family:' + val);
    });
    return out.join('; ');
  }

  function isSafeHref(href) {
    var v = String(href || '').trim();
    // блокуємо scheme-relative (//evil) і небезпечні схеми
    if (/^javascript:|^data:|^vbscript:/i.test(v)) return false;
    if (/^(https?:|mailto:|tel:)/i.test(v)) return true;
    return false;
  }

  // Рекурсивно будуємо безпечне дерево в target з дозволених вузлів source.
  function walk(source, target, allowed, doc) {
    var nodes = source.childNodes;
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];

      // Текстовий вузол — копіюємо як є (createTextNode екранує сам).
      if (node.nodeType === 3) {
        target.appendChild(doc.createTextNode(node.nodeValue));
        continue;
      }
      if (node.nodeType !== 1) continue; // коментарі тощо — ігноруємо

      var tag = node.tagName;

      // Небезпечні теги — викидаємо разом із вмістом.
      if (DROP_WITH_CONTENT[tag]) continue;

      // div → p (нормалізація). Інакше — як є.
      var effTag = (tag === 'DIV') ? 'P' : tag;

      // Невідомий/недозволений форматний тег — розгортаємо (лишаємо дітей).
      if (!allowed[effTag]) {
        // Блокові теги (p/div/li/ul/ol) візуально створюють новий рядок. У compact-режимі
        // вони не дозволені (allowed без P), тож без цього перенос рядка (Enter, який браузер
        // у contenteditable обгортає в <div>) зникав би. Вставляємо <br> на межі блоку —
        // але лише якщо BR дозволений, уже є попередній вміст і останній вузол ще не <br>.
        var isBlock = (effTag === 'P' || effTag === 'LI' || effTag === 'UL' || effTag === 'OL');
        if (isBlock && allowed.BR && target.lastChild &&
            !(target.lastChild.nodeType === 1 && target.lastChild.tagName === 'BR')) {
          target.appendChild(doc.createElement('br'));
        }
        walk(node, target, allowed, doc);
        continue;
      }

      var el = doc.createElement(effTag);

      if (effTag === 'A') {
        var href = node.getAttribute('href');
        if (href && isSafeHref(href)) {
          el.setAttribute('href', href.trim());
          el.setAttribute('target', '_blank');
          el.setAttribute('rel', 'noopener noreferrer');
        } else {
          // посилання без безпечного href — розгортаємо в текст
          walk(node, target, allowed, doc);
          continue;
        }
      } else if (effTag === 'SPAN') {
        var safe = filterStyle(node.getAttribute('style'));
        if (safe) el.setAttribute('style', safe);
      }
      // усі інші теги — БЕЗ атрибутів (жодних on*, class, id, style)

      walk(node, el, allowed, doc);
      target.appendChild(el);
    }
  }

  // Прибираємо порожні обгортки (p/span без тексту і без br).
  function isEffectivelyEmpty(html) {
    var t = String(html || '')
      .replace(/<br\s*\/?>/gi, '')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/gi, '')
      .replace(/\s+/g, '');
    return t.length === 0;
  }

  window.sanitizeRichHtml = function (html, opts) {
    if (html == null || html === '') return '';
    var mode = (opts && opts.mode) || 'full';
    var allowed = (mode === 'compact') ? ALLOWED_COMPACT : ALLOWED_FULL;
    var input = String(html);
    try {
      var doc = new DOMParser().parseFromString('<div id="__rt_root">' + input + '</div>', 'text/html');
      var root = doc.getElementById('__rt_root');
      if (!root) return '';
      var out = doc.createElement('div');
      walk(root, out, allowed, doc);
      var result = out.innerHTML;
      if (isEffectivelyEmpty(result)) return '';
      return result;
    } catch (e) {
      return ''; // у разі будь-якого збою — порожньо (безпечно)
    }
  };

  // Допоміжне: чи схоже значення на HTML (відкривний дозволений тег).
  window.looksLikeRichHtml = function (v) {
    // Тег має закритися (>, />) або мати атрибут — щоб «ширина<b висота» НЕ було HTML.
    return typeof v === 'string' && /<(b|strong|i|em|u|s|strike|p|ul|ol|li|a|span|br)(\s*\/?>|\s+[a-z-]+\s*=)/i.test(v);
  };
})();
