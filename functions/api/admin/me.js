// GET /api/admin/me — лёгкая проверка: авторизован ли текущий запрос как админ.
// Используется витриной для preview-режима (показать магазин админу, даже если он закрыт).
// Кука admin_session — HttpOnly, поэтому JS на витрине не может прочитать её сам.
import { checkAuthAsync, unauthorized, jsonResp } from '../../_utils/shop.js';

export async function onRequestGet({ request, env }) {
  if (!(await checkAuthAsync(request, env))) return unauthorized();
  return jsonResp({ ok: true, admin: true });
}
