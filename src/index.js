// src/index.js — mao-quote API（Cloudflare Workers）
//
// 数据以 JSON 模块形式打包进 Worker（总量小，无需 KV/D1）。
// 多语言扩展：生成 data/<lang>.json 后，import 并注册到 DATASETS 即可。

import chapters from "../data/chapters.json";
import zh from "../data/zh.json";
import page from "./page.html"; // 交互式文档页（文本模块），浏览器访问 / 时返回

// ---------------------------------------------------------------------------
// 数据注册与索引（模块加载时一次性构建）
// ---------------------------------------------------------------------------
const DATASETS = { zh };
const DEFAULT_LANG = "zh";

const chapterById = new Map(chapters.map((c) => [c.id, c]));

// byChapter[lang]: chapterId -> quotes[]（保持原始顺序）
// byId[lang]:      id -> quote
const byChapter = {};
const byId = {};
for (const [lang, dataset] of Object.entries(DATASETS)) {
  byChapter[lang] = new Map();
  byId[lang] = new Map();
  for (const q of dataset.quotes) {
    if (!byChapter[lang].has(q.chapter)) byChapter[lang].set(q.chapter, []);
    byChapter[lang].get(q.chapter).push(q);
    byId[lang].set(q.id, q);
  }
}

// ---------------------------------------------------------------------------
// 响应工具
// ---------------------------------------------------------------------------
const json = (body, status = 200, cache = "public, max-age=3600") =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "cache-control": cache,
    },
  });

const fail = (status, message) => json({ error: message }, status, "no-store");

// FNV-1a 哈希，用于 daily 的稳定选取
function hash32(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// 解析并校验 lang 参数，非法返回 null
function pickLang(url) {
  const lang = url.searchParams.get("lang") || DEFAULT_LANG;
  return DATASETS[lang] ? lang : null;
}

// 解析并校验 chapter 参数：
//   未传 -> 返回该语言全部语录
//   合法 -> 返回该章节语录
//   非法 -> 返回 undefined（调用方返回 404）
function pickList(url, lang) {
  const chapter = url.searchParams.get("chapter");
  if (!chapter) return { chapter: null, list: DATASETS[lang].quotes };
  if (!chapterById.has(chapter)) return undefined;
  return { chapter, list: byChapter[lang].get(chapter) || [] };
}

function chapterView(c, lang) {
  return { id: c.id, order: c.order, name: c.names[lang] ?? c.names.zh };
}

// ---------------------------------------------------------------------------
// 各端点处理
// ---------------------------------------------------------------------------

// GET / —— 浏览器返回交互式文档页，API 客户端（Accept 不含 text/html）返回服务信息
function handlePage() {
  return new Response(page, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=600",
    },
  });
}

function handleRoot() {
  return json({
    name: "mao-quote",
    description: "毛主席语录 API",
    endpoints: [
      "GET /api/meta",
      "GET /api/chapters?lang=zh",
      "GET /api/quotes?lang=zh&chapter=study&page=1&size=20",
      "GET /api/quote/random?lang=zh&chapter=study",
      "GET /api/quote/daily?lang=zh&date=2026-08-26",
      "GET /api/quote/{id}",
      "GET /api/search?lang=zh&q=纸老虎",
    ],
  });
}

// GET /api/meta —— 语言与总量概览
function handleMeta() {
  return json({
    defaultLang: DEFAULT_LANG,
    languages: Object.entries(DATASETS).map(([lang, d]) => ({
      lang,
      quotes: d.stats.quotes,
    })),
    chapters: chapters.length,
  });
}

// GET /api/chapters?lang=zh —— 章节列表（含各章语录数）
function handleChapters(url) {
  const lang = pickLang(url);
  if (!lang) return fail(404, `unsupported lang: ${url.searchParams.get("lang")}`);
  return json(
    chapters.map((c) => ({
      ...chapterView(c, lang),
      quotes: (byChapter[lang].get(c.id) || []).length,
    }))
  );
}

// GET /api/quotes?lang=zh&chapter=party&page=1&size=20 —— 分页列表
function handleQuotes(url) {
  const lang = pickLang(url);
  if (!lang) return fail(404, `unsupported lang: ${url.searchParams.get("lang")}`);
  const picked = pickList(url, lang);
  if (!picked) return fail(404, `unknown chapter: ${url.searchParams.get("chapter")}`);

  const page = Math.max(1, parseInt(url.searchParams.get("page"), 10) || 1);
  const size = Math.min(100, Math.max(1, parseInt(url.searchParams.get("size"), 10) || 20));
  const total = picked.list.length;
  const totalPages = Math.max(1, Math.ceil(total / size));
  return json({
    lang,
    chapter: picked.chapter,
    page,
    size,
    total,
    totalPages,
    quotes: picked.list.slice((page - 1) * size, page * size),
  });
}

// GET /api/quote/random?lang=zh&chapter=study —— 随机一条
function handleRandom(url) {
  const lang = pickLang(url);
  if (!lang) return fail(404, `unsupported lang: ${url.searchParams.get("lang")}`);
  const picked = pickList(url, lang);
  if (!picked) return fail(404, `unknown chapter: ${url.searchParams.get("chapter")}`);
  if (!picked.list.length) return fail(404, "chapter has no quotes");
  const q = picked.list[Math.floor(Math.random() * picked.list.length)];
  return json({ lang, ...q }, 200, "no-store");
}

// GET /api/quote/daily?lang=zh&date=YYYY-MM-DD —— 每日一言（同一日期结果固定）
function handleDaily(url) {
  const lang = pickLang(url);
  if (!lang) return fail(404, `unsupported lang: ${url.searchParams.get("lang")}`);
  const picked = pickList(url, lang);
  if (!picked) return fail(404, `unknown chapter: ${url.searchParams.get("chapter")}`);
  if (!picked.list.length) return fail(404, "chapter has no quotes");

  const date = url.searchParams.get("date") || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail(400, "date must be YYYY-MM-DD");

  const q = picked.list[hash32(`${lang}|${picked.chapter || "all"}|${date}`) % picked.list.length];
  return json({ lang, date, ...q });
}

// GET /api/quote/{id} —— 按 id 取单条（id 各语言独立，跨语言查找）
function handleQuoteById(id) {
  for (const [lang, map] of Object.entries(byId)) {
    if (map.has(id)) return json({ lang, ...map.get(id) });
  }
  return fail(404, `quote not found: ${id}`);
}

// GET /api/search?lang=zh&q=纸老虎&chapter=imperialism —— 子串搜索（最多 50 条）
function handleSearch(url) {
  const lang = pickLang(url);
  if (!lang) return fail(404, `unsupported lang: ${url.searchParams.get("lang")}`);
  const keyword = (url.searchParams.get("q") || "").trim();
  if (!keyword) return fail(400, "missing query parameter: q");
  const picked = pickList(url, lang);
  if (!picked) return fail(404, `unknown chapter: ${url.searchParams.get("chapter")}`);

  const hits = [];
  for (const q of picked.list) {
    if (
      q.text.includes(keyword) ||
      (q.derived && q.derived.includes(keyword)) ||
      q.source.title.includes(keyword)
    ) {
      hits.push(q);
      if (hits.length >= 50) break;
    }
  }
  return json({ lang, q: keyword, total: hits.length, quotes: hits });
}

// ---------------------------------------------------------------------------
// 路由
// ---------------------------------------------------------------------------
export default {
  fetch(request) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, OPTIONS",
          "access-control-allow-headers": "*",
          "access-control-max-age": "86400",
        },
      });
    }
    if (request.method !== "GET") return fail(405, "method not allowed");

    const p = url.pathname;
    try {
      if (p === "/") {
        if ((request.headers.get("accept") || "").includes("text/html")) return handlePage();
        return handleRoot();
      }
      if (p === "/api/meta") return handleMeta();
      if (p === "/api/chapters") return handleChapters(url);
      if (p === "/api/quotes") return handleQuotes(url);
      if (p === "/api/quote/random") return handleRandom(url);
      if (p === "/api/quote/daily") return handleDaily(url);
      if (p === "/api/search") return handleSearch(url);
      const m = p.match(/^\/api\/quote\/([\w-]+)$/);
      if (m) return handleQuoteById(m[1]);
      return fail(404, `not found: ${p}`);
    } catch {
      return fail(500, "internal error");
    }
  },
};
