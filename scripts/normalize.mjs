// scripts/normalize.mjs
// 将未规范化的 zh.txt 解析为结构化 JSON：句子(quote) - 章节(chapter) - 出处(source)
// 用法：node scripts/normalize.mjs
//
// 设计目标：
// 1. 章节使用与语言无关的 slug id，为多语言扩展做准备（chapters.json 存各语言名称）
// 2. 每条语录 id 由内容哈希生成，数据重排时 id 保持稳定
// 3. 日期存结构化 ISO 形式(date)，精度跟随原文（年/年月/年月日），
//    各语言展示格式由 API 层按 locale 渲染，不在数据层冗余存储原文表述

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// ---------------------------------------------------------------------------
// 章节元数据：id 为语言无关标识，names 按语言扩展（未来加 "en"/"ja"/"ru" 等）
// 顺序与《毛主席语录》原始章节顺序一致
// ---------------------------------------------------------------------------
const CHAPTERS = [
  { id: "party",                       zh: "共产党",           en: "The Communist Party" },
  { id: "class-struggle",              zh: "阶级斗争",         en: "Classes and Class Struggle" },
  { id: "socialism-and-communism",     zh: "社会主义和共产主义", en: "Socialism and Communism" },
  { id: "contradictions-among-the-people", zh: "人民内部矛盾", en: "The Correct Handling of Contradictions Among the People" },
  { id: "war-and-peace",               zh: "战争与和平",       en: "War and Peace" },
  { id: "imperialism",                 zh: "帝国主义",         en: "Imperialism and All Reactionaries Are Paper Tigers" },
  { id: "dare-to-struggle",            zh: "敢于斗争",         en: "Dare to Struggle and Dare to Win" },
  { id: "peoples-war",                 zh: "人民战争",         en: "People's War" },
  { id: "peoples-army",                zh: "人民军队",         en: "The People's Army" },
  { id: "party-committees",            zh: "党委领导",         en: "Leadership of Party Committees" },
  { id: "masses",                      zh: "群众",             en: "The Mass Line" },
  { id: "political-work",              zh: "政工",             en: "Political Work" },
  { id: "officers-and-men",            zh: "官兵关系",         en: "Relations Between Officers and Men" },
  { id: "army-and-people",             zh: "军民关系",         en: "Relations Between the Army and the People" },
  { id: "three-democracies",           zh: "三大民主",         en: "The Three Main Democracies" },
  { id: "education-and-training",      zh: "教育训练",         en: "Education and Training" },
  { id: "serving-the-people",          zh: "为人民服务",       en: "Serving the People" },
  { id: "patriotism-and-internationalism", zh: "爱国主义与国际主义", en: "Patriotism and Internationalism" },
  { id: "heroism",                     zh: "英雄主义",         en: "Revolutionary Heroism" },
  { id: "diligence-and-thrift",        zh: "勤俭建国",         en: "Building the Country Through Diligence and Thrift" },
  { id: "self-reliance",               zh: "自力更生，艰苦奋斗", en: "Self-Reliance and Hard Struggle" },
  { id: "methods-of-thinking",         zh: "思想与工作方法",   en: "Methods of Thinking and Methods of Work" },
  { id: "investigation",               zh: "调查",             en: "Investigation and Study" },
  { id: "correcting-ideas",            zh: "纠正错误思想",     en: "Correcting Incorrect Ideas" },
  { id: "unity",                       zh: "团结",             en: "Unity" },
  { id: "discipline",                  zh: "纪律",             en: "Discipline" },
  { id: "criticism",                   zh: "批评",             en: "Criticism and Self-Criticism" },
  { id: "communists",                  zh: "共产党员",         en: "Communists" },
  { id: "cadres",                      zh: "干部",             en: "Cadres" },
  { id: "youth",                       zh: "青年",             en: "Youth" },
  { id: "women",                       zh: "妇女",             en: "Women" },
  { id: "culture",                     zh: "文化",             en: "Culture and Art" },
  { id: "study",                       zh: "学习",             en: "Study" },
];

const chapterByZh = new Map(CHAPTERS.map((c) => [c.zh, c]));

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

// FNV-1a 短哈希 → base36，用于生成稳定 id
function hashId(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return "q" + (h >>> 0).toString(36);
}

// 统一标点：全角实心点 •(U+2022) → ·(U+00B7)
function normalizePunct(s) {
  return s.replace(/\u2022/g, "\u00B7").trim();
}

// 日期解析：支持 1954年9月15日 / 1937年7月 / 1955年 / 1953年夏（季节忽略，只取年份）
// 返回 ISO 字符串，精度取决于原文；无法解析返回 null
function parseDate(raw) {
  const m = raw.match(/^(\d{4})年(?:([0-9]{1,2})月(?:([0-9]{1,2})日)?)?[春夏秋冬]?$/);
  if (!m) return null;
  const [, y, mo, d] = m;
  let iso = y;
  if (mo) iso += "-" + String(Number(mo)).padStart(2, "0");
  if (d) iso += "-" + String(Number(d)).padStart(2, "0");
  return iso;
}

// 出处行解析，支持以下变体：
//   ——《标题》（1945年4月24日）
//   ——《标题》（1939年5月26日）[1]          ← 脚注标记
//   ——〈标题〉，1964年1月12日               ← 单角括号 + 逗号分隔日期
//   ——标题（1953年夏）[3]                    ← 无书名号
function parseSource(line) {
  let m;
  let title, dateText, footnote = null;

  if ((m = line.match(/^——《(.+?)》（(.+?)）(?:\[(\d+)\])?$/))) {
    [, title, dateText, footnote] = m;
  } else if ((m = line.match(/^——〈(.+?)〉，(.+?)$/))) {
    [, title, dateText] = m;
  } else if ((m = line.match(/^——(.+?)（(.+?)）(?:\[(\d+)\])?$/))) {
    [, title, dateText, footnote] = m;
  } else {
    return null; // 无法识别，交由主流程报错
  }

  const iso = parseDate(dateText);
  if (!iso) return null; // 日期无法解析，交由主流程报警告
  return {
    title: normalizePunct(title),
    date: iso,
    ...(footnote ? { footnote: Number(footnote) } : {}),
  };
}

// 语录文本清理：去掉编辑标注，如结尾的（12月19日之每日名言）
function cleanText(s) {
  return normalizePunct(s.replace(/[（(][^（）()]*每日名言[^（）()]*[）)]\s*$/, ""));
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
const raw = readFileSync(join(ROOT, "zh.txt"), "utf8").replace(/^\uFEFF/, "");
const lines = raw
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l.length > 0);

const quotes = [];
const warnings = [];
let chapter = null;
let pendingQuote = null; // 等待出处行的语录

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const lineNo = i + 1;

  // 章节标题行
  if (chapterByZh.has(line)) {
    if (pendingQuote) {
      warnings.push(`第${lineNo}行：语录缺少出处行即进入新章节「${line}」`);
      pendingQuote = null;
    }
    chapter = chapterByZh.get(line);
    continue;
  }

  if (!chapter) {
    warnings.push(`第${lineNo}行：出现在任何章节之前：${line.slice(0, 20)}…`);
    continue;
  }

  // 出处行
  if (line.startsWith("——")) {
    if (!pendingQuote) {
      warnings.push(`第${lineNo}行：出处行前没有语录正文：${line}`);
      continue;
    }
    const source = parseSource(line);
    if (!source) {
      warnings.push(`第${lineNo}行：无法解析的出处行：${line}`);
      pendingQuote.source = { title: line.replace(/^——/, ""), date: null };
    } else {
      pendingQuote.source = source;
    }
    pendingQuote = null;
    continue;
  }

  // 衍生句行：附到上一条语录的 derived 字段
  if (/^衍生[：:]/.test(line)) {
    if (quotes.length === 0) {
      warnings.push(`第${lineNo}行：衍生句前没有语录：${line}`);
      continue;
    }
    quotes[quotes.length - 1].derived = cleanText(line.replace(/^衍生[：:]/, ""));
    continue;
  }

  // 语录正文行
  if (pendingQuote) {
    warnings.push(`第${lineNo}行：上一条语录缺少出处行：${pendingQuote.text.slice(0, 20)}…`);
  }
  pendingQuote = {
    chapter: chapter.id,
    text: cleanText(line),
    derived: null,
    source: null,
  };
  quotes.push(pendingQuote);
}
if (pendingQuote && !pendingQuote.source) {
  warnings.push(`文件末尾：最后一条语录缺少出处行：${pendingQuote.text.slice(0, 20)}…`);
}

// 生成稳定 id（章节 + 正文哈希）
for (const q of quotes) {
  q.id = hashId(q.chapter + "\n" + q.text);
}

// 检查 id 冲突（正文重复时才会出现）
const seen = new Map();
for (const q of quotes) {
  if (seen.has(q.id)) warnings.push(`id 冲突：${q.id}（正文完全重复的两条语录）`);
  seen.set(q.id, true);
}

// ---------------------------------------------------------------------------
// 输出
// ---------------------------------------------------------------------------
const dataDir = join(ROOT, "data");
mkdirSync(dataDir, { recursive: true });

// chapters.json：章节元数据（语言无关 id + 多语言名称）
const chaptersOut = CHAPTERS.map((c, i) => ({
  id: c.id,
  order: i + 1,
  names: { zh: c.zh, en: c.en },
}));
writeFileSync(
  join(dataDir, "chapters.json"),
  JSON.stringify(chaptersOut, null, 2) + "\n",
  "utf8"
);

// zh.json：规范化后的中文语录数据
const zhOut = {
  lang: "zh",
  version: 1,
  sourceFile: "zh.txt",
  generatedAt: new Date().toISOString(),
  stats: {
    chapters: new Set(quotes.map((q) => q.chapter)).size,
    quotes: quotes.length,
    withDerived: quotes.filter((q) => q.derived).length,
  },
  quotes,
};
writeFileSync(join(dataDir, "zh.json"), JSON.stringify(zhOut, null, 2) + "\n", "utf8");

// ---------------------------------------------------------------------------
// 报告
// ---------------------------------------------------------------------------
const perChapter = new Map();
for (const q of quotes) perChapter.set(q.chapter, (perChapter.get(q.chapter) || 0) + 1);

console.log(`✓ 共解析 ${quotes.length} 条语录，覆盖 ${perChapter.size}/${CHAPTERS.length} 个章节`);
console.log(`  其中衍生句 ${zhOut.stats.withDerived} 条`);
for (const c of CHAPTERS) {
  const n = perChapter.get(c.id) || 0;
  console.log(`  [${String(n).padStart(3)}] ${c.zh} (${c.id})${n === 0 ? "  ← 章节为空！" : ""}`);
}
const missingSource = quotes.filter((q) => !q.source.date && !q.source.title);
if (missingSource.length) console.log(`⚠ ${missingSource.length} 条语录缺少出处`);
if (warnings.length) {
  console.log(`\n⚠ ${warnings.length} 条警告：`);
  warnings.forEach((w) => console.log("  " + w));
} else {
  console.log("\n✓ 无警告，所有行均按预期解析");
}
