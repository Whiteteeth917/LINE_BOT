// 標準樞紐點（Pivot Point）公式，純數學計算，不含任何預測或建議成分。
function calcPivotPoints({ high, low, close }) {
  const pivot = (high + low + close) / 3;
  const r1 = 2 * pivot - low;
  const s1 = 2 * pivot - high;
  return { pivot, r1, s1 };
}

function calcStopLoss(support, stopLossPct) {
  if (support == null || stopLossPct == null) return null;
  return support * (1 - stopLossPct / 100);
}

module.exports = { calcPivotPoints, calcStopLoss };
