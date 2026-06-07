// POST /api/nova-poshta/warehouses { cityRef } — список отделений в населённом пункте
import { getSettings, jsonResp } from '../../_utils/shop.js';

export async function onRequestPost({ request, env }) {
  const settings = await getSettings(env);
  const apiKey = (settings.npApiKey || '').trim();
  if (!apiKey) return jsonResp({ ok: false, error: 'Nova Poshta API не настроена.' }, 500);

  let body;
  try { body = await request.json(); } catch { return jsonResp({ ok: false, error: 'Невалидный JSON' }, 400); }
  const cityRef = String(body.cityRef || body.ref || '').trim();
  if (!cityRef) return jsonResp({ ok: true, warehouses: [] });

  try {
    const r = await fetch('https://api.novaposhta.ua/v2.0/json/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey,
        modelName: 'AddressGeneral',
        calledMethod: 'getWarehouses',
        methodProperties: { SettlementRef: cityRef, Limit: 500, Page: 1 },
      }),
    });
    const data = await r.json();
    if (!data.success) {
      const errs = (data.errors || []).join('; ') || 'NP API error';
      return jsonResp({ ok: false, error: errs }, 502);
    }
    const warehouses = (data.data || [])
      .map(w => ({
        ref: w.Ref,
        number: w.Number,
        name: w.Description,
        address: w.ShortAddress || '',
      }))
      .sort((a, b) => parseInt(a.number) - parseInt(b.number));
    return jsonResp({ ok: true, warehouses });
  } catch (e) {
    return jsonResp({ ok: false, error: 'Ошибка связи с НП: ' + e.message }, 502);
  }
}
