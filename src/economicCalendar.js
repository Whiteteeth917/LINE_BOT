// 國際總經行事曆，用 TradingView 經濟日曆的公開資料端點（免費、不需金鑰，非官方 API，
// 需要帶 Origin/Referer 才不會被擋，行為可能隨時改版）
const COUNTRIES = 'US,TW,CN';

function toUtcRangeForTaipeiDay(date) {
  // Asia/Taipei 是 UTC+8，把「台北當地今天 00:00~24:00」換算成 UTC 區間
  const y = date.getFullYear();
  const m = date.getMonth();
  const d = date.getDate();
  const startUtc = new Date(Date.UTC(y, m, d, -8, 0, 0)); // 台北 00:00 = UTC 前一天 16:00
  const endUtc = new Date(Date.UTC(y, m, d + 1, -8, 0, 0));
  return { startUtc, endUtc };
}

// 回傳今天（台北時區）重要性最高的總經事件清單，抓不到時回傳 null
async function fetchTodayHighImpactEvents(date = new Date()) {
  const { startUtc, endUtc } = toUtcRangeForTaipeiDay(date);
  const url = `https://economic-calendar.tradingview.com/events?from=${startUtc.toISOString()}&to=${endUtc.toISOString()}&countries=${COUNTRIES}`;

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      Origin: 'https://in.tradingview.com',
      Referer: 'https://in.tradingview.com/',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json.status !== 'ok' || !Array.isArray(json.result)) return null;

  return json.result
    .filter((e) => e.importance === 1)
    .map((e) => ({
      title: e.title,
      country: e.country,
      timeUtc: e.date,
      forecast: e.forecast,
      previous: e.previous,
    }));
}

module.exports = { fetchTodayHighImpactEvents };
