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
const { loadNameMap, stockLabel } = require('./stockNames');
const { backfillRecentDays } = require('../backtest/backfillHistory');

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

const client = new Client(lineConfig);
const app = express();

app.get('/', (_req, res) => res.send('LINE trading plan bot is running.'));

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
  if (event.type !== 'message' || event.message.type !== 'text') return;

  const userId = event.source.userId;
  if (userId) store.saveSubscriberId(userId);

  const text = event.message.text.trim();

  if (isSettingMessage(text)) {
    const update = parseSettingMessage(text);
    const today = store.saveToday(update);
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: `已更新今日重點：\n${buildTodayEcho(today)}\n\n傳送「今日」可查看完整計畫。`,
    });
  }

  if (['今日', '查看', '查詢', '計畫'].includes(text)) {
    const message = await buildTodayPlanMessage();
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
    const today = store.getToday();
    if (!today.watchlist.length) {
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: '尚未設定觀察標的，請先傳送「設定」指令。',
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
    const rest = text.replace(/^k\s*線圖?/i, '').trim();
    let codes = rest ? rest.split(/[,、\s]+/).filter(Boolean) : store.getToday().watchlist;

    if (!codes.length) {
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: '請指定股票代號，例如「K線 2330」，或先用「設定」設定觀察名單。',
      });
    }

    const truncated = codes.length > 5;
    codes = codes.slice(0, 5);

    try {
      const urls = await buildCandlestickUrls(codes);
      const messages = [];
      codes.forEach((code, i) => {
        if (urls[i]) {
          messages.push({ type: 'image', originalContentUrl: urls[i], previewImageUrl: urls[i] });
        } else {
          messages.push({ type: 'text', text: `${code}　資料取得失敗或代號不存在。` });
        }
      });
      if (truncated) messages.push({ type: 'text', text: '觀察名單超過5檔，僅顯示前5檔。' });
      return client.replyMessage(event.replyToken, messages.slice(0, 5));
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
    '今日 → 查看今天完整的交易計畫檢查清單（盤前掃描／開盤／盤中／收盤，含自動抓取的美股、台指期、總經事件、你的觀察標的價位）',
    '',
    '選股 → 不知道要看哪些股票時用。從全市場流動性前150大股票裡，篩出今天符合技術面進場條件的候選股，附即時基本面與異常標記（2年回測驗證過）',
    '',
    '類股 關鍵字 → 對特定產業有興趣、但不知道買哪一檔時用。例如「類股 半導體」「類股 重電」「類股 航運」，會列出該產業符合技術訊號的股票，附進場／目標／停損參考價與法人籌碼（不加關鍵字會列出所有產業分類）',
    '',
    '盤中 → 隨時查看台指期與觀察標的的即時報價（約15分鐘延遲），並標示是否跌破停損或20日均線',
    '',
    'K線 [代號] → 查看K線圖（含20日均線），例如「K線 2330」；不加代號則顯示你觀察名單裡所有股票的K線圖（最多5檔）',
    '',
    '說明 / 指令 / help → 顯示這份指令列表',
    '',
    `【自動推播】每個交易日 ${PUSH_CRON}（${CRON_TIMEZONE}）推播一次每日計畫；`,
    `盤中 09:30~13:00 每 30 分鐘（cron: ${INTRADAY_CRON}）推播一次部位檢查。`,
  ].join('\n');
}

async function buildTodayPlanMessage() {
  const today = store.getToday();
  const [levels, usMarket, economicEvents, txf] = await Promise.all([
    buildLevelsForWatchlist(today.watchlist, today.stopLossPct),
    fetchUsMarketSummary().catch(() => null),
    fetchTodayHighImpactEvents().catch(() => null),
    fetchTxfSummary().catch(() => null),
  ]);

  let commentary = null;
  if (CONTENT_MODE === 'claude') {
    const { generateCommentary } = require('./generateWithClaude');
    commentary = await generateCommentary(today);
  }

  return buildPlanMessage(today, levels, new Date(), commentary, usMarket, economicEvents, txf);
}

async function pushDailyPlan() {
  const userId = store.getSubscriberId();
  if (!userId) {
    console.warn('[pushDailyPlan] 尚無訂閱者 userId，略過推播（請先傳訊息給 Bot 一次）。');
    return;
  }

  const message = await buildTodayPlanMessage();
  try {
    await client.pushMessage(userId, { type: 'text', text: message });
    console.log('[pushDailyPlan] 已推播', new Date().toISOString());
  } catch (err) {
    console.error('[pushDailyPlan] 推播失敗:', err.message);
  }
}

function isWithinIntradayWindow(now) {
  const [start, end] = INTRADAY_WINDOW;
  const minutes = now.getHours() * 60 + now.getMinutes();
  return minutes >= start.h * 60 + start.m && minutes <= end.h * 60 + end.m;
}

async function pushIntradayCheck() {
  const now = new Date();
  if (!isWithinIntradayWindow(now)) return; // 排程每半小時觸發一次，只有落在 09:30~13:00 才真的推播

  const userId = store.getSubscriberId();
  if (!userId) return;

  const today = store.getToday();
  if (!today.watchlist.length) return;

  try {
    const { text } = await buildIntradayMessage(today);
    await client.pushMessage(userId, { type: 'text', text });
    console.log('[pushIntradayCheck] 已推播', now.toISOString());
  } catch (err) {
    console.error('[pushIntradayCheck] 推播失敗:', err.message);
  }
}

cron.schedule(PUSH_CRON, pushDailyPlan, { timezone: CRON_TIMEZONE });
cron.schedule(INTRADAY_CRON, pushIntradayCheck, { timezone: CRON_TIMEZONE });

// 啟動時在背景補齊最近的歷史行情快取。雲端部署（Render 等）的映像檔不含 backtest/cache，
// 選股／類股需要至少 80 個交易日（含 60 日均線），預設回補 200 個日曆天（約 135 個交易日）。
// 已存在的日期會被略過，所以本機有快取時幾乎不花時間。
const WARMUP_DAYS = Number(process.env.WARMUP_DAYS) || 200;
let warmupDone = false;
function warmupCache() {
  console.log(`[warmup] 開始回補最近 ${WARMUP_DAYS} 天行情快取`);
  return backfillRecentDays(WARMUP_DAYS)
    .then(() => console.log('[warmup] 行情快取回補完成'))
    .catch((err) => console.error('[warmup] 行情快取回補失敗:', err.message))
    .finally(() => { warmupDone = true; });
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

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
  console.log(`內容模式: ${CONTENT_MODE}｜排程: ${PUSH_CRON} (${CRON_TIMEZONE})`);
  warmupCache();
});
