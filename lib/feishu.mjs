export function validateWebhook(url) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname === "open.feishu.cn" &&
      !u.port && !u.username && !u.password && !u.search && !u.hash &&
      /^\/open-apis\/bot\/v2\/hook\/[a-zA-Z0-9-]+$/.test(u.pathname);
  } catch { return false; }
}
export async function signature(timestamp, secret) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(`${timestamp}\n${secret}`), {name:"HMAC",hash:"SHA-256"}, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new Uint8Array()));
  return btoa(String.fromCharCode(...bytes));
}
/** Caller owns durable delivery claims. A network error is ambiguous and must not auto-retry. */
export async function sendFeishu(url, secret, text, fetcher = fetch) {
  if (!validateWebhook(url)) throw new Error("飞书 Webhook 未配置或格式不正确");
  const payload = {msg_type:"text",content:{text}};
  if (secret) {
    try { payload.timestamp = String(Math.floor(Date.now()/1000)); payload.sign = await signature(payload.timestamp, secret); }
    catch { return {status:"failed",message:"消息签名生成失败，请检查机器人签名配置；请求未发送"}; }
  }
  // Workers supports manual/follow only. Never forward a webhook or signature to a redirect target.
  let options;
  try {
    options = {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload),redirect:"manual",signal:AbortSignal.timeout(10000)};
    new Request(url, options);
  } catch { return {status:"failed",message:"发送请求初始化失败，请联系站点维护者；请求未发送"}; }
  let response;
  try { response = await fetcher(url, options); }
  catch (error) {
    const reason = error?.name === "TimeoutError" || error?.name === "AbortError" ? "等待飞书回执超时" : "连接飞书时发生网络异常";
    return {status:"unknown",message:`${reason}，送达状态未确认；请核对飞书群，不会自动重复发送`};
  }
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel().catch(()=>{});
    return {status:"failed",message:`飞书接口返回重定向（HTTP ${response.status}），已停止发送，请检查 Webhook 地址`};
  }
  let result;
  try { result = await response.json(); } catch { return {status:"unknown",message:`飞书响应无法解析（HTTP ${response.status}），请先检查飞书群，避免重复通知`}; }
  const code = result?.code ?? result?.StatusCode;
  if (!response.ok || (code !== undefined && code !== 0)) return {status:"failed",message:`飞书拒绝请求（${typeof code === "number" ? code : response.status}），请检查机器人安全设置`};
  if (code !== 0) return {status:"unknown",message:"飞书响应缺少成功回执，请先检查飞书群，避免重复通知"};
  return {status:"sent",message:"飞书已接收"};
}
export function notificationText(items, digest) {
  return `DayDay AI · ${digest ? "节目更新简报" : "你关注的节目更新了"}\n\n` +
    items.map(e => `${e.source}\n${e.title}${e.duration ? ` · ${e.duration} 分钟` : ""}\n${e.summary ? e.summary.slice(0,180) + "\n" : ""}${e.url}`).join("\n\n") +
    "\n\n每天一点，跟上 AI。";
}
