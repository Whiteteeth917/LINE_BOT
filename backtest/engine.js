const { annotateSeries } = require('./indicators');
const { buildSortedRet20ByDate, isEntrySignal, DEFAULT_RS_PERCENTILE, EXIT_RULES } = require('./strategy');

// 對單一個股序列跑訊號＋模擬進出場，回傳這檔股票所有交易紀錄
function simulateOneStock(code, name, series, sortedRet20ByDate, params) {
  const { stopLossPct, minHoldDays, maxHoldDays, rsPercentile, trailOn } = params;
  const trades = [];
  let position = null; // { entryIndex, entryDate, entryPrice }

  for (let i = 0; i < series.length; i++) {
    const row = series[i];

    if (position) {
      const daysHeld = i - position.entryIndex;
      const stopPrice = position.entryPrice * (1 - stopLossPct / 100);

      let exitReason = null;
      let exitPrice = null;

      if (row.close <= stopPrice) {
        exitReason = 'stop_loss';
        exitPrice = stopPrice;
      } else if (daysHeld >= minHoldDays) {
        const trailMA = trailOn === 'ma20' ? row.ma20 : row.ma10;
        if (trailMA != null && row.close < trailMA) {
          exitReason = 'trailing_stop';
          exitPrice = row.close;
        } else if (daysHeld >= maxHoldDays) {
          exitReason = 'max_hold';
          exitPrice = row.close;
        }
      }

      if (exitReason) {
        const returnPct = (exitPrice / position.entryPrice - 1) * 100;
        trades.push({
          code,
          name,
          entryDate: position.entryDate,
          entryPrice: position.entryPrice,
          exitDate: row.date,
          exitPrice,
          returnPct,
          daysHeld,
          reason: exitReason,
        });
        position = null;
      }
      continue;
    }

    // 沒有部位時才檢查進場訊號；訊號當天收盤後判斷，隔天開盤進場
    if (isEntrySignal(row, sortedRet20ByDate.get(row.date), rsPercentile)) {
      const next = series[i + 1];
      if (next && next.open != null) {
        position = { entryIndex: i + 1, entryDate: next.date, entryPrice: next.open };
      }
    }
  }

  // 「戰績」要看到還沒出場的部位：用最後一天收盤價算目前報酬，reason 標成 open
  if (position && params.includeOpen) {
    const last = series[series.length - 1];
    trades.push({
      code,
      name,
      entryDate: position.entryDate,
      entryPrice: position.entryPrice,
      exitDate: null,
      exitPrice: last.close,
      returnPct: (last.close / position.entryPrice - 1) * 100,
      daysHeld: series.length - 1 - position.entryIndex,
      reason: 'open',
    });
  }

  return trades;
}

function runBacktest(seriesMap, universe, params = {}) {
  const cfg = {
    stopLossPct: params.stopLossPct ?? 20,
    minHoldDays: params.minHoldDays ?? EXIT_RULES.minHoldDays,
    maxHoldDays: params.maxHoldDays ?? EXIT_RULES.maxHoldDays,
    rsPercentile: params.rsPercentile ?? DEFAULT_RS_PERCENTILE,
    trailOn: params.trailOn ?? 'ma20',
    includeOpen: Boolean(params.includeOpen),
  };

  for (const series of seriesMap.values()) annotateSeries(series);
  const sortedRet20ByDate = buildSortedRet20ByDate(seriesMap);

  const allTrades = [];
  for (const { code, name } of universe) {
    const series = seriesMap.get(code);
    if (!series || series.length < 80) continue;
    const trades = simulateOneStock(code, name, series, sortedRet20ByDate, cfg);
    allTrades.push(...trades);
  }

  return { trades: allTrades, config: cfg };
}

module.exports = { runBacktest, simulateOneStock };
