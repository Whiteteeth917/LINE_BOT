const fs = require('fs');
const path = require('path');

const CACHE_DIR = path.join(__dirname, 'cache');

// 回傳依日期排序的 [{ date: 'YYYYMMDD', rows: [...] }]，自動略過假日檔案
function loadAllDays() {
  if (!fs.existsSync(CACHE_DIR)) return []; // 雲端部署剛啟動、尚未回補完成時快取目錄可能還不存在
  const files = fs.readdirSync(CACHE_DIR).filter((f) => f.endsWith('.json')).sort();
  const days = [];
  for (const f of files) {
    const content = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, f), 'utf8'));
    if (content.holiday) continue;
    days.push({ date: f.replace('.json', ''), rows: content });
  }
  return days;
}

// 只讀最近 n 個交易日（從最新檔案往回找，跳過假日檔），給只需要短期資料的功能用，
// 避免每次都把整份歷史快取（數十 MB）載入記憶體。
function loadRecentDays(n) {
  if (!fs.existsSync(CACHE_DIR)) return [];
  const files = fs.readdirSync(CACHE_DIR).filter((f) => f.endsWith('.json')).sort().reverse();
  const days = [];
  for (const f of files) {
    if (days.length >= n) break;
    const content = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, f), 'utf8'));
    if (content.holiday) continue;
    days.push({ date: f.replace('.json', ''), rows: content });
  }
  return days.reverse();
}

module.exports = { loadAllDays, loadRecentDays, CACHE_DIR };
