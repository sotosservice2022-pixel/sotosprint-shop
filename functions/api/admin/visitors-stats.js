// GET /api/admin/visitors-stats — отримати кількість унікальних відвідувачів за останні 31 день
// POST /api/admin/visitors-stats { action: 'reset' } — очистити лічильники
import { checkAuthAsync, jsonResp } from '../../_utils/shop.js';

function dateKeyForOffset(daysBack) {
  const kyivOffsetMs = 3 * 60 * 60 * 1000;
  const d = new Date(Date.now() + kyivOffsetMs - daysBack * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

export async function onRequestGet({ request, env }) {
  if (!(await checkAuthAsync(request, env))) return jsonResp({ ok: false, error: 'Не авторизовано' }, 401);
  if (!env.SHOP_KV) return jsonResp({ ok: false, error: 'KV недоступний' }, 500);

  // Читаємо 31 день
  const days = [];
  for (let i = 0; i < 31; i++) days.push(dateKeyForOffset(i));

  const counts = await Promise.all(days.map(async (d) => {
    try {
      const v = await env.SHOP_KV.get(`visits_${d}`);
      return { date: d, count: parseInt(v || '0', 10) };
    } catch { return { date: d, count: 0 }; }
  }));

  // Підсумки
  const today = counts[0].count;
  const yesterday = counts[1] ? counts[1].count : 0;
  const last7Days = counts.slice(0, 7).reduce((s, x) => s + x.count, 0);
  const last30Days = counts.slice(0, 30).reduce((s, x) => s + x.count, 0);

  return jsonResp({
    ok: true,
    today,
    yesterday,
    last7Days,
    last30Days,
    daily: counts, // [{date, count}, ...]
  });
}

export async function onRequestPost({ request, env }) {
  if (!(await checkAuthAsync(request, env))) return jsonResp({ ok: false, error: 'Не авторизовано' }, 401);
  if (!env.SHOP_KV) return jsonResp({ ok: false, error: 'KV недоступний' }, 500);

  let body;
  try { body = await request.json(); } catch { return jsonResp({ ok: false, error: 'Невалідний JSON' }, 400); }

  if (body.action !== 'reset') return jsonResp({ ok: false, error: 'Невідома дія' }, 400);

  // Видаляємо всі visits_* за останні 100 днів
  let deleted = 0;
  for (let i = 0; i < 100; i++) {
    const d = dateKeyForOffset(i);
    try {
      await env.SHOP_KV.delete(`visits_${d}`);
      deleted++;
    } catch {}
  }
  return jsonResp({ ok: true, deleted });
}
