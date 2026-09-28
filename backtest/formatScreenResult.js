function fmtPct(n) {
  if (n == null) return '無資料';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(1)}%`;
}

function formatScreenResult(result) {
  const { date, universeSize, totalSignals, candidates } = result;
  // date 是我們自己 toYYYYMMDD() 產生的西元年格式（YYYYMMDD），不是 TWSE 原始資料的民國年格式
  const dateLabel = `${date.slice(0, 4)}/${date.slice(4, 6)}/${date.slice(6, 8)}`;

  const header = `🔍 今日技術面選股候選（${dateLabel} 收盤資料）\n股票池：日均成交金額前 ${universeSize} 檔｜符合技術訊號：${totalSignals} 檔`;

  if (candidates.length === 0) {
    return `${header}\n\n今天沒有股票同時符合趨勢、相對強度與突破條件，觀望為主。`;
  }

  const blocks = candidates.map((c, idx) => {
    const flagLine = c.flags.length ? `⚠️ ${c.flags.join('、')}` : '✅ 無異常標記';
    const revLine = c.revenue ? `營收年增 ${fmtPct(c.revenue.yoyGrowthPct)}` : '營收資料：無';
    const epsLine = c.eps ? `EPS(最近一季) ${c.eps.epsBasic}` : 'EPS資料：無（可能非一般業公司）';
    return [
      `${idx + 1}. ${c.code} ${c.name}　收盤 ${c.close}`,
      `　20日報酬 ${fmtPct(c.ret20 * 100)}｜${revLine}｜${epsLine}`,
      `　${flagLine}`,
    ].join('\n');
  });

  const footer = '※ 技術面訊號為 2 年回測驗證過（勝率約 51.9%、平均持有22.5個交易日、獲利因子 3.30）；基本面與異常標記為即時資料，未經回測驗證，僅供參考，非投資建議。';

  return [header, ...blocks, footer].join('\n\n');
}

module.exports = { formatScreenResult };
