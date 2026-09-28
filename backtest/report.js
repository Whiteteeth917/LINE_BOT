function summarize(trades) {
  if (trades.length === 0) {
    return { totalTrades: 0 };
  }

  const wins = trades.filter((t) => t.returnPct > 0);
  const losses = trades.filter((t) => t.returnPct <= 0);

  const avg = (arr, sel) => (arr.length ? arr.reduce((s, t) => s + sel(t), 0) / arr.length : 0);

  const winRate = (wins.length / trades.length) * 100;
  const avgWinPct = avg(wins, (t) => t.returnPct);
  const avgLossPct = avg(losses, (t) => t.returnPct);
  const avgHoldDays = avg(trades, (t) => t.daysHeld);
  const avgReturnPct = avg(trades, (t) => t.returnPct);

  const grossWin = wins.reduce((s, t) => s + t.returnPct, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.returnPct, 0));
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : Infinity;

  const byReason = {};
  for (const t of trades) byReason[t.reason] = (byReason[t.reason] || 0) + 1;

  return {
    totalTrades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate,
    avgWinPct,
    avgLossPct,
    avgReturnPct,
    avgHoldDays,
    profitFactor,
    byReason,
  };
}

function printReport(trades, universeSize, dayRange) {
  const s = summarize(trades);
  console.log('='.repeat(50));
  console.log(`回測期間：${dayRange[0]} ~ ${dayRange[1]}`);
  console.log(`股票池大小：${universeSize} 檔（日均成交金額排名前段，排除ETF/權證/特別股）`);
  console.log('='.repeat(50));

  if (s.totalTrades === 0) {
    console.log('沒有任何交易訊號觸發，可能是條件太嚴格或資料不足。');
    return s;
  }

  console.log(`總交易次數：${s.totalTrades}`);
  console.log(`勝率：${s.winRate.toFixed(1)}%（${s.wins} 勝 / ${s.losses} 敗）`);
  console.log(`平均獲利交易報酬：+${s.avgWinPct.toFixed(2)}%`);
  console.log(`平均虧損交易報酬：${s.avgLossPct.toFixed(2)}%`);
  console.log(`整體平均每筆報酬：${s.avgReturnPct.toFixed(2)}%`);
  console.log(`平均持有天數：${s.avgHoldDays.toFixed(1)} 個交易日`);
  console.log(`獲利因子（總獲利/總虧損）：${s.profitFactor === Infinity ? '∞（無虧損交易）' : s.profitFactor.toFixed(2)}`);
  console.log('出場原因統計：', s.byReason);
  console.log('='.repeat(50));

  return s;
}

module.exports = { summarize, printReport };
