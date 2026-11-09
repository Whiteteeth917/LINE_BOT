// 證交所連不上時（例如雲端主機的 IP 被證交所封鎖）的歷史行情備援：
// 向 Yahoo Finance 逐檔抓 universeSnapshot.json 裡約 200 檔高流動性股票的一年日K，
// 轉成跟證交所快取相同格式的「每日一檔」JSON，存在 cache/yahoo/。
// loadCache 只在證交所快取沒有某一天時才用這裡的資料，所以證交所恢復後會自動以官方資料為準。
//
// 跟證交所資料的差異：只有這約 200 檔（不是全市場）；成交量比證交所少約 1～2 成（Yahoo 不含部分交易），
// 成交金額用「收盤價 × 成交量」估算。
const fs = require('fs');
const path = require('path');
const { YAHOO_DIR } = require('./loadCache');
const { isCompletedBarDate, taipeiNow, taipeiDateOf } = require('../src/dailyBarSources');
const { describeFetchError } = require('../src/fetchError');

const META_FILE = path.join(YAHOO_DIR, 'meta.json');
// 雲端主機的 IP 容易被限流，同時請求數壓低一點
const CONCURRENCY = 3;
const MIN_SUCCESS = 100; // 抓到的股票太少就不要覆蓋舊資料
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

function loadUniverseCodes() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'universeSnapshot.json'), 'utf8')).codes;
}

function loadNames() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'stockNamesSnapshot.json'), 'utf8'));
  } catch {
    return {};
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchYearBars(code) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(`${code}.TW`)}?range=1y&interval=1d`;
  let res;
  // 被限流（429）時等一下再試，最多 3 次
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(15000) });
    if (res.status !== 429) break;
    await sleep(2000 * (attempt + 1));
  }
  if (!res.ok) throw new Error(`Yahoo HTTP ${res.status}`);
  const r = (await res.json())?.chart?.result?.[0];
  const q = r?.indicators?.quote?.[0];
  if (!r || !q || !Array.isArray(r.timestamp)) return [];
  const bars = [];
  r.timestamp.forEach((t, i) => {
    const bar = { date: taipeiDateOf(t), open: q.open[i], high: q.high[i], low: q.low[i], close: q.close[i], volume: q.volume[i] };
    if ([bar.open, bar.high, bar.low, bar.close, bar.volume].some((v) => v == null)) return;
    if (!isCompletedBarDate(bar.date)) return; // 盤中還沒收完的今天那根不要
    bars.push(bar);
  });
  return bars;
}

function readMeta() {
  try {
    return JSON.parse(fs.readFileSync(META_FILE, 'utf8'));
  } catch {
    return null;
  }
}

// 需要重抓：沒抓過、超過 12 小時，或今天 14:30 收盤資料定案後還沒抓過
function isStale(meta = readMeta()) {
  if (!meta || !meta.builtAt) return true;
  const builtAt = new Date(meta.builtAt).getTime();
  if (Date.now() - builtAt > MAX_AGE_MS) return true;
  const now = taipeiNow();
  if (now.minutes >= 14 * 60 + 30) {
    const d = now.date;
    const todayClose = new Date(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T14:30:00+08:00`).getTime();
    if (builtAt < todayClose) return true;
  }
  return false;
}

async function buildYahooHistory() {
  const codes = loadUniverseCodes();
  const names = loadNames();
  const byDate = new Map(); // date -> rows
  let ok = 0;
  let failed = 0;
  let lastError = null;

  let next = 0;
  async function worker() {
    while (next < codes.length) {
      const code = codes[next++];
      try {
        const bars = await fetchYearBars(code);
        if (!bars.length) { failed++; continue; }
        ok++;
        for (const b of bars) {
          if (!byDate.has(b.date)) byDate.set(b.date, []);
          byDate.get(b.date).push({
            code, name: names[code] || code, volume: b.volume, value: Math.round(b.close * b.volume),
            open: b.open, high: b.high, low: b.low, close: b.close,
          });
        }
      } catch (err) {
        failed++;
        lastError = describeFetchError(err);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  if (ok < MIN_SUCCESS) {
    throw new Error(`Yahoo 只抓到 ${ok} 檔（失敗 ${failed}${lastError ? `，最後錯誤：${lastError}` : ''}），不覆蓋現有資料`);
  }

  // 先寫到暫存資料夾再整個換掉，避免讀到寫一半的資料
  const tmpDir = `${YAHOO_DIR}.tmp`;
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
  for (const [date, rows] of byDate) fs.writeFileSync(path.join(tmpDir, `${date}.json`), JSON.stringify(rows));
  const dates = [...byDate.keys()].sort();
  const meta = { builtAt: new Date().toISOString(), stocks: ok, failed, days: dates.length, latestDate: dates[dates.length - 1] };
  fs.writeFileSync(path.join(tmpDir, 'meta.json'), JSON.stringify(meta));
  fs.rmSync(YAHOO_DIR, { recursive: true, force: true });
  fs.renameSync(tmpDir, YAHOO_DIR);
  return meta;
}

let building = null;
// 最近一次建立的結果（給 /healthz 與錯誤訊息用）
const status = { lastAttemptAt: null, lastError: null };
// 過期才重抓；同時間只跑一次
function refreshYahooHistoryIfStale() {
  if (!isStale()) return Promise.resolve(readMeta());
  if (!building) {
    console.log('[yahooHistory] 開始從 Yahoo 建立歷史行情備援');
    const started = Date.now();
    status.lastAttemptAt = new Date().toISOString();
    building = buildYahooHistory()
      .then((meta) => {
        status.lastError = null;
        console.log(`[yahooHistory] 完成：${meta.stocks} 檔、${meta.days} 天（到 ${meta.latestDate}），${Math.round((Date.now() - started) / 1000)} 秒`);
        return meta;
      })
      .catch((err) => {
        status.lastError = err.message;
        console.error('[yahooHistory] 失敗:', err.message);
        return null;
      })
      .finally(() => { building = null; });
  }
  return building;
}

// 給選股／進場條件／戰績呼叫：歷史行情不夠時，當場用 Yahoo 補（約 15 秒）。
// 剛失敗過 3 分鐘內不重試，避免每個指令都重打一次 Yahoo。
const RETRY_AFTER_FAIL_MS = 3 * 60 * 1000;
async function ensureHistory(loadRecentDays, minDays) {
  if (loadRecentDays(minDays).length >= minDays) return;
  const recentFail = status.lastError && status.lastAttemptAt && Date.now() - new Date(status.lastAttemptAt).getTime() < RETRY_AFTER_FAIL_MS;
  if (!recentFail) await refreshYahooHistoryIfStale();
  const have = loadRecentDays(minDays).length;
  if (have >= minDays) return;
  const err = new Error(
    status.lastError
      ? `歷史行情不足（${have} 天），證交所連不上，Yahoo 備援也失敗：${status.lastError}`
      : `歷史行情還在下載中（目前 ${have} 天），請約 1 分鐘後再試`
  );
  err.userMessage = err.message;
  throw err;
}

function getStatus() {
  return { ...status, building: Boolean(building), meta: readMeta() };
}

module.exports = { buildYahooHistory, refreshYahooHistoryIfStale, readMeta, isStale, ensureHistory, getStatus };
