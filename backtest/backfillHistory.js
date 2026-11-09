const fs = require('fs');
const path = require('path');
const { fetchMarketDay, toYYYYMMDD } = require('./fetchMarketDay');
const { describeFetchError } = require('../src/fetchError');

const CACHE_DIR = path.join(__dirname, 'cache');
// 證交所限制約「每 5 秒 3 次請求」，超過會暫時封鎖 IP（雲端主機重啟後要整批回補，特別容易踩到）
const DELAY_MS = 2000;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isWeekday(d) {
  const day = d.getDay();
  return day !== 0 && day !== 6;
}

async function backfillRange(start, end) {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

  const dates = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    if (isWeekday(d)) dates.push(new Date(d));
  }

  console.log(`預計檢查 ${dates.length} 個平日（含假日，會自動略過非交易日）`);

  let fetched = 0;
  let skippedCached = 0;
  let skippedHoliday = 0;
  let failed = 0;

  for (const d of dates) {
    const key = toYYYYMMDD(d);
    const file = path.join(CACHE_DIR, `${key}.json`);

    if (fs.existsSync(file)) {
      skippedCached++;
      continue;
    }

    try {
      const rows = await fetchMarketDay(d);
      if (rows == null) {
        skippedHoliday++;
        // 今天當天若還沒收盤也會回傳「查無資料」，不能當成永久假日快取，
        // 否則收盤後也不會再補抓；只有「早於今天」的日期才能放心快取為假日。
        if (key !== toYYYYMMDD(new Date())) {
          fs.writeFileSync(file, JSON.stringify({ holiday: true }));
        }
      } else {
        fs.writeFileSync(file, JSON.stringify(rows));
        fetched++;
      }
    } catch (err) {
      failed++;
      console.warn(`[backfill] ${key} 失敗: ${describeFetchError(err)}`);
    }

    if (fetched % 20 === 0 && fetched > 0) {
      console.log(`進度：已抓 ${fetched} 個交易日（略過快取 ${skippedCached}、假日 ${skippedHoliday}、失敗 ${failed}）`);
    }

    await sleep(DELAY_MS);
  }

  console.log(`完成。抓取 ${fetched}，快取略過 ${skippedCached}，假日略過 ${skippedHoliday}，失敗 ${failed}`);
  return { fetched, skippedCached, skippedHoliday, failed };
}

function backfill(years = 2) {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - Math.round(years * 365));
  return backfillRange(start, end);
}

// 輕量更新：只檢查最近 n 天（給每日排程用，大部分會被快取略過，只補真的缺的那一兩天）
function backfillRecentDays(n = 10) {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - n);
  return backfillRange(start, end);
}

if (require.main === module) {
  const years = parseFloat(process.argv[2]) || 2;
  backfill(years).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { backfill, backfillRange, backfillRecentDays };
