// /api/admin/sms-test — надсилає тестове SMS щоб перевірити налаштування TurboSMS
import { checkAuthAsync, getSettings, jsonResp, sendSms } from '../../_utils/shop.js';

export async function onRequestPost({ request, env }) {
  if (!(await checkAuthAsync(request, env))) return jsonResp({ ok: false, error: 'Не авторизовано' }, 401);

  let body;
  try { body = await request.json(); } catch { return jsonResp({ ok: false, error: 'Невалідний JSON' }, 400); }
  const to = String(body.to || '').trim();
  if ((to || '').replace(/\D/g, '').length < 10) {
    return jsonResp({ ok: false, error: 'Введіть правильний номер телефону' }, 400);
  }

  const settings = await getSettings(env);
  if (!settings.smsApiToken || !settings.smsSender) {
    return jsonResp({ ok: false, error: 'SMS не налаштовано: вкажи токен TurboSMS та імʼя відправника.' }, 400);
  }

  try {
    const res = await sendSms(settings, to, `🧪 Тестове SMS від ${settings.title || 'магазину'}. Налаштування TurboSMS працюють!`);
    if (res.ok) return jsonResp({ ok: true, message: `✅ SMS надіслано на ${to}.`, id: res.id });
    return jsonResp({ ok: false, error: res.error }, 400);
  } catch (e) {
    return jsonResp({ ok: false, error: e.message }, 500);
  }
}
