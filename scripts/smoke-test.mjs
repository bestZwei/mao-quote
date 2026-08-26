// scripts/smoke-test.mjs — 对本地 wrangler dev 服务做端点冒烟测试
const BASE = "http://127.0.0.1:8787";
let passed = 0, failed = 0;

async function check(name, path, fn) {
  const res = await fetch(BASE + path);
  const body = await res.json().catch(() => null);
  try {
    fn(res.status, body);
    passed++;
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`✗ ${name} → ${e.message}`);
    console.log(`  status=${res.status} body=${JSON.stringify(body)?.slice(0, 200)}`);
  }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

await check("根路径服务信息", "/", (s, b) => {
  assert(s === 200, "status"); assert(b.name === "mao-quote", "name"); assert(Array.isArray(b.endpoints), "endpoints");
});
await check("meta 概览", "/api/meta", (s, b) => {
  assert(s === 200, "status"); assert(b.chapters === 33, "33 章"); assert(b.languages[0].quotes === 440, "440 条");
});
await check("章节列表", "/api/chapters", (s, b) => {
  assert(s === 200, "status"); assert(b.length === 33, "33 章");
  assert(b[0].id === "party" && b[0].name === "共产党", "首章");
  assert(b[32].id === "study" && b[32].quotes === 15, "末章数量");
});
await check("分页列表（全量）", "/api/quotes?page=1&size=10", (s, b) => {
  assert(s === 200, "status"); assert(b.total === 440, "total"); assert(b.quotes.length === 10, "size"); assert(b.totalPages === 44, "pages");
});
await check("分页列表（按章节）", "/api/quotes?chapter=study&page=1&size=5", (s, b) => {
  assert(s === 200, "status"); assert(b.total === 15, "total"); assert(b.quotes.every(q => q.chapter === "study"), "chapter 一致");
});
await check("分页列表（非法章节）", "/api/quotes?chapter=not-exist", (s, b) => {
  assert(s === 404, "status"); assert(b.error.includes("unknown chapter"), "error msg");
});
await check("随机语录", "/api/quote/random", (s, b) => {
  assert(s === 200, "status"); assert(b.text && b.source?.title && b.id, "字段完整");
});
await check("随机语录（指定章节）", "/api/quote/random?chapter=imperialism", (s, b) => {
  assert(s === 200, "status"); assert(b.chapter === "imperialism", "chapter");
});
await check("每日一言（默认今天）", "/api/quote/daily", (s, b) => {
  assert(s === 200, "status"); assert(/^\d{4}-\d{2}-\d{2}$/.test(b.date), "date"); assert(b.text, "text");
});
await check("每日一言（确定性）", "/api/quote/daily?date=2026-01-01", async (s, b) => {
  assert(s === 200, "status");
  const b2 = await (await fetch(BASE + "/api/quote/daily?date=2026-01-01")).json();
  assert(b.id === b2.id, "同日期结果一致");
  const b3 = await (await fetch(BASE + "/api/quote/daily?date=2026-01-02")).json();
  assert(b.id !== b3.id, "不同日期结果不同");
});
await check("每日一言（非法日期）", "/api/quote/daily?date=20260101", (s, b) => {
  assert(s === 400, "status");
});
await check("搜索（正文）", "/api/search?q=纸老虎", (s, b) => {
  assert(s === 200, "status"); assert(b.total >= 3, "命中数"); assert(b.quotes.every(q => q.text.includes("纸老虎") || q.derived?.includes("纸老虎") || q.source.title.includes("纸老虎")), "命中内容");
});
await check("搜索（出处标题）", "/api/search?q=论持久战", (s, b) => {
  assert(s === 200, "status"); assert(b.total > 0, "命中");
});
await check("搜索（缺 q）", "/api/search", (s, b) => {
  assert(s === 400, "status");
});
await check("非法 lang", "/api/quotes?lang=xx", (s, b) => {
  assert(s === 404, "status");
});

// 按 id 查询 + 404：先取一条真实 id
const sample = await (await fetch(BASE + "/api/quotes?size=1")).json();
const id = sample.quotes[0].id;
await check("按 id 查询", `/api/quote/${id}`, (s, b) => {
  assert(s === 200, "status"); assert(b.id === id, "id 一致"); assert(b.lang === "zh", "lang");
});
await check("按 id 查询（不存在）", "/api/quote/zzzzz", (s, b) => {
  assert(s === 404, "status");
});

// 方法与路由边界
{
  const r1 = await fetch(BASE + "/api/quotes", { method: "POST" });
  const ok1 = r1.status === 405;
  const r2 = await fetch(BASE + "/nope", { method: "GET" });
  const ok2 = r2.status === 404;
  const r3 = await fetch(BASE + "/api/quotes", { method: "OPTIONS" });
  const ok3 = r3.status === 204 && r3.headers.get("access-control-allow-origin") === "*";
  const r4 = await fetch(BASE + "/api/meta");
  const ok4 = r4.headers.get("access-control-allow-origin") === "*" && (r4.headers.get("content-type") || "").includes("application/json");
  if (ok1 && ok2 && ok3 && ok4) { passed++; console.log("✓ POST 405 / 未知路径 404 / OPTIONS 204 / CORS 头"); }
  else { failed++; console.log(`✗ 方法与边界：405=${ok1} 404=${ok2} OPTIONS=${ok3} CORS=${ok4}`); }
}

console.log(`\n结果：${passed} 通过，${failed} 失败`);
process.exit(failed ? 1 : 0);
