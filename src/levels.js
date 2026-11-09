const { fetchPrevDayOHLC } = require('./twse');
const { calcPivotPoints, calcStopLoss } = require('./pivotPoints');
const { loadNameMap, stockLabel } = require('./stockNames');
const { describeFetchError } = require('./fetchError');
const { fetchLatestBar } = require('./dailyBarSources');
const { loadRecentDays } = require('../backtest/loadCache');
const { backfillRecentDays } = require('../backtest/backfillHistory');

// 最近一個完整交易日的 OHLC 來源（全部都要能快速失敗：LINE 回覆約 1 分鐘內就要送出）：
//   A. 本機行情快取（全市場；背景更新，不等它）
//   B. 證交所 OpenAPI STOCK_DAY_ALL（全市場一次請求，結果暫存 10 分鐘，失敗後 10 分鐘內不再試）
//   C. 非證交所備援 Yahoo／FinMind／鉅亨網（逐檔，見 dailyBarSources.js）
//   D. 證交所 STOCK_DAY（逐檔，最後手段，失敗後 10 分鐘內不再試）
// 證交所連得上（B 成功）時：A、B 取日期較新者 → C → D。
// 證交所連不上（B 失敗）時：快取多半也停在好幾天前，改成 C 優先 → A → D。
const REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const COOLDOWN_MS = 10 * 60 * 1000;
const OPENAPI_URL = 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL';

let lastCacheRefresh = 0;
let cacheRefreshing = null;
let openApiMemo = { at: 0, data: null, failedAt: 0 };
let openApiFetching = null;
let stockDayFailedAt = 0;

// 背景更新快取，呼叫端不等它（證交所連不上時回補要好幾十秒才會放棄）
function refreshCacheInBackground() {
  if (cacheRefreshing || Date.now() - lastCacheRefresh < REFRESH_INTERVAL_MS) return;
  cacheRefreshing = backfillRecentDays(5)
    .catch((err) => console.error('[levels] 行情快取更新失敗:', describeFetchError(err)))
    .finally(() => {
      lastCacheRefresh = Date.now();
      cacheRefreshing = null;
    });
}

function num(s) {
  const n = parseFloat(String(s).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

// 回傳 { date: 'YYYYMMDD', byCode: Map } 或 null（失敗時）
function fetchOpenApiDay() {
  const now = Date.now();
  if (openApiMemo.data && now - openApiMemo.at < REFRESH_INTERVAL_MS) return Promise.resolve(openApiMemo.data);
  if (now - openApiMemo.failedAt < COOLDOWN_MS) return Promise.resolve(null);
  if (!openApiFetching) {
    openApiFetching = (async () => {
      const res = await fetch(OPENAPI_URL, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rows = await res.json();
      if (!Array.isArray(rows) || !rows.length) throw new Error('無資料');
      // 日期是民國年 '1151106'
      const roc = String(rows[0].Date || '');
      const date = roc.length === 7 ? `${Number(roc.slice(0, 3)) + 1911}${roc.slice(3)}` : null;
      const byCode = new Map(rows.map((r) => [r.Code, {
        open: num(r.OpeningPrice), high: num(r.HighestPrice), low: num(r.LowestPrice), close: num(r.ClosingPrice),
      }]));
      const data = { date, byCode };
      openApiMemo = { at: Date.now(), data, failedAt: 0 };
      return data;
    })()
      .catch((err) => {
        openApiMemo = { ...openApiMemo, failedAt: Date.now() };
        console.error('[levels] 證交所 OpenAPI 失敗:', describeFetchError(err));
        return null;
      })
      .finally(() => { openApiFetching = null; });
  }
  return openApiFetching;
}

function loadCacheDay() {
  refreshCacheInBackground();
  const [latest] = loadRecentDays(1);
  if (!latest) return null;
  return { date: latest.date, byCode: new Map(latest.rows.map((r) => [r.code, r])) };
}

// 'YYYYMMDD' → 證交所格式 '115/11/06'（跟 STOCK_DAY 回傳的日期格式一致）
function toRocDate(yyyymmdd) {
  return `${Number(yyyymmdd.slice(0, 4)) - 1911}/${yyyymmdd.slice(4, 6)}/${yyyymmdd.slice(6, 8)}`;
}

function isComplete(row) {
  return row && row.high != null && row.low != null && row.close != null;
}

function fromMarketDay(day, code) {
  if (!day || !day.date) return null;
  const row = day.byCode.get(code);
  return isComplete(row) ? { date: toRocDate(day.date), open: row.open, high: row.high, low: row.low, close: row.close } : null;
}

async function fromAlternatives(code) {
  const bar = await fetchLatestBar(code);
  return { date: toRocDate(bar.date), open: bar.open, high: bar.high, low: bar.low, close: bar.close, name: bar.name || null };
}

async function fromStockDay(code) {
  if (Date.now() - stockDayFailedAt < COOLDOWN_MS) return null;
  try {
    return await fetchPrevDayOHLC(code);
  } catch (err) {
    stockDayFailedAt = Date.now();
    throw err;
  }
}

async function getOhlc(code, cacheDay, openApiDay) {
  const errors = [];
  const attempt = async (fn) => {
    try {
      return await fn();
    } catch (err) {
      errors.push(describeFetchError(err));
      return null;
    }
  };

  let ohlc = null;
  if (openApiDay) {
    const [first, second] = [cacheDay, openApiDay].sort((a, b) => ((b && b.date) || '').localeCompare((a && a.date) || ''));
    ohlc = fromMarketDay(first, code) || fromMarketDay(second, code) || (await attempt(() => fromAlternatives(code)));
  } else {
    ohlc = (await attempt(() => fromAlternatives(code))) || fromMarketDay(cacheDay, code);
  }
  if (!ohlc) ohlc = await attempt(() => fromStockDay(code));
  if (!ohlc && errors.length) throw new Error(errors[0]);
  return ohlc;
}

async function buildLevelsForWatchlist(watchlist, stopLossPct) {
  const nameMap = loadNameMap();
  const cacheDay = loadCacheDay();
  const openApiDay = await fetchOpenApiDay();

  return Promise.all(
    watchlist.map(async (code) => {
      let label = stockLabel(code, nameMap);
      try {
        const ohlc = await getOhlc(code, cacheDay, openApiDay);
        if (ohlc && ohlc.name && label === code) label = `${code} ${ohlc.name}`;
        if (!ohlc || ohlc.close == null) {
          return { code, label, error: '查無資料' };
        }
        const { pivot, r1, s1 } = calcPivotPoints(ohlc);
        const stopLoss = calcStopLoss(s1, stopLossPct);
        return { code, label, ohlcDate: ohlc.date, close: ohlc.close, pivot, r1, s1, stopLoss };
      } catch (err) {
        const reason = describeFetchError(err);
        console.error(`[levels] ${code} 取得失敗:`, reason);
        return { code, label, error: reason };
      }
    })
  );
}

module.exports = { buildLevelsForWatchlist };
