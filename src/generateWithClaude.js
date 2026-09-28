const { execFile } = require('child_process');

// 選用模組：需要本機/伺服器已用 Claude Pro/Max 帳號登入 Claude Code CLI（`claude` 指令可用）。
// 用量算在你的訂閱互動額度內，不會另外產生 API 費用，但非官方保證支援無人值守伺服器排程，
// 若失敗（逾時、未登入等）一律 fallback 回純範本，不影響推播。
function generateCommentary(today) {
  const prompt = [
    '你是專業台股交易員的助理。根據以下今日重點，用繁體中文寫一段 2-3 句的簡短盤前提醒，',
    '聚焦操作心態與風險控管，不要編造或預測任何價位數字，不要加免責聲明。',
    `觀察標的：${today.watchlist.join('、') || '無'}`,
    `停損規則：支撐下方 ${today.stopLossPct}%`,
    `備註：${today.note || '無'}`,
  ].join('\n');

  return new Promise((resolve) => {
    execFile('claude', ['-p', prompt], { timeout: 60000 }, (err, stdout) => {
      if (err) {
        console.warn('[generateWithClaude] 呼叫失敗，改用純範本:', err.message);
        return resolve(null);
      }
      resolve(stdout.trim());
    });
  });
}

module.exports = { generateCommentary };
