// 台指期（近月連續合約）報價，用 TradingView 公開 scanner 端點（免費、不需金鑰，非官方 API，
// 資料延遲約 15 分鐘，僅供參考走勢強弱，不是即時逐筆報價）
const SYMBOL = 'TAIFEX:TXF1!';

async function fetchTxfSummary() {
  const url = 'https://scanner.tradingview.com/global/scan';
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0',
      Origin: 'https://in.tradingview.com',
      Referer: 'https://in.tradingview.com/',
    },
    body: JSON.stringify({
      symbols: { tickers: [SYMBOL], query: { types: [] } },
      columns: ['close', 'change', 'open', 'high', 'low', 'volume'],
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const row = json?.data?.[0];
  if (!row) throw new Error('無資料');

  const [close, changePct, open, high, low, volume] = row.d;
  return { close, changePct, open, high, low, volume };
}

module.exports = { fetchTxfSummary };
