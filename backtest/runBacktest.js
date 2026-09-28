const { loadAllDays } = require('./loadCache');
const { buildUniverse } = require('./universe');
const { buildSeriesByCode } = require('./buildSeries');
const { runBacktest } = require('./engine');
const { printReport } = require('./report');

function main() {
  const days = loadAllDays();
  if (days.length < 80) {
    console.error(`快取資料只有 ${days.length} 個交易日，太少無法回測，請先跑 backfillHistory.js`);
    process.exit(1);
  }

  const universe = buildUniverse(days, { topN: 150, minCoverage: 0.9 });
  console.log(`股票池：${universe.length} 檔（依日均成交金額排名前150，覆蓋率需達90%交易日）`);

  const codes = universe.map((u) => u.code);
  const seriesMap = buildSeriesByCode(days, codes);

  const { trades } = runBacktest(seriesMap, universe, {
    stopLossPct: 20,
    minHoldDays: 15,
    maxHoldDays: 80,
    rsPercentile: 0.9,
    trailOn: 'ma20',
  });

  const dayRange = [days[0].date, days[days.length - 1].date];
  printReport(trades, universe.length, dayRange);

  // 額外存一份交易明細，方便人工抽查
  const fs = require('fs');
  const path = require('path');
  const outFile = path.join(__dirname, 'last_trades.json');
  fs.writeFileSync(outFile, JSON.stringify(trades, null, 2));
  console.log(`交易明細已存到 ${outFile}`);
}

main();
