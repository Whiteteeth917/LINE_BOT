// 三大法人（外資／投信／自營商）每日買賣超，TWSE 公開資料（免費、不需金鑰）
// https://www.twse.com.tw/fund/T86
const fs = require('fs');
const path = require('path');
const { CACHE_DIR } = require('./loadCache');
const { describeFetchError } = require('../src/fetchError');

// 某一天的法人買賣超公布後就不會再變，存到硬碟後就不必重抓（整份全市場資料一天約 3 秒）。
// 放在行情快取資料夾底下的子資料夾，雲端主機重啟後會跟著行情快取一起清空、重抓。
const T86_DIR = path.join(CACHE_DIR, 't86');
// 證交所連不上時，10 分鐘內不再嘗試（否則每次查詢都要等好幾次逾時）
const COOLDOWN_MS = 10 * 60 * 1000;
let failedAt = 0;

function parseNumber(s) {
  const n = parseFloat(String(s).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

async function fetchT86(dateStr) {
  const url = `https://www.twse.com.tw/fund/T86?response=json&date=${dateStr}&selectType=ALL`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json.stat !== 'OK' || !Array.isArray(json.data)) return null;

  const fields = json.fields;
  const idx = (name) => fields.indexOf(name);
  const iCode = idx('證券代號');
  const iForeign1 = idx('外陸資買賣超股數(不含外資自營商)');
  const iForeign2 = idx('外資自營商買賣超股數');
  const iTrust = idx('投信買賣超股數');
  const iDealer = idx('自營商買賣超股數');
  const iTotal = idx('三大法人買賣超股數');

  const map = new Map();
  for (const row of json.data) {
    const code = row[iCode]?.trim();
    if (!code) continue;
    const foreignNet = (parseNumber(row[iForeign1]) || 0) + (parseNumber(row[iForeign2]) || 0);
    map.set(code, {
      foreignNet,
      trustNet: parseNumber(row[iTrust]) || 0,
      dealerNet: parseNumber(row[iDealer]) || 0,
      totalNet: parseNumber(row[iTotal]) || 0,
    });
  }
  return map;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// recentDates: 由呼叫端傳入已知的近N個交易日日期（'YYYYMMDD'），避免重複判斷假日
// 回傳 code -> { foreignNetLots, trustNetLots, totalNetLots }（單位：張，1張=1000股）
function readCachedDay(dateStr) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(T86_DIR, `${dateStr}.json`), 'utf8'));
    return new Map(raw);
  } catch {
    return null;
  }
}

function writeCachedDay(dateStr, dayMap) {
  try {
    fs.mkdirSync(T86_DIR, { recursive: true });
    fs.writeFileSync(path.join(T86_DIR, `${dateStr}.json`), JSON.stringify([...dayMap.entries()]));
  } catch (err) {
    console.warn('[institutionalFlow] 寫入快取失敗:', err.message);
  }
}

// 先讀硬碟快取，沒有的日期才向證交所抓；一遇到連線失敗就停止（剩下的日期不再硬打）
async function loadDay(dateStr, state) {
  const cached = readCachedDay(dateStr);
  if (cached) return cached;
  if (state.stopped || Date.now() - failedAt < COOLDOWN_MS) return null;
  if (state.fetchedAny) await sleep(2000); // 證交所限制約每 5 秒 3 次請求
  state.fetchedAny = true;
  try {
    const dayMap = await fetchT86(dateStr);
    if (dayMap) writeCachedDay(dateStr, dayMap);
    return dayMap;
  } catch (err) {
    failedAt = Date.now();
    state.stopped = true;
    console.warn(`[institutionalFlow] ${dateStr} 取得失敗，先停止抓取:`, describeFetchError(err));
    return null;
  }
}

async function fetchRecentInstitutionalFlow(recentDates) {
  const sums = new Map();
  const state = { stopped: false, fetchedAny: false };
  let daysCovered = 0;

  for (const dateStr of recentDates) {
    const dayMap = await loadDay(dateStr, state);
    if (dayMap) {
      daysCovered++;
      for (const [code, v] of dayMap.entries()) {
        const acc = sums.get(code) || { foreignNet: 0, trustNet: 0, totalNet: 0 };
        acc.foreignNet += v.foreignNet;
        acc.trustNet += v.trustNet;
        acc.totalNet += v.totalNet;
        sums.set(code, acc);
      }
    }
  }

  const result = new Map();
  for (const [code, v] of sums.entries()) {
    result.set(code, {
      foreignNetLots: Math.round(v.foreignNet / 1000),
      trustNetLots: Math.round(v.trustNet / 1000),
      totalNetLots: Math.round(v.totalNet / 1000),
    });
  }
  // 實際有資料的天數（證交所連不上時可能少於要求的天數），顯示時要照實寫
  result.daysCovered = daysCovered;
  return result;
}

module.exports = { fetchT86, fetchRecentInstitutionalFlow };
