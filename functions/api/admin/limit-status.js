// GET /api/admin/limit-status — повертає активні ліміти (для банера в адмінці)
import { checkAuthAsync, getLimitStatus, jsonResp } from '../../_utils/shop.js';

export async function onRequestGet({ request, env }) {
  if (!(await checkAuthAsync(request, env))) return jsonResp({ ok: false, error: 'Не авторизовано' }, 401);
  const active = await getLimitStatus();
  return jsonResp({ ok: true, active });
}
