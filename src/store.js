// 多使用者設定儲存。
//
// 每位使用者（LINE userId）各自有：觀察名單、停損規則、備註、推播開關。
// 後端有兩種，依環境變數自動選擇：
//   1. Upstash Redis（設定 UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN 時）
//      雲端部署用：Render 免費方案硬碟是暫時性的，重啟後檔案會消失，資料要放外部資料庫。
//   2. 本機 JSON 檔 data/users.json（未設定 Upstash 時）：本機開發用。
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
// USERS_FILE 可另外指定（模擬器用獨立檔案，不會動到真正的使用者資料）
const USERS_PATH = process.env.USERS_FILE || path.join(DATA_DIR, 'users.json');
// 舊版（單一使用者）的檔案，首次啟動時會搬到新格式
const LEGACY_TODAY_PATH = path.join(DATA_DIR, 'today.json');
const LEGACY_SUBSCRIBER_PATH = path.join(DATA_DIR, 'subscriber.json');

// 擁有者：用環境變數指定的 userId，預設值與其他使用者不同（開啟盤中推播、套用 DEFAULT_WATCHLIST）
const OWNER_ID = process.env.LINE_USER_ID || null;

function parseWatchlist(raw) {
  return (raw || '').split(/[,、\s]+/).filter(Boolean);
}

function defaultsFor(userId) {
  const isOwner = userId && userId === OWNER_ID;
  return {
    watchlist: isOwner ? parseWatchlist(process.env.DEFAULT_WATCHLIST) : [],
    // 20% 是回測驗證過、搭配「持有3-4週、跌破20日均線才出場」策略的停損寬度；
    // 太緊的停損（例如2-5%）會在正常波動中被提早洗出場，詳見 backtest/ 的調參紀錄。
    stopLossPct: Number(process.env.DEFAULT_STOP_LOSS_PCT) || 20,
    note: isOwner ? process.env.DEFAULT_NOTE || '' : '',
    dailyPush: true,
    // LINE 免費方案推播額度很少，盤中每天最多 8 則，預設只對擁有者開啟，其他人用指令自行開啟
    intradayPush: Boolean(isOwner),
    // 持股紀錄：[{ code, cost, lots, buyDate: 'YYYYMMDD' }]，用「買進／賣出」指令維護
    positions: [],
    // 到價提醒：[{ code, price, direction: 'above' | 'below', createdAt }]，觸發一次後自動刪除
    alerts: [],
    // 收盤訊號通知（觀察名單有股票全部到齊或只差一項時推播），lastSignalDate 用來避免同一天重複推
    signalPush: true,
    lastSignalDate: null,
  };
}

// ---- Upstash Redis（REST API，不需額外套件）----

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const USER_KEY = (id) => `linebot:user:${id}`;
const SUBSCRIBERS_KEY = 'linebot:subscribers';

async function redis(...command) {
  const res = await fetch(UPSTASH_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(10000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new Error(`Upstash ${command[0]} 失敗: ${json.error || res.status}`);
  return json.result;
}

const redisBackend = {
  name: 'upstash',
  async getUser(id) {
    const raw = await redis('GET', USER_KEY(id));
    return raw ? JSON.parse(raw) : null;
  },
  async setUser(id, data) {
    await redis('SET', USER_KEY(id), JSON.stringify(data));
  },
  async addSubscriber(id) {
    await redis('SADD', SUBSCRIBERS_KEY, id);
  },
  async removeSubscriber(id) {
    await redis('SREM', SUBSCRIBERS_KEY, id);
  },
  async listSubscribers() {
    return (await redis('SMEMBERS', SUBSCRIBERS_KEY)) || [];
  },
};

// ---- 本機 JSON 檔 ----

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function loadFileDb() {
  const db = readJson(USERS_PATH, null);
  if (db) return db;

  // 從舊版單一使用者格式搬過來（另外指定 USERS_FILE 時，例如模擬器，不要把真實使用者搬進去）
  const fresh = { users: {}, subscribers: [] };
  const legacyId = process.env.USERS_FILE ? null : readJson(LEGACY_SUBSCRIBER_PATH, {}).userId;
  if (legacyId) {
    const legacyToday = readJson(LEGACY_TODAY_PATH, {});
    fresh.users[legacyId] = {
      ...defaultsFor(legacyId),
      ...(legacyToday.watchlist ? { watchlist: legacyToday.watchlist } : {}),
      ...(legacyToday.stopLossPct != null ? { stopLossPct: legacyToday.stopLossPct } : {}),
      ...(legacyToday.note ? { note: legacyToday.note } : {}),
      intradayPush: true, // 舊版本來就會推盤中檢查，維持原行為
    };
    fresh.subscribers.push(legacyId);
  }
  return fresh;
}

function saveFileDb(db) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(USERS_PATH, JSON.stringify(db, null, 2), 'utf8');
}

const fileBackend = {
  name: 'file',
  async getUser(id) {
    return loadFileDb().users[id] || null;
  },
  async setUser(id, data) {
    const db = loadFileDb();
    db.users[id] = data;
    saveFileDb(db);
  },
  async addSubscriber(id) {
    const db = loadFileDb();
    if (!db.subscribers.includes(id)) db.subscribers.push(id);
    saveFileDb(db);
  },
  async removeSubscriber(id) {
    const db = loadFileDb();
    db.subscribers = db.subscribers.filter((s) => s !== id);
    saveFileDb(db);
  },
  async listSubscribers() {
    return loadFileDb().subscribers;
  },
};

const backend = UPSTASH_URL && UPSTASH_TOKEN ? redisBackend : fileBackend;

// ---- 對外介面 ----

async function getUser(userId) {
  const stored = await backend.getUser(userId);
  return { ...defaultsFor(userId), ...(stored || {}) };
}

async function saveUser(userId, partial) {
  const merged = { ...(await getUser(userId)), ...partial };
  await backend.setUser(userId, merged);
  return merged;
}

async function addSubscriber(userId) {
  await backend.addSubscriber(userId);
}

async function removeSubscriber(userId) {
  await backend.removeSubscriber(userId);
}

// 擁有者一定在名單內，即使資料庫被清空，排程推播也不會整個停掉
async function listSubscribers() {
  const list = await backend.listSubscribers();
  if (OWNER_ID && !list.includes(OWNER_ID)) list.push(OWNER_ID);
  return list;
}

module.exports = {
  backendName: backend.name,
  getUser,
  saveUser,
  addSubscriber,
  removeSubscriber,
  listSubscribers,
};
