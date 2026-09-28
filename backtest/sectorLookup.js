// 產業別分類，沿用月營收資料集裡的「產業別」欄位（TWSE 官方標準分類，免費、不需金鑰）
const REVENUE_URL = 'https://openapi.twse.com.tw/v1/opendata/t187ap05_L';

// 口語關鍵字 -> TWSE 官方產業別，方便不熟股票分類的人查詢
const ALIASES = {
  重電: '電機機械',
  電機: '電機機械',
  半導體: '半導體業',
  IC: '半導體業',
  晶片: '半導體業',
  航運: '航運業',
  航海: '航運業',
  貨櫃: '航運業',
  生技: '生技醫療業',
  醫療: '生技醫療業',
  製藥: '生技醫療業',
  金融: '金融保險業',
  銀行: '金融保險業',
  保險: '金融保險業',
  觀光: '觀光餐旅',
  餐旅: '觀光餐旅',
  航空: '觀光餐旅',
  雲端: '數位雲端',
  AI: '電子零組件業',
  伺服器: '電腦及週邊設備業',
  綠能: '綠能環保',
  太陽能: '綠能環保',
  鋼鐵: '鋼鐵工業',
  鋼鐵股: '鋼鐵工業',
  汽車: '汽車工業',
  電動車: '汽車工業',
  食品: '食品工業',
  塑膠: '塑膠工業',
  紡織: '紡織纖維',
  通信: '通信網路業',
  網通: '通信網路業',
  光電: '光電業',
  面板: '光電業',
  電子通路: '電子通路業',
  資訊服務: '資訊服務業',
  油電: '油電燃氣業',
  貿易: '貿易百貨',
  百貨: '貿易百貨',
};

let cachedCodeToIndustry = null;
let cachedCategories = null;

async function loadIndustryMap() {
  if (cachedCodeToIndustry) return cachedCodeToIndustry;

  const res = await fetch(REVENUE_URL, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const rows = await res.json();

  const map = new Map();
  const categories = new Set();
  for (const r of rows) {
    const code = r['公司代號'];
    const industry = r['產業別'];
    if (!code || !industry) continue;
    map.set(code, industry);
    categories.add(industry);
  }

  cachedCodeToIndustry = map;
  cachedCategories = [...categories];
  return map;
}

async function listCategories() {
  await loadIndustryMap();
  return cachedCategories;
}

// 把使用者輸入的關鍵字解析成官方產業別；找不到精確/別名對應時，用包含比對抓最相近的一個
async function resolveCategory(keyword) {
  const categories = await listCategories();
  const trimmed = keyword.trim();

  if (categories.includes(trimmed)) return trimmed;
  if (ALIASES[trimmed]) return ALIASES[trimmed];

  const partial = categories.find((c) => c.includes(trimmed) || trimmed.includes(c));
  return partial || null;
}

async function getCodesByCategory(category) {
  const map = await loadIndustryMap();
  const codes = [];
  for (const [code, industry] of map.entries()) {
    if (industry === category) codes.push(code);
  }
  return codes;
}

module.exports = { loadIndustryMap, listCategories, resolveCategory, getCodesByCategory };
