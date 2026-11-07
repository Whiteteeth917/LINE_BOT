const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const TODAY_PATH = path.join(DATA_DIR, 'today.json');
const SUBSCRIBER_PATH = path.join(DATA_DIR, 'subscriber.json');

// 雲端平台（例如 Render 免費方案）的硬碟是暫時性的，重啟／重新部署後 data/ 會被清空，
// 因此預設值可以用環境變數指定，檔案不存在時就退回這些設定。
const DEFAULT_TODAY = {
  watchlist: (process.env.DEFAULT_WATCHLIST || '').split(/[,、\s]+/).filter(Boolean),
  // 20% 是回測驗證過、搭配「持有3-4週、跌破20日均線才出場」策略的停損寬度；
  // 太緊的停損（例如2-5%）會在正常波動中被提早洗出場，詳見 backtest/ 的調參紀錄。
  stopLossPct: Number(process.env.DEFAULT_STOP_LOSS_PCT) || 20,
  note: process.env.DEFAULT_NOTE || '',
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  ensureDataDir();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function getToday() {
  return { ...DEFAULT_TODAY, ...readJson(TODAY_PATH, {}) };
}

function saveToday(partial) {
  const merged = { ...getToday(), ...partial };
  writeJson(TODAY_PATH, merged);
  return merged;
}

function getSubscriberId() {
  const data = readJson(SUBSCRIBER_PATH, {});
  return data.userId || process.env.LINE_USER_ID || null;
}

function saveSubscriberId(userId) {
  writeJson(SUBSCRIBER_PATH, { userId });
}

module.exports = {
  getToday,
  saveToday,
  getSubscriberId,
  saveSubscriberId,
};
