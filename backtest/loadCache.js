const fs = require('fs');
const path = require('path');

const CACHE_DIR = path.join(__dirname, 'cache');
// 證交所連不上時由 yahooHistory.js 建立的備援行情（只有約 200 檔高流動性股票）
const YAHOO_DIR = path.join(CACHE_DIR, 'yahoo');
const DAY_FILE = /^\d{8}\.json$/;

function listDir(dir) {
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => DAY_FILE.test(f)) : [];
}

// 所有日期檔，依日期排序。證交所快取有的日期（含假日標記）一律用證交所的，
// 沒有的日期才用 Yahoo 備援，所以證交所恢復後會自動以官方資料為準。
function listDayFiles() {
  const primary = listDir(CACHE_DIR);
  const have = new Set(primary);
  const yahoo = listDir(YAHOO_DIR).filter((f) => !have.has(f));
  return [
    ...primary.map((f) => ({ name: f, file: path.join(CACHE_DIR, f), source: 'twse' })),
    ...yahoo.map((f) => ({ name: f, file: path.join(YAHOO_DIR, f), source: 'yahoo' })),
  ].sort((a, b) => a.name.localeCompare(b.name));
}

function readDay({ name, file, source }) {
  const content = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (content.holiday) return null;
  return { date: name.replace('.json', ''), rows: content, source };
}

// 回傳依日期排序的 [{ date: 'YYYYMMDD', rows: [...], source: 'twse' | 'yahoo' }]，自動略過假日檔案
function loadAllDays() {
  return listDayFiles().map(readDay).filter(Boolean);
}

// 只讀最近 n 個交易日（從最新檔案往回找，跳過假日檔），給只需要短期資料的功能用，
// 避免每次都把整份歷史快取（數十 MB）載入記憶體。
function loadRecentDays(n) {
  const files = listDayFiles().reverse();
  const days = [];
  for (const f of files) {
    if (days.length >= n) break;
    const day = readDay(f);
    if (day) days.push(day);
  }
  return days.reverse();
}

// 有用到 Yahoo 備援資料時，附在結果下方的說明；全部是證交所資料時回傳 null
function dataSourceNote(days) {
  const yahooDays = days.filter((d) => d.source === 'yahoo').length;
  if (!yahooDays) return null;
  return `※ 證交所資料暫時無法取得，近 ${yahooDays} 個交易日改用 Yahoo Finance 備援（僅流動性前約 200 檔，成交量略低於證交所），結果可能與正式資料略有差異。`;
}

module.exports = { loadAllDays, loadRecentDays, dataSourceNote, CACHE_DIR, YAHOO_DIR };
