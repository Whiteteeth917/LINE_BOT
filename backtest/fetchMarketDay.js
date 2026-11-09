// 抓證交所單一交易日「全部上市證券」的開高低收成交資訊（免費公開資料，不需金鑰）
// https://www.twse.com.tw/exchangeReport/MI_INDEX?response=json&date=YYYYMMDD&type=ALLBUT0999

function toYYYYMMDD(d) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

function parseNumber(s) {
  const n = parseFloat(String(s).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

// 回傳 null 代表非交易日（假日／尚未收盤），回傳陣列代表該日全市場資料
async function fetchMarketDay(date) {
  const dateStr = toYYYYMMDD(date);
  const url = `https://www.twse.com.tw/exchangeReport/MI_INDEX?response=json&date=${dateStr}&type=ALLBUT0999`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`TWSE HTTP ${res.status}`);
  const json = await res.json();
  if (json.stat !== 'OK') return null;

  const table = (json.tables || []).find((t) => (t.fields || []).includes('證券代號'));
  if (!table) return null;

  return table.data.map((row) => {
    const [code, name, volume, , value, open, high, low, close] = row;
    return {
      code: code.trim(),
      name: name.trim(),
      volume: parseNumber(volume),
      value: parseNumber(value),
      open: parseNumber(open),
      high: parseNumber(high),
      low: parseNumber(low),
      close: parseNumber(close),
    };
  }).filter((r) => r.close != null);
}

module.exports = { fetchMarketDay, toYYYYMMDD };
