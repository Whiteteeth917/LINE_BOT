// 把「日期為主」的快取資料（每天一份全市場清單）轉成「個股為主」的時間序列，方便算技術指標。
function buildSeriesByCode(days, codes) {
  const codeSet = new Set(codes);
  const seriesMap = new Map(); // code -> [{date, open, high, low, close, volume}]

  for (const { date, rows } of days) {
    for (const r of rows) {
      if (!codeSet.has(r.code)) continue;
      if (r.close == null) continue;
      if (!seriesMap.has(r.code)) seriesMap.set(r.code, []);
      seriesMap.get(r.code).push({
        date,
        open: r.open,
        high: r.high,
        low: r.low,
        close: r.close,
        volume: r.volume,
      });
    }
  }

  // 已經照 days 的日期順序 push，天生就是時間遞增排序
  return seriesMap;
}

module.exports = { buildSeriesByCode };
