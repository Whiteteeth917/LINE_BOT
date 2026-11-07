# 台股每日交易計畫 LINE Bot

推播「含時間標記的交易檢查清單」（盤前掃描／開盤策略／盤中調整／收盤策略），
本身**不下單、不連券商 API**，純粹是流程提醒工具，由你自己照清單操作。

## 功能

- 每個交易日早上自動推播當日檢查清單（時間可調整，預設 07:30，週一至週五）
- 傳「設定」訊息可更新觀察名單／停損規則／備註，設定後會持續沿用
- 支撐／壓力／停損價**不用手動輸入**：Bot 會即時向證交所公開資料（免費、不需金鑰）
  抓前一交易日 OHLC，用標準樞紐點公式（Pivot Point）自動計算；停損＝支撐下方 X%（可設定比例）
- 傳「今日」可隨時查看目前完整計畫
- 內容生成預設為固定範本（零成本）；`CONTENT_MODE=claude` 可選用本機已登入的
  Claude Code CLI（`claude -p`）生成一小段提醒語句，失敗時自動 fallback 回純範本

## 安裝

```bash
npm install
cp .env.example .env
```

## 設定 LINE Messaging API

1. 到 [LINE Developers Console](https://developers.line.biz/) 建立 Provider → Messaging API Channel
2. 在 Channel 設定頁取得：
   - **Channel access token**（長期，需手動 issue）→ 填入 `.env` 的 `LINE_CHANNEL_ACCESS_TOKEN`
   - **Channel secret** → 填入 `.env` 的 `LINE_CHANNEL_SECRET`
3. 用官方帳號 QR Code 把 Bot 加為好友，先傳一則任意訊息給它
   （這樣伺服器才會記到你的 `userId`，後續排程推播才知道要送給誰）

## 本機測試

```bash
npm start
```

需要一個 LINE 伺服器打得到的公開網址，本機測試可用 `ngrok`：

```bash
ngrok http 3000
```

把 ngrok 給的 `https://xxxx.ngrok-free.app/webhook` 填回
LINE Developers Console 的 Webhook URL，並開啟「Use webhook」。

## 部署（免費方案，以 Render 為例）

專案已附 `render.yaml`（Blueprint），會用現有的 `Dockerfile` 部署（內建台北時區）。

1. 把這個 repo 推上 GitHub（`.env` 不會被推上去）
2. Render → **New → Blueprint** → 選這個 repo，Render 會讀 `render.yaml` 建立服務
3. 依提示填入環境變數：
   - `LINE_CHANNEL_ACCESS_TOKEN`、`LINE_CHANNEL_SECRET`
   - `LINE_USER_ID`：你的 userId（LINE Developers Console → Basic settings → Your user ID）
   - `DEFAULT_WATCHLIST`：預設觀察名單，例如 `2330,2454`
4. 部署完成後，把 `https://<你的服務>.onrender.com/webhook` 填回
   LINE Developers Console 的 Webhook URL，開啟「Use webhook」並按 Verify
5. 到 [cron-job.org](https://cron-job.org) 建一個排程，**每 10 分鐘**打一次
   `https://<你的服務>.onrender.com/healthz`，避免免費方案閒置 15 分鐘後休眠
   （休眠期間 cron 推播不會觸發）

### 免費方案的限制

- **硬碟是暫時性的**：重啟／重新部署後，用 LINE「設定」指令改的內容會消失，
  回到 `DEFAULT_WATCHLIST` 等環境變數的值。想長期改觀察名單，請改 Render 上的環境變數。
- **行情快取**：映像檔不含 `backtest/cache`，啟動後會在背景回補最近約 200 天的
  證交所資料（約 1～2 分鐘），期間「選股」「類股」可能回覆失敗，稍等即可。
  `/healthz` 的 `cacheReady` 會顯示是否完成。
- `CONTENT_MODE=claude` 需要本機 claude CLI，雲端上請維持 `template`。

## 今日重點設定範例

在 LINE 傳送：

```
設定
觀察 2330,2454
停損規則 2
備註 今天有法說會
```

支撐／壓力／停損價會在每次產生計畫時自動計算，不用手動輸入數字。

## 免責聲明

本工具僅提供操作流程提醒與清單格式化，支撐／壓力／停損為公開歷史資料的
客觀數學計算（樞紐點公式），不構成投資建議，所有交易決策與風險由使用者自行負責。
若證交所資料來源異常或非交易日，該標的當日會顯示「資料取得失敗」，請自行查價。
