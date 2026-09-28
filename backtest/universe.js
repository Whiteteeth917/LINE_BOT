// 用「日均成交金額」排名選股票池，取代指數成分股名單（那個沒有免費即時來源）。
// 排除 ETF／權證／特別股等非普通股代碼。
function isOrdinaryStock(code) {
  return /^[1-9]\d{3}$/.test(code);
}

// days: loadAllDays() 的結果
// 回傳依日均成交金額排序前 topN 檔的代碼陣列，且要求至少在 minCoverage 比例的交易日中有出現（避免新股/下市股資料不全）
function buildUniverse(days, { topN = 150, minCoverage = 0.9 } = {}) {
  const stats = new Map(); // code -> { name, sumValue, count }

  for (const { rows } of days) {
    for (const r of rows) {
      if (!isOrdinaryStock(r.code) || r.value == null) continue;
      const s = stats.get(r.code) || { name: r.name, sumValue: 0, count: 0 };
      s.sumValue += r.value;
      s.count += 1;
      s.name = r.name;
      stats.set(r.code, s);
    }
  }

  const totalDays = days.length;
  const ranked = [...stats.entries()]
    .filter(([, s]) => s.count / totalDays >= minCoverage)
    .map(([code, s]) => ({ code, name: s.name, avgValue: s.sumValue / s.count }))
    .sort((a, b) => b.avgValue - a.avgValue)
    .slice(0, topN);

  return ranked;
}

module.exports = { buildUniverse, isOrdinaryStock };
