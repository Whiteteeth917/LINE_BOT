// 盤中個股報價（約15分鐘延遲）。
// 主要來源：TradingView 公開 scanner 端點（免費、不需金鑰，非官方 API）。
// 備援來源：證交所「基本市況報導」MIS API。TradingView 會擋部分雲端主機 IP（例如 Render），
// 失敗時自動改用官方來源，兩邊回傳格式一致：Map<code, { close, changePct, source }>。
// 第三順位：Yahoo Finance。雲端主機有時候證交所整個連不上、TradingView 又在限流（HTTP 429），
// Yahoo 是目前確認從 Render 連得上的來源；逐檔查詢，上市 .TW、上櫃 .TWO 都支援。
const TV_URL = 'https://scanner.tradingview.com/global/scan';
const TWSE_MIS_URL = 'https://mis.twse.com.tw/stock/api/getStockInfo.jsp';

async function fetchFromTradingView(codes) {
  const tickers = codes.map((c) => `TWSE:${c}`);
  const res = await fetch(TV_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0',
      Origin: 'https://in.tradingview.com',
      Referer: 'https://in.tradingview.com/',
    },
    body: JSON.stringify({
      symbols: { tickers, query: { types: [] } },
      columns: ['close', 'change'],
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`TradingView HTTP ${res.status}`);
  const json = await res.json();

  const map = new Map();
  for (const row of json.data || []) {
    const code = row.s.replace('TWSE:', '');
    const [close, changePct] = row.d;
    if (close != null) map.set(code, { close, changePct, source: 'tradingview' });
  }
  return map;
}

function toNum(s) {
  const n = parseFloat(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function fetchFromTwseMis(codes) {
  // 同時查上市(tse)與上櫃(otc)，不存在的那一邊 MIS 會直接略過
  const exCh = codes.flatMap((c) => [`tse_${c}.tw`, `otc_${c}.tw`]).join('|');
  const url = `${TWSE_MIS_URL}?ex_ch=${encodeURIComponent(exCh)}&json=1&delay=0&_=${Date.now()}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://mis.twse.com.tw/stock/index.jsp' },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`TWSE MIS HTTP ${res.status}`);
  const json = await res.json();

  const map = new Map();
  for (const row of json.msgArray || []) {
    const prevClose = toNum(row.y);
    // z＝最近成交價；剛好沒有成交時會是 "-"，改用最佳買價第一檔
    const close = toNum(row.z) ?? toNum((row.b || '').split('_')[0]);
    if (close == null) continue;
    const changePct = prevClose ? ((close - prevClose) / prevClose) * 100 : 0;
    map.set(row.c, { close, changePct, source: 'twse-mis' });
  }
  return map;
}

async function fetchYahooOne(code) {
  for (const suffix of ['.TW', '.TWO']) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(code + suffix)}?range=1d&interval=1d`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) });
    if (res.status === 404) continue;
    if (!res.ok) throw new Error(`Yahoo HTTP ${res.status}`);
    const meta = (await res.json())?.chart?.result?.[0]?.meta;
    const close = meta && meta.regularMarketPrice;
    if (close == null) continue;
    const prev = meta.chartPreviousClose ?? meta.previousClose;
    return { close, changePct: prev ? ((close - prev) / prev) * 100 : 0, source: 'yahoo' };
  }
  return null;
}

async function fetchFromYahoo(codes) {
  const map = new Map();
  const results = await Promise.allSettled(codes.map((c) => fetchYahooOne(c)));
  results.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value) map.set(codes[i], r.value);
  });
  if (!map.size && results.some((r) => r.status === 'rejected')) {
    throw results.find((r) => r.status === 'rejected').reason;
  }
  return map;
}

async function fetchQuotes(codes) {
  if (!codes.length) return new Map();

  let map = new Map();
  try {
    map = await fetchFromTradingView(codes);
  } catch (err) {
    console.warn('[fetchQuotes] TradingView 失敗，改用證交所 MIS:', err.message);
  }

  const missing = codes.filter((c) => !map.has(c));
  if (missing.length) {
    try {
      const fallback = await fetchFromTwseMis(missing);
      for (const [code, q] of fallback) map.set(code, q);
    } catch (err) {
      console.error('[fetchQuotes] 證交所 MIS 也失敗:', err.message);
    }
  }

  const stillMissing = codes.filter((c) => !map.has(c));
  if (stillMissing.length) {
    try {
      const fallback = await fetchFromYahoo(stillMissing);
      for (const [code, q] of fallback) map.set(code, q);
    } catch (err) {
      console.error('[fetchQuotes] Yahoo 也失敗:', err.message);
    }
  }
  return map;
}

module.exports = { fetchQuotes };
