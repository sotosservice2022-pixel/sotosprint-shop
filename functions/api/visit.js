// GET /api/visit — лічить унікальних відвідувачів за день.
// Фільтри:
//   1. Боти (User-Agent regex) — не рахуємо
//   2. Адмін (cookie admin_session присутній) — не рахуємо
//   3. Cookie visit_id (TTL 24h) — основна дедуплікація
//   4. IP+день fallback (на випадок incognito/блокування cookies) — запасна дедуплікація

// Регулярка для виявлення ботів. Покриває основних краулерів.
const BOT_RE = /(bot|crawler|spider|crawling|slurp|mediapartners|googlebot|bingbot|yandexbot|duckduckbot|baiduspider|sogou|exabot|facebot|ia_archiver|petalbot|ahrefsbot|semrushbot|mj12bot|dotbot|seekport|gptbot|chatgpt|claude|cohere|anthropic|perplexity|telegrambot|whatsapp|viber|skypeuripreview|slackbot|discordbot|twitterbot|linkedinbot|embedly|quora link preview|outbrain|pinterest|redditbot|applebot|aspiegelbot|mauibot|seznambot|adsbot|amazonbot|bytespider)/i;

// Простий хеш рядка (для IP — не для безпеки, лише для коротких KV-ключів)
function hashStr(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}

export async function onRequestGet({ request, env }) {
  const cookieHeader = request.headers.get('cookie') || '';
  const userAgent = request.headers.get('user-agent') || '';
  const ip = request.headers.get('cf-connecting-ip')
          || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
          || '';

  // 1. Фільтр ботів
  if (BOT_RE.test(userAgent)) {
    return new Response('bot', { status: 200, headers: { 'Cache-Control': 'no-store' } });
  }

  // 2. Адмін — не рахуємо (власник заходить)
  if (/(^|;\s*)admin_session=/.test(cookieHeader)) {
    return new Response('admin', { status: 200, headers: { 'Cache-Control': 'no-store' } });
  }

  // 3. Вже є cookie visit_id — не рахуємо
  if (/(^|;\s*)visit_id=/.test(cookieHeader)) {
    return new Response('1', { status: 200, headers: { 'Cache-Control': 'no-store' } });
  }

  if (!env.SHOP_KV) return new Response('0', { status: 200 });

  const now = new Date();
  // Київський час для daily-rolling
  const kyivOffsetMs = 3 * 60 * 60 * 1000;
  const dayKey = new Date(now.getTime() + kyivOffsetMs).toISOString().slice(0, 10);
  const counterKey = `visits_${dayKey}`;

  // 4. IP-fallback: якщо cookie немає (incognito, блокування) — перевіримо чи був візит з цього IP сьогодні
  let alreadySeenByIp = false;
  if (ip) {
    const ipKey = `visit_seen_${dayKey}_${hashStr(ip)}`;
    try {
      const seen = await env.SHOP_KV.get(ipKey);
      if (seen) {
        alreadySeenByIp = true;
      } else {
        // Позначаємо IP як побачений на сьогодні (TTL до кінця доби + 1 година)
        await env.SHOP_KV.put(ipKey, '1', { expirationTtl: 30 * 60 * 60 }); // 30h
      }
    } catch {}
  }

  // Якщо IP вже бачений — все одно ставимо cookie (щоб надалі не йти в KV), але не інкрементимо лічильник
  if (alreadySeenByIp) {
    const visitId = (crypto.randomUUID && crypto.randomUUID()) || (Date.now().toString(36) + Math.random().toString(36).slice(2));
    return new Response('dup-ip', {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
        'Set-Cookie': `visit_id=${visitId}; Path=/; Max-Age=86400; SameSite=Lax; Secure`,
      },
    });
  }

  // Все нормально — рахуємо
  try {
    const cur = parseInt((await env.SHOP_KV.get(counterKey)) || '0', 10);
    await env.SHOP_KV.put(counterKey, String(cur + 1), { expirationTtl: 100 * 24 * 60 * 60 }); // 100 днів
  } catch {}

  const visitId = (crypto.randomUUID && crypto.randomUUID()) || (Date.now().toString(36) + Math.random().toString(36).slice(2));
  return new Response('1', {
    status: 200,
    headers: {
      'Cache-Control': 'no-store',
      'Set-Cookie': `visit_id=${visitId}; Path=/; Max-Age=86400; SameSite=Lax; Secure`,
    },
  });
}
