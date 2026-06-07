// POST /api/nova-poshta/cities { q: "Київ" } — поиск городов НП
import { getSettings, jsonResp } from '../../_utils/shop.js';

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { body = {}; }
  const q = String(body.q || '').trim();

  let settings;
  try { settings = await getSettings(env); }
  catch (e) { return jsonResp({ ok: false, error: 'Settings: ' + e.message }, 500); }

  const apiKey = (settings.npApiKey || '').trim();
  if (!apiKey) return jsonResp({ ok: false, error: 'Нова Пошта API не налаштована. Введіть apiKey в адмінці.' }, 500);
  if (q.length < 2) return jsonResp({ ok: true, cities: [] });

  try {
    const r = await fetch('https://api.novaposhta.ua/v2.0/json/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey,
        modelName: 'AddressGeneral',
        calledMethod: 'getSettlements',
        methodProperties: { FindByString: q, Limit: 20, Page: 1 },
      }),
    });
    const data = await r.json();
    if (!data.success) {
      const errs = Array.isArray(data.errors) ? data.errors.join('; ') : String(data.errors || 'NP API error');
      return jsonResp({ ok: false, error: errs });
    }
    const cities = (data.data || []).map(c => ({
      ref: c.Ref,
      name: c.Description,
      area: c.AreaDescription,
      type: c.SettlementTypeDescription,
      label: (c.SettlementTypeDescription || '') + ' ' + (c.Description || '') + (c.AreaDescription ? ' (' + c.AreaDescription + ' обл.)' : ''),
    }));
    return jsonResp({ ok: true, cities });
  } catch (e) {
    return jsonResp({ ok: false, error: 'Помилка звʼязку з НП: ' + e.message }, 502);
  }
}
