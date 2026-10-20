/** Small, non-evaluating RSS/Atom reader. Source text is always rendered as text. */
export function plain(input = "") {
  let text=String(input).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  // Atom often entity-encodes an HTML fragment; decode before stripping tags.
  for(let i=0;i<2;i++)text=text
    .replace(/&#x([\da-f]+);/gi, (_, n) => safeCode(parseInt(n,16)))
    .replace(/&#(\d+);/g, (_,n)=>safeCode(Number(n)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp|mdash|ndash|hellip|rsquo|lsquo|rdquo|ldquo);/g,(_,n)=>({amp:"&",lt:"<",gt:">",quot:'"',apos:"'",nbsp:" ",mdash:"—",ndash:"–",hellip:"…",rsquo:"’",lsquo:"‘",rdquo:"”",ldquo:"“"}[n]));
  return text
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x([\da-f]+);/gi, (_, n) => safeCode(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => safeCode(Number(n)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, n) => ({amp:"&",lt:"<",gt:">",quot:'"',apos:"'",nbsp:" "}[n]))
    .replace(/\s+/g, " ").trim();
}
function safeCode(n) { return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ""; }
export function safeUrl(value) {
  try { const u = new URL(plain(value)); return ["https:", "http:"].includes(u.protocol) ? u.href : ""; } catch { return ""; }
}
function tag(xml, name) {
  return xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"))?.[1] ?? "";
}
function attr(xml, name, attribute) {
  return xml.match(new RegExp(`<${name}\\b[^>]*\\b${attribute}=["']([^"']+)`, "i"))?.[1] ?? "";
}
export function parseFeed(xml, source, now = new Date()) {
  if (!/<(?:rss|feed|rdf:RDF)\b/i.test(xml)) throw new Error("来源未返回 RSS / Atom");
  const items = [...xml.matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)];
  return items.slice(0, source.kind === "podcast" ? 18 : 35).flatMap(([, , item]) => {
    const title = plain(tag(item, "title")).slice(0, 350);
    const rawDate = plain(tag(item, "pubDate") || tag(item, "published") || tag(item, "updated") || tag(item, "dc:date"));
    const parsed = new Date(rawDate);
    if (!title || !Number.isFinite(parsed.getTime()) || parsed.getTime() > now.getTime() + 600000) return [];
    const atomLink = item.match(/<link\b(?=[^>]*rel=["']alternate["'])[^>]*>/i)?.[0] || item.match(/<link\b[^>]*href=[^>]*>/i)?.[0] || "";
    const url = safeUrl(tag(item, "link")) || safeUrl(attr(atomLink, "link", "href")) || safeUrl(tag(item, "guid")) || source.website;
    const summary = plain(tag(item, "description") || tag(item, "summary") || tag(item, "content:encoded") || tag(item, "content") || tag(item, "media:description")).slice(0, 650);
    const content = `${title} ${summary}`;
    const topics = [];
    const topicRules = {
      "模型与产品": /model|gpt|claude|gemini|deepseek|qwen|模型|产品|发布/i,
      "Agent 与开发": /agent|coding|code|developer|智能体|编程|开发/i,
      "论文与研究": /research|paper|benchmark|研究|论文|评测/i,
      "商业与趋势": /funding|invest|business|startup|融资|商业|创业/i,
      "开源生态": /open.source|hugging|github|开源/i,
    };
    for (const [key, rule] of Object.entries(topicRules)) if (rule.test(content)) topics.push(key);
    if (!topics.length) topics.push(source.category || "商业与趋势");
    const rawDuration = plain(tag(item, "itunes:duration"));
    const parts = rawDuration.split(":").map(Number);
    const seconds = parts.reduce((sum, n) => sum * 60 + n, 0);
    return [{
      id: "", kind: source.kind === "podcast" ? "episode" : "article", sourceId: source.id,
      source: source.name, title, summary, url, publishedAt: parsed.toISOString(),
      category: topics[0], topics, language: source.language || "en",
      duration: seconds > 0 ? Math.round(seconds / 60) : null,
      artwork: source.artwork || "", color: source.color || "#a8d5bc",
      byline: plain(tag(item, "itunes:author") || tag(item, "dc:creator") || tag(item, "author")),
      identity: source.kind === "podcast" ? title.toLowerCase().replace(/[\s\p{P}]/gu, "") : url,
    }];
  });
}
export async function stableId(value) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(n => n.toString(16).padStart(2, "0")).join("").slice(0, 24);
}
export async function readSource(source, fetcher = fetch) {
  const res = await fetcher(source.feed, { headers: { "User-Agent": "ZhigengAI/1.0 (+RSS reader)", "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml" }, signal: AbortSignal.timeout(14000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  // Bound response before parsing, including chunked responses.
  const reader = res.body?.getReader(); if (!reader) throw new Error("空响应");
  const decoder = new TextDecoder(); let size = 0, text = "";
  const limit = source.kind === "podcast" ? 18 : 35;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > 4_000_000) { await reader.cancel(); throw new Error("订阅源超过 4MB"); }
    text += decoder.decode(value,{stream:true});
    // Long-running podcasts may have very large archives. Only consume the newest
    // complete entries rather than download the entire archive on every poll.
    if ((text.match(/<\/(?:item|entry)>/gi)||[]).length >= limit) { await reader.cancel(); break; }
  }
  text += decoder.decode();
  const items = parseFeed(text, source);
  for (const item of items) { item.id = await stableId(`${item.kind === "episode" ? source.id : "article"}:${item.identity}`); delete item.identity; }
  return items;
}
