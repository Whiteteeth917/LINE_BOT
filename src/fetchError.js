// Node 的 fetch 在連線層失敗時只會丟出「fetch failed」，真正原因（連線被重置、逾時、憑證錯誤…）
// 藏在 err.cause 裡。把它帶出來，訊息與 log 才看得出是哪一種問題。
function describeFetchError(err) {
  if (!err) return '未知錯誤';
  // 一個網域有多個 IP 時，cause 會是 AggregateError，真正的錯誤碼在 errors[] 裡
  const cause = err.cause && Array.isArray(err.cause.errors) && err.cause.errors.length ? err.cause.errors[0] : err.cause;
  const code = cause && (cause.code || (cause.name !== 'Error' ? cause.name : null));
  if (err.name === 'TimeoutError' || code === 'UND_ERR_CONNECT_TIMEOUT') return '連線逾時';
  if (code === 'ECONNRESET') return '連線被對方中斷（可能被暫時封鎖）';
  if (code === 'ECONNREFUSED') return '連線被拒絕';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'DNS 查詢失敗';
  if (code) return `${err.message}: ${code}`;
  return err.message;
}

module.exports = { describeFetchError };
