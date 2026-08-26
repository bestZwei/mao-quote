# mao-quote · 毛主席语录 API

基于 [Cloudflare Workers](https://developers.cloudflare.com/workers/) 的《毛主席语录》API 服务。提供随机语录、每日一言、章节浏览、全文搜索等能力，数据结构面向多语言扩展设计。

- **33 个章节 / 440 条语录**，每条均带出处（篇名 + 日期）
- 零数据库依赖：数据以 JSON 打包进 Worker，冷启动即完整可用
- 全端点开启 CORS，可直接用于网页 / 小程序 / 桌面小组件

## 快速开始

```bash
npm install        # 安装 wrangler
npm run dev        # 本地启动 http://127.0.0.1:8787
npm test           # 冒烟测试（默认测本地，可传 URL：node scripts/smoke-test.mjs https://xxx.workers.dev）
```

## 测试

两层测试，覆盖功能与数据完整性：

```bash
# 1. 功能冒烟测试（18 项：全部端点 + 参数校验 + CORS + 错误码）
npm test                                              # 测本地（需先 npm run dev）
node scripts/smoke-test.mjs https://xxx.workers.dev   # 测线上部署

# 2. 部署后数据一致性校验（拉取线上全量 440 条与本地 data/zh.json 逐条比对 + 响应头 + 延迟）
npm run verify:prod
```

也可手动验证：

```bash
curl https://<your-worker>/api/meta
curl "https://<your-worker>/api/quote/daily"
curl "https://<your-worker>/api/search?q=纸老虎"
```

## API 文档

所有端点均为 `GET`，返回 `application/json`。公共参数：

| 参数 | 说明 |
|---|---|
| `lang` | 语言代码，默认 `zh` |
| `chapter` | 章节 slug（见 `/api/chapters`），可选 |

错误时返回 `{"error": "..."}` 及对应 HTTP 状态码（400 / 404 / 405）。

### `GET /api/meta` — 服务概览

```json
{ "defaultLang": "zh", "languages": [{ "lang": "zh", "quotes": 440 }], "chapters": 33 }
```

### `GET /api/chapters` — 章节列表

```
GET /api/chapters?lang=zh
```

```json
[
  { "id": "party", "order": 1, "name": "共产党", "quotes": 13 },
  { "id": "class-struggle", "order": 2, "name": "阶级斗争", "quotes": 23 }
]
```

### `GET /api/quotes` — 分页列表

```
GET /api/quotes?chapter=study&page=1&size=20
```

| 参数 | 默认 | 说明 |
|---|---|---|
| `page` | 1 | 页码（从 1 开始） |
| `size` | 20 | 每页条数（1–100） |

```json
{
  "lang": "zh", "chapter": "study", "page": 1, "size": 20,
  "total": 15, "totalPages": 1,
  "quotes": [ { "id": "q...", "chapter": "study", "text": "...", "derived": null, "source": { "title": "中共八大开幕词", "date": "1956-09-15" } } ]
}
```

### `GET /api/quote/random` — 随机一条

```
GET /api/quote/random?chapter=imperialism
```

### `GET /api/quote/daily` — 每日一言

同一日期返回结果固定（基于哈希的确定性选取），适合做"每日一言"小组件。

```
GET /api/quote/daily?date=2026-08-26
```

| 参数 | 默认 | 说明 |
|---|---|---|
| `date` | 当天（UTC） | 格式 `YYYY-MM-DD` |

### `GET /api/quote/{id}` — 按 id 查询

```
GET /api/quote/q1h5bi91
```

id 为语录内容哈希，数据重新整理后依然稳定；跨语言查找无需传 `lang`。

### `GET /api/search` — 全文搜索

对正文、衍生句、出处标题做子串匹配，最多返回 50 条。

```
GET /api/search?q=纸老虎&chapter=imperialism
```

## 语录数据结构

```json
{
  "id": "q1h5bi91",
  "chapter": "class-struggle",
  "text": "革命不是请客吃饭……",
  "derived": null,
  "source": {
    "title": "湖南农民运动考察报告",
    "date": "1927-03",
    "footnote": 1
  }
}
```

| 字段 | 说明 |
|---|---|
| `id` | 内容哈希（章节 + 正文），数据重排不变 |
| `chapter` | 语言无关的章节 slug |
| `text` | 语录正文 |
| `derived` | 衍生短句（原文"衍生："标注，共 3 条），无则为 `null` |
| `source.title` | 出处篇名 |
| `source.date` | ISO 日期，精度跟随原文：`1955` / `1937-07` / `1954-09-15` |
| `source.footnote` | 原始数据中的脚注编号（可选） |

日期展示格式由客户端按 locale 渲染（如 `1927年3月`、`March 1927`）。

## 数据处理

原始数据为未规范化的 `zh.txt`，执行以下命令重新生成结构化数据：

```bash
npm run normalize
```

脚本 `scripts/normalize.mjs` 会：

- 识别章节标题行、语录行、`——《出处》（日期）` 出处行
- 兼容边界格式：单角括号 `〈〉`、无书名号出处、仅年份 / 年月、脚注标记 `[1]` 等
- 清理编辑标注、统一中间点 `•` → `·`
- 输出 `data/zh.json` 与 `data/chapters.json`，并对异常行打印警告（不会静默丢数据）

## 多语言扩展

架构上已为多语言预留：

1. 准备译文原始数据，扩展 `scripts/normalize.mjs`（或新增脚本）生成 `data/en.json` 等
2. 在 `src/index.js` 中 import 并注册到 `DATASETS`：
   ```js
   import en from "../data/en.json";
   const DATASETS = { zh, en };
   ```
3. 在 `data/chapters.json` 各章节的 `names` 中补充对应语言名称

章节使用语言无关的 slug id（如 `class-struggle`），各语言数据共用同一套章节体系；`lang` 参数在所有列表类端点生效。

## 部署到 Cloudflare Workers

```bash
npx wrangler login     # 首次需登录
npm run deploy         # 部署，输出 workers.dev 访问地址
```

部署后可在 `wrangler.jsonc` 中修改 `name` 来自定义子域名，或配置自定义域名（Custom Domains）。

## 目录结构

```
mao-quote/
├── zh.txt                 # 原始数据
├── data/
│   ├── chapters.json      # 章节元数据（语言无关 id + 多语言名称）
│   └── zh.json            # 规范化中文数据（440 条）
├── src/
│   └── index.js           # Worker 入口（路由 + 全部端点）
├── scripts/
│   ├── normalize.mjs      # 数据规范化脚本
│   ├── smoke-test.mjs     # 端点冒烟测试（支持传入 URL）
│   └── verify-prod.mjs    # 部署后数据一致性校验
├── wrangler.jsonc         # Cloudflare Workers 配置
└── package.json
```
