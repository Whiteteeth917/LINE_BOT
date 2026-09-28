// 三大法人（外資／投信／自營商）每日買賣超，TWSE 公開資料（免費、不需金鑰）
// https://www.twse.com.tw/fund/T86

function parseNumber(s) {
  const n = parseFloat(String(s).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

async function fetchT86(dateStr) {
  const url = `https://www.twse.com.tw/fund/T86?response=json&date=${dateStr}&selectType=ALL`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
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
async function fetchRecentInstitutionalFlow(recentDates) {
  const sums = new Map();

  for (const dateStr of recentDates) {
    let dayMap;
    try {
      dayMap = await fetchT86(dateStr);
    } catch (err) {
      console.warn(`[institutionalFlow] ${dateStr} 取得失敗:`, err.message);
      dayMap = null;
    }
    if (dayMap) {
      for (const [code, v] of dayMap.entries()) {
        const acc = sums.get(code) || { foreignNet: 0, trustNet: 0, totalNet: 0 };
        acc.foreignNet += v.foreignNet;
        acc.trustNet += v.trustNet;
        acc.totalNet += v.totalNet;
        sums.set(code, acc);
      }
    }
    await sleep(300);
  }

  const result = new Map();
  for (const [code, v] of sums.entries()) {
    result.set(code, {
      foreignNetLots: Math.round(v.foreignNet / 1000),
      trustNetLots: Math.round(v.trustNet / 1000),
      totalNetLots: Math.round(v.totalNet / 1000),
    });
  }
  return result;
}

module.exports = { fetchT86, fetchRecentInstitutionalFlow };
