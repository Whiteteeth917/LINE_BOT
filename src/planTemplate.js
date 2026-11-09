function formatDate(d) {
  const weekday = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}（${weekday}）`;
}

function line(items) {
  return items.map((i) => `□ ${i}`).join('\n');
}

function fmt(n) {
  return n == null ? '－' : n.toFixed(2);
}

// levels: [{ code, label, ohlcDate, pivot, r1, s1, stopLoss, error }]
function buildTodaySection(today, levels) {
  if (!today.watchlist.length) {
    return '【今日重點】\n（尚未設定觀察標的，請先傳送「設定」指令，例如：\n設定\n觀察 2330,2454\n停損規則 2）';
  }

  const rows = levels.map((l) => {
    if (l.error) return `${l.label}　資料取得失敗（${l.error}），請自行查價`;
    return `${l.label}　前收 ${fmt(l.close)}｜樞紐 ${fmt(l.pivot)}｜壓力 ${fmt(l.r1)}｜支撐 ${fmt(l.s1)}｜停損 ${fmt(l.stopLoss)}`;
  });

  const note = today.note ? `\n備註：${today.note}` : '';
  return `【今日重點】（前一交易日樞紐點自動計算，停損＝支撐下方 ${today.stopLossPct}%）\n${rows.join('\n')}${note}`;
}

function buildUsMarketLine(usMarket) {
  if (!usMarket || usMarket.length === 0) return null;
  const parts = usMarket.map((m) => {
    if (m.error) return `${m.label} 取得失敗`;
    const sign = m.changePct > 0 ? '+' : '';
    return `${m.label} ${sign}${m.changePct.toFixed(2)}%`;
  });
  return `美股前一收盤：${parts.join('｜')}`;
}

function buildEconomicEventsBlock(events) {
  if (events == null) return '今日總經事件：資料取得失敗，請自行查詢';
  if (events.length === 0) return '今日總經事件：無重大事件公布';

  const rows = events.map((e) => {
    const t = new Date(e.timeUtc);
    const hh = String((t.getUTCHours() + 8) % 24).padStart(2, '0'); // UTC 轉台北時間（UTC+8）
    const mm = String(t.getUTCMinutes()).padStart(2, '0');
    const fc = e.forecast != null ? `　預期 ${e.forecast}` : '';
    const prev = e.previous != null ? `　前值 ${e.previous}` : '';
    return `${hh}:${mm} [${e.country}] ${e.title}${fc}${prev}`;
  });
  return `今日重大總經事件：\n${rows.join('\n')}`;
}

function buildTxfLine(txf) {
  if (txf === undefined) return null;
  if (txf == null || txf.close == null) return '台指期：資料取得失敗，請自行查詢';
  const sign = txf.changePct > 0 ? '+' : '';
  const session = txf.session === 'day' ? '日盤' : txf.session === 'night' ? '夜盤' : '近月';
  return `台指期（${session}，約15分鐘延遲）：${txf.close}　${sign}${txf.changePct.toFixed(2)}%　區間 ${txf.low}-${txf.high}`;
}

function buildPlanMessage(today, levels, date = new Date(), commentary = null, usMarket = null, economicEvents = undefined, txf = undefined) {
  const header = `📈 台股每日交易計畫\n${formatDate(date)}`;
  const commentarySection = commentary ? `【提醒】\n${commentary}` : null;

  const usMarketLine = buildUsMarketLine(usMarket);
  const economicLine = economicEvents !== undefined ? buildEconomicEventsBlock(economicEvents) : null;
  const txfLine = buildTxfLine(txf);
  const preMarketChecklist = line([
    '複查觀察名單籌碼面／技術面（可傳送「選股」查看技術面篩選候選）',
    '今日關鍵價位已自動列於上方【今日重點】',
  ]);
  const preMarket = `【07:30-08:59｜盤前掃描】\n${[usMarketLine, txfLine, economicLine, preMarketChecklist].filter(Boolean).join('\n')}`;

  const openStrategy = `【09:00-09:30｜開盤策略】\n${line([
    '開盤前 3-5 分鐘不躁進，先看量價',
    '符合進場條件才進場，否則觀望',
    '進場後立即設定停損單',
  ])}`;

  const midDay = `【09:30-13:00｜盤中調整】\n${line([
    '每 30 分鐘檢查一次部位與大盤連動（可傳送「盤中」查看）',
    '達停損價位立即執行，不凹單',
    '持有週期目標 3-4 週，正常價格波動不用理會，跌破20日均線才算真正轉弱、才重新評估',
    '不追高、不因消息面亂了節奏，也不因單日漲跌就提早出場',
  ])}`;

  const closing = `【13:00-13:25｜收盤前策略】\n${line([
    '檢視當沖／隔日沖部位是否需平倉',
    '留倉部位再次確認停損停利設定',
    '觀察尾盤爆量、急拉急殺訊號',
  ])}`;

  const review = `【13:30 後｜收盤覆盤】\n${line([
    '記錄今日交易日誌（進出場理由、盈虧、情緒狀態）',
    '更新明日觀察名單',
  ])}`;

  const disclaimer = '※ 本清單為操作流程提醒，非投資建議，請自行判斷風險並承擔交易結果。';

  return [
    header,
    buildTodaySection(today, levels),
    commentarySection,
    preMarket,
    openStrategy,
    midDay,
    closing,
    review,
    disclaimer,
  ].filter(Boolean).join('\n\n');
}

module.exports = { buildPlanMessage };
