const { fetchPrevDayOHLC } = require('./twse');
const { calcPivotPoints, calcStopLoss } = require('./pivotPoints');
const { loadNameMap, stockLabel } = require('./stockNames');
const { describeFetchError } = require('./fetchError');
const { loadRecentDays } = require('../backtest/loadCache');
const { backfillRecentDays } = require('../backtest/backfillHistory');

// 最近一個交易日的 OHLC，依序嘗試三個來源：
//   1. 本機行情快取（全市場一個檔案；每 10 分鐘最多補抓一次）
//   2. 證交所 OpenAPI STOCK_DAY_ALL（openapi.twse.com.tw，一次請求拿到全部上市股票，結果暫存 10 分鐘）
//   3. 證交所 STOCK_DAY（www.twse.com.tw，每檔一次請求，最後手段）
// 雲端主機連 www.twse.com.tw 常常失敗（請求太密集會被暫時封鎖），不能只靠它；
// 1、2 若都有資料，取日期較新的那份。
const REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const OPENAPI_URL = 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL';

let lastCacheRefresh = 0;
let cacheRefreshing = null;
let openApiMemo = { at: 0, data: null };
let openApiFetching = null;

function refreshCacheIfStale() {
  if (Date.now() - lastCacheRefresh < REFRESH_INTERVAL_MS) return Promise.resolve();
  if (!cacheRefreshing) {
    cacheRefreshing = backfillRecentDays(5)
      .catch((err) => console.error('[levels] 行情快取更新失敗:', describeFetchError(err)))
      .finally(() => {
        lastCacheRefresh = Date.now();
        cacheRefreshing = null;
      });
  }
  return cacheRefreshing;
}

function num(s) {
  const n = parseFloat(String(s).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

// 回傳 { date: 'YYYYMMDD', byCode: Map } 或 null（失敗時）
function fetchOpenApiDay() {
  if (openApiMemo.data && Date.now() - openApiMemo.at < REFRESH_INTERVAL_MS) return Promise.resolve(openApiMemo.data);
  if (!openApiFetching) {
    openApiFetching = (async () => {
      const res = await fetch(OPENAPI_URL, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(15000) });
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
      openApiMemo = { at: Date.now(), data };
      return data;
    })()
      .catch((err) => {
        console.error('[levels] 證交所 OpenAPI 失敗:', describeFetchError(err));
        return null;
      })
      .finally(() => { openApiFetching = null; });
  }
  return openApiFetching;
}

async function loadCacheDay() {
  await refreshCacheIfStale();
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

async function getOhlc(code, sources) {
  for (const src of sources) {
    const row = src.byCode.get(code);
    if (isComplete(row)) return { date: toRocDate(src.date), open: row.open, high: row.high, low: row.low, close: row.close };
  }
  return fetchPrevDayOHLC(code);
}

async function buildLevelsForWatchlist(watchlist, stopLossPct) {
  const nameMap = loadNameMap();
  const [cacheDay, openApiDay] = await Promise.all([loadCacheDay(), fetchOpenApiDay()]);
  // 日期較新的來源排前面
  const sources = [cacheDay, openApiDay].filter((s) => s && s.date).sort((a, b) => b.date.localeCompare(a.date));

  return Promise.all(
    watchlist.map(async (code) => {
      const label = stockLabel(code, nameMap);
      try {
        const ohlc = await getOhlc(code, sources);
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
