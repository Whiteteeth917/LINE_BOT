// 從證交所公開資料抓「前一交易日」OHLC，免費、不需金鑰。
// https://www.twse.com.tw/exchangeReport/STOCK_DAY

function toQueryDate(d) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}01`;
}

function parseNumber(s) {
  const n = parseFloat(String(s).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

async function fetchMonth(stockNo, monthDate) {
  const url = `https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=${toQueryDate(monthDate)}&stockNo=${stockNo}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`TWSE HTTP ${res.status}`);
  const json = await res.json();
  if (json.stat !== 'OK' || !Array.isArray(json.data)) return [];
  return json.data;
}

// 回傳最近一個交易日的 { date, open, high, low, close }，抓不到則回傳 null
async function fetchPrevDayOHLC(stockNo, today = new Date()) {
  let rows = await fetchMonth(stockNo, today);

  if (rows.length === 0) {
    const prevMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    rows = await fetchMonth(stockNo, prevMonth);
  }

  if (rows.length === 0) return null;

  const last = rows[rows.length - 1];
  const [date, , , open, high, low, close] = last;

  return {
    date,
    open: parseNumber(open),
    high: parseNumber(high),
    low: parseNumber(low),
    close: parseNumber(close),
  };
}

module.exports = { fetchPrevDayOHLC };
