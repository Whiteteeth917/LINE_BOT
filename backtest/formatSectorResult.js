function fmt(n) {
  return n == null ? '－' : (Math.round(n * 100) / 100).toString();
}

function fmtPct(n) {
  if (n == null) return '無資料';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(1)}%`;
}

function fmtLots(n) {
  if (n == null) return '無資料';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n}張`;
}

function buildActionableBlock(c, idx) {
  const flagLine = c.flags.length ? `⚠️ ${c.flags.join('、')}` : '✅ 無異常標記';
  const flowLine = c.flow
    ? `近5日法人合計 ${fmtLots(c.flow.totalNetLots)}（外資${fmtLots(c.flow.foreignNetLots)}）`
    : '近5日法人：無資料';

  return [
    `${idx + 1}. ${c.code} ${c.name}　現價 ${fmt(c.close)}`,
    `　進場參考區 ${fmt(c.support)}~${fmt(c.pivot)}｜目標參考 ${fmt(c.resistance)}｜停損參考 ${fmt(c.stopLoss)}`,
    `　${flowLine}｜營收年增 ${fmtPct(c.revenue?.yoyGrowthPct)}`,
    `　${flagLine}`,
  ].join('\n');
}

function buildWatchLine(c) {
  return `・${c.code} ${c.name}　現價 ${fmt(c.close)}（20日報酬 ${fmtPct(c.ret20 * 100)}）`;
}

function formatSectorResult(result, keyword) {
  if (!result.matched) {
    return [
      `找不到「${keyword}」對應的產業分類。`,
      '可用的分類：',
      result.categories.join('、'),
    ].join('\n');
  }

  const { category, results, total } = result;
  const header = `🔍 ${category} 類股掃描（共 ${total} 檔上市公司）`;

  if (results.length === 0) {
    return `${header}\n\n目前沒有足夠資料的個股可顯示。`;
  }

  const actionable = results.filter((c) => c.signal);
  const watching = results.filter((c) => !c.signal && c.trendUp).slice(0, 5);

  const sections = [header];

  if (actionable.length > 0) {
    sections.push(
      `【✅ 符合技術面進場條件，可考慮操作】`,
      ...actionable.map((c, idx) => buildActionableBlock(c, idx))
    );
  } else {
    sections.push('今天這個類股沒有股票符合完整的技術面進場條件，建議先觀望。');
  }

  if (watching.length > 0) {
    sections.push(
      '【👀 趨勢向上但訊號未到齊，先關注不進場】',
      watching.map(buildWatchLine).join('\n')
    );
  }

  const footer = [
    '※「進場參考區／目標參考／停損參考」是用前一交易日資料算出的樞紐點公式，是客觀數學計算，不是預測，也沒有題材面故事（工具沒有新聞來源，無法查證，不會編造）。',
    '※ 進場條件同一套邏輯經過2年回測驗證（勝率約51.9%、獲利因子3.30、平均持有約4.5週），基本面/籌碼/異常標記是即時資料，未經回測驗證。',
    '※ 僅供參考，非投資建議，請自行判斷風險並對自己的交易負責。',
  ].join('\n');
  sections.push(footer);

  return sections.join('\n\n');
}

module.exports = { formatSectorResult };
