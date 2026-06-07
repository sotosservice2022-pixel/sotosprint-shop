// POST /api/admin/logout — очищает cookie-сессию
import { buildLogoutSetCookie } from '../../_utils/shop.js';

export async function onRequestPost() {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Set-Cookie': buildLogoutSetCookie(),
    },
  });
}
