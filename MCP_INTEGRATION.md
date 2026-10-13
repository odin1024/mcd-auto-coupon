# MCP 集成说明 · 麦门券官

本文件说明麦门券官（mcd-auto-coupon）如何真实接入麦当劳中国 MCP，以及每个工具在业务中的实际作用与调用流程。

## 1. MCP Server 信息

| 项目 | 值 |
|---|---|
| Server 名称 | 麦当劳中国 MCP（mcd-mcp） |
| 协议 | MCP Streamable HTTP（JSON-RPC 2.0） |
| 服务地址 | `https://mcp.mcd.cn` |
| 鉴权方式 | HTTP Header `Authorization: Bearer <MCP_TOKEN>` |
| 官方平台 | [open.mcd.cn/mcp](https://open.mcd.cn/mcp) |
| 限流 | 官方 600 次/分钟（HTTP 429 表示触发限流） |

Token 需在 [open.mcd.cn/mcp](https://open.mcd.cn/mcp) 控制台激活申请，代表麦当劳会员身份。本项目通过环境变量 `MCD_MCP_TOKEN` 传入，仓库内**不保存任何真实 Token**。

## 2. 本项目实际使用的 MCP 工具

| # | 工具名 | 分类 | 在本项目中的作用 | 是否写操作 |
|---|---|---|---|---|
| 1 | `available-coupons` | 麦麦省领券 | 领券前扫描麦麦省优惠券列表，识别"未领取"券 | 只读 |
| 2 | `auto-bind-coupons` | 麦麦省领券 | **一键领取全部可领优惠券**，返回领券结果（总计/成功/失败/couponId/couponCode） | 写（领券） |
| 3 | `query-my-coupons` | 麦麦省领券 | 领券前后两次读取我的优惠券，用于核对与看板展示 | 只读 |
| 4 | `query-my-account` | 麦麦商城 | 读取积分账户（可用/累计/冻结/本月到期），展示积分概览 | 只读 |
| 5 | `campaign-calendar` | 互动与内容 | 读取当月活动日历，展示"今日麦门活动"雷达 | 只读 |
| 6 | `query-meals` | 点餐相关 | 读取门店菜单（分类 + 餐品），作为**用券决策**的餐品池（V2.0） | 只读 |
| 7 | `calculate-price` | 点餐相关 | **官方真实计价**：对用券候选餐品计算原价/券后价/折扣（单位：分），支撑 TOP3 最划算方案（V2.0） | 只读 |

> 注：官方 MCP 共提供 35 个工具（点餐、互动内容、麦麦省领券、麦麦商城、通用），本项目按业务需要接入以上 7 个：领券链路 3 个 + 资产/活动 2 个 + V2.0 用券决策 2 个，避免无关调用。

## 3. 调用流程

### 3.1 初始化握手

```
POST https://mcp.mcd.cn
Authorization: Bearer <MCD_MCP_TOKEN>
Content-Type: application/json

→ initialize（协议版本 2024-11-05，clientInfo: mcd-auto-coupon）
→ notifications/initialized
```

### 3.2 一键领券流程（POST /api/claim）

```
┌─────────────┐   available-coupons   ┌──────────────────┐
│  一键领券按钮 │ ───────────────────▶ │ 扫描可领券列表     │
└─────────────┘                       └──────────────────┘
                                            │
                                            ▼
                                   auto-bind-coupons
                                            │
                                            ▼
                                 ┌──────────────────────┐
                                 │ 领券结果（成功/失败/   │
                                 │ couponId/couponCode） │
                                 └──────────────────────┘
                                            │
                                            ▼
                                   query-my-coupons
                                            │  （跳过缓存，强制刷新）
                                            ▼
                                 ┌──────────────────────┐
                                 │ 领后核对 + 更新券资产   │
                                 │ 看板 + 省钱成绩单       │
                                 └──────────────────────┘
```

### 3.3 看板加载流程（GET /api/dashboard）

三个只读调用并行执行，聚合后返回：

```
query-my-coupons ──▶ 券资产（数量 + 明细）
query-my-account ──▶ 积分概览（可用/累计/冻结/本月到期）
campaign-calendar ─▶ 今日活动雷达
```

## 4. 响应形态与解析（兼容官方三种形态）

官方 MCP 返回存在多种形态，本项目解析器全部兼容：

| 工具 | 返回形态 | 本项目解析 |
|---|---|---|
| `query-my-account` | JSON 信封 `{success, code, message, data}` | 直接解包 data |
| `available-coupons` | Markdown 文本（标题/状态/图片） | 逐项解析标题、状态（已领/未领/不可领）、图片 |
| `auto-bind-coupons` | Markdown 文本（总计/成功/失败 + 成功券明细） | 解析统计与 couponId/couponCode |
| `query-my-coupons` | Markdown 文本（`# 您的优惠券列表` + `## 券名` + 优惠/有效期/标签） | 逐券解析 |
| `campaign-calendar` | Markdown 文本（`### 活动列表` + `#### 日期 状态` + 活动标题/内容） | 按日期分组解析 |

## 5. 业务价值

- **省时**：原本需要逐个进入领券页手动领取的优惠券，现在一次点击全部领取；
- **不遗漏**：自动扫描"未领取"券，避免错过限时限量的优惠；
- **看得见**：券资产、积分、活动、省钱成绩单在同一屏聚合，用户对"领了哪些券、能省多少"一目了然；
- **诚实口径**：省钱金额仅统计明确标注「立减/省 X 元」的券，不夸大、不虚构。

## 6. 安全与合规

- Token 仅通过环境变量注入，仓库与配置示例（`mcp-config.example.json`）只含 `${MCD_MCP_TOKEN}` 占位符；
- 未配置 Token 时自动进入演示模式（内置模拟数据），不发起任何外网请求；
- 不收集、不保存任何用户个人信息；
- 不涉及下单、支付等敏感操作，仅在用户主动点击时调用领券工具；
- 所有餐品、价格、券、活动信息以麦当劳官方渠道实时结果为准。

## 7. 客户端实现要点

- 零第三方依赖（Node.js 18+ 内置 `fetch`）；
- 请求间隔 ≥ 120ms（官方限流 600 次/分钟），HTTP 429 自动退避重试；
- HTTP 401 明确报错提示 Token 失效，便于排查；
- JSON 信封与纯文本双形态自动识别，统一输出 `{ok, data}`。
