// 把每個日期、全市場 20 日報酬率由小到大排序，用來算個股當天的相對強度百分位
// （沒有另外快取加權指數，用同一批股票池的橫斷面排名近似「有沒有跑贏大盤」）
function buildSortedRet20ByDate(seriesMap) {
  const byDate = new Map(); // date -> [ret20...]

  for (const series of seriesMap.values()) {
    for (const r of series) {
      if (r.ret20 == null) continue;
      if (!byDate.has(r.date)) byDate.set(r.date, []);
      byDate.get(r.date).push(r.ret20);
    }
  }

  const sortedByDate = new Map();
  for (const [date, arr] of byDate.entries()) {
    sortedByDate.set(date, [...arr].sort((a, b) => a - b));
  }
  return sortedByDate;
}

function percentileRank(sortedArr, val) {
  let lo = 0;
  let hi = sortedArr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedArr[mid] < val) lo = mid + 1;
    else hi = mid;
  }
  return lo / sortedArr.length;
}

// 回測調參找出來的預設門檻：20日報酬要排在股票池前 10%（百分位 >= 0.9），
// 且同時滿足「創20日新高」與「量能爆量」（比只滿足其一嚴格，訊號品質較高）。
const DEFAULT_RS_PERCENTILE = 0.9;

const VOLUME_SURGE_MULTIPLE = 1.5;

// 把進場條件拆成逐項結果（給「進場條件」指令逐條顯示用），isEntrySignal 也共用這份判斷，確保兩邊邏輯一致。
// 資料不足時回傳 null。
function evaluateEntryConditions(row, sortedRet20, rsPercentile = DEFAULT_RS_PERCENTILE) {
  if (row.ma20 == null || row.ma60 == null || row.ma60Rising == null || row.ret20 == null || !sortedRet20 || !sortedRet20.length) {
    return null;
  }
  const rsRank = percentileRank(sortedRet20, row.ret20);
  const conditions = {
    aboveMa20: row.close > row.ma20,
    ma20AboveMa60: row.ma20 > row.ma60,
    ma60Rising: row.ma60Rising,
    relativeStrength: rsRank >= rsPercentile,
    high20: row.isHigh20,
    volumeSurge: row.volAvg20 != null && row.volume > VOLUME_SURGE_MULTIPLE * row.volAvg20,
  };
  return { conditions, rsRank, all: Object.values(conditions).every(Boolean) };
}

// 進場條件：站上季線且季線走揚、站上月線、相對強度夠強、且創20日新高與爆量同時成立
function isEntrySignal(row, sortedRet20, rsPercentile = DEFAULT_RS_PERCENTILE) {
  const result = evaluateEntryConditions(row, sortedRet20, rsPercentile);
  return Boolean(result && result.all);
}

module.exports = {
  buildSortedRet20ByDate,
  evaluateEntryConditions,
  isEntrySignal,
  percentileRank,
  DEFAULT_RS_PERCENTILE,
  VOLUME_SURGE_MULTIPLE,
};
