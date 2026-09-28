function sma(values, i, period) {
  if (i + 1 < period) return null;
  let sum = 0;
  for (let k = i - period + 1; k <= i; k++) sum += values[k];
  return sum / period;
}

function rollingMax(values, i, period) {
  if (i + 1 < period) return null;
  let max = -Infinity;
  for (let k = i - period + 1; k <= i; k++) if (values[k] > max) max = values[k];
  return max;
}

// 幫一檔股票的時間序列補上每日技術指標（原地新增欄位）
function annotateSeries(series) {
  const closes = series.map((r) => r.close);
  const volumes = series.map((r) => r.volume);

  for (let i = 0; i < series.length; i++) {
    const ma10 = sma(closes, i, 10);
    const ma20 = sma(closes, i, 20);
    const ma60 = sma(closes, i, 60);
    const ma60Prev5 = i >= 64 ? sma(closes, i - 5, 60) : null;
    const volAvg20 = sma(volumes, i, 20);
    const high20 = rollingMax(closes, i, 20);
    const ret20 = i >= 20 && closes[i - 20] ? closes[i] / closes[i - 20] - 1 : null;

    series[i].ma10 = ma10;
    series[i].ma20 = ma20;
    series[i].ma60 = ma60;
    series[i].ma60Rising = ma60 != null && ma60Prev5 != null ? ma60 > ma60Prev5 : null;
    series[i].volAvg20 = volAvg20;
    series[i].isHigh20 = high20 != null && series[i].close >= high20;
    series[i].ret20 = ret20;
  }

  return series;
}

module.exports = { sma, rollingMax, annotateSeries };
