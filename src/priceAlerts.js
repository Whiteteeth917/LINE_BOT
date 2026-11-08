// 到價提醒：每則提醒只觸發一次，觸發後自動刪除。
// 資料存在使用者設定的 alerts 欄位：[{ code, price, direction: 'above' | 'below', createdAt }]
const { fetchQuotes } = require('./intradayQuotes');

const MAX_ALERTS_PER_USER = 10;

function fmt(n) {
  return n == null ? '－' : (Math.round(n * 100) / 100).toString();
}

function describe(alert) {
  return `${alert.direction === 'above' ? '漲到' : '跌到'} ${fmt(alert.price)}`;
}

// 方向不指定時用現價判斷：目標價高於現價＝等漲上去，低於現價＝等跌下來
function resolveDirection(explicit, target, currentPrice) {
  if (explicit === '>') return 'above';
  if (explicit === '<') return 'below';
  if (currentPrice == null) return null;
  return target >= currentPrice ? 'above' : 'below';
}

function isTriggered(alert, price) {
  return alert.direction === 'above' ? price >= alert.price : price <= alert.price;
}

function addAlert(alerts, alert) {
  const duplicate = alerts.some((a) => a.code === alert.code && a.price === alert.price && a.direction === alert.direction);
  if (duplicate) return { alerts, error: '這則提醒已經設定過了。' };
  if (alerts.length >= MAX_ALERTS_PER_USER) {
    return { alerts, error: `每人最多 ${MAX_ALERTS_PER_USER} 則提醒，請先用「取消提醒 代號」刪掉一些。` };
  }
  return { alerts: [...alerts, alert], error: null };
}

// price 不填＝刪掉這檔的全部提醒
function removeAlerts(alerts, code, price) {
  const keep = alerts.filter((a) => !(a.code === code && (price == null || a.price === price)));
  return { alerts: keep, removed: alerts.length - keep.length };
}

// 檢查所有使用者的提醒：所有代號合併成一次報價請求。
// usersWithAlerts: [{ userId, alerts }]；回傳 [{ userId, triggered: [{alert, price}], remaining }]
async function checkAlerts(usersWithAlerts) {
  const codes = [...new Set(usersWithAlerts.flatMap((u) => u.alerts.map((a) => a.code)))];
  if (!codes.length) return [];
  const quotes = await fetchQuotes(codes);

  const results = [];
  for (const { userId, alerts } of usersWithAlerts) {
    const triggered = [];
    const remaining = [];
    for (const alert of alerts) {
      const quote = quotes.get(alert.code);
      if (quote && isTriggered(alert, quote.close)) triggered.push({ alert, price: quote.close });
      else remaining.push(alert);
    }
    if (triggered.length) results.push({ userId, triggered, remaining });
  }
  return results;
}

module.exports = {
  MAX_ALERTS_PER_USER,
  describe,
  resolveDirection,
  addAlert,
  removeAlerts,
  checkAlerts,
  fmt,
};
