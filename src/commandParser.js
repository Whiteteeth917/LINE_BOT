const FIELD_KEYS = {
  觀察: 'watchlist',
  停損規則: 'stopLossPct',
  備註: 'note',
};

// 輸入範例：
// 設定
// 觀察 2330,2454
// 停損規則 2
// 備註 今天有法說會
//
// 支撐／壓力／停損價不用手動輸入，Bot 會用前一交易日資料自動算樞紐點，
// 停損規則指「支撐下方 X%」。
function parseSettingMessage(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const update = {};

  for (const l of lines) {
    const match = l.match(/^(觀察|停損規則|備註)[\s:：]+(.+)$/);
    if (!match) continue;
    const key = FIELD_KEYS[match[1]];
    const raw = match[2].trim();

    if (key === 'watchlist') {
      update[key] = raw.split(/[,、\s]+/).filter(Boolean);
    } else if (key === 'stopLossPct') {
      const pct = parseFloat(raw.replace('%', ''));
      if (Number.isFinite(pct)) update[key] = pct;
    } else {
      update[key] = raw;
    }
  }

  return update;
}

function isSettingMessage(text) {
  return text.trim().startsWith('設定');
}

module.exports = { parseSettingMessage, isSettingMessage };
