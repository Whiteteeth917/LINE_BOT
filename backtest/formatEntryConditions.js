const { VOLUME_SURGE_MULTIPLE } = require('./strategy');

function fmt(n) {
  return n == null ? '－' : (Math.round(n * 100) / 100).toString();
}

function fmtPct(ratio) {
  if (ratio == null) return '－';
  const pct = ratio * 100;
  return `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

function fmtLots(shares) {
  return shares == null ? '－' : `${Math.round(shares / 1000).toLocaleString('en-US')}張`;
}

function fmtDate(yyyymmdd) {
  return `${yyyymmdd.slice(4, 6)}/${yyyymmdd.slice(6, 8)}`;
}

function mark(ok) {
  return ok ? '✅' : '❌';
}

function gapPct(target, current) {
  return `差 ${(((target - current) / current) * 100).toFixed(1)}%`;
}

function buildStockBlock(r, meta) {
  const label = r.name ? `${r.code} ${r.name}` : r.code;
  if (r.error) return `📌 ${label}\n　⚠️ ${r.error}`;

  const c = r.conditions;
  const passed = Object.values(c).filter(Boolean).length;
  const total = Object.keys(c).length;
  const status = r.all ? '🔥 條件全部到齊，符合進場訊號' : `符合 ${passed}/${total} 項，尚未到齊`;
  const topPct = Math.max(1, Math.round((1 - r.rsRank) * 100));
  const rsTopNeed = Math.round((1 - meta.rsPercentile) * 100);

  const lines = [
    `📌 ${label}　收盤 ${fmt(r.close)}`,
    `　${status}`,
    '　【趨勢】',
    `　${mark(c.aboveMa20)} 站上月線：收盤 ${fmt(r.close)} ${c.aboveMa20 ? '>' : '≤'} MA20 ${fmt(r.ma20)}`,
    `　${mark(c.ma20AboveMa60)} 月線在季線上：MA20 ${fmt(r.ma20)} ${c.ma20AboveMa60 ? '>' : '≤'} MA60 ${fmt(r.ma60)}`,
    `　${mark(c.ma60Rising)} 季線走揚（MA60 高於5日前）`,
    '　【強度】',
    `　${mark(c.relativeStrength)} 相對強度前${rsTopNeed}%：20日報酬 ${fmtPct(r.ret20)}，排名約前${topPct}%` +
      (!c.relativeStrength && meta.rsThresholdRet20 != null ? `（今日門檻 ${fmtPct(meta.rsThresholdRet20)}）` : ''),
    '　【突破】',
    `　${mark(c.high20)} 創20日收盤新高` +
      (c.high20 ? '' : `：下一交易日收盤需 ≥ ${fmt(r.nextHigh20)}（${gapPct(r.nextHigh20, r.close)}）`),
    `　${mark(c.volumeSurge)} 爆量（> 20日均量${VOLUME_SURGE_MULTIPLE}倍）：今日 ${fmtLots(r.volume)}／均量 ${fmtLots(r.volAvg20)}` +
      (c.volumeSurge ? '' : `，下一交易日需 > ${fmtLots(r.nextVolumeNeeded)}`),
    `　進場參考區 ${fmt(r.support)}~${fmt(r.pivot)}｜目標 ${fmt(r.resistance)}｜停損 ${fmt(r.stopLoss)}`,
  ];
  return lines.join('\n');
}

function formatEntryConditions(result) {
  const header = `🎯 觀察名單進場條件檢查（${fmtDate(result.date)} 收盤資料）`;
  const blocks = result.results.map((r) => buildStockBlock(r, result));

  const footer = [
    `※ 6項全部成立才算進場訊號，與「選股」同一套邏輯（2年回測：勝率約51.9%、獲利因子3.30）。相對強度是跟流動性前${result.poolSize}大上市股比較20日報酬排名。`,
    '※ 「下一交易日需…」是以收盤價計算的觸發門檻；盤中暫時碰到不算，要以收盤確認。',
    '※ 進場參考區／目標／停損為前一交易日樞紐點公式算出的客觀價位，不是預測。僅供參考，非投資建議。',
  ].join('\n');

  return [header, ...blocks, footer].join('\n\n');
}

module.exports = { formatEntryConditions };
