const fs = require('fs');
const path = require('path');

const CACHE_DIR = path.join(__dirname, 'cache');

// 回傳依日期排序的 [{ date: 'YYYYMMDD', rows: [...] }]，自動略過假日檔案
function loadAllDays() {
  const files = fs.readdirSync(CACHE_DIR).filter((f) => f.endsWith('.json')).sort();
  const days = [];
  for (const f of files) {
    const content = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, f), 'utf8'));
    if (content.holiday) continue;
    days.push({ date: f.replace('.json', ''), rows: content });
  }
  return days;
}

module.exports = { loadAllDays, CACHE_DIR };
