require('dotenv').config();

const express = require('express');
const cron = require('node-cron');
const { Client, middleware } = require('@line/bot-sdk');

const store = require('./store');
const { buildPlanMessage } = require('./planTemplate');
const { parseSettingMessage, isSettingMessage } = require('./commandParser');
const { buildLevelsForWatchlist } = require('./levels');
const { screenToday } = require('../backtest/screenToday');
const { formatScreenResult } = require('../backtest/formatScreenResult');
const { fetchUsMarketSummary } = require('./usMarket');
const { fetchTodayHighImpactEvents } = require('./economicCalendar');
const { fetchTxfSummary } = require('./twFutures');
const { buildIntradayMessage } = require('./intradayCheck');
const { screenBySector } = require('../backtest/sectorScreen');
const { formatSectorResult } = require('../backtest/formatSectorResult');
const { listCategories } = require('../backtest/sectorLookup');
const { buildCandlestickUrls } = require('./candlestickChart');
const { buildChartData, renderChartPage, renderNotFound, isValidCode } = require('./chartPage');
const { loadNameMap, stockLabel } = require('./stockNames');
const { backfillRecentDays } = require('../backtest/backfillHistory');
const { checkWatchlistEntry } = require('../backtest/watchlistEntry');
const { formatEntryConditions } = require('../backtest/formatEntryConditions');
const { addPosition, removePosition, buildPositionsReport, fmt, fmtLots, fmtMoney, fmtSignedPct, SHARES_PER_LOT } = require('./positions');
const { fetchQuotes } = require('./intradayQuotes');
const { buildStockCheck } = require('./stockCheck');
const {
  MAX_ALERTS_PER_USER,
  describe: describeAlert,
  resolveDirection,
  addAlert,
  removeAlerts,
  checkAlerts,
  fmt: fmtAlert,
} = require('./priceAlerts');
const { buildSignalMessages } = require('./signalAlerts');
const { todayTaipei } = require('./positions');
const { computeRecentPerformance } = require('../backtest/recentPerformance');
const { formatRecentPerformance } = require('../backtest/formatRecentPerformance');

const lineConfig = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const CONTENT_MODE = process.env.CONTENT_MODE || 'template';
const PUSH_CRON = process.env.PUSH_CRON || '30 7 * * 1-5';
const CRON_TIMEZONE = process.env.CRON_TIMEZONE || 'Asia/Taipei';
const INTRADAY_CRON = process.env.INTRADAY_CRON || '*/30 9-13 * * 1-5';
// 盤中檢查只在 09:30~13:00 這個區間內實際推播（cron 本身每半小時觸發，開盤09:00與收盤13:30兩個時間點跳過）
const INTRADAY_WINDOW = [{ h: 9, m: 30 }, { h: 13, m: 0 }];
// 到價提醒：交易時段內每 5 分鐘檢查一次（09:00~13:30）
const ALERT_CRON = process.env.ALERT_CRON || '*/5 9-13 * * 1-5';
const ALERT_WINDOW = [{ h: 9, m: 0 }, { h: 13, m: 30 }];
// 收盤訊號通知：證交所當日行情大約 14:00~15:00 後才會出來，15:00 跑一次、16:00 補跑（已通知過的人不會重複收到）
const SIGNAL_CRON = process.env.SIGNAL_CRON || '0 15,16 * * 1-5';

const client = new Client(lineConfig);
const app = express();

// 對外網址（互動圖表連結用）。Render 會自動注入 RENDER_EXTERNAL_URL；其他平台請設定 PUBLIC_BASE_URL。
function publicBaseUrl() {
  const base = process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT || 3000}`;
  return base.replace(/\/+$/, '');
}

function chartPageUrl(code, stopLossPct) {
  return `${publicBaseUrl()}/chart/${encodeURIComponent(code)}?sl=${encodeURIComponent(stopLossPct)}`;
}

app.get('/', (_req, res) => res.send('LINE trading plan bot is running.'));

// 互動 K 線頁（任何人都能開，不含使用者資料；停損比例由網址參數帶入）
app.get('/chart/:code', async (req, res) => {
  const code = String(req.params.code).toUpperCase();
  if (!isValidCode(code)) return res.status(400).type('html').send(renderNotFound(code));
  const sl = Number(req.query.sl);
  const stopLossPct = Number.isFinite(sl) && sl > 0 && sl < 100 ? sl : 20;
  try {
    const data = await buildChartData(code, stopLossPct);
    if (!data) return res.status(404).type('html').send(renderNotFound(code));
    res.set('Cache-Control', 'public, max-age=300').type('html').send(renderChartPage(data));
  } catch (err) {
    console.error('[chartPage] 失敗:', err);
    res.status(500).type('html').send(renderNotFound(code));
  }
});

app.post('/webhook', middleware(lineConfig), async (req, res) => {
  try {
    await Promise.all((req.body.events || []).map(handleEvent));
    res.sendStatus(200);
  } catch (err) {
    console.error('[webhook] 處理事件失敗:', err);
    res.sendStatus(500);
  }
});

async function handleEvent(event) {
  const userId = event.source && event.source.userId;

  if (event.type === 'follow' && userId) {
    await store.addSubscriber(userId);
    return client.replyMessage(event.replyToken, { type: 'text', text: `歡迎使用！\n\n${helpText()}` });
  }
  if (event.type === 'unfollow' && userId) {
    return store.removeSubscriber(userId);
  }
  if (event.type !== 'message' || event.message.type !== 'text' || !userId) return;

  await store.addSubscriber(userId);
  const text = event.message.text.trim();

  const pushToggle = text.match(/^(每日|盤中|訊號)推播\s*(開啟|關閉|開|關)$/);
  if (pushToggle) {
    const field = { 每日: 'dailyPush', 盤中: 'intradayPush', 訊號: 'signalPush' }[pushToggle[1]];
    const on = pushToggle[2].startsWith('開');
    await store.saveUser(userId, { [field]: on });
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: `已${on ? '開啟' : '關閉'}${pushToggle[1]}推播。`,
    });
  }

  if (isSettingMessage(text)) {
    const update = parseSettingMessage(text);
    const today = await store.saveUser(userId, update);
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: `已更新今日重點：\n${buildTodayEcho(today)}\n\n傳送「今日」可查看完整計畫。`,
    });
  }

  // ---- 觀察名單快速增減 ----
  const watchEdit = text.match(/^(加入|新增|加|刪除|移除|刪)\s*(?:觀察)?\s*(.*)$/);
  if (watchEdit) {
    const adding = ['加入', '新增', '加'].includes(watchEdit[1]);
    const codes = watchEdit[2].split(/[,、\s]+/).filter(Boolean).map((c) => c.toUpperCase());
    if (!codes.length) {
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: `請在後面加代號，例如「${adding ? '加' : '刪'} 2330 2454」。`,
      });
    }
    const invalid = codes.filter((c) => !isValidCode(c));
    if (invalid.length) {
      return client.replyMessage(event.replyToken, { type: 'text', text: `代號格式不正確：${invalid.join('、')}` });
    }
    const user = await store.getUser(userId);
    const nameMap = loadNameMap();
    const notes = [];
    let watchlist = user.watchlist;
    if (adding) {
      const already = codes.filter((c) => watchlist.includes(c));
      const fresh = [...new Set(codes.filter((c) => !watchlist.includes(c)))];
      watchlist = [...watchlist, ...fresh];
      if (fresh.length) notes.push(`已加入：${fresh.map((c) => stockLabel(c, nameMap)).join('、')}`);
      if (already.length) notes.push(`原本就在名單中：${already.join('、')}`);
      const unknown = fresh.filter((c) => !nameMap.has(c));
      if (unknown.length) notes.push(`⚠️ 查無上市資料（可能代號錯誤或為上櫃股票，部分功能查不到）：${unknown.join('、')}`);
    } else {
      const removed = codes.filter((c) => watchlist.includes(c));
      const missing = codes.filter((c) => !watchlist.includes(c));
      watchlist = watchlist.filter((c) => !codes.includes(c));
      if (removed.length) notes.push(`已移除：${removed.map((c) => stockLabel(c, nameMap)).join('、')}`);
      if (missing.length) notes.push(`不在名單中：${missing.join('、')}`);
    }
    await store.saveUser(userId, { watchlist });
    notes.push(`目前觀察名單（${watchlist.length} 檔）：${watchlist.map((c) => stockLabel(c, nameMap)).join('、') || '（空）'}`);
    return client.replyMessage(event.replyToken, { type: 'text', text: notes.join('\n') });
  }

  if (['觀察名單', '名單'].includes(text)) {
    const user = await store.getUser(userId);
    const nameMap = loadNameMap();
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: user.watchlist.length
        ? `目前觀察名單（${user.watchlist.length} 檔）：\n${user.watchlist.map((c) => stockLabel(c, nameMap)).join('\n')}`
        : '觀察名單是空的，傳「加 2330」加入。',
    });
  }

  // ---- 持股紀錄 ----
  if (/^(買進|買入)/.test(text)) {
    const m = text.match(/^(?:買進|買入)\s*([0-9A-Za-z]+)\s+(\d+(?:\.\d+)?)(?:\s+(\d+(?:\.\d+)?))?\s*張?$/);
    const code = m && m[1].toUpperCase();
    const cost = m && Number(m[2]);
    const lots = m && m[3] != null ? Number(m[3]) : 1;
    if (!m || !isValidCode(code) || !(cost > 0) || !(lots > 0)) {
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: '格式：買進 代號 成本 張數（張數不填預設1張，零股可用小數，例如0.1張＝100股）\n例如「買進 2412 163.5 2」',
      });
    }
    const user = await store.getUser(userId);
    const { positions, merged } = addPosition(user.positions, { code, cost, lots });
    await store.saveUser(userId, { positions });
    const label = stockLabel(code, loadNameMap());
    const stopPrice = (merged ? merged.cost : cost) * (1 - user.stopLossPct / 100);
    const lines = merged
      ? [`已加碼 ${label} ${fmtLots(lots)}，合計 ${fmtLots(merged.lots)}，平均成本 ${fmt(merged.cost)}`]
      : [`已記錄買進 ${label} ${fmtLots(lots)}，成本 ${fmt(cost)}`];
    lines.push(`停損價 ${fmt(stopPrice)}（成本 −${user.stopLossPct}%）`, '傳「持股」可查看損益與出場檢查。');
    return client.replyMessage(event.replyToken, { type: 'text', text: lines.join('\n') });
  }

  if (/^(賣出|賣掉)/.test(text)) {
    const m = text.match(/^(?:賣出|賣掉)\s*([0-9A-Za-z]+)(?:\s+(\d+(?:\.\d+)?))?\s*張?$/);
    const code = m && m[1].toUpperCase();
    const lots = m && m[2] != null ? Number(m[2]) : null;
    if (!m || !isValidCode(code) || (lots != null && !(lots > 0))) {
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: '格式：賣出 代號 [張數]（不填張數＝全部賣出）\n例如「賣出 2412」「賣出 2412 1」',
      });
    }
    const user = await store.getUser(userId);
    const { positions, sold, remaining } = removePosition(user.positions, code, lots);
    if (!sold) {
      return client.replyMessage(event.replyToken, { type: 'text', text: `持股裡沒有 ${code}，傳「持股」查看目前紀錄。` });
    }
    await store.saveUser(userId, { positions });
    const label = stockLabel(code, loadNameMap());
    const lines = [`已記錄賣出 ${label} ${fmtLots(sold.lots)}${remaining ? `，剩 ${fmtLots(remaining)}` : '，已全部出清'}`];
    const quote = (await fetchQuotes([code]).catch(() => new Map())).get(code);
    if (quote) {
      const pnl = (quote.close - sold.cost) * sold.lots * SHARES_PER_LOT;
      lines.push(`以現價 ${fmt(quote.close)} 估算：損益 ${fmtSignedPct((quote.close / sold.cost - 1) * 100)}／${fmtMoney(pnl)}（未扣手續費與稅）`);
    }
    return client.replyMessage(event.replyToken, { type: 'text', text: lines.join('\n') });
  }

  if (['戰績', '績效'].includes(text)) {
    try {
      const message = formatRecentPerformance(computeRecentPerformance());
      return client.replyMessage(event.replyToken, { type: 'text', text: message });
    } catch (err) {
      console.error('[recentPerformance] 失敗:', err);
      return client.replyMessage(event.replyToken, { type: 'text', text: `戰績統計失敗：${err.message}` });
    }
  }

  if (['持股', '庫存', '我的持股'].includes(text)) {
    try {
      const message = await buildPositionsReport(await store.getUser(userId));
      return client.replyMessage(event.replyToken, { type: 'text', text: message });
    } catch (err) {
      console.error('[positions] 失敗:', err);
      return client.replyMessage(event.replyToken, { type: 'text', text: '持股資料抓取失敗，請稍後再試一次。' });
    }
  }

  // ---- 個股健檢 ----
  const stockQuery = text.match(/^(?:查|健檢)\s*([0-9A-Za-z]+)$/);
  if (stockQuery) {
    const code = stockQuery[1].toUpperCase();
    if (!isValidCode(code)) {
      return client.replyMessage(event.replyToken, { type: 'text', text: '代號格式不正確，例如「查 2330」。' });
    }
    try {
      const message = await buildStockCheck(code, await store.getUser(userId));
      return client.replyMessage(event.replyToken, { type: 'text', text: message });
    } catch (err) {
      console.error('[stockCheck] 失敗:', err);
      return client.replyMessage(event.replyToken, { type: 'text', text: '個股資料抓取失敗，請稍後再試一次。' });
    }
  }

  // ---- 到價提醒 ----
  if (/^取消提醒/.test(text)) {
    const m = text.match(/^取消提醒\s*([0-9A-Za-z]+)(?:\s+(\d+(?:\.\d+)?))?$/);
    if (!m) {
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: '格式：取消提醒 代號 [價格]（不填價格＝取消這檔全部提醒），例如「取消提醒 2330」',
      });
    }
    const user = await store.getUser(userId);
    const { alerts, removed } = removeAlerts(user.alerts, m[1].toUpperCase(), m[2] != null ? Number(m[2]) : undefined);
    if (!removed) {
      return client.replyMessage(event.replyToken, { type: 'text', text: '找不到符合的提醒，傳「提醒」查看目前設定。' });
    }
    await store.saveUser(userId, { alerts });
    return client.replyMessage(event.replyToken, { type: 'text', text: `已取消 ${removed} 則提醒，剩 ${alerts.length} 則。` });
  }

  if (/^提醒/.test(text)) {
    const user = await store.getUser(userId);
    const nameMap = loadNameMap();
    const rest = text.replace(/^提醒/, '').trim();

    if (!rest) {
      const list = user.alerts.map((a) => `・${stockLabel(a.code, nameMap)} ${describeAlert(a)}`);
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: list.length
          ? `目前的到價提醒（${list.length}/${MAX_ALERTS_PER_USER}）：\n${list.join('\n')}\n\n取消：傳「取消提醒 代號」`
          : '目前沒有到價提醒。\n設定方式：「提醒 2330 2500」（目標價高於現價＝漲到時通知，低於現價＝跌到時通知）\n也可指定方向：「提醒 2330 >2500」「提醒 2330 <2000」',
      });
    }

    const m = rest.match(/^([0-9A-Za-z]+)\s+([<>])?\s*(\d+(?:\.\d+)?)$/);
    const code = m && m[1].toUpperCase();
    const price = m && Number(m[3]);
    if (!m || !isValidCode(code) || !(price > 0)) {
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: '格式：提醒 代號 價格，例如「提醒 2330 2500」；也可指定方向「提醒 2330 >2500」「提醒 2330 <2000」',
      });
    }

    const quote = (await fetchQuotes([code]).catch(() => new Map())).get(code);
    const direction = resolveDirection(m[2], price, quote && quote.close);
    if (!direction) {
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: `目前抓不到 ${code} 的報價，無法判斷方向。請用「提醒 ${code} >${m[3]}」或「提醒 ${code} <${m[3]}」指定。`,
      });
    }
    if (quote && (direction === 'above' ? quote.close >= price : quote.close <= price)) {
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: `${stockLabel(code, nameMap)} 現價 ${fmtAlert(quote.close)} 已經${direction === 'above' ? '高於' : '低於'} ${fmtAlert(price)}，不需要設提醒。`,
      });
    }

    const alert = { code, price, direction, createdAt: new Date().toISOString() };
    const { alerts, error } = addAlert(user.alerts, alert);
    if (error) return client.replyMessage(event.replyToken, { type: 'text', text: error });
    await store.saveUser(userId, { alerts });
    const now = quote ? `（現價 ${fmtAlert(quote.close)}）` : '';
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: `已設定：${stockLabel(code, nameMap)} ${describeAlert(alert)} 時通知你${now}\n交易日 09:00~13:30 每 5 分鐘檢查一次，觸發後自動刪除。`,
    });
  }

  if (['今日', '查看', '查詢', '計畫'].includes(text)) {
    const message = await buildTodayPlanMessage(await store.getUser(userId));
    return client.replyMessage(event.replyToken, { type: 'text', text: message });
  }

  if (['選股', '篩選', '選股候選'].includes(text)) {
    try {
      const result = await screenToday();
      return client.replyMessage(event.replyToken, { type: 'text', text: formatScreenResult(result) });
    } catch (err) {
      console.error('[screenToday] 失敗:', err);
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: '選股資料抓取失敗，請稍後再試一次。',
      });
    }
  }

  if (['盤中', '部位', '檢查'].includes(text)) {
    const today = await store.getUser(userId);
    if (!today.watchlist.length && !today.positions.length) {
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: '尚未設定觀察標的或持股，請先傳「加 2330」或「買進 2330 成本 張數」。',
      });
    }
    try {
      const { text: message } = await buildIntradayMessage(today);
      return client.replyMessage(event.replyToken, { type: 'text', text: message });
    } catch (err) {
      console.error('[intradayCheck] 失敗:', err);
      return client.replyMessage(event.replyToken, { type: 'text', text: '盤中資料抓取失敗，請稍後再試一次。' });
    }
  }

  if (/^進場(條件)?(?=\s|$|\d)/.test(text)) {
    const user = await store.getUser(userId);
    const rest = text.replace(/^進場(條件)?/, '').trim();
    const codes = rest ? rest.split(/[,、\s]+/).filter(Boolean).map((c) => c.toUpperCase()) : user.watchlist;
    if (!codes.length) {
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: '請先用「設定」設定觀察名單，或直接指定代號，例如「進場條件 2330 2454」。',
      });
    }
    const MAX_CODES = 10;
    const validCodes = codes.filter(isValidCode).slice(0, MAX_CODES);
    if (!validCodes.length) {
      return client.replyMessage(event.replyToken, { type: 'text', text: '股票代號格式不正確，例如「進場條件 2330」。' });
    }
    try {
      const result = await checkWatchlistEntry(validCodes, { stopLossPct: user.stopLossPct });
      let message = formatEntryConditions(result);
      if (codes.length > MAX_CODES) message += `

（一次最多檢查 ${MAX_CODES} 檔，僅顯示前 ${MAX_CODES} 檔）`;
      return client.replyMessage(event.replyToken, { type: 'text', text: message });
    } catch (err) {
      console.error('[watchlistEntry] 失敗:', err);
      return client.replyMessage(event.replyToken, { type: 'text', text: '進場條件資料抓取失敗，請稍後再試一次。' });
    }
  }

  if (text.startsWith('類股')) {
    const keyword = text.replace(/^類股\s*/, '').trim();
    if (!keyword) {
      const categories = await listCategories().catch(() => []);
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: `請在「類股」後面加關鍵字，例如「類股 半導體」「類股 重電」。\n可用分類：\n${categories.join('、')}`,
      });
    }
    try {
      const result = await screenBySector(keyword);
      return client.replyMessage(event.replyToken, { type: 'text', text: formatSectorResult(result, keyword) });
    } catch (err) {
      console.error('[screenBySector] 失敗:', err);
      return client.replyMessage(event.replyToken, { type: 'text', text: '類股資料抓取失敗，請稍後再試一次。' });
    }
  }

  if (/^k\s*線圖?/i.test(text)) {
    const user = await store.getUser(userId);
    const rest = text.replace(/^k\s*線圖?/i, '').trim();
    let codes = rest ? rest.split(/[,、\s]+/).filter(Boolean).map((c) => c.toUpperCase()) : user.watchlist;

    if (!codes.length) {
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: '請指定股票代號，例如「K線 2330」，或先用「設定」設定觀察名單。',
      });
    }

    const MAX_CHARTS = 10; // Flex carousel 上限 12 張，留一點餘裕
    const truncated = codes.length > MAX_CHARTS;
    codes = codes.slice(0, MAX_CHARTS).filter(isValidCode);
    if (!codes.length) {
      return client.replyMessage(event.replyToken, { type: 'text', text: '股票代號格式不正確，例如「K線 2330」。' });
    }

    try {
      const nameMap = loadNameMap();
      const urls = await buildCandlestickUrls(codes);
      const bubbles = codes.map((code, i) =>
        buildChartBubble(stockLabel(code, nameMap), urls[i], chartPageUrl(code, user.stopLossPct))
      );
      const messages = [{
        type: 'flex',
        altText: `K線圖：${codes.join('、')}`,
        contents: { type: 'carousel', contents: bubbles },
      }];
      if (truncated) messages.push({ type: 'text', text: `一次最多顯示 ${MAX_CHARTS} 檔，僅顯示前 ${MAX_CHARTS} 檔。` });
      return client.replyMessage(event.replyToken, messages);
    } catch (err) {
      console.error('[candlestickChart] 失敗:', err);
      return client.replyMessage(event.replyToken, { type: 'text', text: 'K線圖產生失敗，請稍後再試一次。' });
    }
  }

  if (['說明', '指令', 'help', 'HELP', 'Help'].includes(text)) {
    return client.replyMessage(event.replyToken, { type: 'text', text: helpText() });
  }

  return client.replyMessage(event.replyToken, {
    type: 'text',
    text: '輸入「說明」查看使用方式。',
  });
}

// K 線卡片：上方是靜態圖（QuickChart），點圖或按鈕開啟互動圖表頁（已畫好支撐／壓力／停損線）
function buildChartBubble(label, imageUrl, pageUrl) {
  const bubble = {
    type: 'bubble',
    size: 'mega',
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'xs',
      contents: [
        { type: 'text', text: label, weight: 'bold', size: 'lg' },
        {
          type: 'text',
          text: imageUrl ? '近 60 日 K 線＋20 日均線' : '靜態圖產生失敗，可直接開啟互動圖表',
          size: 'xs',
          color: '#888888',
          wrap: true,
        },
      ],
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'button',
          style: 'primary',
          color: '#b8322a',
          height: 'sm',
          action: { type: 'uri', label: '互動圖表（含支撐壓力）', uri: pageUrl },
        },
      ],
    },
  };
  if (imageUrl) {
    bubble.hero = {
      type: 'image',
      url: imageUrl,
      size: 'full',
      aspectRatio: '5:3',
      aspectMode: 'fit',
      action: { type: 'uri', uri: pageUrl },
    };
  }
  return bubble;
}

function buildTodayEcho(today) {
  const nameMap = loadNameMap();
  return [
    `觀察：${today.watchlist.map((code) => stockLabel(code, nameMap)).join('、') || '（未設定）'}`,
    `停損規則：支撐下方 ${today.stopLossPct}%`,
    today.note ? `備註：${today.note}` : null,
  ].filter(Boolean).join('\n');
}

function helpText() {
  return [
    '【指令列表】',
    '',
    '設定 → 設定你的觀察名單／停損規則／備註，設定後會持續沿用到下次修改。格式：',
    '設定',
    '觀察 2330,2454',
    '停損規則 2',
    '備註 今天有法說會',
    '（支撐／壓力／停損價不用手動輸入，Bot 會自動算，停損規則預設20%）',
    '',
    '加 代號 / 刪 代號 → 快速增減觀察名單（不會覆蓋整份名單），例如「加 2330 2454」「刪 2454」；傳「觀察名單」查看目前名單',
    '',
    '買進 代號 成本 張數 → 記錄持股，例如「買進 2412 163.5 2」（同一檔再買會自動算平均成本）',
    '賣出 代號 [張數] → 記錄賣出，不填張數＝全部賣出',
    '持股 → 查看每檔損益、持有天數、距離停損／20日均線多遠，並依回測同一套出場規則提醒該不該出場（盤中檢查也會一起列出）',
    '',
    '今日 → 查看今天完整的交易計畫檢查清單（盤前掃描／開盤／盤中／收盤，含自動抓取的美股、台指期、總經事件、你的觀察標的價位）',
    '',
    '選股 → 不知道要看哪些股票時用。從全市場流動性前150大股票裡，篩出今天符合技術面進場條件的候選股，附即時基本面與異常標記（2年回測驗證過）',
    '',
    '類股 關鍵字 → 對特定產業有興趣、但不知道買哪一檔時用。例如「類股 半導體」「類股 重電」「類股 航運」，會列出該產業符合技術訊號的股票，附進場／目標／停損參考價與法人籌碼（不加關鍵字會列出所有產業分類）',
    '',
    '進場條件 [代號] → 逐項檢查觀察名單每一檔的進場條件（趨勢／相對強度／突破爆量）哪些成立、哪些還沒到，並列出下一交易日要突破的價位與量；也可指定代號，例如「進場條件 2330」',
    '',
    '查 代號 → 個股健檢，一次看現價、進場條件達成幾項、支撐壓力、月營收／EPS、近5日法人買賣超、異常標記，例如「查 2330」',
    '',
    '提醒 代號 價格 → 到價提醒，例如「提醒 2330 2500」（目標高於現價＝漲到通知，低於＝跌到通知；也可寫「>2500」「<2000」指定方向）。傳「提醒」看清單，「取消提醒 代號」取消。交易時段每5分鐘檢查，觸發一次後自動刪除',
    '',
    '盤中 → 隨時查看台指期、持股與觀察標的的即時報價（約15分鐘延遲），並標示是否跌破停損或20日均線、持股是否觸發出場',
    '',
    'K線 [代號] → 查看K線圖（含20日均線），例如「K線 2330」；不加代號則顯示你觀察名單裡所有股票（最多10檔）。按「互動圖表」可開啟已畫好支撐／壓力／停損線、可拖曳縮放的圖表',
    '',
    '戰績 → 用最近幾個月的真實行情，統計「選股」訊號照出場規則操作的勝率、平均報酬、獲利因子，並列出還在持有中的訊號，跟2年回測對照',
    '',
    '每日推播 開／關、盤中推播 開／關、訊號推播 開／關 → 開關自動推播（盤中推播預設關閉）',
    '',
    '說明 / 指令 / help → 顯示這份指令列表',
    '',
    `【自動推播】每個交易日 ${PUSH_CRON}（${CRON_TIMEZONE}）推播一次每日計畫；`,
    `盤中推播開啟時，09:30~13:00 每 30 分鐘（cron: ${INTRADAY_CRON}）推播一次部位檢查。`,
    '到價提醒觸發時會另外推播（每則提醒只推一次）。',
    '訊號推播開啟時（預設開啟），每個交易日收盤後檢查觀察名單，有股票「6項全部到齊」或「只差1項」才推播。',
  ].join('\n');
}

// 美股／總經事件／台指期跟使用者無關，排程推播時只抓一次，所有人共用
async function fetchSharedMarketData() {
  const [usMarket, economicEvents, txf] = await Promise.all([
    fetchUsMarketSummary().catch(() => null),
    fetchTodayHighImpactEvents().catch(() => null),
    fetchTxfSummary().catch(() => null),
  ]);
  return { usMarket, economicEvents, txf };
}

async function buildTodayPlanMessage(today, shared) {
  const [levels, market] = await Promise.all([
    buildLevelsForWatchlist(today.watchlist, today.stopLossPct),
    shared || fetchSharedMarketData(),
  ]);

  let commentary = null;
  if (CONTENT_MODE === 'claude') {
    const { generateCommentary } = require('./generateWithClaude');
    commentary = await generateCommentary(today);
  }

  return buildPlanMessage(today, levels, new Date(), commentary, market.usMarket, market.economicEvents, market.txf);
}

async function pushDailyPlan() {
  const subscribers = await store.listSubscribers().catch((err) => {
    console.error('[pushDailyPlan] 讀取訂閱者失敗:', err.message);
    return [];
  });
  if (!subscribers.length) {
    console.warn('[pushDailyPlan] 尚無訂閱者，略過推播。');
    return;
  }

  const shared = await fetchSharedMarketData();
  let sent = 0;
  for (const userId of subscribers) {
    try {
      const user = await store.getUser(userId);
      if (!user.dailyPush) continue;
      const message = await buildTodayPlanMessage(user, shared);
      await client.pushMessage(userId, { type: 'text', text: message });
      sent++;
    } catch (err) {
      console.error(`[pushDailyPlan] 推播給 ${userId} 失敗:`, err.message);
    }
  }
  console.log(`[pushDailyPlan] 已推播 ${sent}/${subscribers.length} 人`, new Date().toISOString());
}

function isWithinWindow(now, [start, end]) {
  const minutes = now.getHours() * 60 + now.getMinutes();
  return minutes >= start.h * 60 + start.m && minutes <= end.h * 60 + end.m;
}

async function pushIntradayCheck() {
  const now = new Date();
  if (!isWithinWindow(now, INTRADAY_WINDOW)) return; // 排程每半小時觸發一次，只有落在 09:30~13:00 才真的推播

  const subscribers = await store.listSubscribers().catch(() => []);
  let sent = 0;
  for (const userId of subscribers) {
    try {
      const user = await store.getUser(userId);
      if (!user.intradayPush || (!user.watchlist.length && !user.positions.length)) continue;
      const { text } = await buildIntradayMessage(user);
      await client.pushMessage(userId, { type: 'text', text });
      sent++;
    } catch (err) {
      console.error(`[pushIntradayCheck] 推播給 ${userId} 失敗:`, err.message);
    }
  }
  if (sent) console.log(`[pushIntradayCheck] 已推播 ${sent} 人`, now.toISOString());
}

async function pushPriceAlerts() {
  const now = new Date();
  if (!isWithinWindow(now, ALERT_WINDOW)) return;

  const subscribers = await store.listSubscribers().catch(() => []);
  const usersWithAlerts = [];
  for (const userId of subscribers) {
    try {
      const user = await store.getUser(userId);
      if (user.alerts.length) usersWithAlerts.push({ userId, alerts: user.alerts });
    } catch (err) {
      console.error(`[pushPriceAlerts] 讀取 ${userId} 失敗:`, err.message);
    }
  }
  if (!usersWithAlerts.length) return;

  let results;
  try {
    results = await checkAlerts(usersWithAlerts);
  } catch (err) {
    console.error('[pushPriceAlerts] 報價取得失敗:', err.message);
    return;
  }

  const nameMap = loadNameMap();
  for (const { userId, triggered, remaining } of results) {
    try {
      // 先刪除再推播：就算推播失敗也不會每 5 分鐘重複觸發、浪費推播額度
      await store.saveUser(userId, { alerts: remaining });
      const lines = triggered.map(({ alert, price }) =>
        `・${stockLabel(alert.code, nameMap)} 已${describeAlert(alert)}，現價 ${fmtAlert(price)}`
      );
      await client.pushMessage(userId, {
        type: 'text',
        text: `🔔 到價提醒\n${lines.join('\n')}\n\n（報價約15分鐘延遲；這${triggered.length > 1 ? '些' : '則'}提醒已自動刪除）`,
      });
    } catch (err) {
      console.error(`[pushPriceAlerts] 推播給 ${userId} 失敗:`, err.message);
    }
  }
  console.log(`[pushPriceAlerts] 觸發 ${results.reduce((n, r) => n + r.triggered.length, 0)} 則`, now.toISOString());
}

cron.schedule(PUSH_CRON, pushDailyPlan, { timezone: CRON_TIMEZONE });
cron.schedule(INTRADAY_CRON, pushIntradayCheck, { timezone: CRON_TIMEZONE });
cron.schedule(ALERT_CRON, pushPriceAlerts, { timezone: CRON_TIMEZONE });
cron.schedule(SIGNAL_CRON, () => pushSignalAlerts(), { timezone: CRON_TIMEZONE });

// force：模擬器用，忽略「今天的收盤資料出來了沒」與「今天通知過了沒」，直接用最近一天的資料推
async function pushSignalAlerts({ force = false } = {}) {
  const today = todayTaipei();
  const subscribers = await store.listSubscribers().catch(() => []);
  const users = [];
  for (const userId of subscribers) {
    try {
      const user = await store.getUser(userId);
      if (!user.signalPush || !user.watchlist.length) continue;
      if (!force && user.lastSignalDate === today) continue;
      users.push({ userId, user });
    } catch (err) {
      console.error(`[pushSignalAlerts] 讀取 ${userId} 失敗:`, err.message);
    }
  }
  if (!users.length) return;

  let result;
  try {
    result = await buildSignalMessages(users, force ? null : today);
  } catch (err) {
    console.error('[pushSignalAlerts] 進場條件計算失敗:', err.message);
    return;
  }
  if (!result.date) {
    console.log('[pushSignalAlerts] 今天的收盤資料還沒出來（或休市），略過');
    return;
  }

  const textByUser = new Map(result.messages.map((m) => [m.userId, m.text]));
  let sent = 0;
  for (const { userId } of users) {
    try {
      // 不論有沒有訊息都記下今天已檢查，16:00 補跑時就不會重複推播
      if (!force) await store.saveUser(userId, { lastSignalDate: today });
      const text = textByUser.get(userId);
      if (!text) continue;
      await client.pushMessage(userId, { type: 'text', text });
      sent++;
    } catch (err) {
      console.error(`[pushSignalAlerts] 推播給 ${userId} 失敗:`, err.message);
    }
  }
  console.log(`[pushSignalAlerts] 檢查 ${users.length} 人，推播 ${sent} 人`, new Date().toISOString());
}

// 啟動時在背景補齊最近的歷史行情快取。雲端部署（Render 等）的映像檔不含 backtest/cache，
// 選股／類股需要至少 80 個交易日（含 60 日均線），預設回補 200 個日曆天（約 135 個交易日）。
// 已存在的日期會被略過，所以本機有快取時幾乎不花時間。
const WARMUP_DAYS = Number(process.env.WARMUP_DAYS) || 200;
// 證交所連不上時（回補中途放棄或有失敗）每 30 分鐘重試一次；已抓到的日期會被略過，重試只補缺的。
const WARMUP_RETRY_MS = 30 * 60 * 1000;
let warmupDone = false;
function warmupCache() {
  console.log(`[warmup] 開始回補最近 ${WARMUP_DAYS} 天行情快取`);
  return backfillRecentDays(WARMUP_DAYS)
    .then((r) => {
      if (r.aborted || r.failed) {
        console.warn(`[warmup] 行情快取回補未完成（失敗 ${r.failed} 天），${WARMUP_RETRY_MS / 60000} 分鐘後重試`);
        setTimeout(warmupCache, WARMUP_RETRY_MS);
        return;
      }
      warmupDone = true;
      console.log('[warmup] 行情快取回補完成');
    })
    .catch((err) => {
      console.error('[warmup] 行情快取回補失敗:', err.message);
      setTimeout(warmupCache, WARMUP_RETRY_MS);
    });
}

app.get('/healthz', (_req, res) => res.json({ ok: true, cacheReady: warmupDone }));

// 診斷用：確認在部署環境裡報價來源是否可用、實際用的是哪個來源（只回傳公開行情，不含任何設定）
app.get('/diag/quotes', async (_req, res) => {
  const { fetchQuotes } = require('./intradayQuotes');
  const [quotes, txf] = await Promise.all([
    fetchQuotes(['2330']).then((m) => Object.fromEntries(m)).catch((e) => ({ error: e.message })),
    fetchTxfSummary().catch((e) => ({ error: e.message })),
  ]);
  res.json({ quotes, txf });
});

// 診斷用：從伺服器所在位置逐一測試每個外部資料來源能不能連（只打公開行情網址，不含任何設定或使用者資料）
app.get('/diag/sources', async (_req, res) => {
  const { describeFetchError } = require('./fetchError');
  const since = new Date(Date.now() - 20 * 864e5).toISOString().slice(0, 10);
  // expect：回應開頭要出現的字串，用來確認「真的拿到資料」而不只是連得上。
  // 沒有 expect 的（期交所、TradingView 要求 POST）只檢查連線層，GET 回 4xx 也算連得上。
  const probes = [
    { group: '目前使用中', name: 'www.twse.com.tw（K線快取、支撐壓力備援）', url: 'https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&stockNo=2330', expect: '"stat"' },
    { group: '目前使用中', name: 'openapi.twse.com.tw（支撐壓力、基本面）', url: 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL', expect: '"Code"' },
    { group: '目前使用中', name: 'mis.twse.com.tw（個股報價備援）', url: 'https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=tse_2330.tw&json=1&delay=0', expect: 'msgArray' },
    { group: '目前使用中', name: 'mis.taifex.com.tw（台指期備援）', url: 'https://mis.taifex.com.tw/futures/api/getQuoteList' },
    { group: '目前使用中', name: 'scanner.tradingview.com（報價主要來源）', url: 'https://scanner.tradingview.com/global/scan' },
    { group: '備選（逐檔）', name: 'Yahoo Finance query1', url: 'https://query1.finance.yahoo.com/v8/finance/chart/2330.TW?range=5d&interval=1d', expect: '"2330.TW"' },
    { group: '備選（逐檔）', name: 'Yahoo Finance query2', url: 'https://query2.finance.yahoo.com/v8/finance/chart/2330.TW?range=5d&interval=1d', expect: '"2330.TW"' },
    { group: '備選（逐檔）', name: 'FinMind', url: `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPrice&data_id=2330&start_date=${since}`, expect: '"success"' },
    { group: '備選（逐檔）', name: '鉅亨網 cnyes', url: 'https://ws.api.cnyes.com/ws/api/v1/charting/history?symbol=TWS:2330:STOCK&resolution=D&quote=1', expect: '"ok"' },
    { group: '備選（全市場）', name: '櫃買中心 TPEx OpenAPI', url: 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes', expect: 'SecuritiesCompanyCode' },
  ];

  // 只讀前 64KB 就夠判斷（櫃買中心那份完整資料有好幾 MB，不必整份下載）
  async function readHead(r, limit = 64 * 1024) {
    const reader = r.body.getReader();
    const chunks = [];
    let size = 0;
    while (size < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.length;
    }
    reader.cancel().catch(() => {});
    return Buffer.concat(chunks).toString('utf8');
  }

  const results = await Promise.all(probes.map(async ({ group, name, url, expect }) => {
    const started = Date.now();
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(15000) });
      const head = await readHead(r);
      const out = { group, name, reachable: true, status: r.status, ms: Date.now() - started };
      if (expect) out.dataOk = r.ok && head.includes(expect);
      return out;
    } catch (err) {
      return { group, name, reachable: false, error: describeFetchError(err), ms: Date.now() - started };
    }
  }));

  const summary = results.map((x) => {
    const ok = x.reachable && x.dataOk !== false && !(x.status === 429);
    return `${ok ? '✅' : '❌'} [${x.group}] ${x.name}`;
  });
  res.json({ checkedAt: new Date().toISOString(), cacheReady: warmupDone, summary, results });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
  console.log(`內容模式: ${CONTENT_MODE}｜排程: ${PUSH_CRON} (${CRON_TIMEZONE})｜資料儲存: ${store.backendName}`);
  warmupCache();
});

// 給本機模擬器手動觸發排程推播用（正式環境由 cron 觸發）
module.exports = { pushSignalAlerts, pushPriceAlerts, pushIntradayCheck, pushDailyPlan };
