const { fetchPrevDayOHLC } = require('./twse');
const { calcPivotPoints, calcStopLoss } = require('./pivotPoints');

async function buildLevelsForWatchlist(watchlist, stopLossPct) {
  return Promise.all(
    watchlist.map(async (code) => {
      try {
        const ohlc = await fetchPrevDayOHLC(code);
        if (!ohlc || ohlc.close == null) {
          return { code, error: '查無資料' };
        }
        const { pivot, r1, s1 } = calcPivotPoints(ohlc);
        const stopLoss = calcStopLoss(s1, stopLossPct);
        return { code, ohlcDate: ohlc.date, close: ohlc.close, pivot, r1, s1, stopLoss };
      } catch (err) {
        return { code, error: err.message };
      }
    })
  );
}

module.exports = { buildLevelsForWatchlist };
