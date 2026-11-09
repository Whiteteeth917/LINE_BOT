// 「查 2330」單一個股健檢：把散在各指令的資料集中在一則訊息
// （即時報價、進場條件達成數、樞紐點價位、月營收／EPS、近5日法人、異常標記、是否在觀察名單／持股）。
const { fetchQuotes } = require('./intradayQuotes');
const { checkWatchlistEntry } = require('../backtest/watchlistEntry');
const { loadRecentDays } = require('../backtest/loadCache');
const { fetchRecentInstitutionalFlow } = require('../backtest/institutionalFlow');
const {
  fetchRevenueGrowthMap,
  fetchEpsMap,
  fetchWarningCodeSet,
  fetchHeavyInsiderTransferCodeSet,
} = require('../backtest/fundamentals');
const { loadNameMap } = require('./stockNames');

function fmt(n) {
  return n == null ? '－' : (Math.round(n * 100) / 100).toString();
}

function fmtPct(n) {
  if (n == null) return '無資料';
  return `${n > 0 ? '+' : ''}${n.toFixed(1)}%`;
}

function fmtLots(n) {
  if (n == null) return '無資料';
  return `${n > 0 ? '+' : ''}${n.toLocaleString('en-US')}張`;
}

async function buildStockCheck(code, user) {
  const recentDates = loadRecentDays(5).map((d) => d.date);
  const [quotes, entry, revenueMap, epsMap, warningSet, insiderSet, flowMap] = await Promise.all([
    fetchQuotes([code]).catch(() => new Map()),
    checkWatchlistEntry([code], { stopLossPct: user.stopLossPct }).catch((err) => {
      console.error('[stockCheck] 技術面失敗:', err.message);
      return null;
    }),
    fetchRevenueGrowthMap().catch(() => new Map()),
    fetchEpsMap().catch(() => new Map()),
    fetchWarningCodeSet().catch(() => new Set()),
    fetchHeavyInsiderTransferCodeSet().catch(() => new Set()),
    fetchRecentInstitutionalFlow(recentDates).catch(() => new Map()),
  ]);

  const tech = entry && entry.results[0];
  const name = (tech && tech.name) || loadNameMap().get(code) || '';
  const quote = quotes.get(code);

  if (!quote && (!tech || tech.error)) {
    return `查不到 ${code} 的資料，請確認代號是否正確。`;
  }

  const sections = [];

  // 標頭＋報價
  const header = [`🩺 ${name ? `${code} ${name}` : code} 個股健檢`];
  if (quote) {
    header.push(`現價 ${fmt(quote.close)}（${fmtPct(quote.changePct)}，約15分鐘延遲）`);
  } else if (tech && !tech.error) {
    header.push(`最近收盤 ${fmt(tech.close)}`);
  }
  const position = user.positions.find((p) => p.code === code);
  const tags = [];
  if (user.watchlist.includes(code)) tags.push('在觀察名單中');
  if (position) {
    const price = quote ? quote.close : tech && tech.close;
    const pnl = price != null ? `，損益 ${fmtPct((price / position.cost - 1) * 100)}` : '';
    tags.push(`持有 ${position.lots} 張，成本 ${fmt(position.cost)}${pnl}`);
  }
  if (tags.length) header.push(`📎 ${tags.join('｜')}`);
  sections.push(header.join('\n'));

  // 技術面
  if (tech && !tech.error) {
    const passed = Object.values(tech.conditions).filter(Boolean).length;
    const total = Object.keys(tech.conditions).length;
    const trend = tech.conditions.aboveMa20 && tech.conditions.ma20AboveMa60 && tech.conditions.ma60Rising
      ? '多頭（站上月線、月線在季線上且季線走揚）'
      : tech.close < tech.ma20 ? '偏弱（收盤在月線下）' : '整理中（趨勢條件未全部成立）';
    sections.push([
      '【技術面】',
      `進場條件 ${passed}/${total} 項${tech.all ? ' 🔥 全部到齊' : ''}（傳「進場條件 ${code}」看逐項明細）`,
      `趨勢：${trend}`,
      `MA20 ${fmt(tech.ma20)}｜MA60 ${fmt(tech.ma60)}｜20日報酬 ${fmtPct(tech.ret20 * 100)}（約前${Math.max(1, Math.round((1 - tech.rsRank) * 100))}%）`,
      `支撐 ${fmt(tech.support)}｜樞紐 ${fmt(tech.pivot)}｜壓力 ${fmt(tech.resistance)}`,
    ].join('\n'));
  } else if (tech && tech.error) {
    // 不在上市行情資料裡（多半是上櫃股票）：基本面／籌碼／異常標記的資料源也只有上市公司，
    // 硬列出來只會全是「無資料」或誤導成「無異常」，直接說明後結束
    sections.push(`⚠️ ${tech.error}\n技術面、基本面、籌碼與異常標記目前只支援上市股票。`);
    return sections.join('\n\n');
  } else {
    sections.push('【技術面】\n資料暫時取得失敗（伺服器剛啟動時可能還在下載歷史行情），請稍後再試。');
  }

  // 基本面
  const rev = revenueMap.get(code);
  const eps = epsMap.get(code);
  sections.push([
    '【基本面】',
    rev ? `月營收 年增 ${fmtPct(rev.yoyGrowthPct)}｜月增 ${fmtPct(rev.momGrowthPct)}` : '月營收：無資料',
    eps ? `EPS（${eps.year}年第${eps.season}季）${fmt(eps.epsBasic)} 元` : 'EPS：無資料（金融保險類或非上市公司不在此資料中）',
  ].join('\n'));

  // 籌碼
  const flowDays = flowMap.daysCovered || 0;
  const flow = flowDays ? flowMap.get(code) : null;
  sections.push([
    flowDays ? `【籌碼】近${flowDays}個交易日法人買賣超` : '【籌碼】法人買賣超',
    flow
      ? `外資 ${fmtLots(flow.foreignNetLots)}｜投信 ${fmtLots(flow.trustNetLots)}｜三大法人合計 ${fmtLots(flow.totalNetLots)}`
      : '無資料',
  ].join('\n'));

  // 異常標記
  const flags = [];
  if (warningSet.has(code)) flags.push('注意股／處置股');
  if (insiderSet.has(code)) flags.push('近期內部人大幅申報轉讓');
  if (rev && rev.yoyGrowthPct != null && rev.yoyGrowthPct < 0) flags.push('月營收年增為負');
  if (eps && eps.epsBasic != null && eps.epsBasic < 0) flags.push('最近一季EPS為負');
  sections.push(flags.length ? `⚠️ ${flags.join('、')}` : '✅ 無異常標記');

  sections.push('※ 技術面進場條件經2年回測驗證；基本面、籌碼、異常標記為即時公開資料，未經回測驗證。僅供參考，非投資建議。');
  return sections.join('\n\n');
}

module.exports = { buildStockCheck };
