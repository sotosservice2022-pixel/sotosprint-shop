// GET /api/admin/cf-usage — реальне використання Cloudflare сьогодні через GraphQL Analytics API
// Потрібен налаштований cfApiToken + cfAccountId в /admin/integrations/.
import { checkAuthAsync, getSettings, jsonResp } from '../../_utils/shop.js';

export async function onRequestGet({ request, env }) {
  if (!(await checkAuthAsync(request, env))) {
    return jsonResp({ ok: false, error: 'Не авторизовано' }, 401);
  }

  const settings = await getSettings(env);
  const token = (settings.cfApiToken || '').trim();
  const accountId = (settings.cfAccountId || '').trim();
  const namespaceId = (settings.cfNamespaceId || '').trim();

  if (!token) return jsonResp({ ok: false, error: 'Не налаштовано CF API Token у /admin/integrations/' }, 400);
  if (!accountId) return jsonResp({ ok: false, error: 'Не налаштовано CF Account ID у /admin/integrations/' }, 400);

  // Кеш на 5 хв (щоб не дов'язувати CF API щоразу)
  const url = new URL(request.url);
  const cache = caches.default;
  const cacheKey = new Request('https://cache/cf-usage-' + accountId, { method: 'GET' });
  if (!url.searchParams.get('test') && !url.searchParams.get('force')) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
  }

  // Період: початок UTC сьогодні до зараз
  const now = new Date();
  const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
  const startISO = startOfDay.toISOString();
  const endISO = now.toISOString();

  const result = {
    ok: true,
    period: { from: startISO, to: endISO, resetAt: new Date(startOfDay.getTime() + 86400000).toISOString() },
    kv: { reads: null, writes: null, lists: null, deletes: null, error: null },
    workers: { requests: null, errors: null, error: null },
    r2: { storageBytes: null, classAOps: null, classBOps: null, error: null },
  };

  // === Тестовий пінг — verify токена + перевірка Analytics доступу + (опц.) Cache Purge ===
  if (url.searchParams.get('test') === '1') {
    try {
      // 1. Verify token (працює з будь-яким валідним токеном)
      const v = await fetch('https://api.cloudflare.com/client/v4/user/tokens/verify', {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const vj = await v.json();
      if (!vj.success) {
        const msg = vj.errors?.[0]?.message || 'Невірний токен';
        return jsonResp({ ok: false, error: 'Токен не валідний: ' + msg }, 400);
      }

      // 2. Спробуємо викликати GraphQL — щоб переконатись що є Analytics дозвіл
      const tq = `query { viewer { accounts(filter: { accountTag: "${accountId}" }) { accountTag } } }`;
      const g = await fetch('https://api.cloudflare.com/client/v4/graphql', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: tq }),
      });
      const gj = await g.json();
      if (gj.errors && gj.errors.length > 0) {
        return jsonResp({ ok: false, error: 'Токен валідний, але немає прав Analytics: ' + (gj.errors[0]?.message || '') }, 400);
      }
      const accs = gj.data?.viewer?.accounts || [];
      if (accs.length === 0) {
        return jsonResp({ ok: false, error: 'Account ID не знайдено в токені (перевірте що токен виданий для цього акаунту)' }, 400);
      }

      // 3. Якщо вказано Zone ID — перевіряємо доступ до Cache Purge
      const settings2 = await getSettings(env);
      const zoneId = (settings2.cfZoneId || '').trim();
      let purgeStatus = 'не налаштовано';
      let zoneInfo = '';
      if (zoneId) {
        // 3.1 Спочатку перевіряємо чи токен бачить цю зону взагалі
        try {
          const z = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}`, {
            headers: { 'Authorization': `Bearer ${token}` },
          });
          const zj = await z.json();
          if (zj.success) {
            zoneInfo = `зона "${zj.result?.name || '?'}" видима ✓`;
          } else {
            const msg = zj.errors?.[0]?.message || 'unknown';
            purgeStatus = `❌ токен НЕ бачить цю зону (${msg}). Перевірте Zone ID або Zone Resources.`;
            return jsonResp({
              ok: true,
              accountId: accs[0].accountTag,
              zoneId,
              purgeStatus,
            });
          }
        } catch (e) {
          purgeStatus = `❌ помилка зони: ${e.message}`;
          return jsonResp({
            ok: true,
            accountId: accs[0].accountTag,
            zoneId,
            purgeStatus,
          });
        }
        // 3.2 Робимо реальний purge
        try {
          const p = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ files: [`https://${(settings2.primaryDomain || 'sotosprint.store').trim()}/test-purge-` + Date.now()] }),
          });
          const pj = await p.json();
          if (pj.success) {
            purgeStatus = `✅ працює (${zoneInfo})`;
          } else {
            const err = pj.errors?.[0]?.message || 'unknown';
            const code = pj.errors?.[0]?.code || '?';
            purgeStatus = `❌ purge помилка [code ${code}]: ${err}`;
          }
        } catch (e) {
          purgeStatus = `❌ ${e.message}`;
        }
      }

      return jsonResp({
        ok: true,
        accountId: accs[0].accountTag,
        zoneId: zoneId || null,
        purgeStatus,
      });
    } catch (e) {
      return jsonResp({ ok: false, error: e.message }, 500);
    }
  }

  // === GraphQL запит ===
  // KV operations
  if (namespaceId) {
    try {
      const q = `
        query KvOps($accountTag: String!, $nsTag: String!, $start: Time!, $end: Time!) {
          viewer {
            accounts(filter: { accountTag: $accountTag }) {
              kvOperationsAdaptiveGroups(
                limit: 1000,
                filter: {
                  namespaceId: $nsTag,
                  datetime_geq: $start,
                  datetime_leq: $end
                }
              ) {
                sum { requests }
                dimensions { actionType }
              }
            }
          }
        }`;
      const data = await cfGraphql(token, q, { accountTag: accountId, nsTag: namespaceId, start: startISO, end: endISO });
      const groups = data?.viewer?.accounts?.[0]?.kvOperationsAdaptiveGroups || [];
      const totals = { read: 0, write: 0, list: 0, delete: 0 };
      for (const g of groups) {
        const t = g.dimensions?.actionType;
        if (totals[t] !== undefined) totals[t] += g.sum?.requests || 0;
      }
      result.kv.reads = totals.read;
      result.kv.writes = totals.write;
      result.kv.lists = totals.list;
      result.kv.deletes = totals.delete;
    } catch (e) {
      result.kv.error = e.message;
    }
  } else {
    result.kv.error = 'Не вказано namespaceId';
  }

  // Workers / Pages requests
  try {
    const q = `
      query WorkersReq($accountTag: String!, $start: Time!, $end: Time!) {
        viewer {
          accounts(filter: { accountTag: $accountTag }) {
            workersInvocationsAdaptive(
              limit: 1000,
              filter: { datetime_geq: $start, datetime_leq: $end }
            ) {
              sum { requests, errors }
            }
          }
        }
      }`;
    const data = await cfGraphql(token, q, { accountTag: accountId, start: startISO, end: endISO });
    const groups = data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive || [];
    let req = 0, err = 0;
    for (const g of groups) {
      req += g.sum?.requests || 0;
      err += g.sum?.errors || 0;
    }
    result.workers.requests = req;
    result.workers.errors = err;
  } catch (e) {
    result.workers.error = e.message;
  }

  // R2 storage + ops
  try {
    const q = `
      query R2($accountTag: String!, $start: Time!, $end: Time!) {
        viewer {
          accounts(filter: { accountTag: $accountTag }) {
            r2OperationsAdaptiveGroups(
              limit: 1000,
              filter: { datetime_geq: $start, datetime_leq: $end }
            ) {
              sum { requests }
              dimensions { actionType }
            }
            r2StorageAdaptiveGroups(
              limit: 1,
              filter: { datetime_geq: $start, datetime_leq: $end }
            ) {
              max { payloadSize }
            }
          }
        }
      }`;
    const data = await cfGraphql(token, q, { accountTag: accountId, start: startISO, end: endISO });
    const acc = data?.viewer?.accounts?.[0];
    let classA = 0, classB = 0;
    const ops = acc?.r2OperationsAdaptiveGroups || [];
    // Class A: PUT/POST/DELETE/CreateMultipart, Class B: GET/HEAD/List
    const classAActions = ['PutObject', 'PostObject', 'DeleteObject', 'CreateMultipartUpload', 'UploadPart', 'CompleteMultipartUpload', 'CopyObject'];
    const classBActions = ['GetObject', 'HeadObject', 'ListObjects', 'ListBuckets'];
    for (const g of ops) {
      const t = g.dimensions?.actionType;
      if (classAActions.includes(t)) classA += g.sum?.requests || 0;
      else if (classBActions.includes(t)) classB += g.sum?.requests || 0;
    }
    result.r2.classAOps = classA;
    result.r2.classBOps = classB;
    const storage = acc?.r2StorageAdaptiveGroups?.[0]?.max?.payloadSize;
    if (typeof storage === 'number') result.r2.storageBytes = storage;
  } catch (e) {
    result.r2.error = e.message;
  }

  const response = jsonResp(result);
  response.headers.set('Cache-Control', 'public, max-age=300');
  await cache.put(cacheKey, response.clone());
  return response;
}

// Helper для запиту до GraphQL
async function cfGraphql(token, query, variables) {
  const r = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!r.ok) {
    throw new Error(`HTTP ${r.status}`);
  }
  const j = await r.json();
  if (j.errors && j.errors.length > 0) {
    throw new Error(j.errors[0]?.message || 'GraphQL error');
  }
  return j.data;
}
