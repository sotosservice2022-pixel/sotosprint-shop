// Общие утилиты магазина: настройки, товары, авторизация админки.

const DEFAULT_SETTINGS = {
  shopEnabled: true,
  browserTabTitle: '', // якщо порожньо — використовується seoTitle або title
  shopDisabledMessage: '🚫 Магазин тимчасово не приймає замовлення. Спробуйте пізніше.',
  title: '🖨 AGPRNT — друк фотографій',
  subtitle: 'Якісний друк ваших фотографій з доставкою по Україні',
  adminHeaderText: 'AGPRNT — управління сайтом і товарами', // підзаголовок у шапці адмінки

  contacts: 'Телефон: +380 (XX) XXX-XX-XX\nІнстаграм: @agprnt',
  // Тексты способов доставки/оплаты в виде Markdown — клиент видит как текст-меню
  deliveryMethods: [
    'Самовивіз (адресу уточнимо по телефону)',
    'Нова Пошта — відділення',
    'Нова Пошта — адресна доставка',
  ],
  paymentMethods: [
    'На картку Приват/Моно (реквізити надішлемо після підтвердження замовлення)',
    'Накладений платіж Нової Пошти',
    'Готівкою при самовивозі',
  ],
  // Кнопки и тексты UI
  catalogTitle: 'Наші послуги',
  cartTitle: '🛒 Кошик',
  // Окремий текст назви магазину для мобільних (≤700px)
  mobileTitle: '',
  emptyCartText: 'Кошик порожній. Додайте товари з каталогу.',
  addToCartText: 'У кошик',
  inCartText: '✓ У кошику',  // текст кнопки коли товар вже в кошику
  proceedCheckoutText: '➡️ Оформити замовлення',
  checkoutTitle: 'Оформлення замовлення',
  submitText: 'Відправити замовлення',
  successText: '✅ Замовлення #{orderId} прийнято! Ми звʼяжемося з вами для уточнення.',
  uploadHint: 'Прикріпіть фото для друку (до {maxFiles} шт., до {maxSize} МБ кожне)',
  // Заголовки секцій (можна редагувати)
  orderItemsTitle: '📦 Склад замовлення',
  photosBlockTitle: '📷 Фотографії для друку',
  choosePhotosText: '📷 Вибрати фото',
  contactDetailsTitle: '📝 Контактні дані',
  deliveryBlockTitle: '🚚 Доставка',
  paymentBlockTitle: '💳 Оплата',
  contactsBlockTitle: '📞 Контакти',
  cartTotalLabel: 'Разом:',
  cartItemRemoveText: 'Видалити',
  cartNothingSelectedText: 'Оберіть хоча б один товар',
  // Валидация формы оформления
  fields: [
    { id: 'name', type: 'text', label: 'Імʼя', placeholder: 'Як до вас звертатися', required: true, maxLength: 100 },
    { id: 'phone', type: 'tel', label: 'Телефон', placeholder: '+380 (__) ___-__-__', required: true },
    { id: 'comment', type: 'textarea', label: 'Коментар до замовлення', placeholder: 'Адреса НП, № відділення, побажання...', required: false, maxLength: 500 },
  ],
  // Тексты ошибок
  phoneErrorText: 'Введіть номер повністю (12 цифр)',
  requiredFieldError: 'Заповніть це поле',
  noPhotosError: 'Прикріпіть фото для всіх товарів у кошику',
  totalPhotosError: 'Максимум {max} фото на замовлення (всього). Зайві пропущено.',
  networkErrorText: 'Мережа недоступна або зʼєднання перервано. Спробуйте ще раз.',
  retryingText: 'Спроба {attempt}…',
  preparingText: 'Підготовка фото…',
  sendingText: 'Відправляємо замовлення…',
  // Сжатие фото перед отправкой
  autoCompress: true,
  compressMaxSide: 4000,
  compressQuality: 95,
  // Nova Poshta API
  npApiKey: '',
  npEnabled: false,
  // Лейблы для NP-полей в чекауте
  npCityLabel: 'Місто (Нова Пошта)',
  npLabel: '📦 Нова Пошта',
  npCityPlaceholder: 'Почніть вводити назву…',
  npWarehouseLabel: 'Відділення',
  npWarehouseEmptyPlaceholder: '— спочатку виберіть місто —',
  npLoadingText: 'Завантажую відділення…',
  // Двухфакторная аутентификация
  twoFactorChannel: 'off', // 'off' | 'telegram' | 'email'
  twoFactorEnabled: false, // legacy, оставляем для миграции
  twoFactorChatId: '', // пусто = используется CHAT_ID для заказов
  // Email через Resend (https://resend.com)
  emailApiKey: '',
  emailFrom: 'onboarding@resend.dev',
  emailTo: '',
  // Кастомизация шапки
  topbarBg: '#ffffff',
  topbarText: '',          // legacy — теперь используется topbarContactsList
  // Логотип
  logoEnabled: false,
  logoImage: '', // data URL
  logoLinksToHome: true,    // клік по логотипу → головна сторінка
  logoOffsetX: 0,           // px — горизонтальне зміщення логотипу від базового положення (-300..300)
  logoOffsetXMobile: 0,     // px — окреме зміщення лого для мобільних (≤700px)
  // Назва магазину
  titleLinksToHome: false,  // клік по назві → головна сторінка
  titleOffsetX: 0,          // px — горизонтальне зміщення назви від базового положення (-300..300)
  titleOffsetXMobile: 0,    // px — окреме зміщення назви для мобільних (≤700px)
  titleAbsoluteCenter: false, // якщо true — назва позиціонується строго по центру екрана (через position:absolute)
  // Окремі зміщення для решти елементів шапки
  searchOffsetX: 0,         // px (-300..300)
  searchOffsetXMobile: 0,   // px (-200..200)
  menuOffsetX: 0,           // px
  menuOffsetXMobile: 0,
  cartOffsetX: 0,           // px
  cartOffsetXMobile: 0,
  // Каталог
  mobileTwoColumns: false,  // показувати 2 колонки на мобільному (за замовч. 1)
  // Контакты — массивы строк, отдельно в шапке и внизу
  topbarContactsEnabled: true,
  topbarContactsList: [],  // строки для шапки
  contactsEnabled: true,
  contactsList: [],        // строки для футера
  // SEO (для пошукових систем — Google, Bing, Яндекс)
  seoTitle: 'AGPRNT — друк фотографій з доставкою по Україні',
  seoDescription: 'Якісний друк фотографій з доставкою Новою Поштою по всій Україні. Замовляй фото з телефону за хвилину — без реєстрації.',
  seoKeywords: 'друк фото, фотодрук, друк фотографій, фото на замовлення, фотолабораторія, agprnt, нова пошта, Україна',
  seoOgImage: '', // URL картинки для превью в соцмережах (1200×630 рекомендовано)
  // === PWA (встановлюване застосунок на телефон) ===
  // Якщо true — на сайті реєструється service worker + manifest, і браузер пропонує
  // «Встановити застосунок». Якщо вимкнути — SW автоматично знімається з реєстрації,
  // manifest не підключається (фіча повністю вимикається без слідів).
  pwaEnabled: false,
  pwaAppName: 'AGPRNT — друк фото',   // повна назва застосунку (екран встановлення)
  pwaShortName: 'AGPRNT',            // коротка назва (під іконкою на робочому столі)
  pwaThemeColor: '#0b8aff',          // колір системної панелі застосунку
  pwaBackgroundColor: '#0b8aff',     // колір splash-екрану під час запуску
  pwaIconImage: '',                  // власна іконка застосунку (URL з R2, PNG квадратна ≥512px); '' = стандартна «AG»
  pwaIconMaskImage: '',              // maskable-варіант (автогенерується в адмінці: фон + іконка по центру, бо Android обрізає в коло)
  pwaInstallButtonEnabled: true,     // дозволити встановлення з браузера (false = прибрати кнопку І manifest → пункту в меню браузера теж не буде)

  // === Відстеження замовлення (клієнт вводить № замовлення + телефон) ===
  orderTrackingEnabled: false,   // головний тумблер фічі (вимкнено = /api/track віддає 404)
  trackPageEnabled: true,        // показувати окрему сторінку /track
  trackButtonEnabled: true,      // показувати кнопку «Відстежити замовлення» на вітрині
  trackButtonText: '📦 Відстежити замовлення',
  // Редаговані підказки/тексти у формі відстеження (сторінка /track і модалка на вітрині)
  trackTitle: '📦 Відстеження замовлення',
  trackSubtitle: 'Введіть номер замовлення і телефон, на який оформляли',
  trackOrderPlaceholder: 'напр. 1024',
  trackPhonePlaceholder: 'напр. 0991234567',
  // Заготовка повідомлення клієнту в картці замовлення ({orderId} — номер, {link} — посилання)
  trackMessageTemplate: 'Ваше замовлення №{orderId} виконане ✅\nВідстежити: {link}',

  // Раздел заказов
  newOrderToastText: '🛍 Нове замовлення #{orderId}',
  newOrderToastEnabled: true,
  // Сповіщення в Telegram про досягнення лімітів Cloudflare
  limitNotifyEnabled: true,
  limitNotifyIntervalMin: 60,    // мін. інтервал між сповіщеннями одного типу

  // Сповіщення в Telegram при кожній авторизації в адмінку
  loginNotifyEnabled: true,
  // Якщо true — пароль запитується при кожному вході (cookie session-only, без Max-Age).
  // Якщо false — cookie живе 30 днів (за замовчуванням).
  requirePasswordEachSession: false,

  // === Cloudflare Analytics API (для статистики реального використання) ===
  cfApiToken: '',                // токен з правом "Account Analytics: Read" + (опц.) "Zone Cache Purge: Edit"
  cfAccountId: '',               // Account ID з Cloudflare Dashboard
  cfNamespaceId: '2b33bf309cd7409aa255274b8eb25380', // ID нашого SHOP_KV (заповнено)
  cfZoneId: '',                  // Zone ID домену (для миттєвого purge кешу при змінах)
  cfProjectName: 'agprnt-shop', // Pages-проект — для додавання доменів через API
  primaryDomain: 'agprnt.com', // основний домен сайту — використовується у purge, webhook, redirect
  // Резервний (запасний) проект — другий магазин якого можна вмикати/вимикати одним кліком
  reserveProjectName: '',  // напр. 'tehno-store'
  reserveDomain: '',       // напр. 'agprnt.com'

  // Швидкість оновлення UI / продуктивність
  publicPollIntervalSec: 5,      // як часто публічний сайт перевіряє оновлення (1-60)
  adminPollIntervalSec: 60,      // як часто адмінка опитує нові замовлення (10-300)
  adminEscBackEnabled: true,     // Escape = кнопка «← Назад» в адмінці
  ordersAutoRefreshSec: 15,      // авто-оновлення таблиці /admin/orders/ (5-120)
  shopVersionCacheSec: 2,        // CDN-кеш на /api/shop-version (1-30)
  shopFullCacheSec: 30,          // CDN-кеш на /api/shop (5-300)
  // Категории товаров
  categories: [],          // [{ id, name, slug }]
  // Промокоди / купони
  promoCodes: [],          // [{ id, code, type:'percent'|'fixed'|'shipping', value, minOrder, maxUses, used, validFrom, validUntil, enabled, description }]
  promoEnabled: true,      // показувати поле "Промокод" у формі оформлення
  promoFieldLabel: '🎟 Промокод (якщо є)',
  // Сповіщення клієнту після замовлення (через Resend.com — той самий API ключ що для 2FA)
  customerEmailEnabled: false,
  customerEmailRequired: false,  // якщо true — email обов'язковий для оформлення (інакше — опціональне поле)
  customerEmailSubject: 'Замовлення #{orderId} прийнято — {shopTitle}',
  customerEmailFromName: '',     // ім'я відправника (якщо порожнє — береться title магазину)
  customerEmailFooter: 'Дякуємо за замовлення! Ми звʼяжемося з вами найближчим часом.',
  customerEmailFieldLabel: '📧 Email для підтвердження замовлення',
  // Дозволити замовлення коли Telegram бот не налаштований / вимкнений
  allowOrdersWithoutBot: false,  // якщо true — замовлення зберігається в /admin/orders/ навіть без Telegram
  // SMS клієнту — платний шлюз, вмикається/налаштовується пізніше
  smsEnabled: false,
  smsProvider: 'turbosms',       // 'turbosms' | 'smsclub' | 'twilio'
  smsApiToken: '',               // Bearer-токен (TurboSMS/SMSClub) або Auth Token (Twilio)
  smsAccountSid: '',             // лише для Twilio — Account SID
  smsSender: '',                 // альфа-імʼя відправника (TurboSMS/SMSClub) або From-номер (Twilio)
  smsTemplate: 'Замовлення #{orderId} прийнято. Сума: {total} грн. Дякуємо!',
  showCategoriesNav: true, // показывать вкладки категорий на главной
  showAllCategoriesTab: true, // показывать вкладку «Усі товари» (если false — только конкретные категории)
  defaultCategoryName: 'Усі товари',
  // Тема (light/dark)
  theme: 'light',
  // Шапка — расширенная кастомизация
  topbarBgImage: '',         // data URL (опционально)
  topbarTitleSize: 17,       // px
  topbarTitleMinSize: 14,    // px — мінімум при авто-стискуванні (під більше = крупніший шрифт навіть якщо обрізається)
  topbarContactsSize: 12,    // px
  headerMenuSize: 14,        // px — розмір шрифту меню (Доставка/Оплата/Про нас/Контакти)
  globalFontScale: 1.0,      // 0.8-1.5 — масштабує весь текст у каталозі
  subtitleAlign: 'left',     // 'left' | 'center' | 'right'
  topbarTextColorOverride: '', // если пусто — авто по контрасту фона
  topbarLayout: 'default',     // legacy: default | logo-right | centered-title (для зворотньої сумісності)
  topbarTitleAlign: 'left',    // legacy
  // Нова система: позиція кожного елементу шапки (left | center | right)
  topbarPositions: {
    logo: 'left',
    title: 'left',
    menu: 'center',
    search: 'center',
    contacts: 'right',
    // cart завжди справа
  },
  // Порядок елементів всередині зони (1, 2, 3...). Менші номери — лівіше/верхніше.
  topbarElementOrder: {
    logo: 1,
    search: 2,
    title: 3,
    menu: 4,
    contacts: 5,
    // cart завжди останній справа
  },
  // Меню в шапці (горизонтальні пункти типу Доставка, Оплата, Про нас, Контакти)
  headerMenuEnabled: true,
  headerMenu: [],              // [{ id, title, content, enabled }]
  // Пошук товарів у шапці
  headerSearchEnabled: false,
  headerSearchPlaceholder: '🔍 Пошук товарів…',
  // Кнопки на сайті
  buttonColor: '#0b8aff',
  buttonHoverColor: '',
  buttonTextColor: '#ffffff',
  successColor: '#16a34a',
  // Іконка вкладки браузера (favicon)
  faviconImage: '',
  // Масові операції в адмінці (червоний банер у /orders/ і /products/)
  showBulkOperations: true,
  // Стиснення картинок товарів (в адмінці)
  productImageMaxSide: 1200,
  productImageQuality: 85,
  // Готовність до онлайн-оплати (legacy, не використовується новим кодом)
  onlinePaymentEnabled: false,
  onlinePaymentProvider: '',
  onlinePaymentMerchantId: '',
  onlinePaymentApiKey: '',
  // === Онлайн-оплата (LiqPay + Monobank) ===
  payTestMode: false,            // тестовий режим (LiqPay sandbox / тестовий токен Monobank)
  payLiqpayEnabled: false,
  payLiqpayPublicKey: '',
  payLiqpayPrivateKey: '',       // СЕКРЕТ — не віддається назад у UI/публічно
  payMonoEnabled: false,
  payMonoToken: '',              // СЕКРЕТ (X-Token) — не віддається назад у UI/публічно
  // Аналітика
  googleAnalyticsId: '',          // G-XXXXXXX (GA4)
  googleTagManagerId: '',         // GTM-XXXXXXX
  facebookPixelId: '',            // Facebook Pixel ID
  // Файлове сховище R2
  storageQuotaMB: 200,            // ліміт у MB
  // === Боковые баннеры (до 3 штук на каждой стороне) ===
  bannerWidth: 180,
  // Старі поля залишаємо для зворотньої сумісності — мігруються в sideBanners при першому читанні
  bannerLeftEnabled: false, bannerLeftImage: '', bannerLeftVideo: '', bannerLeftText: '', bannerLeftLink: '',
  bannerRightEnabled: false, bannerRightImage: '', bannerRightVideo: '', bannerRightText: '', bannerRightLink: '',
  // Нові: масиви по 3 елементи. Кожен елемент: { enabled, image, video, text, link, productId }
  sideBanners: {
    left: [
      { enabled: false, image: '', video: '', text: '', link: '', productId: '' },
      { enabled: false, image: '', video: '', text: '', link: '', productId: '' },
      { enabled: false, image: '', video: '', text: '', link: '', productId: '' },
    ],
    right: [
      { enabled: false, image: '', video: '', text: '', link: '', productId: '' },
      { enabled: false, image: '', video: '', text: '', link: '', productId: '' },
      { enabled: false, image: '', video: '', text: '', link: '', productId: '' },
    ],
    rotateEnabled: false,    // якщо увімкнено — показувати по черзі (інакше всі стеком)
    rotateInterval: 5,       // секунди між зміною
    transitionEffect: 'fade', // 'instant' | 'fade' | 'slide-left' | 'slide-right'
  },

  // === Hero-банер під шапкою (на всю ширину) ===
  heroBanner: {
    enabled: false,
    image: '',          // R2-URL фону (основне зображення)
    images: [],         // додаткові зображення для слайдшоу — масив { url, link, productId }
    rotateEnabled: false, // автоматично змінювати фонове зображення
    rotateInterval: 5,    // секунди між зміною
    transitionEffect: 'fade', // 'instant' | 'fade' | 'slide-left' | 'slide-right'
    text: '',           // багаторядковий текст
    textColor: '#ffffff',
    textBgOpacity: 0.4, // 0-1 — прозорість темної підкладки під текстом
    textPosition: 'center', // top | center | bottom
    textAlign: 'center',    // left | center | right
    link: '',
    productId: '',
    minHeight: 250,     // мінімальна висота в px
    paddingY: 30,       // вертикальні відступи в px
  },

  // Счётчик продаж под товарами
  showSoldCount: false,
  quickAddToCartEnabled: false,
  inCartClickOpensCart: true,  // якщо товар вже в кошику — клік по кнопці відкриває кошик (замість повторного додавання)
  inCartClickOpensCartMobile: true, // те саме але для мобільного (≤700px)
  inCartClickRemoves: false,   // якщо товар вже в кошику — клік прибирає його з кошика (має пріоритет над OpensCart)
  inCartClickRemovesMobile: false, // те саме але для мобільного (≤700px)
  inCartRemoveToastText: '🗑 Прибрано з кошика', // текст тоста при видаленні (порожнє = без тоста)
  inCartRemoveAnimation: false, // показувати анімацію зникнення кнопки/картки при видаленні
  inCartConfirmRemove: false,  // запитувати підтвердження перед видаленням (десктоп)
  inCartConfirmRemoveMobile: false, // те саме для мобільного (≤700px)
  inCartConfirmRemoveText: 'Прибрати товар з кошика?', // текст підтвердження
  adminShowVisitorsWidget: false, // показувати міні-віджет відвідувачів на головній адмінці
  soldCountTemplate: 'Куплено: {count}',
};

const DEFAULT_PRODUCTS = [
  {
    id: 'p1',
    name: '10×15 фотодрук',
    description: 'Стандартний розмір. Глянцевий або матовий папір високої якості.',
    price: 6,
    currency: '₴',
    image: '',
    images: [],
    video: '',
    attributes: [],
    enabled: true,
    requiresPhoto: true,
    options: [
      { id: 'glossy', name: 'Глянцевий', priceDelta: 0 },
      { id: 'matte', name: 'Матовий', priceDelta: 0 },
    ],
  },
  {
    id: 'p2',
    name: '13×18 фотодрук',
    description: 'Трохи більший за стандарт, ідеально для рамок.',
    price: 12,
    currency: '₴',
    image: '',
    images: [],
    video: '',
    attributes: [],
    enabled: true,
    requiresPhoto: true,
    options: [
      { id: 'glossy', name: 'Глянцевий', priceDelta: 0 },
      { id: 'matte', name: 'Матовий', priceDelta: 0 },
    ],
  },
  {
    id: 'p3',
    name: '20×30 фотодрук',
    description: 'Великий розмір для портретів і пейзажів.',
    price: 35,
    currency: '₴',
    image: '',
    images: [],
    video: '',
    attributes: [],
    enabled: true,
    requiresPhoto: true,
    options: [],
  },
];

export const ALLOWED_FIELD_TYPES = ['text', 'tel', 'email', 'number', 'textarea'];

export async function getSettings(env) {
  if (!env.SHOP_KV) return DEFAULT_SETTINGS;
  try {
    const stored = await env.SHOP_KV.get('settings', 'json');
    const merged = stored ? { ...DEFAULT_SETTINGS, ...stored } : DEFAULT_SETTINGS;
    return migrateLegacyFields(merged);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

// Если в новом формате массивы пустые, но есть старые legacy-строки — мигрируем.
function migrateLegacyFields(s) {
  if ((!Array.isArray(s.topbarContactsList) || s.topbarContactsList.length === 0) && s.topbarText) {
    s.topbarContactsList = [s.topbarText];
  }
  if ((!Array.isArray(s.contactsList) || s.contactsList.length === 0) && s.contacts) {
    s.contactsList = String(s.contacts).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  }
  // Миграция legacy twoFactorEnabled → twoFactorChannel
  if (s.twoFactorChannel === undefined || s.twoFactorChannel === null) {
    s.twoFactorChannel = s.twoFactorEnabled ? 'telegram' : 'off';
  }
  // Миграция legacy bannerLeft/bannerRight → sideBanners.{left,right}[0]
  if (!s.sideBanners || typeof s.sideBanners !== 'object') {
    s.sideBanners = { left: [], right: [] };
  }
  if (!Array.isArray(s.sideBanners.left)) s.sideBanners.left = [];
  if (!Array.isArray(s.sideBanners.right)) s.sideBanners.right = [];
  // Доповнюємо до 3 порожніх слотів
  while (s.sideBanners.left.length < 3) {
    s.sideBanners.left.push({ enabled: false, image: '', video: '', text: '', link: '', productId: '' });
  }
  while (s.sideBanners.right.length < 3) {
    s.sideBanners.right.push({ enabled: false, image: '', video: '', text: '', link: '', productId: '' });
  }
  // Якщо перший слот порожній а є legacy — переносимо
  if (s.bannerLeftEnabled && !s.sideBanners.left[0].enabled && !s.sideBanners.left[0].image && !s.sideBanners.left[0].video && !s.sideBanners.left[0].text) {
    s.sideBanners.left[0] = {
      enabled: true,
      image: s.bannerLeftImage || '',
      video: s.bannerLeftVideo || '',
      text: s.bannerLeftText || '',
      link: s.bannerLeftLink || '',
      productId: '',
    };
  }
  if (s.bannerRightEnabled && !s.sideBanners.right[0].enabled && !s.sideBanners.right[0].image && !s.sideBanners.right[0].video && !s.sideBanners.right[0].text) {
    s.sideBanners.right[0] = {
      enabled: true,
      image: s.bannerRightImage || '',
      video: s.bannerRightVideo || '',
      text: s.bannerRightText || '',
      link: s.bannerRightLink || '',
      productId: '',
    };
  }
  // heroBanner — про всяк випадок дефолтуємо
  if (!s.heroBanner || typeof s.heroBanner !== 'object') {
    s.heroBanner = { ...DEFAULT_SETTINGS.heroBanner };
  }
  return s;
}

export async function saveSettings(env, settings) {
  await env.SHOP_KV.put('settings', JSON.stringify(settings));
  await bumpShopVersion(env);
  await invalidateShopCache(env);
}

// Надсилання SMS клієнту. Провайдер обирається в settings.smsProvider. Повертає { ok, id?, error? }.
// === Секретне посилання відстеження (/track?t=...) ===
// Токен виводиться з секрету + id + телефону (SHA-256), тому НЕ потребує міграції
// старих замовлень — працює для всіх, включно зі старими. Секрет генерується один раз
// і зберігається в settings (публічно НЕ віддається — див. SECRET_FIELDS в api/shop.js).
export async function getTrackSecret(env) {
  const s = await getSettings(env);
  if (s.trackSecret) return s.trackSecret;
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const secret = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
  s.trackSecret = secret;
  try { await saveSettings(env, s); } catch {}
  return secret;
}

export async function trackTokenFor(secret, order) {
  const phoneDigits = String(order.phone || '').replace(/\D/g, '');
  const data = new TextEncoder().encode(`${secret}|${order.id}|${phoneDigits}`);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

export async function sendSms(settings, phone, text) {
  const num = (phone || '').replace(/\D/g, '');
  if (!num) return { ok: false, error: 'Порожній номер телефону' };
  const provider = (settings.smsProvider || 'turbosms').trim();
  const token = (settings.smsApiToken || '').trim();
  const sender = (settings.smsSender || '').trim();
  try {
    if (provider === 'turbosms') {
      if (!token || !sender) return { ok: false, error: 'TurboSMS: потрібні токен і імʼя відправника' };
      const res = await fetch('https://api.turbosms.ua/message/send.json', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipients: [num], sms: { sender, text } }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d.response_code === 0) return { ok: true, id: d.response_result?.[0]?.message_id };
      return { ok: false, error: d.response_status || d.message || ('HTTP ' + res.status) };
    }
    if (provider === 'smsclub') {
      if (!token || !sender) return { ok: false, error: 'SMSClub: потрібні токен і імʼя відправника' };
      const res = await fetch('https://im.smsclub.mobi/sms/send', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: [num], message: text, src_addr: sender }),
      });
      const d = await res.json().catch(() => ({}));
      const info = d.success_request?.info;
      if (res.ok && info) return { ok: true, id: Object.keys(info)[0] };
      return { ok: false, error: d.message || d.error || ('HTTP ' + res.status) };
    }
    if (provider === 'twilio') {
      const sid = (settings.smsAccountSid || '').trim();
      if (!sid || !token || !sender) return { ok: false, error: 'Twilio: потрібні Account SID, Auth Token і From-номер' };
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: 'POST',
        headers: { 'Authorization': 'Basic ' + btoa(`${sid}:${token}`), 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ From: sender, To: '+' + num, Body: text }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d.sid) return { ok: true, id: d.sid };
      return { ok: false, error: d.message || ('HTTP ' + res.status) };
    }
    return { ok: false, error: 'Невідомий SMS-провайдер: ' + provider };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function getProducts(env) {
  if (!env.SHOP_KV) return DEFAULT_PRODUCTS;
  try {
    const stored = await env.SHOP_KV.get('products', 'json');
    return Array.isArray(stored) ? stored : DEFAULT_PRODUCTS;
  } catch {
    return DEFAULT_PRODUCTS;
  }
}

export async function saveProducts(env, products) {
  await env.SHOP_KV.put('products', JSON.stringify(products));
  await bumpShopVersion(env);
  await invalidateShopCache(env);
}

// Версія публічних даних магазину — оновлюється при будь-якій зміні settings/products.
// Використовується frontend-ом для швидкої перевірки "чи змінились дані".
export async function bumpShopVersion(env) {
  if (!env.SHOP_KV) return;
  try {
    await env.SHOP_KV.put('shop_version', String(Date.now()));
    // Інвалідуємо CDN-кеш версії та повного shop
    const cache = caches.default;
    await cache.delete(new Request('https://internal-cache/shop-version', { method: 'GET' }));
  } catch {}
}
export async function getShopVersion(env) {
  if (!env.SHOP_KV) return '0';
  try { return (await env.SHOP_KV.get('shop_version')) || '0'; } catch { return '0'; }
}

// === Заказы — храним в KV ===
// Ключ: order_<paddedTimestamp>_<orderId>. Padding важен для сортировки KV list по дате.
function paddedTs() {
  return String(Date.now()).padStart(15, '0');
}
export async function saveOrder(env, order) {
  if (!env.SHOP_KV) return;
  const key = `order_${paddedTs()}_${order.id}`;
  order.kvKey = key;
  // Храним заказы 1 год по TTL — чтобы не разрастались
  await env.SHOP_KV.put(key, JSON.stringify(order), { expirationTtl: 365 * 24 * 60 * 60 });
  // Обновляем счётчик непрочитанных (чтобы /api/admin/orders-stats не делал list)
  await bumpOrderMeta(env, { newUnread: true, latest: order });
}

// Метаданные заказов в одном ключе — для быстрого опроса без list().
// { total, unread, lastOrderId, latestUnread: {...} }
export async function getOrderMeta(env) {
  if (!env.SHOP_KV) return { total: 0, unread: 0, latestUnread: null };
  try {
    const m = await env.SHOP_KV.get('order_meta', 'json');
    return m || { total: 0, unread: 0, latestUnread: null };
  } catch { return { total: 0, unread: 0, latestUnread: null }; }
}
export async function saveOrderMeta(env, meta) {
  if (!env.SHOP_KV) return;
  await env.SHOP_KV.put('order_meta', JSON.stringify(meta));
}
export async function bumpOrderMeta(env, { newUnread = false, markedRead = false, deleted = false, latest = null }) {
  const meta = await getOrderMeta(env);
  if (newUnread) {
    meta.unread = (meta.unread || 0) + 1;
    meta.total = (meta.total || 0) + 1;
    if (latest) meta.latestUnread = {
      id: latest.id, customerName: latest.customerName, totalPrice: latest.totalPrice, kvKey: latest.kvKey,
    };
  }
  if (markedRead) meta.unread = Math.max(0, (meta.unread || 0) - 1);
  if (deleted) {
    meta.total = Math.max(0, (meta.total || 0) - 1);
    // Якщо deleted unread — рахуємо. Але в нас завжди deleted = full deletion, тож просто можемо decrement
    // Не ризикуємо — залишаємо unread без змін, він себе скорегує наступного перерахунку
  }
  await saveOrderMeta(env, meta);
  return meta;
}
// Перерахунок meta з повного списку (виклик нечасто, наприклад раз в день або вручну)
export async function recalcOrderMeta(env) {
  if (!env.SHOP_KV) return null;
  const list = await env.SHOP_KV.list({ prefix: 'order_', limit: 1000 });
  const keys = list.keys.filter(k => k.name !== 'order_meta').map(k => k.name);
  const orders = await Promise.all(keys.map(async k => {
    try { return await env.SHOP_KV.get(k, 'json'); } catch { return null; }
  }));
  const valid = orders.filter(Boolean);
  const unread = valid.filter(o => !o.isRead);
  const meta = {
    total: valid.length,
    unread: unread.length,
    latestUnread: unread[0] ? {
      id: unread[0].id, customerName: unread[0].customerName, totalPrice: unread[0].totalPrice, kvKey: unread[0].kvKey,
    } : null,
  };
  await saveOrderMeta(env, meta);
  return meta;
}
export async function listOrders(env, limit = 200) {
  if (!env.SHOP_KV) return [];
  const list = await env.SHOP_KV.list({ prefix: 'order_', limit });
  // Виключаємо службові ключі (order_meta, order_counter тощо).
  // Реальні замовлення мають формат order_<timestamp>_<id> — починаються з order_ + цифра.
  const keys = list.keys
    .map(k => k.name)
    .filter(name => /^order_\d/.test(name))
    .reverse();
  const orders = await Promise.all(keys.map(async k => {
    try { return await env.SHOP_KV.get(k, 'json'); } catch { return null; }
  }));
  return orders.filter(Boolean);
}
export async function getOrder(env, kvKey) {
  if (!env.SHOP_KV) return null;
  try { return await env.SHOP_KV.get(kvKey, 'json'); } catch { return null; }
}
export async function updateOrder(env, kvKey, patch) {
  const cur = await getOrder(env, kvKey);
  if (!cur) return null;
  const updated = { ...cur, ...patch };
  await env.SHOP_KV.put(kvKey, JSON.stringify(updated), { expirationTtl: 365 * 24 * 60 * 60 });
  // Якщо переходимо з непрочитаного у прочитане — зменшуємо лічильник
  if (!cur.isRead && updated.isRead) {
    await bumpOrderMeta(env, { markedRead: true });
  }
  return updated;
}
export async function deleteOrder(env, kvKey) {
  if (!env.SHOP_KV) return;
  try {
    const cur = await getOrder(env, kvKey);
    await env.SHOP_KV.delete(kvKey);
    if (cur) {
      await bumpOrderMeta(env, { deleted: true, markedRead: !cur.isRead });
    }
  } catch {}
}

// === Конфиг бота ===
// Хранится в KV под ключом 'bot'. Если в KV пусто — fallback на env-секреты.
// Так что можно менять токен через админку без редеплоя, но если в KV нет — берём из CF Secrets.
export async function getBotConfig(env) {
  let stored = null;
  if (env.SHOP_KV) {
    try { stored = await env.SHOP_KV.get('bot', 'json'); } catch {}
  }
  return {
    botToken: (stored?.botToken || env.BOT_TOKEN || '').trim(),
    chatId: (stored?.chatId || env.CHAT_ID || '').toString().trim(),
  };
}

export async function saveBotConfig(env, cfg) {
  if (!env.SHOP_KV) throw new Error('KV не настроен');
  await env.SHOP_KV.put('bot', JSON.stringify({
    botToken: (cfg.botToken || '').trim(),
    chatId: (cfg.chatId || '').toString().trim(),
  }));
}

export function validateProduct(p) {
  if (!p || typeof p !== 'object') return 'Товар має бути обʼєктом';
  if (!p.id || !/^[a-z0-9_-]+$/i.test(p.id)) return 'Некоректний id';
  if (!p.name || typeof p.name !== 'string' || p.name.length > 200) return 'Некоректна назва';
  if (!Number.isFinite(p.price) || p.price < 0 || p.price > 1000000) return 'Некоректна ціна';
  if (p.image && typeof p.image === 'string' && p.image.length > 5_000_000) return 'Картинка завелика';
  if (Array.isArray(p.images)) {
    if (p.images.length > 12) return 'Забагато картинок (макс 12)';
    for (const img of p.images) {
      // Підтримуємо обидва формати: рядок (URL) і обʼєкт {url, zoomable, link}
      if (typeof img === 'string') {
        if (img.length > 5_000_000) return 'Картинка завелика';
      } else if (img && typeof img === 'object') {
        if (typeof img.url !== 'string' || img.url.length > 5_000_000) return 'Картинка завелика';
        if (img.link && typeof img.link === 'string' && img.link.length > 500) return 'Посилання на картинці зашироке';
      } else {
        return 'Некоректний формат картинки';
      }
    }
  }
  if (p.video && (typeof p.video !== 'string' || p.video.length > 500)) return 'Некоректний URL відео';
  if (Array.isArray(p.attributes)) {
    if (p.attributes.length > 30) return 'Забагато характеристик';
    for (const a of p.attributes) {
      if (typeof a?.label !== 'string' || typeof a?.value !== 'string') return 'Некоректна характеристика';
      if (a.label.length > 100 || a.value.length > 500) return 'Задовга характеристика';
    }
  }
  return null;
}

// Генерируем уникальный id товара на основе имени + случайного хвоста
export function genProductId(name) {
  const slug = String(name || '')
    .toLowerCase()
    .replace(/[^a-zа-яё0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);
  const tail = Math.random().toString(36).slice(2, 6);
  return (slug || 'product') + '-' + tail;
}

// Авторизация админки (как в проекте печати)
export async function getEffectivePassword(env) {
  // Читаємо тільки з KV (на free tier KV має eventual consistency до 60 сек між регіонами).
  if (env.SHOP_KV) {
    try {
      const stored = await env.SHOP_KV.get('admin_password_override');
      if (stored && stored.length >= 6) return stored.trim();
    } catch {}
  }
  // Якщо колись був встановлений override — НЕ повертаємось до env.ADMIN_PASSWORD
  // (інакше старий env-пароль почне знову працювати після /reset).
  const revoked = await getPasswordRevocationTime(env);
  if (revoked > 0) {
    return '';
  }
  return (env.ADMIN_PASSWORD || '').trim();
}

export async function setPasswordOverride(env, newPassword) {
  if (!env.SHOP_KV) throw new Error('KV не настроен');
  if (!newPassword || newPassword.length < 8) throw new Error('Пароль должен быть не короче 8 символов');
  const trimmed = newPassword.trim();
  const ts = Date.now();
  await env.SHOP_KV.put('admin_password_override', trimmed);
  await env.SHOP_KV.put('admin_password_revoked_at', String(ts));
}

export async function clearPasswordOverride(env) {
  if (!env.SHOP_KV) return;
  try { await env.SHOP_KV.delete('admin_password_override'); } catch {}
  try { await env.SHOP_KV.delete('admin_password_revoked_at'); } catch {}
}

export function checkAuth(request, env) {
  // SYNC-версия используется как pre-filter; подробная проверка cookie — в checkAuthAsync.
  // Для backward compat оставляем синхронную проверку через env.ADMIN_PASSWORD.
  const expected = (env.ADMIN_PASSWORD || '').trim();
  if (!expected) return false;

  // 1. Cookie-сессия (приоритет — это основной способ)
  const cookies = parseCookies(request.headers.get('cookie') || '');
  const sessionCookie = cookies['admin_session'];
  if (sessionCookie && verifyAuthCookieSync(sessionCookie, expected)) return true;

  // 2. X-Admin-Key (для curl/скриптов)
  const key = request.headers.get('x-admin-key');
  if (key && safeEqual(key, expected)) return true;

  // 3. Basic Auth (legacy fallback)
  const auth = request.headers.get('authorization');
  if (auth && auth.startsWith('Basic ')) {
    try {
      const decoded = atob(auth.slice(6));
      const [, pwd] = decoded.split(':');
      if (pwd && safeEqual(pwd, expected)) return true;
    } catch {}
  }
  return false;
}

function parseCookies(str) {
  const out = {};
  for (const part of String(str || '').split(/;\s*/)) {
    if (!part) continue;
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

// Cookie-токен формата: <ts>.<sig>, где sig = HMAC-SHA256(ts, ADMIN_PASSWORD).
// При смене пароля все старые сессии автоматически инвалидируются.
const SESSION_MAX_AGE_SEC = 30 * 24 * 60 * 60; // 30 дней

export async function makeAuthCookie(env) {
  const expected = await getEffectivePassword(env);
  const ts = Date.now();
  const sig = await hmacB64(String(ts), expected);
  return `${ts}.${sig}`;
}

export function buildSessionSetCookie(value) {
  return `admin_session=${value}; Path=/; Max-Age=${SESSION_MAX_AGE_SEC}; HttpOnly; Secure; SameSite=Strict`;
}

// Cookie без Max-Age — живе тільки до закриття браузера (session cookie).
// Використовується коли `requirePasswordEachSession` увімкнено в settings.
export function buildSessionOnlyCookie(value) {
  return `admin_session=${value}; Path=/; HttpOnly; Secure; SameSite=Strict`;
}

// Будує Set-Cookie з урахуванням налаштування requirePasswordEachSession
export async function buildSessionCookieFromSettings(env, value) {
  try {
    const s = await getSettings(env);
    if (s.requirePasswordEachSession) return buildSessionOnlyCookie(value);
  } catch {}
  return buildSessionSetCookie(value);
}

// Сповіщення в Telegram про успішний вхід в адмінку
export async function notifyAdminLogin(env, ip, userAgent) {
  try {
    const s = await getSettings(env);
    if (s.loginNotifyEnabled === false) return;
    const bot = await getBotConfig(env);
    if (!bot.botToken || !bot.chatId) return;
    const ua = String(userAgent || '').slice(0, 200);
    const date = new Date().toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv' });
    const text = `🔓 *Вхід в адмінку*\n\n📅 ${date}\n🌐 IP: \`${ip || 'невідомо'}\`\n💻 ${ua || 'невідомо'}\n\nЯкщо це не ви — негайно змініть пароль!`;
    await fetch(`https://api.telegram.org/bot${bot.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: bot.chatId, text, parse_mode: 'Markdown' }),
    });
  } catch {}
}

export function buildLogoutSetCookie() {
  return `admin_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

// Синхронная проверка cookie. Так как HMAC subtleCrypto асинхронный, кешируем результат
// проверки в простом WeakMap нельзя (request — fresh каждый раз). Поэтому делаем
// помощник с pre-computed подписью при login и проверкой при verify через crypto.
// Реализуем через async-вариант checkAuthAsync ниже; sync-версия выше используется для совместимости.
function verifyAuthCookieSync(value, secret) {
  // НЕ настоящая верификация — только грубый пред-фильтр.
  // Реальная асинхронная верификация делается в checkAuthAsync.
  // Здесь возвращаем false чтобы заставить вызывать checkAuthAsync везде где нужно cookie.
  return false;
}

// Асинхронная проверка авторизации с поддержкой cookie. Используется в эндпоинтах.
export async function checkAuthAsync(request, env) {
  const expected = await getEffectivePassword(env);
  if (!expected) return false;

  const cookies = parseCookies(request.headers.get('cookie') || '');
  const sessionCookie = cookies['admin_session'];
  if (sessionCookie) {
    const ok = await verifyAuthCookieAsync(sessionCookie, expected, env);
    if (ok) return true;
  }

  // X-Admin-Key
  const key = request.headers.get('x-admin-key');
  if (key && safeEqual(key, expected)) return true;

  // Basic Auth (legacy)
  const auth = request.headers.get('authorization');
  if (auth && auth.startsWith('Basic ')) {
    try {
      const decoded = atob(auth.slice(6));
      const [, pwd] = decoded.split(':');
      if (pwd && safeEqual(pwd, expected)) return true;
    } catch {}
  }
  return false;
}

async function verifyAuthCookieAsync(value, secret, env) {
  const [ts, sig] = String(value || '').split('.');
  if (!ts || !sig) return false;
  const expectedSig = await hmacB64(ts, secret);
  if (expectedSig.length !== sig.length) return false;
  let r = 0;
  for (let i = 0; i < sig.length; i++) r |= sig.charCodeAt(i) ^ expectedSig.charCodeAt(i);
  if (r !== 0) return false;
  const cookieTs = parseInt(ts, 10);
  const age = Date.now() - cookieTs;
  if (!Number.isFinite(age) || age < 0 || age > SESSION_MAX_AGE_SEC * 1000) return false;
  // Перевірка: чи створено cookie ПІСЛЯ останньої зміни пароля?
  if (env) {
    const revokedAt = await getPasswordRevocationTime(env);
    if (revokedAt && cookieTs < revokedAt) return false;
  }
  return true;
}

// Часова мітка останньої зміни пароля. Кукі видані ДО цієї мітки — невалідні.
// Зберігається в Cache API (per-colo, миттєво) + KV (постійно, 60с propagation).
export async function getPasswordRevocationTime(env) {
  if (env.SHOP_KV) {
    try {
      const stored = await env.SHOP_KV.get('admin_password_revoked_at');
      if (stored) {
        const n = parseInt(stored, 10);
        if (Number.isFinite(n) && n > 0) return n;
      }
    } catch {}
  }
  return 0;
}

async function setPasswordRevocationTime(env, ts) {
  if (env.SHOP_KV) {
    try { await env.SHOP_KV.put('admin_password_revoked_at', String(ts)); } catch {}
  }
}

async function hmacB64(message, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(String(message)));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export function unauthorized() {
  return new Response(JSON.stringify({ ok: false, error: 'Не авторизовано' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export function escapeMd(text) {
  return String(text ?? '').replace(/([_*`\[\]])/g, '\\$1');
}

// Екранує HTML-небезпечні символи для безпечного вставлення в HTML
export function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

export function jsonResp(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders },
  });
}

// Інвалідація кешу /api/admin/orders після мутацій (delete/update)
export async function invalidateOrdersCache() {
  try {
    const cache = caches.default;
    const cacheKey = new Request('https://internal-cache/orders-list', { method: 'GET' });
    await cache.delete(cacheKey);
  } catch {}
}

// Повертає основний домен сайту з settings, або fallback 'agprnt.com'.
// Використовується скрізь де потрібен домен у URL (purge, webhook, redirect).
export async function getPrimaryDomain(env) {
  try {
    const s = await getSettings(env);
    const d = (s.primaryDomain || '').trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (d) return d;
  } catch {}
  return 'agprnt.com';
}

// Інвалідація CDN-кешу /api/shop після зміни settings/products
export async function invalidateShopCache(env) {
  // Глобальний purge через CF API (всі колонки одночасно).
  // Якщо токен не налаштовано — graceful fallback (нічого не робимо).
  if (env) {
    try {
      const domain = await getPrimaryDomain(env);
      await purgeCfCache(env, [
        `https://${domain}/api/shop`,
        `https://${domain}/api/shop-version`,
      ]);
    } catch {}
  }
}

// Глобальний purge cache в Cloudflare (всі колонки одночасно).
// Потрібен cfApiToken з permission Zone:Cache Purge:Edit та cfZoneId.
// Якщо не налаштовано — просто нічого не робимо (graceful fallback).
export async function purgeCfCache(env, urls) {  try {
    const settings = await getSettings(env);
    const token = (settings.cfApiToken || '').trim();
    const zoneId = (settings.cfZoneId || '').trim();
    if (!token || !zoneId) return false;
    const r = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ files: urls }),
    });
    const j = await r.json();
    return !!j.success;
  } catch {
    return false;
  }
}

// Сповіщення в Telegram про досягнення ліміту Cloudflare.
// Захист від спаму — налаштовується в settings.limitNotifyIntervalMin.
// Можна вимкнути в settings.limitNotifyEnabled.
export async function notifyLimitHit(env, kind, errorMessage) {
  try {
    // Перевіряємо чи увімкнено сповіщення
    let intervalMin = 60;
    let enabled = true;
    try {
      const settings = await getSettings(env);
      enabled = settings.limitNotifyEnabled !== false;
      intervalMin = parseInt(settings.limitNotifyIntervalMin, 10) || 60;
    } catch {
      // Якщо settings недоступні (KV в лімітах) — все одно надсилаємо
    }
    if (!enabled) return;

    const cache = caches.default;
    const guardKey = new Request(`https://internal-cache/limit-notify-${kind}`, { method: 'GET' });
    const cached = await cache.match(guardKey);
    if (cached) return; // ще в межах інтервалу

    const bot = await getBotConfig(env);
    if (!bot.botToken || !bot.chatId) return;

    const labels = {
      'kv-write': 'KV writes (1000/день)',
      'kv-read': 'KV reads (100 000/день)',
      'kv-list': 'KV lists (1000/день)',
      'kv-delete': 'KV deletes (1000/день)',
      'r2-storage': 'R2 storage (10 GB)',
      'unknown': 'невідомий ліміт',
    };
    const label = labels[kind] || labels.unknown;
    const time = new Date().toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv' });

    const text = `⚠️ *AGPRNT: вичерпано ліміт Cloudflare*\n\n` +
      `*Тип:* ${label}\n` +
      `*Час:* ${time}\n` +
      `*Помилка:* \`${(errorMessage || '').slice(0, 200)}\`\n\n` +
      `*Що це значить:*\n` +
      `${kind === 'kv-write' ? '— Нові замовлення можуть не зберігатись в адмінку (Telegram отримає!)' : ''}\n` +
      `${kind === 'kv-list' ? '— Адмінка /admin/orders/ може не оновлюватись' : ''}\n` +
      `${kind === 'kv-read' ? '— Сайт може не завантажувати товари клієнтам' : ''}\n` +
      `${kind === 'r2-storage' ? '— Не можна завантажувати нові файли' : ''}\n\n` +
      `*Що робити:*\n` +
      `1. Зачекати до 02:00 (Київ) — ліміти скинуться\n` +
      `2. Або підключити Workers Paid $5/міс — знімає всі ліміти\n` +
      `3. Dashboard: https://dash.cloudflare.com → Plans\n\n` +
      `_Наступне сповіщення цього типу — через ${intervalMin} хв (якщо ліміт ще не скинеться)._`;

    await fetch(`https://api.telegram.org/bot${bot.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: bot.chatId, text, parse_mode: 'Markdown' }),
    });

    // Ставимо guard на N хвилин зі ВСІМА деталями (для відображення банера в адмінці)
    const guardData = JSON.stringify({
      kind, label, errorMessage: (errorMessage || '').slice(0, 200),
      hitAt: Date.now(),
    });
    const guardResp = new Response(guardData, {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': `public, max-age=${intervalMin * 60}`,
      },
    });
    await cache.put(guardKey, guardResp);
  } catch {}
}

// Отримати поточний стан лімітів — для банера в адмінці
export async function getLimitStatus() {
  const cache = caches.default;
  const kinds = ['kv-write', 'kv-read', 'kv-list', 'kv-delete', 'r2-storage'];
  const active = [];
  for (const kind of kinds) {
    try {
      const cached = await cache.match(new Request(`https://internal-cache/limit-notify-${kind}`, { method: 'GET' }));
      if (cached) {
        const body = await cached.text();
        try {
          const data = JSON.parse(body);
          // Розраховуємо коли мине (UTC midnight = 02:00 Kyiv для денних лімітів)
          const now = new Date();
          const tomorrow = new Date(now);
          tomorrow.setUTCHours(24, 0, 0, 0);
          active.push({
            kind: data.kind || kind,
            label: data.label || kind,
            errorMessage: data.errorMessage || '',
            hitAt: data.hitAt || 0,
            resetsAt: tomorrow.getTime(),
          });
        } catch {
          // Старий формат guard ('1') — все одно показуємо
          active.push({ kind, label: kind, errorMessage: '', hitAt: 0, resetsAt: 0 });
        }
      }
    } catch {}
  }
  return active;
}

// Класифікація помилки KV/R2 за текстом
export function classifyLimitError(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  if (msg.includes('list() limit') || msg.includes('list limit')) return 'kv-list';
  if (msg.includes('write') && msg.includes('limit')) return 'kv-write';
  if (msg.includes('read') && msg.includes('limit')) return 'kv-read';
  if (msg.includes('delete') && msg.includes('limit')) return 'kv-delete';
  if (msg.includes('limit exceeded for the day')) return 'kv-write'; // generic
  if (msg.includes('storage') && msg.includes('quota')) return 'r2-storage';
  return null; // не помилка ліміту — не сповіщаємо
}
