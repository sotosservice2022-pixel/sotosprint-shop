// POST /api/admin/orders-bulk — массовые операции над заказами
// Body: { kvKeys: [...], action: 'delete' | 'read' | 'unread' | 'done' | 'undone' }
// Или { action: 'delete-all', confirm: 'YES' } — удалить ВСЕ заказы
// Или { action: 'cleanup-old', days: N, dryRun?: bool } — удалить заказы старше N дней (текст+фото)
import { listOrders, deleteOrder, updateOrder, checkAuthAsync, jsonResp, invalidateOrdersCache, cleanupOldOrders, cleanupOldOrderPhotosKeepOrder } from '../../_utils/shop.js';

export async function onRequestPost({ request, env }) {
  if (!(await checkAuthAsync(request, env))) return jsonResp({ ok: false, error: 'Не авторизовано' }, 401);

  let body;
  try { body = await request.json(); } catch { return jsonResp({ ok: false, error: 'Невалидний JSON' }, 400); }
  const action = String(body.action || '').toLowerCase();

  // Видалити старі замовлення (текст у KV + фото в R2) старші за N днів.
  // dryRun — лише порахувати, скільки потрапить під видалення.
  if (action === 'cleanup-old') {
    const days = Math.max(1, parseInt(body.days, 10) || 0);
    if (!days) return jsonResp({ ok: false, error: 'Вкажіть кількість днів (≥1)' }, 400);
    const dryRun = body.dryRun === true;
    try {
      const r = await cleanupOldOrders(env, days, dryRun);
      if (!dryRun) await invalidateOrdersCache();
      return jsonResp({ ok: true, action: 'cleanup-old', dryRun, days, scanned: r.scanned, matched: r.matched, deleted: dryRun ? 0 : r.deleted });
    } catch (e) {
      return jsonResp({ ok: false, error: 'Помилка очищення: ' + e.message }, 500);
    }
  }

  // Видалити ЛИШЕ фото старих замовлень (текст лишається). dryRun — лише порахувати.
  if (action === 'cleanup-old-photos') {
    const days = Math.max(1, parseInt(body.days, 10) || 0);
    if (!days) return jsonResp({ ok: false, error: 'Вкажіть кількість днів (≥1)' }, 400);
    const dryRun = body.dryRun === true;
    try {
      const r = await cleanupOldOrderPhotosKeepOrder(env, days, dryRun);
      if (!dryRun) await invalidateOrdersCache();
      return jsonResp({
        ok: true, action: 'cleanup-old-photos', dryRun, days,
        scanned: r.scanned, matched: r.matched,
        deletedPhotos: dryRun ? 0 : r.deletedPhotos,
        matchedPhotos: r.deletedPhotos,
        matchedMB: +(r.matchedBytes / 1024 / 1024).toFixed(2),
      });
    } catch (e) {
      return jsonResp({ ok: false, error: 'Помилка очищення: ' + e.message }, 500);
    }
  }

  if (action === 'delete-all') {
    if (body.confirm !== 'YES') {
      return jsonResp({ ok: false, error: 'Підтвердження не пройдено. Передайте confirm: "YES" в тілі запиту.' }, 400);
    }
    const orders = await listOrders(env, 1000);
    let deleted = 0;
    for (const o of orders) {
      if (o.kvKey) {
        try { await deleteOrder(env, o.kvKey); deleted++; } catch {}
      }
    }
    await invalidateOrdersCache();
    return jsonResp({ ok: true, deleted });
  }

  const keys = Array.isArray(body.kvKeys) ? body.kvKeys.filter(k => typeof k === 'string' && k.startsWith('order_')) : [];
  if (keys.length === 0) return jsonResp({ ok: false, error: 'Не вибрано жодного замовлення' }, 400);
  if (keys.length > 200) return jsonResp({ ok: false, error: 'Забагато замовлень за раз (макс 200)' }, 400);

  let processed = 0;
  if (action === 'delete') {
    for (const k of keys) {
      try { await deleteOrder(env, k); processed++; } catch {}
    }
  } else {
    let patch = {};
    if (action === 'read') patch.isRead = true;
    else if (action === 'unread') patch.isRead = false;
    else if (action === 'done') { patch.isDone = true; patch.doneAt = new Date().toISOString(); }
    else if (action === 'undone') { patch.isDone = false; patch.doneAt = null; }
    else return jsonResp({ ok: false, error: 'Невідома дія: ' + action }, 400);
    for (const k of keys) {
      try { await updateOrder(env, k, patch); processed++; } catch {}
    }
  }
  await invalidateOrdersCache();
  return jsonResp({ ok: true, processed });
}
