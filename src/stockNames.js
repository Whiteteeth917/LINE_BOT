const fs = require('fs');
const path = require('path');
const { CACHE_DIR } = require('../backtest/loadCache');

// 從最新一個非假日的行情快取取出 代號 -> 名稱 對照（只讀一個檔案，不必載入全部歷史）
function loadNameMap() {
  try {
    const files = fs.readdirSync(CACHE_DIR).filter((f) => f.endsWith('.json')).sort().reverse();
    for (const f of files) {
      const content = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, f), 'utf8'));
      if (content.holiday) continue;
      return new Map(content.map((r) => [r.code, r.name]));
    }
  } catch (err) {
    console.error('[stockNames] 讀取快取失敗:', err.message);
  }
  return new Map();
}

// 「2330 台積電」；查不到名稱（例如上櫃股票或快取缺漏）時只顯示代號
function stockLabel(code, nameMap) {
  const name = nameMap.get(code);
  return name ? `${code} ${name}` : code;
}

module.exports = { loadNameMap, stockLabel };
