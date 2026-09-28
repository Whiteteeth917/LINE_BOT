// 基本面／異常排除資料，全部是 TWSE OpenAPI 免費公開資料，即時抓最新一期，不需金鑰。
// 注意：這些資料源官方只給「最新一期」，沒有歷史查詢，所以只能用在「即時篩選」，
// 不能用來回測過去（回測結果不包含這層過濾的效果）。

const REVENUE_URL = 'https://openapi.twse.com.tw/v1/opendata/t187ap05_L';
const EPS_URL = 'https://openapi.twse.com.tw/v1/opendata/t187ap06_L_ci';
const NOTICE_URL = 'https://openapi.twse.com.tw/v1/announcement/notice';
const PUNISH_URL = 'https://openapi.twse.com.tw/v1/announcement/punish';
const INSIDER_TRANSFER_URL = 'https://openapi.twse.com.tw/v1/opendata/t187ap12_L';

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

function parseNumber(s) {
  if (s === '' || s == null) return null;
  const n = parseFloat(String(s).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

// code -> { yoyGrowthPct, momGrowthPct }
async function fetchRevenueGrowthMap() {
  const rows = await fetchJson(REVENUE_URL);
  const map = new Map();
  for (const r of rows) {
    const code = r['公司代號'];
    if (!code) continue;
    map.set(code, {
      yoyGrowthPct: parseNumber(r['營業收入-去年同月增減(%)']),
      momGrowthPct: parseNumber(r['營業收入-上月比較增減(%)']),
    });
  }
  return map;
}

// code -> { epsBasic, season, year }（只有一般業公司會出現在這份資料，金融/保險/證券等控股類公司不在這裡）
async function fetchEpsMap() {
  const rows = await fetchJson(EPS_URL);
  const map = new Map();
  for (const r of rows) {
    const code = r['公司代號'];
    if (!code) continue;
    map.set(code, {
      epsBasic: parseNumber(r['基本每股盈餘（元）']),
      season: r['季別'],
      year: r['年度'],
    });
  }
  return map;
}

// 回傳今天有被公告「注意」或「處置」的股票代碼集合
async function fetchWarningCodeSet() {
  const codes = new Set();

  try {
    const notice = await fetchJson(NOTICE_URL);
    for (const r of notice) if (r.Code) codes.add(r.Code);
  } catch (err) {
    console.warn('[fundamentals] 注意股資料取得失敗:', err.message);
  }

  try {
    const punish = await fetchJson(PUNISH_URL);
    for (const r of punish) if (r.Code) codes.add(r.Code);
  } catch (err) {
    console.warn('[fundamentals] 處置股資料取得失敗:', err.message);
  }

  return codes;
}

// 回傳「近期有大幅申報轉讓」的股票代碼集合（轉讓股數 / 自有持股 >= 30%）
async function fetchHeavyInsiderTransferCodeSet(thresholdRatio = 0.3) {
  const codes = new Set();
  try {
    const rows = await fetchJson(INSIDER_TRANSFER_URL);
    for (const r of rows) {
      const code = r['公司代號'];
      const transferShares = parseNumber(r['預定轉讓方式及股數-轉讓股數']);
      const heldShares = parseNumber(r['目前持有股數-自有持股']);
      if (!code || transferShares == null || !heldShares) continue;
      if (transferShares / heldShares >= thresholdRatio) codes.add(code);
    }
  } catch (err) {
    console.warn('[fundamentals] 內部人持股轉讓資料取得失敗:', err.message);
  }
  return codes;
}

module.exports = {
  fetchRevenueGrowthMap,
  fetchEpsMap,
  fetchWarningCodeSet,
  fetchHeavyInsiderTransferCodeSet,
};
