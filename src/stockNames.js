const fs = require('fs');
const path = require('path');
const { CACHE_DIR } = require('../backtest/loadCache');

// 內建的代號→名稱對照（上市＋上櫃），快取還沒下載（例如雲端主機剛重啟、或連不上證交所）時也能顯示名稱。
// 名稱很少變動；要更新時重新產生 src/stockNamesSnapshot.json 即可。
let snapshot = null;
function loadSnapshot() {
  if (!snapshot) {
    try {
      snapshot = JSON.parse(fs.readFileSync(path.join(__dirname, 'stockNamesSnapshot.json'), 'utf8'));
    } catch (err) {
      console.error('[stockNames] 讀取內建名稱表失敗:', err.message);
      snapshot = {};
    }
  }
  return snapshot;
}

// 代號 -> 名稱。以內建名稱表為底，再用最新一個非假日的行情快取覆蓋（只讀一個檔案，不必載入全部歷史）
function loadNameMap() {
  const map = new Map(Object.entries(loadSnapshot()));
  try {
    const files = fs.existsSync(CACHE_DIR)
      ? fs.readdirSync(CACHE_DIR).filter((f) => f.endsWith('.json')).sort().reverse()
      : [];
    for (const f of files) {
      const content = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, f), 'utf8'));
      if (content.holiday) continue;
      for (const r of content) map.set(r.code, r.name);
      break;
    }
  } catch (err) {
    console.error('[stockNames] 讀取快取失敗:', err.message);
  }
  return map;
}

// 「2330 台積電」；查不到名稱時只顯示代號
function stockLabel(code, nameMap) {
  const name = nameMap.get(code);
  return name ? `${code} ${name}` : code;
}

module.exports = { loadNameMap, stockLabel };
