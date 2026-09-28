// 盤中個股即時（約15分鐘延遲）報價，用 TradingView 公開 scanner 端點（免費、不需金鑰，非官方 API）
async function fetchQuotes(codes) {
  if (!codes.length) return new Map();

  const tickers = codes.map((c) => `TWSE:${c}`);
  const res = await fetch('https://scanner.tradingview.com/global/scan', {
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
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();

  const map = new Map();
  for (const row of json.data || []) {
    const code = row.s.replace('TWSE:', '');
    const [close, changePct] = row.d;
    map.set(code, { close, changePct });
  }
  return map;
}

module.exports = { fetchQuotes };
