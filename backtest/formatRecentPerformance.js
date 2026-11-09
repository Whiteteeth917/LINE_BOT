const REASON_LABEL = {
  stop_loss: '停損',
  trailing_stop: '跌破20MA',
  max_hold: '持有到期',
};

function fmtDate(yyyymmdd) {
  return `${yyyymmdd.slice(4, 6)}/${yyyymmdd.slice(6, 8)}`;
}

function fmtFullDate(yyyymmdd) {
  return `${yyyymmdd.slice(0, 4)}/${yyyymmdd.slice(4, 6)}/${yyyymmdd.slice(6, 8)}`;
}

function fmtPct(n) {
  return `${n > 0 ? '+' : ''}${n.toFixed(1)}%`;
}

function fmtPf(pf) {
  return pf === Infinity ? '∞（沒有虧損）' : pf.toFixed(2);
}

function tradeLine(t) {
  const name = t.name ? `${t.code} ${t.name}` : t.code;
  if (t.reason === 'open') {
    return `・${name}　${fmtDate(t.entryDate)} 進場 ${t.entryPrice}→現 ${t.exitPrice}　${fmtPct(t.returnPct)}（第${t.daysHeld}天）`;
  }
  return `・${name}　${fmtDate(t.entryDate)}→${fmtDate(t.exitDate)}　${fmtPct(t.returnPct)}（${REASON_LABEL[t.reason] || t.reason}）`;
}

function formatRecentPerformance(r) {
  const header = [
    `📊 選股訊號近期戰績`,
    `期間：${fmtFullDate(r.periodStart)} ~ ${fmtFullDate(r.periodEnd)}（${r.tradingDays} 個交易日）`,
    `股票池：流動性前 ${r.universeSize} 大上市股｜共出現 ${r.signalCount} 次進場訊號`,
  ].join('\n');

  if (!r.signalCount) {
    return `${header}\n\n這段期間沒有出現任何進場訊號。`;
  }

  const sections = [header];
  const c = r.closedStats;
  if (c.totalTrades) {
    sections.push([
      `【已出場 ${c.totalTrades} 筆】`,
      `勝率 ${c.winRate.toFixed(1)}%（${c.wins} 勝 ${c.losses} 敗）｜平均每筆 ${fmtPct(c.avgReturnPct)}`,
      `平均賺 ${fmtPct(c.avgWinPct)}／平均賠 ${fmtPct(c.avgLossPct)}｜獲利因子 ${fmtPf(c.profitFactor)}`,
      `平均持有 ${c.avgHoldDays.toFixed(1)} 個交易日`,
      `最近出場：`,
      ...r.recentClosed.map(tradeLine),
    ].join('\n'));
  } else {
    sections.push('【已出場】這段期間的訊號都還沒出場。');
  }

  if (r.open.length) {
    const o = r.openStats;
    const shown = r.open.slice(0, 8);
    sections.push([
      `【持有中 ${r.open.length} 筆】目前平均 ${fmtPct(o.avgReturnPct)}，${o.wins} 筆賺 ${o.losses} 筆賠`,
      ...shown.map(tradeLine),
      r.open.length > shown.length ? `…另有 ${r.open.length - shown.length} 筆` : null,
    ].filter(Boolean).join('\n'));
  }

  sections.push([
    '【對照】2年回測：勝率約51.9%、獲利因子3.30、平均持有約22.5個交易日。',
    '※ 進出場模擬：訊號隔天開盤進場；跌破成本−20%停損、持有滿15天後跌破20日均線出場、最長80天。未扣手續費與稅。',
    '※ 這段期間可能與策略調參用的資料重疊，不算完全獨立的驗證；筆數少時結果波動很大，參考就好。非投資建議。',
  ].join('\n'));

  return sections.join('\n\n');
}

module.exports = { formatRecentPerformance };
