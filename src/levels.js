const { fetchPrevDayOHLC } = require('./twse');
const { calcPivotPoints, calcStopLoss } = require('./pivotPoints');
const { loadNameMap, stockLabel } = require('./stockNames');

async function buildLevelsForWatchlist(watchlist, stopLossPct) {
  const nameMap = loadNameMap();
  return Promise.all(
    watchlist.map(async (code) => {
      const label = stockLabel(code, nameMap);
      try {
        const ohlc = await fetchPrevDayOHLC(code);
        if (!ohlc || ohlc.close == null) {
          return { code, label, error: '查無資料' };
        }
        const { pivot, r1, s1 } = calcPivotPoints(ohlc);
        const stopLoss = calcStopLoss(s1, stopLossPct);
        return { code, label, ohlcDate: ohlc.date, close: ohlc.close, pivot, r1, s1, stopLoss };
      } catch (err) {
        return { code, label, error: err.message };
      }
    })
  );
}

module.exports = { buildLevelsForWatchlist };
