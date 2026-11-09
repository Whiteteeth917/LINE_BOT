// 收盤後訊號通知：對每個人的觀察名單跑一次進場條件，只在
//   1. 6 項全部到齊（符合進場訊號）
//   2. 只差 1 項（附上下一交易日要達成的門檻）
// 時推播，其他時候不推，避免浪費 LINE 推播額度。已經持有的股票不提醒進場。
const { checkWatchlistEntry } = require('../backtest/watchlistEntry');
const { VOLUME_SURGE_MULTIPLE } = require('../backtest/strategy');

function fmt(n) {
  return n == null ? '－' : (Math.round(n * 100) / 100).toString();
}

function fmtPct(ratio) {
  const pct = ratio * 100;
  return `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

function fmtLots(shares) {
  return `${Math.round(shares / 1000).toLocaleString('en-US')}張`;
}

// 每項條件沒成立時，下一交易日要達成什麼
function missingHint(key, r, meta) {
  switch (key) {
    case 'aboveMa20':
      return `站上月線：收盤需 > ${fmt(r.ma20)}`;
    case 'ma20AboveMa60':
      return `月線在季線上：MA20 ${fmt(r.ma20)} 需 > MA60 ${fmt(r.ma60)}`;
    case 'ma60Rising':
      return '季線走揚：季線還在下彎，需等季線翻揚';
    case 'relativeStrength':
      return `相對強度前${Math.round((1 - meta.rsPercentile) * 100)}%：20日報酬 ${fmtPct(r.ret20)}，今日門檻 ${meta.rsThresholdRet20 != null ? fmtPct(meta.rsThresholdRet20) : '－'}`;
    case 'high20':
      return `創20日新高：收盤需 ≥ ${fmt(r.nextHigh20)}`;
    case 'volumeSurge':
      return `爆量：成交量需 > ${fmtLots(r.nextVolumeNeeded)}（20日均量${VOLUME_SURGE_MULTIPLE}倍）`;
    default:
      return key;
  }
}

function buildUserMessage(user, entry) {
  const held = new Set(user.positions.map((p) => p.code));
  const byCode = new Map(entry.results.map((r) => [r.code, r]));
  const full = [];
  const near = [];

  for (const code of user.watchlist) {
    const r = byCode.get(code);
    if (!r || r.error || held.has(code)) continue;
    const label = r.name ? `${r.code} ${r.name}` : r.code;
    const missing = Object.entries(r.conditions).filter(([, ok]) => !ok).map(([k]) => k);
    if (missing.length === 0) {
      const stop = r.support * (1 - user.stopLossPct / 100);
      full.push(`🔥 ${label}　收盤 ${fmt(r.close)}\n　進場參考區 ${fmt(r.support)}~${fmt(r.pivot)}｜目標 ${fmt(r.resistance)}｜停損參考 ${fmt(stop)}`);
    } else if (missing.length === 1) {
      near.push(`👀 ${label}　收盤 ${fmt(r.close)}\n　只差「${missingHint(missing[0], r, entry)}」`);
    }
  }

  if (!full.length && !near.length) return null;

  const d = entry.date;
  const sections = [`📣 收盤訊號通知（${d.slice(4, 6)}/${d.slice(6, 8)}）`];
  if (full.length) sections.push(['【符合進場訊號】隔天開盤可考慮進場', ...full].join('\n'));
  if (near.length) sections.push(['【只差一項】先盯著', ...near].join('\n'));
  sections.push('傳「進場條件」看逐項明細。不想收到這類通知：傳「訊號推播 關」。\n※ 僅供參考，非投資建議。');
  return sections.join('\n\n');
}

// users: [{ userId, user }]；回傳 { date, messages: [{ userId, text }] }；
// date 為 null 代表今天的收盤資料還沒出來（或今天休市），呼叫端應略過
async function buildSignalMessages(users, todayDate) {
  const codes = [...new Set(users.flatMap(({ user }) => user.watchlist))];
  if (!codes.length) return { date: null, messages: [] };

  const entry = await checkWatchlistEntry(codes);
  if (todayDate != null && entry.date !== todayDate) return { date: null, messages: [] };

  const messages = [];
  for (const { userId, user } of users) {
    const text = buildUserMessage(user, entry);
    if (text) messages.push({ userId, text });
  }
  return { date: entry.date, messages };
}

module.exports = { buildSignalMessages, buildUserMessage };
