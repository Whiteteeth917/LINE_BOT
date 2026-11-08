// 本機模擬器：在瀏覽器用類似 LINE 的聊天畫面測試 Bot，不需要 LINE 帳號、ngrok 或部署。
//
//   npm run simulate   → 開啟 http://localhost:8080
//
// 運作方式：啟動真正的 Bot（src/index.js），但把 LINE SDK 的 replyMessage / pushMessage 換掉，
// 回覆改成存起來顯示在網頁上，不會真的送到 LINE。訊息會帶正確簽章送進 /webhook，
// 所以走的是跟正式環境完全相同的處理流程。
// 使用者資料存在 data/simulator-users.json（獨立檔案，不影響 data/users.json，也不會寫入 Upstash）。
const path = require('path');
const crypto = require('crypto');

const BOT_PORT = Number(process.env.SIM_BOT_PORT) || 3999;
const SIM_PORT = Number(process.env.SIM_PORT) || 8080;
const SECRET = crypto.randomBytes(16).toString('hex');
const SIM_USER_ID = 'Usimulator000000000000000000000000';

// 必須在 require src/index.js（它會載入 dotenv）之前設定；dotenv 不會覆蓋已存在的環境變數
Object.assign(process.env, {
  LINE_CHANNEL_SECRET: SECRET,
  LINE_CHANNEL_ACCESS_TOKEN: 'simulator',
  PORT: String(BOT_PORT),
  UPSTASH_REDIS_REST_URL: '',
  UPSTASH_REDIS_REST_TOKEN: '',
  LINE_USER_ID: '',
  USERS_FILE: path.join(__dirname, '..', 'data', 'simulator-users.json'),
});

// ---- 攔截 LINE 回覆 ----
const sdk = require('@line/bot-sdk');
const pendingReplies = new Map(); // replyToken -> messages[]
const pushed = []; // 排程推播（到價提醒等），網頁會輪詢取得

sdk.Client.prototype.replyMessage = async function (replyToken, messages) {
  pendingReplies.set(replyToken, Array.isArray(messages) ? messages : [messages]);
};
sdk.Client.prototype.pushMessage = async function (to, messages) {
  if (to !== SIM_USER_ID) return; // 其他使用者（理論上不會有）一律丟掉
  pushed.push(...(Array.isArray(messages) ? messages : [messages]));
};

require('../src/index');

// ---- 模擬器網頁＋API ----
const express = require('express');
const app = express();
app.use(express.json());

async function sendToBot(event) {
  const body = JSON.stringify({ destination: 'simulator', events: [event] });
  const signature = crypto.createHmac('sha256', SECRET).update(body).digest('base64');
  const res = await fetch(`http://localhost:${BOT_PORT}/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-line-signature': signature },
    body,
  });
  return res.status;
}

app.post('/api/send', async (req, res) => {
  const text = String(req.body.text || '').slice(0, 2000);
  const replyToken = crypto.randomBytes(8).toString('hex');
  const event = req.body.follow
    ? { type: 'follow', replyToken, source: { type: 'user', userId: SIM_USER_ID }, timestamp: Date.now(), mode: 'active' }
    : {
        type: 'message',
        replyToken,
        source: { type: 'user', userId: SIM_USER_ID },
        timestamp: Date.now(),
        mode: 'active',
        message: { type: 'text', id: replyToken, text },
      };
  try {
    const status = await sendToBot(event);
    const messages = pendingReplies.get(replyToken) || [];
    pendingReplies.delete(replyToken);
    res.json({ status, messages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/pushes', (_req, res) => {
  res.json({ messages: pushed.splice(0) });
});

app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'simulator.html')));

app.listen(SIM_PORT, () => {
  console.log(`\n🟢 模擬器已啟動：http://localhost:${SIM_PORT}\n   （Ctrl+C 結束；資料存在 data/simulator-users.json）\n`);
});
