// 不依賴證交所的「單一個股最近一個完整交易日 OHLC」來源。
// 雲端主機（例如 Render）常常連不上證交所的任何網站，這些是備援：
//   1. Yahoo Finance（上市 .TW、上櫃 .TWO 都有）
//   2. FinMind（只有已收盤的日資料）
//   3. 鉅亨網 cnyes（附中文名稱）
// 剛失敗過的來源 10 分鐘內直接跳過，避免每次都要等逾時（LINE 回覆有時間限制）。
const { describeFetchError } = require('./fetchError');

const TIMEOUT_MS = 8000;
const COOLDOWN_MS = 10 * 60 * 1000;
// 收盤 13:30，留點時間讓各來源的當日 K 棒定案；這之前「今天」那根是盤中未完成的，不能拿來算樞紐點
const SESSION_FINAL_MINUTES = 14 * 60;

const failedAt = new Map(); // source -> timestamp

function taipeiNow() {
  // 'YYYY-MM-DD HH:MM:SS'（sv-SE 格式）
  const s = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Taipei' });
  return { date: s.slice(0, 10).replace(/-/g, ''), minutes: Number(s.slice(11, 13)) * 60 + Number(s.slice(14, 16)) };
}

function taipeiDateOf(unixSec) {
  return new Date((unixSec + 8 * 3600) * 1000).toISOString().slice(0, 10).replace(/-/g, '');
}

// bars: [{ date: 'YYYYMMDD', open, high, low, close }]，任意順序
// 這一天的日K是否已經定案（今天要等到 14:00 後）
function isCompletedBarDate(date) {
  const now = taipeiNow();
  return date < now.date || (date === now.date && now.minutes >= SESSION_FINAL_MINUTES);
}

function latestCompletedBar(bars) {
  const usable = bars
    .filter((b) => b.high != null && b.low != null && b.close != null)
    .filter((b) => isCompletedBarDate(b.date))
    .sort((a, b) => a.date.localeCompare(b.date));
  return usable[usable.length - 1] || null;
}

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  return { status: res.status, ok: res.ok, json: res.ok ? await res.json() : null };
}

// ---- 各來源：查得到回傳 bar，「這檔沒有資料」回傳 null，連線問題丟出錯誤 ----

async function fromYahoo(code) {
  for (const suffix of ['.TW', '.TWO']) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(code + suffix)}?range=10d&interval=1d`;
    const { status, ok, json } = await getJson(url);
    if (status === 404) continue; // 不是上市就試上櫃
    if (!ok) throw new Error(`Yahoo HTTP ${status}`);
    const r = json?.chart?.result?.[0];
    const q = r?.indicators?.quote?.[0];
    if (!r || !q || !Array.isArray(r.timestamp)) continue;
    const bars = r.timestamp.map((t, i) => ({
      date: taipeiDateOf(t), open: q.open[i], high: q.high[i], low: q.low[i], close: q.close[i],
    }));
    const bar = latestCompletedBar(bars);
    if (bar) return bar;
  }
  return null;
}

async function fromFinMind(code) {
  const since = new Date(Date.now() - 20 * 864e5).toISOString().slice(0, 10);
  const url = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPrice&data_id=${encodeURIComponent(code)}&start_date=${since}`;
  const { status, ok, json } = await getJson(url);
  if (!ok) throw new Error(`FinMind HTTP ${status}`);
  const bars = (json?.data || []).map((r) => ({
    date: String(r.date).replace(/-/g, ''), open: r.open, high: r.max, low: r.min, close: r.close,
  }));
  return latestCompletedBar(bars);
}

async function fromCnyes(code) {
  const url = `https://ws.api.cnyes.com/ws/api/v1/charting/history?symbol=TWS:${encodeURIComponent(code)}:STOCK&resolution=D&quote=1`;
  const { status, ok, json } = await getJson(url);
  if (!ok) throw new Error(`cnyes HTTP ${status}`);
  const d = json?.data;
  if (!d || !Array.isArray(d.t)) return null;
  const bars = d.t.map((t, i) => ({ date: taipeiDateOf(t), open: d.o[i], high: d.h[i], low: d.l[i], close: d.c[i] }));
  const bar = latestCompletedBar(bars);
  const name = d.quote && typeof d.quote['200009'] === 'string' ? d.quote['200009'] : null;
  return bar ? { ...bar, name } : null;
}

const SOURCES = [
  ['yahoo', fromYahoo],
  ['finmind', fromFinMind],
  ['cnyes', fromCnyes],
];

// 依序嘗試各來源，回傳 { date: 'YYYYMMDD', open, high, low, close, source, name? }；全部失敗丟出錯誤
async function fetchLatestBar(code) {
  const errors = [];
  let skipped = 0;
  for (const [name, fn] of SOURCES) {
    const last = failedAt.get(name);
    if (last && Date.now() - last < COOLDOWN_MS) {
      skipped++;
      continue;
    }
    try {
      const bar = await fn(code);
      if (bar) return { ...bar, source: name };
    } catch (err) {
      failedAt.set(name, Date.now());
      const reason = describeFetchError(err);
      errors.push(`${name}: ${reason}`);
      console.warn(`[dailyBarSources] ${name} 失敗（${code}）:`, reason);
    }
  }
  if (errors.length) throw new Error(`備用來源都失敗（${errors.join('；')}）`);
  if (skipped === SOURCES.length) throw new Error('資料來源暫時都連不上，約 10 分鐘後會再試');
  throw new Error('查無資料');
}

module.exports = { fetchLatestBar, latestCompletedBar, isCompletedBarDate, taipeiNow, taipeiDateOf };
