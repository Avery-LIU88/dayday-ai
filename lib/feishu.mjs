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
  if (secret) { payload.timestamp = String(Math.floor(Date.now()/1000)); payload.sign = await signature(payload.timestamp, secret); }
  const response = await fetcher(url, {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload),redirect:"error",signal:AbortSignal.timeout(10000)});
  let result;
  try { result = await response.json(); } catch { return {status:"unknown",message:"响应无法确认，请先检查飞书群，避免重复通知"}; }
  if (!response.ok || (result.code ?? result.StatusCode) !== 0) return {status:"failed",message:`飞书拒绝请求（${result.code ?? result.StatusCode ?? response.status}），请检查机器人安全设置`};
  return {status:"sent",message:"飞书已接收"};
}
export function notificationText(items, digest) {
  return `DayDay AI · ${digest ? "节目更新简报" : "你关注的节目更新了"}\n\n` +
    items.map(e => `${e.source}\n${e.title}${e.duration ? ` · ${e.duration} 分钟` : ""}\n${e.summary ? e.summary.slice(0,180) + "\n" : ""}${e.url}`).join("\n\n") +
    "\n\n每天一点，跟上 AI。";
}
