// 台指期（近月）報價，資料延遲約 15 分鐘，僅供參考走勢強弱，不是即時逐筆報價。
// 主要來源：TradingView 公開 scanner 端點（免費、不需金鑰，非官方 API）。
// 備援來源：期交所 MIS 行情 API。TradingView 會擋部分雲端主機 IP（例如 Render），失敗時自動改用官方來源。
const TV_URL = 'https://scanner.tradingview.com/global/scan';
const TV_SYMBOL = 'TAIFEX:TXF1!';
const TAIFEX_MIS_URL = 'https://mis.taifex.com.tw/futures/api/getQuoteList';

async function fetchFromTradingView() {
  const res = await fetch(TV_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0',
      Origin: 'https://in.tradingview.com',
      Referer: 'https://in.tradingview.com/',
    },
    body: JSON.stringify({
      symbols: { tickers: [TV_SYMBOL], query: { types: [] } },
      columns: ['close', 'change', 'open', 'high', 'low', 'volume'],
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`TradingView HTTP ${res.status}`);
  const json = await res.json();
  const row = json?.data?.[0];
  if (!row) throw new Error('TradingView 無資料');

  const [close, changePct, open, high, low, volume] = row.d;
  return { close, changePct, open, high, low, volume, source: 'tradingview' };
}

// marketType: '0'＝一般交易時段（日盤 08:45~13:45），'1'＝盤後交易時段（夜盤 15:00~隔天 05:00）
async function fetchTaifexSession(marketType) {
  const res = await fetch(TAIFEX_MIS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'User-Agent': 'Mozilla/5.0' },
    body: JSON.stringify({
      MarketType: marketType,
      SymbolType: 'F',
      KindID: '1',
      CID: 'TXF',
      ExpireMonth: '',
      RowSize: '',
      PageNo: '',
      SortColumn: '',
      AscDesc: 'A',
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`TAIFEX MIS HTTP ${res.status}`);
  const json = await res.json();
  // 清單依到期月份排序，第一筆「TXF?#-F」就是近月合約（TXF-S 是現貨指數，略過）
  const row = (json?.RtData?.QuoteList || []).find((r) => /^TXF[A-Z]\d-F$/.test(r.SymbolID));
  if (!row) throw new Error(`TAIFEX MIS 無資料 (${json?.RtMsg || 'empty'})`);

  const num = (s) => (s === '' || s == null ? null : parseFloat(s));
  // 還沒開盤時合約列還在，但成交價是空字串：視為這個時段沒資料，不要回傳一堆 null
  if (num(row.CLastPrice) == null) return null;
  return {
    close: num(row.CLastPrice),
    changePct: num(row.CDiffRate) ?? 0,
    open: num(row.COpenPrice),
    high: num(row.CHighPrice),
    low: num(row.CLowPrice),
    volume: num(row.CTotalVolume),
    source: marketType === '1' ? 'taifex-mis-night' : 'taifex-mis',
    session: marketType === '1' ? 'night' : 'day',
  };
}

// 日盤有成交就用日盤；日盤還沒開（例如早上 07:30）就改用夜盤，兩邊都沒有才算失敗
async function fetchFromTaifexMis() {
  const day = await fetchTaifexSession('0');
  if (day) return day;
  const night = await fetchTaifexSession('1');
  if (night) return night;
  throw new Error('TAIFEX MIS 日盤與夜盤都沒有成交資料');
}

async function fetchTxfSummary() {
  try {
    return await fetchFromTradingView();
  } catch (err) {
    console.warn('[fetchTxfSummary] TradingView 失敗，改用期交所 MIS:', err.message);
  }
  return fetchFromTaifexMis();
}

module.exports = { fetchTxfSummary };
