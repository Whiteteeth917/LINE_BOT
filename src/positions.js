// 持股紀錄＋出場檢查。
// 出場規則跟回測引擎（backtest/engine.js）同一套：
//   1. 價格 ≤ 成本 × (1 − 停損%) → 停損出場
//   2. 持有滿 15 個交易日後，跌破 20 日均線 → 出場（未滿 15 天前跌破均線不出場，只看停損）
//   3. 持有滿 80 個交易日 → 出場
// 回測是用收盤價判斷；盤中價格只是提醒，實際以收盤確認。
const { fetchQuotes } = require('./intradayQuotes');
const { loadRecentDays } = require('../backtest/loadCache');
const { buildSeriesByCode } = require('../backtest/buildSeries');
const { annotateSeries } = require('../backtest/indicators');
const { EXIT_RULES } = require('../backtest/strategy');
const { loadNameMap, stockLabel } = require('./stockNames');

const SHARES_PER_LOT = 1000;

function fmt(n) {
  return n == null ? '－' : (Math.round(n * 100) / 100).toString();
}

function fmtSignedPct(n) {
  return `${n > 0 ? '+' : ''}${n.toFixed(1)}%`;
}

function fmtMoney(n) {
  const rounded = Math.round(n);
  return `${rounded > 0 ? '+' : ''}${rounded.toLocaleString('en-US')}元`;
}

function fmtLots(lots) {
  return `${Math.round(lots * 1000) / 1000}張`;
}

function fmtDate(yyyymmdd) {
  return `${yyyymmdd.slice(0, 4)}/${yyyymmdd.slice(4, 6)}/${yyyymmdd.slice(6, 8)}`;
}

// 台北時間的今天 YYYYMMDD（跟伺服器時區無關）
function todayTaipei() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' }).replace(/-/g, '');
}

// ---- 持股增減（純函式，回傳新的 positions 陣列）----

// 同一檔重複買進視為加碼：張數相加、成本加權平均、買進日期保留第一次
function addPosition(positions, { code, cost, lots }) {
  const existing = positions.find((p) => p.code === code);
  if (!existing) {
    return { positions: [...positions, { code, cost, lots, buyDate: todayTaipei() }], merged: null };
  }
  const totalLots = existing.lots + lots;
  const merged = {
    ...existing,
    lots: totalLots,
    cost: (existing.cost * existing.lots + cost * lots) / totalLots,
  };
  return { positions: positions.map((p) => (p.code === code ? merged : p)), merged };
}

// lots 不填＝全部賣出；回傳 { positions, sold: {code, cost, lots, buyDate} | null, remaining }
function removePosition(positions, code, lots) {
  const existing = positions.find((p) => p.code === code);
  if (!existing) return { positions, sold: null, remaining: 0 };
  const sellLots = lots == null || lots >= existing.lots ? existing.lots : lots;
  const remaining = existing.lots - sellLots;
  const next = remaining > 1e-9
    ? positions.map((p) => (p.code === code ? { ...p, lots: remaining } : p))
    : positions.filter((p) => p.code !== code);
  return { positions: next, sold: { ...existing, lots: sellLots }, remaining: remaining > 1e-9 ? remaining : 0 };
}

// ---- 出場檢查 ----

// 用已收盤資料算 20 日均線、最近收盤價，以及每檔「買進後經過幾個交易日」
function loadClosedData(codes) {
  const days = loadRecentDays(EXIT_RULES.maxHoldDays + 30);
  const seriesMap = buildSeriesByCode(days, codes);
  const tradingDates = days.map((d) => d.date);
  const byCode = new Map();
  for (const code of codes) {
    const series = seriesMap.get(code);
    if (!series || !series.length) continue;
    annotateSeries(series);
    const last = series[series.length - 1];
    byCode.set(code, { ma20: last.ma20, lastClose: last.close, lastDate: last.date });
  }
  return { byCode, tradingDates };
}

function evaluatePosition(pos, quote, closed, tradingDates, stopLossPct) {
  const price = quote ? quote.close : closed ? closed.lastClose : null;
  // 跟回測一致：買進當天算第 0 天，之後每個交易日 +1
  const daysHeld = tradingDates.filter((d) => d > pos.buyDate).length;
  // 買進日早於讀進來的資料範圍時，實際天數比算出來的多（反正已超過最長持有，只標示「以上」）
  const heldText = tradingDates.length && pos.buyDate < tradingDates[0] ? `${daysHeld}+` : `${daysHeld}`;
  const stopPrice = pos.cost * (1 - stopLossPct / 100);
  const ma20 = closed ? closed.ma20 : null;

  if (price == null) {
    return { pos, price: null, daysHeld, stopPrice, ma20, heldText, action: 'unknown', status: '⚪ 報價取得失敗' };
  }

  const pnlPct = (price / pos.cost - 1) * 100;
  const pnlAmount = (price - pos.cost) * pos.lots * SHARES_PER_LOT;
  const belowMa20 = ma20 != null && price < ma20;
  const pastMinHold = daysHeld >= EXIT_RULES.minHoldDays;

  let action;
  let status;
  if (price <= stopPrice) {
    action = 'exit';
    status = `🔴 觸及停損 ${fmt(stopPrice)}，依規則出場`;
  } else if (daysHeld >= EXIT_RULES.maxHoldDays) {
    action = 'exit';
    status = `⏰ 已持有 ${heldText} 個交易日，達最長持有 ${EXIT_RULES.maxHoldDays} 天，依規則出場`;
  } else if (belowMa20 && pastMinHold) {
    action = 'exit';
    status = `⚠️ 跌破20日均線 ${fmt(ma20)}，收盤仍在均線下就出場`;
  } else if (belowMa20) {
    action = 'hold';
    status = `🟡 跌破20日均線，但持有未滿 ${EXIT_RULES.minHoldDays} 個交易日，依規則續抱（只看停損）`;
  } else {
    action = 'hold';
    status = '🟢 續抱';
  }

  return { pos, price, pnlPct, pnlAmount, daysHeld, heldText, stopPrice, ma20, action, status, live: Boolean(quote) };
}

async function evaluatePositions(positions, stopLossPct) {
  const codes = positions.map((p) => p.code);
  const quotes = await fetchQuotes(codes).catch(() => new Map());
  const { byCode, tradingDates } = loadClosedData(codes);
  return positions.map((p) => evaluatePosition(p, quotes.get(p.code), byCode.get(p.code), tradingDates, stopLossPct));
}

function distanceLine(e) {
  const parts = [`停損 ${fmt(e.stopPrice)}（距 ${fmtSignedPct((e.stopPrice / e.price - 1) * 100)}）`];
  if (e.ma20 != null) parts.push(`20MA ${fmt(e.ma20)}（距 ${fmtSignedPct((e.ma20 / e.price - 1) * 100)}）`);
  return parts.join('｜');
}

function buildPositionBlock(e, nameMap) {
  const label = stockLabel(e.pos.code, nameMap);
  const head = `📌 ${label}　${fmtLots(e.pos.lots)}　成本 ${fmt(e.pos.cost)}`;
  if (e.price == null) return [head, `　${e.status}`].join('\n');
  return [
    head,
    `　現價 ${fmt(e.price)}${e.live ? '' : '（最近收盤）'}　損益 ${fmtSignedPct(e.pnlPct)}／${fmtMoney(e.pnlAmount)}`,
    `　${fmtDate(e.pos.buyDate)} 買進，已持有 ${e.heldText} 個交易日`,
    `　${distanceLine(e)}`,
    `　${e.status}`,
  ].join('\n');
}

async function buildPositionsReport(user) {
  if (!user.positions.length) {
    return '目前沒有持股紀錄。\n買進後傳「買進 代號 成本 張數」記錄，例如「買進 2412 163.5 2」。';
  }
  const evaluations = await evaluatePositions(user.positions, user.stopLossPct);
  const nameMap = loadNameMap();

  const priced = evaluations.filter((e) => e.price != null);
  const totalCost = priced.reduce((s, e) => s + e.pos.cost * e.pos.lots * SHARES_PER_LOT, 0);
  const totalPnl = priced.reduce((s, e) => s + e.pnlAmount, 0);
  const exits = evaluations.filter((e) => e.action === 'exit');

  const sections = [
    `💼 我的持股（${evaluations.length} 檔，報價約15分鐘延遲）`,
    totalCost > 0 ? `總損益 ${fmtMoney(totalPnl)}（${fmtSignedPct((totalPnl / totalCost) * 100)}）` : null,
    exits.length ? `🚨 有 ${exits.length} 檔觸發出場條件：${exits.map((e) => e.pos.code).join('、')}` : '✅ 目前沒有持股觸發出場條件',
    ...evaluations.map((e) => buildPositionBlock(e, nameMap)),
    [
      `※ 出場規則（與回測相同）：跌破成本 −${user.stopLossPct}% 停損；持有滿 ${EXIT_RULES.minHoldDays} 個交易日後跌破20日均線出場；最長持有 ${EXIT_RULES.maxHoldDays} 個交易日。`,
      '※ 回測以收盤價判斷，盤中暫時跌破請以收盤確認。損益未扣手續費與證交稅。僅供參考，非投資建議。',
    ].join('\n'),
  ].filter(Boolean);

  return sections.join('\n\n');
}

// 盤中檢查訊息裡的精簡版（一檔一行）
async function buildPositionLines(user) {
  if (!user.positions.length) return { lines: [], exitCount: 0 };
  const evaluations = await evaluatePositions(user.positions, user.stopLossPct);
  const nameMap = loadNameMap();
  const lines = evaluations.map((e) => {
    const label = stockLabel(e.pos.code, nameMap);
    if (e.price == null) return `${label}　${e.status}`;
    return `${label}　現價 ${fmt(e.price)}｜損益 ${fmtSignedPct(e.pnlPct)}｜${e.status}`;
  });
  return { lines, exitCount: evaluations.filter((e) => e.action === 'exit').length };
}

module.exports = {
  addPosition,
  removePosition,
  buildPositionsReport,
  buildPositionLines,
  evaluatePositions,
  fmtMoney,
  fmtSignedPct,
  fmtLots,
  fmt,
  SHARES_PER_LOT,
};
