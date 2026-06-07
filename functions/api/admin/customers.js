// GET /api/admin/customers — зведення клієнтів із замовлень (CRM).
// Групуємо всі замовлення за телефоном: імʼя, кількість замовлень, сума, останнє замовлення,
// топ-товари та позначка «повторний клієнт».
import { listOrders, checkAuthAsync, jsonResp } from '../../_utils/shop.js';

function normPhone(p) { return String(p || '').replace(/\D/g, ''); }

export async function onRequestGet({ request, env }) {
  try {
    if (!(await checkAuthAsync(request, env))) return jsonResp({ ok: false, error: 'Не авторизовано' }, 401);

    const orders = await listOrders(env, 500);
    const map = new Map();

    for (const o of orders) {
      const norm = normPhone(o.phone);
      // ключ — нормалізований телефон; якщо телефону нема — групуємо за іменем
      const key = norm || ('name:' + String(o.customerName || '').trim().toLowerCase());
      if (!key || key === 'name:') continue;

      let c = map.get(key);
      if (!c) {
        c = {
          phone: o.phone || '', phoneNorm: norm, name: o.customerName || '',
          ordersCount: 0, totalSpent: 0, totalPhotos: 0,
          firstOrderAt: null, lastOrderAt: null, lastOrderId: null,
          _products: {},
        };
        map.set(key, c);
      }
      c.ordersCount++;
      c.totalSpent += Number(o.totalPrice) || 0;
      c.totalPhotos += Number(o.totalPhotos) || 0;

      const at = o.createdAt || '';
      if (at) {
        if (!c.firstOrderAt || at < c.firstOrderAt) c.firstOrderAt = at;
        if (!c.lastOrderAt || at > c.lastOrderAt) {
          c.lastOrderAt = at;
          c.name = o.customerName || c.name;
          c.phone = o.phone || c.phone;
          c.lastOrderId = o.id;
        }
      }
      for (const it of (o.items || [])) {
        const n = it.productName || '?';
        c._products[n] = (c._products[n] || 0) + (Number(it.quantity) || 1);
      }
    }

    const customers = Array.from(map.values()).map(c => {
      const topProducts = Object.entries(c._products)
        .sort((a, b) => b[1] - a[1]).slice(0, 3)
        .map(([name, qty]) => ({ name, qty }));
      const { _products, ...rest } = c;
      return {
        ...rest,
        repeat: c.ordersCount > 1,
        avgOrder: c.ordersCount ? Math.round(c.totalSpent / c.ordersCount) : 0,
        topProducts,
      };
    });

    customers.sort((a, b) => b.totalSpent - a.totalSpent);

    const summary = {
      totalCustomers: customers.length,
      repeatCustomers: customers.filter(c => c.repeat).length,
      totalRevenue: customers.reduce((s, c) => s + c.totalSpent, 0),
      ordersAnalyzed: orders.length,
    };

    return jsonResp({ ok: true, customers, summary });
  } catch (e) {
    return jsonResp({ ok: false, error: 'Server error: ' + (e.message || String(e)) }, 500);
  }
}
