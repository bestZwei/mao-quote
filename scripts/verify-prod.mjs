// scripts/verify-prod.mjs — 部署后数据一致性校验：拉取线上全量数据与本地 data/zh.json 逐条比对
// 用法：
//   node scripts/verify-prod.mjs                          → 默认线上地址
//   node scripts/verify-prod.mjs https://xxx.workers.dev  → 指定地址
const BASE = (process.argv[2] || "https://mao-quote.gern.workers.dev").replace(/\/$/, "");
console.log(`目标：${BASE}\n`);
const fs = await import("node:fs");
const local = JSON.parse(fs.readFileSync("data/zh.json", "utf8"));

// 响应头检查
const res = await fetch(BASE + "/api/quotes?size=100&page=1");
console.log("响应头：");
for (const k of ["content-type", "cache-control", "access-control-allow-origin"]) {
  console.log(`  ${k}: ${res.headers.get(k)}`);
}

// 拉全量（size 上限 100，共 5 页）
const t0 = Date.now();
const remote = [];
for (let p = 1; p <= 5; p++) {
  const r = await (await fetch(`${BASE}/api/quotes?size=100&page=${p}`)).json();
  remote.push(...r.quotes);
}
console.log("拉取 5 页耗时(ms):", Date.now() - t0);
console.log("远程条数:", remote.length, "| 本地条数:", local.quotes.length);

// 逐条比对
const lm = new Map(local.quotes.map((q) => [q.id, q]));
let diff = 0;
for (const q of remote) {
  const l = lm.get(q.id);
  const a = JSON.stringify({ c: q.chapter, t: q.text, d: q.derived, s: q.source });
  const b = l && JSON.stringify({ c: l.chapter, t: l.text, d: l.derived, s: l.source });
  if (a !== b) {
    diff++;
    console.log("不一致:", q.id);
  }
}
console.log("逐条比对:", diff === 0 ? "完全一致 ✓" : `发现 ${diff} 处差异 ✗`);

// 抽查：著名语录
const s1 = await (await fetch(BASE + "/api/search?q=" + encodeURIComponent("星星之火"))).json();
const s2 = await (await fetch(BASE + "/api/search?q=" + encodeURIComponent("一切反动派都是纸老虎"))).json();
console.log("抽查「星星之火」:", s1.total > 0 ? "命中 ✓" : "未命中 ✗");
console.log("抽查「纸老虎」:", s2.total > 0 ? "命中 ✓" : "未命中 ✗");

// 延迟：连续请求 5 次取平均
const lat = [];
for (let i = 0; i < 5; i++) {
  const s = Date.now();
  await fetch(BASE + "/api/quote/random");
  lat.push(Date.now() - s);
}
console.log("random 平均延迟(ms):", Math.round(lat.reduce((a, b) => a + b) / lat.length), "| 明细:", lat.join(","));
