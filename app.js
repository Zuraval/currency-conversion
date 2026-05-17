/**
 * app.js — логика интерфейса валютного конвертера
 *
 * Ответственности:
 *  - Инициализация и заполнение селектов
 *  - Реактивный пересчёт при изменении суммы / валют
 *  - Отображение популярных пар
 *  - История последних 10 конвертаций (с localStorage)
 *  - Авто-обновление курсов раз в 10 минут
 */

// ── DOM-элементы ──────────────────────────────────────
const $ = id => document.getElementById(id);

const amountInput   = $('amountInput');
const fromSelect    = $('fromCurrency');
const toSelect      = $('toCurrency');
const swapBtn       = $('swapBtn');
const resultDisplay = $('resultDisplay');
const rateDisplay   = $('rateDisplay');
const statusBar     = $('statusBar');
const statusText    = $('statusText');
const updateTime    = $('updateTime');
const ratesGrid     = $('ratesGrid');
const historySection= $('historySection');
const historyList   = $('historyList');
const clearHistory  = $('clearHistory');

// ── Глобальное состояние ──────────────────────────────
let state = {
  rates:     null,   // объект курсов с базой USD
  source:    null,   // 'cache' | 'live' | 'fallback'
  timestamp: null,
  history:   [],     // [{from, to, amount, result, time}]
};

const POPULAR_PAIRS = [
  ['USD', 'EUR'], ['USD', 'RUB'], ['EUR', 'RUB'],
  ['USD', 'GBP'], ['USD', 'CNY'], ['EUR', 'GBP'],
  ['USD', 'JPY'], ['USD', 'TRY'], ['EUR', 'TRY'],
  ['USD', 'KZT'], ['USD', 'AED'], ['GBP', 'EUR'],
];

// ── Форматирование ────────────────────────────────────

function formatAmount(n, currency) {
  if (n === null || !isFinite(n)) return '—';
  const abs = Math.abs(n);
  const opts = {
    minimumFractionDigits: abs >= 1000 ? 0 : abs >= 10 ? 2 : 4,
    maximumFractionDigits: abs >= 1000 ? 0 : abs >= 10 ? 2 : 4,
  };
  return n.toLocaleString('ru-RU', opts) + ' ' + currency;
}

function formatTime(ts) {
  if (!ts) return 'резервные данные';
  const d = new Date(ts);
  return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function currencyLabel(code) {
  const c = RatesProvider.CURRENCIES.find(x => x.code === code);
  return c ? `${c.flag} ${code}` : code;
}

// ── Заполнение селектов ───────────────────────────────

function populateSelects() {
  const currencies = RatesProvider.CURRENCIES;
  [fromSelect, toSelect].forEach((sel, i) => {
    sel.innerHTML = '';
    currencies.forEach(({ code, flag, name }) => {
      const opt = document.createElement('option');
      opt.value = code;
      opt.textContent = `${flag} ${code} — ${name}`;
      sel.appendChild(opt);
    });
    // Дефолты: из USD в RUB
    sel.value = i === 0 ? 'USD' : 'RUB';
  });
}

// ── Пересчёт ──────────────────────────────────────────

function recalculate() {
  const amount = parseFloat(amountInput.value);
  const from   = fromSelect.value;
  const to     = toSelect.value;

  if (!state.rates || isNaN(amount) || amount < 0) {
    resultDisplay.textContent = '—';
    rateDisplay.textContent   = '';
    return;
  }

  resultDisplay.classList.add('loading');

  const result   = RatesProvider.convert(amount, from, to, state.rates);
  const unitRate = RatesProvider.convert(1,      from, to, state.rates);

  resultDisplay.classList.remove('loading');
  resultDisplay.textContent = formatAmount(result, to);
  rateDisplay.textContent   = `1 ${from} = ${unitRate} ${to}`;

  // Добавляем в историю при осмысленной сумме
  if (amount > 0 && result !== null) {
    addToHistory({ from, to, amount, result });
  }
}

// ── История ───────────────────────────────────────────

const HISTORY_KEY = 'currency_history_v1';

function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    state.history = raw ? JSON.parse(raw) : [];
  } catch {
    state.history = [];
  }
  renderHistory();
}

function addToHistory(entry) {
  // Дедупликация: не добавляем, если последняя запись идентична
  const last = state.history[0];
  if (last &&
      last.from   === entry.from &&
      last.to     === entry.to   &&
      last.amount === entry.amount) return;

  state.history.unshift({ ...entry, time: Date.now() });
  if (state.history.length > 10) state.history.pop();
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(state.history)); } catch {}
  renderHistory();
}

function renderHistory() {
  const items = state.history;
  historySection.style.display = items.length ? '' : 'none';
  historyList.innerHTML = '';

  items.forEach(({ from, to, amount, result, time }) => {
    const li = document.createElement('li');
    li.className = 'history-item';
    li.innerHTML = `
      <span class="history-from">${formatAmount(amount, from)}</span>
      <span class="history-arrow">→</span>
      <span class="history-to">${formatAmount(result, to)}</span>
      <span class="history-time">${formatTime(time)}</span>`;
    historyList.appendChild(li);
  });
}

// ── Популярные пары ───────────────────────────────────

function renderRatesGrid() {
  if (!state.rates) return;
  ratesGrid.innerHTML = '';

  POPULAR_PAIRS.forEach(([from, to]) => {
    const rate = RatesProvider.convert(1, from, to, state.rates);
    if (rate === null) return;

    const card = document.createElement('div');
    card.className = 'rate-card';

    // Псевдо-изменение: небольшой случайный шум для демонстрации
    // В реальном приложении здесь был бы yesterday's rate из API
    const fakeChange = ((Math.sin(from.charCodeAt(0) * to.charCodeAt(1)) * 2.3)).toFixed(2);
    const sign       = fakeChange >= 0 ? '+' : '';
    const cls        = fakeChange >= 0 ? 'up' : 'down';

    card.innerHTML = `
      <div class="rate-pair">${from} / ${to}</div>
      <div class="rate-value">${rate}</div>
      <div class="rate-change ${cls}">${sign}${fakeChange}%</div>`;

    // Клик по карточке → подставить валютную пару в конвертер
    card.addEventListener('click', () => {
      fromSelect.value = from;
      toSelect.value   = to;
      recalculate();
      amountInput.focus();
    });

    ratesGrid.appendChild(card);
  });
}

// ── Статус ────────────────────────────────────────────

function setStatus(msg, type = '') {
  statusText.textContent = msg;
  statusBar.className    = 'status-bar' + (type ? ` ${type}` : '');
}

// ── Загрузка курсов ───────────────────────────────────

async function loadRates() {
  setStatus('Загрузка курсов...');
  resultDisplay.classList.add('loading');

  try {
    const { rates, source, timestamp } = await RatesProvider.get('USD');
    state.rates     = rates;
    state.source    = source;
    state.timestamp = timestamp;

    const sourceLabel = {
      live:     '✓ Актуальные курсы',
      cache:    '◷ Из кэша',
      fallback: '⚠ Резервные данные (офлайн)',
    }[source] || source;

    const timeLabel = timestamp ? `, обновлено в ${formatTime(timestamp)}` : '';
    setStatus(sourceLabel + timeLabel, source === 'fallback' ? 'error' : 'ok');
    updateTime.textContent = 'обновлено ' + formatTime(timestamp || Date.now());

    renderRatesGrid();
    recalculate();
  } catch (err) {
    setStatus('Ошибка загрузки курсов: ' + err.message, 'error');
    resultDisplay.classList.remove('loading');
  }
}

// ── Авто-обновление ───────────────────────────────────

function scheduleAutoRefresh() {
  // Обновляем каждые 10 минут, предварительно очистив кэш
  setInterval(() => {
    loadRates();
  }, 10 * 60 * 1000);
}

// ── Подписка на события ───────────────────────────────

function bindEvents() {
  // Пересчёт при изменении суммы с дебаунсом
  let debounceTimer;
  amountInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(recalculate, 200);
  });

  fromSelect.addEventListener('change', recalculate);
  toSelect.addEventListener('change', recalculate);

  // Быстрые суммы
  document.querySelectorAll('.quick-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      amountInput.value = btn.dataset.amount;
      recalculate();
    });
  });

  // Swap
  swapBtn.addEventListener('click', () => {
    const tmp        = fromSelect.value;
    fromSelect.value = toSelect.value;
    toSelect.value   = tmp;
    swapBtn.classList.add('spinning');
    setTimeout(() => swapBtn.classList.remove('spinning'), 350);
    recalculate();
  });

  // Очистить историю
  clearHistory.addEventListener('click', () => {
    state.history = [];
    try { localStorage.removeItem(HISTORY_KEY); } catch {}
    renderHistory();
  });
}

// ── Точка входа ───────────────────────────────────────

async function init() {
  populateSelects();
  bindEvents();
  loadHistory();
  await loadRates();
  scheduleAutoRefresh();
}

init();
