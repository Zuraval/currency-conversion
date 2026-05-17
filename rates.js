/**
 * rates.js — модуль получения курсов валют
 *
 * Стратегия:
 *  1. Проверяем localStorage-кэш (TTL 10 минут)
 *  2. При промахе → fetchLive() через open API
 *  3. При ошибке сети → возвращаем FALLBACK-курсы с пометкой
 *
 * Экспортирует:
 *  - RatesProvider.get(base)  → Promise<{ rates, source, timestamp }>
 *  - RatesProvider.convert(amount, from, to, rates) → number
 *  - RatesProvider.CURRENCIES → массив поддерживаемых валют
 */

const RatesProvider = (() => {

  const CACHE_KEY  = 'currency_rates_v2';
  const CACHE_TTL  = 10 * 60 * 1000; // 10 минут
  const API_URL    = 'https://api.exchangerate-api.com/v4/latest/';

  // Резервные курсы (относительно USD) на случай отсутствия сети
  const FALLBACK_RATES_USD = {
    USD: 1,    EUR: 0.921, GBP: 0.786, RUB: 91.2,
    CNY: 7.24, JPY: 149.5, TRY: 32.1,  KZT: 449,
    BYN: 3.27, UAH: 39.8,  INR: 83.1,  CHF: 0.897,
    CAD: 1.363, AUD: 1.527, NOK: 10.55, SEK: 10.42,
    PLN: 3.96,  CZK: 22.9,  BRL: 4.97,  MXN: 17.12,
    AED: 3.673, SAR: 3.751, HKD: 7.822, SGD: 1.344,
    KRW: 1327,  ZAR: 18.63, THB: 35.1,  IDR: 15685,
  };

  const CURRENCIES = [
    { code: 'USD', flag: '🇺🇸', name: 'Доллар США' },
    { code: 'EUR', flag: '🇪🇺', name: 'Евро' },
    { code: 'RUB', flag: '🇷🇺', name: 'Российский рубль' },
    { code: 'GBP', flag: '🇬🇧', name: 'Фунт стерлингов' },
    { code: 'CNY', flag: '🇨🇳', name: 'Китайский юань' },
    { code: 'JPY', flag: '🇯🇵', name: 'Японская иена' },
    { code: 'TRY', flag: '🇹🇷', name: 'Турецкая лира' },
    { code: 'KZT', flag: '🇰🇿', name: 'Казахский тенге' },
    { code: 'BYN', flag: '🇧🇾', name: 'Белорусский рубль' },
    { code: 'UAH', flag: '🇺🇦', name: 'Украинская гривна' },
    { code: 'CHF', flag: '🇨🇭', name: 'Швейцарский франк' },
    { code: 'CAD', flag: '🇨🇦', name: 'Канадский доллар' },
    { code: 'AUD', flag: '🇦🇺', name: 'Австралийский доллар' },
    { code: 'INR', flag: '🇮🇳', name: 'Индийская рупия' },
    { code: 'NOK', flag: '🇳🇴', name: 'Норвежская крона' },
    { code: 'SEK', flag: '🇸🇪', name: 'Шведская крона' },
    { code: 'PLN', flag: '🇵🇱', name: 'Польский злотый' },
    { code: 'BRL', flag: '🇧🇷', name: 'Бразильский реал' },
    { code: 'AED', flag: '🇦🇪', name: 'Дирхам ОАЭ' },
    { code: 'HKD', flag: '🇭🇰', name: 'Гонконгский доллар' },
    { code: 'SGD', flag: '🇸🇬', name: 'Сингапурский доллар' },
    { code: 'KRW', flag: '🇰🇷', name: 'Южнокорейская вона' },
    { code: 'THB', flag: '🇹🇭', name: 'Тайский бат' },
    { code: 'ZAR', flag: '🇿🇦', name: 'Южноафриканский рэнд' },
    { code: 'MXN', flag: '🇲🇽', name: 'Мексиканский песо' },
    { code: 'IDR', flag: '🇮🇩', name: 'Индонезийская рупия' },
    { code: 'CZK', flag: '🇨🇿', name: 'Чешская крона' },
    { code: 'SAR', flag: '🇸🇦', name: 'Саудовский риял' },
  ];

  /** Читаем кэш из localStorage */
  function readCache(base) {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const cache = JSON.parse(raw);
      const entry  = cache[base];
      if (!entry) return null;
      if (Date.now() - entry.timestamp > CACHE_TTL) return null;
      return entry;
    } catch {
      return null;
    }
  }

  /** Записываем в кэш */
  function writeCache(base, rates) {
    try {
      const raw   = localStorage.getItem(CACHE_KEY) || '{}';
      const cache = JSON.parse(raw);
      cache[base] = { rates, timestamp: Date.now() };
      // Храним не более 5 разных баз, чтобы не раздувать storage
      const keys = Object.keys(cache);
      if (keys.length > 5) delete cache[keys[0]];
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch { /* storage full или private mode */ }
  }

  /** Перебазирование курсов: переводим из базы source в базу target */
  function rebase(rates, fromBase, toBase) {
    if (fromBase === toBase) return rates;
    const factor = 1 / rates[toBase];
    const rebased = {};
    for (const [code, rate] of Object.entries(rates)) {
      rebased[code] = rate * factor;
    }
    rebased[fromBase] = factor;
    rebased[toBase]   = 1;
    return rebased;
  }

  /** Загружаем курсы по сети */
  async function fetchLive(base) {
    const resp  = await fetch(API_URL + base, { signal: AbortSignal.timeout(7000) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json  = await resp.json();
    return json.rates; // объект { EUR: x, ... }
  }

  /**
   * Основная точка входа.
   * Возвращает { rates, source, timestamp }
   * source: 'cache' | 'live' | 'fallback'
   */
  async function get(base = 'USD') {
    // 1. Кэш
    const cached = readCache(base);
    if (cached) {
      return { rates: cached.rates, source: 'cache', timestamp: cached.timestamp };
    }

    // 2. Сеть
    try {
      // Запрашиваем USD как pivot, потом перебазируем — экономит запросы
      let rates;
      if (base === 'USD') {
        rates = await fetchLive('USD');
      } else {
        // Если валюта отсутствует в API, запрашиваем USD и пересчитываем
        const usdRates = readCache('USD');
        if (usdRates) {
          rates = rebase({ USD: 1, ...usdRates.rates }, 'USD', base);
        } else {
          rates = await fetchLive(base);
        }
      }
      rates[base] = 1; // собственная валюта = 1
      writeCache(base, rates);
      return { rates, source: 'live', timestamp: Date.now() };
    } catch (_err) {
      // 3. Fallback
      const rates = rebase(FALLBACK_RATES_USD, 'USD', base);
      return { rates, source: 'fallback', timestamp: null };
    }
  }

  /**
   * Конвертация суммы amount из from в to.
   * Нетривиальная логика: cross-rate через кэшированный pivot USD,
   * с округлением зависящим от масштаба результата.
   */
  function convert(amount, from, to, rates) {
    if (!rates || from === to) return amount;
    const fromRate = rates[from];
    const toRate   = rates[to];
    if (!fromRate || !toRate) return null;
    const result = (amount / fromRate) * toRate;
    return smartRound(result);
  }

  /** Умное округление: чем крупнее число — тем меньше знаков после запятой */
  function smartRound(n) {
    if (!isFinite(n)) return n;
    const abs = Math.abs(n);
    if (abs === 0)       return 0;
    if (abs >= 100000)   return Math.round(n);
    if (abs >= 10000)    return Math.round(n * 10)   / 10;
    if (abs >= 1000)     return Math.round(n * 100)  / 100;
    if (abs >= 10)       return Math.round(n * 1000) / 1000;
    return Math.round(n * 10000) / 10000;
  }

  return { get, convert, CURRENCIES, rebase, smartRound };
})();
