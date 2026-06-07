// GET/POST /api/admin/domain — управління доменом сайту через CF API.
// Дозволяє додати/перевірити/видалити custom domain у Cloudflare Pages.
import { checkAuthAsync, getSettings, saveSettings, getBotConfig, jsonResp } from '../../_utils/shop.js';

// GET — поточний стан + список доменів проекту
export async function onRequestGet({ request, env }) {
  if (!(await checkAuthAsync(request, env))) return jsonResp({ ok: false, error: 'Не авторизовано' }, 401);
  const settings = await getSettings(env);
  const token = (settings.cfApiToken || '').trim();
  const accountId = (settings.cfAccountId || '').trim();
  const projectName = (settings.cfProjectName || 'sotosprint-shop').trim();
  const primaryDomain = (settings.primaryDomain || 'sotosprint.store').trim();

  if (!token || !accountId) {
    return jsonResp({
      ok: true,
      primaryDomain,
      projectName,
      cfConfigured: false,
      message: 'CF API не налаштовано. Перейди в /admin/integrations/ і додай токен.',
      domains: [],
    });
  }

  // Список доменів проекту
  let domains = [];
  let cfError = null;
  try {
    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${projectName}/domains`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    const j = await r.json();
    if (j.success) {
      domains = (j.result || []).map(d => ({
        name: d.name,
        status: d.status,
        certificate_authority: d.certificate_authority,
        verification_data: d.verification_data,
      }));
    } else {
      cfError = j.errors?.[0]?.message || 'CF API error';
    }
  } catch (e) {
    cfError = e.message;
  }

  return jsonResp({
    ok: true,
    primaryDomain,
    projectName,
    cfConfigured: true,
    cfError,
    domains,
  });
}

export async function onRequestPost({ request, env }) {
  if (!(await checkAuthAsync(request, env))) return jsonResp({ ok: false, error: 'Не авторизовано' }, 401);
  let body;
  try { body = await request.json(); } catch { return jsonResp({ ok: false, error: 'Невалидний JSON' }, 400); }

  const action = String(body.action || '').trim();
  const settings = await getSettings(env);
  const token = (settings.cfApiToken || '').trim();
  const accountId = (settings.cfAccountId || '').trim();
  const projectName = (settings.cfProjectName || 'sotosprint-shop').trim();

  if (!token || !accountId) {
    return jsonResp({ ok: false, error: 'CF API не налаштовано (потрібен cfApiToken + cfAccountId)' }, 400);
  }

  // === ADD: додати новий домен у Pages + автоматично створити CNAME у Zone ===
  if (action === 'add') {
    const newDomain = String(body.domain || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (!newDomain || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(newDomain)) {
      return jsonResp({ ok: false, error: 'Невалидний домен' }, 400);
    }
    const result = { ok: true, steps: [] };

    // 1. Додаємо домен у Pages
    try {
      const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${projectName}/domains`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newDomain }),
      });
      const j = await r.json();
      if (j.success) {
        result.steps.push({ name: 'pages-add', ok: true, message: `Домен ${newDomain} додано в Pages` });
      } else {
        const msg = j.errors?.[0]?.message || 'Помилка додавання';
        // Якщо помилка "already exists" — продовжуємо, щоб все одно створити CNAME
        if (msg.toLowerCase().includes('already exists')) {
          result.steps.push({ name: 'pages-add', ok: true, message: 'Домен уже був доданий' });
        } else {
          result.steps.push({ name: 'pages-add', ok: false, error: msg });
          return jsonResp({ ...result, ok: false });
        }
      }
    } catch (e) {
      result.steps.push({ name: 'pages-add', ok: false, error: e.message });
      return jsonResp({ ...result, ok: false });
    }

    // 2. Знаходимо Zone ID для домена
    const apex = newDomain.replace(/^www\./, '');
    let zoneId = '';
    try {
      const zr = await fetch(`https://api.cloudflare.com/client/v4/zones?name=${encodeURIComponent(apex)}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const zj = await zr.json();
      if (zj.success && zj.result?.length > 0) {
        zoneId = zj.result[0].id;
        result.steps.push({ name: 'zone-lookup', ok: true, message: `Zone знайдено: ${zoneId}` });
      } else {
        result.steps.push({ name: 'zone-lookup', ok: false, error: `Зона ${apex} не знайдена в твоєму акаунті. Спочатку додай домен як сайт у Cloudflare Dashboard → Add a site.` });
        return jsonResp(result); // не критично, просто без auto-DNS
      }
    } catch (e) {
      result.steps.push({ name: 'zone-lookup', ok: false, error: e.message });
      return jsonResp(result);
    }

    // 3. Створюємо CNAME запис → sotosprint-shop.pages.dev
    try {
      // Для apex домена використовуємо name = '@' (CF підтримує CNAME flattening)
      // Для www.example.com → name = www
      const isApex = newDomain === apex;
      const cnameName = isApex ? '@' : newDomain.split('.')[0];
      const target = `${projectName}.pages.dev`;

      // Спочатку перевіримо чи запис вже існує
      const checkR = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records?name=${encodeURIComponent(newDomain)}&type=CNAME`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const checkJ = await checkR.json();
      if (checkJ.success && checkJ.result?.length > 0) {
        result.steps.push({ name: 'dns-create', ok: true, message: `CNAME запис уже існує` });
      } else {
        // Створюємо
        const cr = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'CNAME',
            name: cnameName,
            content: target,
            proxied: true,
            ttl: 1, // auto
          }),
        });
        const cj = await cr.json();
        if (cj.success) {
          result.steps.push({ name: 'dns-create', ok: true, message: `CNAME ${newDomain} → ${target} створено` });
        } else {
          const errMsg = cj.errors?.[0]?.message || 'Помилка DNS';
          // Якщо токен не має DNS:Edit — інструктуємо як додати
          if (errMsg.toLowerCase().includes('authentication') || errMsg.toLowerCase().includes('not authorized')) {
            result.steps.push({
              name: 'dns-create',
              ok: false,
              error: `Не вистачає прав: додай у CF API token permission "Zone → DNS → Edit". Або створи CNAME вручну: ім'я "${cnameName}" → ${target}`,
            });
          } else {
            result.steps.push({ name: 'dns-create', ok: false, error: errMsg });
          }
        }
      }
    } catch (e) {
      result.steps.push({ name: 'dns-create', ok: false, error: e.message });
    }

    return jsonResp({ ...result, message: 'Готово. SSL виписується автоматично (1-5 хв).' });
  }

  // === STATUS: перевірити статус домену ===
  if (action === 'status') {
    const checkDomain = String(body.domain || '').trim();
    if (!checkDomain) return jsonResp({ ok: false, error: 'Не вказано domain' }, 400);
    try {
      const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${projectName}/domains/${encodeURIComponent(checkDomain)}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const j = await r.json();
      if (!j.success) return jsonResp({ ok: false, error: j.errors?.[0]?.message || 'CF error' }, 400);
      return jsonResp({
        ok: true,
        status: j.result?.status,
        certificate_authority: j.result?.certificate_authority,
        verification_data: j.result?.verification_data,
        domain: j.result,
      });
    } catch (e) {
      return jsonResp({ ok: false, error: e.message }, 500);
    }
  }

  // === REMOVE: видалити домен з Pages ===
  if (action === 'remove') {
    const removeDomain = String(body.domain || '').trim();
    if (!removeDomain) return jsonResp({ ok: false, error: 'Не вказано domain' }, 400);
    try {
      const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${projectName}/domains/${encodeURIComponent(removeDomain)}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const j = await r.json();
      if (!j.success) return jsonResp({ ok: false, error: j.errors?.[0]?.message || 'CF error' }, 400);
      return jsonResp({ ok: true, message: 'Домен видалено' });
    } catch (e) {
      return jsonResp({ ok: false, error: e.message }, 500);
    }
  }

  // === UPDATE_WEBHOOK: тільки оновити Telegram webhook на поточний primaryDomain.
  //    Корисно коли DNS ще не пропагувався при finalize і webhook не встановився.
  if (action === 'update_webhook') {
    try {
      const bot = await getBotConfig(env);
      if (!bot.botToken) return jsonResp({ ok: false, error: 'Бот не налаштовано' }, 400);
      const domain = (settings.primaryDomain || '').trim();
      if (!domain) return jsonResp({ ok: false, error: 'primaryDomain не задано' }, 400);
      const webhookUrl = `https://${domain}/api/telegram-webhook`;
      const r = await fetch(`https://api.telegram.org/bot${bot.botToken}/setWebhook?url=${encodeURIComponent(webhookUrl)}`);
      const j = await r.json();
      if (!j.ok) return jsonResp({ ok: false, error: j.description || 'Telegram error' }, 400);
      return jsonResp({ ok: true, message: `Webhook оновлено: ${webhookUrl}` });
    } catch (e) {
      return jsonResp({ ok: false, error: e.message }, 500);
    }
  }

  // === FINALIZE: зробити домен основним (primaryDomain + Zone ID + Telegram webhook) ===
  if (action === 'finalize') {
    const newPrimary = String(body.domain || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (!newPrimary) return jsonResp({ ok: false, error: 'Не вказано domain' }, 400);

    const result = { ok: true, steps: [] };

    // 1. Знаходимо Zone ID для нового домена через CF API
    let newZoneId = '';
    try {
      // CF API підтримує пошук зон за іменем (тільки apex, не subdomain).
      // Намагаємось знайти zone яка містить новий домен (root domain)
      const apex = newPrimary.replace(/^www\./, ''); // якщо www.example.com → example.com
      const zr = await fetch(`https://api.cloudflare.com/client/v4/zones?name=${encodeURIComponent(apex)}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const zj = await zr.json();
      if (zj.success && zj.result && zj.result.length > 0) {
        newZoneId = zj.result[0].id;
        result.steps.push({ name: 'zone-lookup', ok: true, message: `Zone ID знайдено: ${newZoneId}` });
      } else {
        // Пробуємо ще через список усіх зон з фільтром
        const zr2 = await fetch(`https://api.cloudflare.com/client/v4/zones?name=${encodeURIComponent(newPrimary)}`, {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        const zj2 = await zr2.json();
        if (zj2.success && zj2.result && zj2.result.length > 0) {
          newZoneId = zj2.result[0].id;
          result.steps.push({ name: 'zone-lookup', ok: true, message: `Zone ID знайдено: ${newZoneId}` });
        } else {
          result.steps.push({ name: 'zone-lookup', ok: false, error: `Не знайдено zone для ${apex}. Перевір що домен доданий у твій CF-акаунт як сайт (не лише як Pages domain).` });
        }
      }
    } catch (e) {
      result.steps.push({ name: 'zone-lookup', ok: false, error: e.message });
    }

    // 2. Зберігаємо primaryDomain (+ cfZoneId якщо знайшли) в settings
    try {
      settings.primaryDomain = newPrimary;
      if (newZoneId) {
        settings.cfZoneId = newZoneId;
      }
      await saveSettings(env, settings);
      result.steps.push({ name: 'settings', ok: true, message: 'primaryDomain' + (newZoneId ? ' + cfZoneId' : '') + ' оновлено' });
    } catch (e) {
      result.steps.push({ name: 'settings', ok: false, error: e.message });
      result.ok = false;
    }

    // 3. Оновлюємо Telegram webhook на новий домен
    try {
      const bot = await getBotConfig(env);
      if (bot.botToken) {
        const webhookUrl = `https://${newPrimary}/api/telegram-webhook`;
        const r = await fetch(`https://api.telegram.org/bot${bot.botToken}/setWebhook?url=${encodeURIComponent(webhookUrl)}`);
        const j = await r.json();
        if (j.ok) {
          result.steps.push({ name: 'webhook', ok: true, message: 'Telegram webhook оновлено: ' + webhookUrl });
        } else {
          result.steps.push({ name: 'webhook', ok: false, error: j.description });
        }
      } else {
        result.steps.push({ name: 'webhook', ok: false, error: 'Бот не налаштовано — webhook пропущено' });
      }
    } catch (e) {
      result.steps.push({ name: 'webhook', ok: false, error: e.message });
    }

    return jsonResp(result);
  }

  // === RESERVE_STATUS: статус резервного проекту (чи прив'язаний домен)
  if (action === 'reserve_status') {
    const reserveProj = (body.project || settings.reserveProjectName || '').trim();
    const reserveDom = (body.domain || settings.reserveDomain || '').trim().toLowerCase();
    if (!reserveProj || !reserveDom) {
      return jsonResp({ ok: true, configured: false, message: 'Резервний проект не налаштовано' });
    }
    try {
      const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${reserveProj}/domains`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const j = await r.json();
      if (!j.success) return jsonResp({ ok: false, error: j.errors?.[0]?.message || 'CF API error' });
      const found = (j.result || []).find(d => d.name?.toLowerCase() === reserveDom);
      return jsonResp({
        ok: true,
        configured: true,
        project: reserveProj,
        domain: reserveDom,
        attached: !!found,
        status: found?.status || 'detached',
      });
    } catch (e) {
      return jsonResp({ ok: false, error: e.message }, 500);
    }
  }

  // === RESERVE_DISABLE: відсоединити домен від резервного проекту (резерв "спить") ===
  if (action === 'reserve_disable') {
    const reserveProj = (body.project || settings.reserveProjectName || '').trim();
    const reserveDom = (body.domain || settings.reserveDomain || '').trim().toLowerCase();
    if (!reserveProj || !reserveDom) {
      return jsonResp({ ok: false, error: 'Не задано reserveProject/reserveDomain' }, 400);
    }
    try {
      const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${reserveProj}/domains/${encodeURIComponent(reserveDom)}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      // CF може вернути порожнє тіло на 200/204
      if (r.ok) {
        return jsonResp({ ok: true, message: `Домен ${reserveDom} відсоединений від ${reserveProj}. Сайт у режимі резерву.` });
      }
      const txt = await r.text();
      return jsonResp({ ok: false, error: `HTTP ${r.status}: ${txt}` }, 500);
    } catch (e) {
      return jsonResp({ ok: false, error: e.message }, 500);
    }
  }

  // === RESERVE_ENABLE: прив'язати домен до резервного проекту (активувати резерв) ===
  if (action === 'reserve_enable') {
    const reserveProj = (body.project || settings.reserveProjectName || '').trim();
    const reserveDom = (body.domain || settings.reserveDomain || '').trim().toLowerCase();
    if (!reserveProj || !reserveDom) {
      return jsonResp({ ok: false, error: 'Не задано reserveProject/reserveDomain' }, 400);
    }
    try {
      const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${reserveProj}/domains`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: reserveDom }),
      });
      const j = await r.json();
      if (j.success) {
        return jsonResp({ ok: true, message: `Резерв активований: ${reserveDom} → ${reserveProj}. SSL може ініціалізуватися 1-5 хв.` });
      }
      const msg = j.errors?.[0]?.message || 'Помилка';
      if (msg.toLowerCase().includes('already exists')) {
        return jsonResp({ ok: true, message: `Домен уже прив'язаний (резерв активний)` });
      }
      return jsonResp({ ok: false, error: msg }, 400);
    } catch (e) {
      return jsonResp({ ok: false, error: e.message }, 500);
    }
  }

  return jsonResp({ ok: false, error: 'Невідома дія: ' + action }, 400);
}
