// GET/POST /api/admin/settings — настройки магазина
import { getSettings, saveSettings, checkAuthAsync, unauthorized, jsonResp, notifyLimitHit, classifyLimitError } from '../../_utils/shop.js';

export async function onRequestGet({ request, env }) {
  if (!(await checkAuthAsync(request, env))) return unauthorized();
  const settings = await getSettings(env);
  return jsonResp({ ok: true, settings });
}

export async function onRequestPost({ request, env }) {
  if (!(await checkAuthAsync(request, env))) return unauthorized();
  let s;
  try { s = await request.json(); } catch { return jsonResp({ ok: false, error: 'Невалідний JSON' }, 400); }
  try {
    await saveSettings(env, s);
    return jsonResp({ ok: true });
  } catch (e) {
    const limitKind = classifyLimitError(e);
    if (limitKind) await notifyLimitHit(env, limitKind, e.message);
    return jsonResp({ ok: false, error: 'Помилка збереження: ' + e.message }, 500);
  }
}
