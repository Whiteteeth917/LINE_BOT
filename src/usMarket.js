// 美股前一交易日收盤漲跌，用 Yahoo Finance 公開行情 API（免費、不需金鑰，非官方但穩定常用）
const SYMBOLS = [
  { symbol: '%5EIXIC', label: '那斯達克' },
  { symbol: '%5EGSPC', label: 'S&P500' },
  { symbol: '%5EDJI', label: '道瓊' },
];

async function fetchOne({ symbol, label }) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=5d`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const meta = json?.chart?.result?.[0]?.meta;
  if (!meta || meta.regularMarketPrice == null) throw new Error('無資料');
  return {
    label,
    price: meta.regularMarketPrice,
    changePct: meta.regularMarketChangePercent,
  };
}

// 回傳 [{ label, price, changePct }]，單一指數失敗不影響其他指數
async function fetchUsMarketSummary() {
  const results = await Promise.all(
    SYMBOLS.map((s) => fetchOne(s).catch((err) => ({ label: s.label, error: err.message })))
  );
  return results;
}

module.exports = { fetchUsMarketSummary };
