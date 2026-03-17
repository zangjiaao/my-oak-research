# Oak Gather Service

社交媒体数据采集服务，使用 Playwright 和 Cookie 认证来获取社交媒体平台的数据。

## 支持的平台

- **X.com (Twitter)** - Cookie 认证
- **小红书 (Xiaohongshu)** - Cookie 认证
- **Reddit** - Cookie 认证
- **抖音 (Douyin)** - Cookie 认证
- **TikTok** - Cookie 认证
- **微博 (Weibo)** - Cookie 认证
- **Telegram** - Cookie + localStorage 认证
- **WhatsApp** - 持久化浏览器配置文件（QR 码扫码登录）

## 快速开始

### 1. 安装依赖

```bash
cd apps/gather
uv sync
playwright install chromium
```

### 2. 导出 Chrome Cookies

首先，确保你已在 Chrome 浏览器中登录目标平台。然后运行以下命令导出 cookies：

```bash
# 导出 X.com cookies
uv run export_chrome_cookies.py x

# 导出小红书 cookies
uv run export_chrome_cookies.py xiaohongshu

# 导出 Reddit cookies
uv run export_chrome_cookies.py reddit

# 导出抖音 cookies
uv run export_chrome_cookies.py douyin

# 导出 TikTok cookies
uv run export_chrome_cookies.py tiktok

# 导出微博 cookies
uv run export_chrome_cookies.py weibo

# 导出 Telegram cookies + localStorage
uv run export_chrome_cookies.py telegram

# 导出 WhatsApp（启动浏览器，需要扫码登录）
uv run export_chrome_cookies.py whatsapp
```

**注意**：
- 运行此脚本之前，请完全关闭 Chrome 浏览器
- 导出的文件会保存在 `.auth/` 目录下（已被 gitignore 忽略，不会提交到仓库）

导出的文件格式为 Playwright storage_state 格式：

```json
{
  "cookies": [
    {
      "name": "cookie_name",
      "value": "cookie_value",
      "domain": ".example.com",
      "path": "/",
      "secure": true,
      "httpOnly": true,
      "sameSite": "Lax",
      "expires": 1234567890
    }
  ],
  "origins": []
}
```

### 3. 启动服务

```bash
python main.py
```

或者使用 uvicorn：

```bash
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

## API 接口

### 验证认证 (POST /verify-auth)

验证 cookies 是否有效。

默认会优先尝试脚本校验：先查找 gather 内置脚本 `apps/gather/site_scripts/<platform>/me.ts`，再查找外部 bb-site（优先 `me.ts` / `me.js`，兼容回退 `user.ts` / `user.js`）。若脚本不可用才回退到 gather 内置平台 client 校验。可通过 `BB_SITES_DIR` 指定外部 bb-site 根目录（默认按 `~/.bb-browser/bb-sites`、`~/Reference/bb-sites` 依次查找）。  
`whatsapp` 平台优先使用 `agent-browser` 方式做登录态探测（更贴合其 persistent profile 场景）。

**请求体**：
```json
{
  "platform": "x",
  "stateFile": ".auth/x_auth.json",
  "verifyScriptPath": "/Users/me/Reference/bb-sites/twitter/me.ts",
  "verifyArgs": { "screen_name": "openai" },
  "verifyTargetUrl": "https://x.com",
  "verifyTimeoutMs": 90000,
  "verifyPostWaitMs": 5000,
  "auth_data": {
    "cookies": [...],
    "origins": []
  }
}
```

`auth_data` 与 `stateFile` 二选一即可（`stateFile` 为 gather 服务本机可访问路径）。
可选覆盖字段：
- `verifyScriptPath`: 指定本次校验使用的脚本路径（不传则按平台自动查找 `me.ts/me.js/user.ts/user.js`）
- `verifyArgs`: 透传给校验脚本的参数对象
- `verifyTargetUrl`: 指定校验跳转地址（不传则按平台默认地址）
- `verifyTimeoutMs`: Playwright 导航超时（毫秒，默认 `60000`）
- `verifyPostWaitMs`: 导航后额外等待时间（毫秒，默认 `3000`，单页应用建议适当调大）

**响应**：
```json
{
  "valid": true,
  "message": "X.com authentication is valid",
  "details": {
    "platform": "X",
    "cookies_count": 15
  }
}
```

### 获取数据 v2（推荐）(POST /v2/fetch)

`/v2/fetch` 是唯一 fetch 契约入口，返回数组 `CleanItem`。

**请求体**：
```json
{
  "platform": "x",
  "sourceId": "source_123",
  "keywords": ["openai"],
  "driver": "playwright",
  "output": {
    "field": ["text", "meta.image", "url", "comments"]
  },
  "driverOptions": {
    "playwright": {
      "mode": "eval-js",
      "scriptPath": "/path/to/script.js"
    },
    "network": {
      "proxy": {
        "url": "socks5h://127.0.0.1:9050"
      }
    },
    "filter": {
      "minChars": 8
    }
  }
}
```

`driver` 必填，可选值为 `xhttp`、`playwright`、`agent-browser`。
`output.field` 必填，控制 `recordContent` 输出字段（支持点路径）：

- `["text"]`：只返回 `recordContent.text`
- `["text", "url"]`：返回 `recordContent.text` + `recordContent.url`
- `["meta.image"]`：返回嵌套字段 `recordContent.meta.image`

`/v2/fetch` 只接受新字段：`sourceId`、`platform`、`keywords`、`driver`、`driverOptions`、`output.field`。不再兼容旧字段。

### 通用网络代理配置（支持 HTTP/SOCKS/Tor）

三个 driver（`xhttp` / `playwright` / `agent-browser`）都支持在 `driverOptions.network.proxy` 下统一配置代理：

```json
{
  "driverOptions": {
    "network": {
      "proxy": {
        "url": "socks5h://127.0.0.1:9050",
        "username": "optional-user",
        "password": "optional-pass",
        "bypass": "localhost,127.0.0.1"
      }
    }
  }
}
```

- `url`: 必填，支持 `http://`、`https://`、`socks5://`、`socks5h://`
- `username/password`: 可选，未写入 URL 时会自动注入
- `bypass`: 可选，主要用于浏览器类 driver（Playwright / agent-browser）
- Tor 推荐使用 `socks5h://127.0.0.1:9050`（DNS 也走 Tor）

### xhttp 驱动（`driver: "xhttp"`）

适用于直接调用搜索 API 或普通 HTTP 页面，不依赖浏览器环境。

```json
{
  "platform": "search",
  "sourceId": "source_search_demo",
  "driver": "xhttp",
  "driverOptions": {
    "url": "https://api.example.com/search",
    "method": "POST",
    "headers": {
      "Content-Type": "application/json"
    },
    "params": {
      "q": "openai"
    },
    "json": {
      "query": "openai",
      "count": 20
    },
    "signature": {
      "secretEnv": "SEARCH_API_SECRET",
      "source": "query",
      "timestampField": "ts",
      "nonceField": "nonce",
      "fields": ["q", "ts", "nonce"],
      "algorithm": "hmac-sha256",
      "digest": "hex",
      "target": "header",
      "header": "X-Signature"
    },
    "timeoutSeconds": 20,
    "maxChars": 50000
  }
}
```

`xhttp` 常用参数：

- `url` / `urls`: 必填，目标地址（支持 `http/https`）
- `method`: 可选，默认 `GET`，支持 `GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS`
- `headers`: 可选，请求头对象
- `params`: 可选，Query 参数对象
- `json` / `form` / `body`: 可选，请求体（只能传一种）
- `signature`: 可选，按字段生成签名并写回 query/body/header（支持 `secret` 或 `secretEnv`）
- `timeoutSeconds`: 可选，超时时间，默认 `15`
- `maxChars`: 可选，返回 `text/markdown` 最大长度，默认 `20000`

### Agent Browser 脚本化 PoC（`driver: "agent-browser"`）

用于复杂交互场景（登录后页面、轮询点击、按脚本采集内容），通过 `agent-browser` CLI 执行步骤。

```json
{
  "platform": "telegram",
  "sourceId": "source_telegram_demo",
  "driver": "agent-browser",
  "driverOptions": {
    "headed": true,
    "profile": ".auth/telegram_profile",
    "auth": {
      "stateFile": ".auth/telegram_auth.json"
    },
    "script": [
      { "command": "open https://web.telegram.org/a/" },
      { "command": "wait --load networkidle" },
      { "command": "snapshot -i", "captureAs": "entry_snapshot" },
      { "command": "click @e25", "repeat": 3, "intervalMs": 2000 },
      { "command": "get text @e40", "captureAs": "messages" }
    ],
    "filters": {
      "capture": {
        "keys": ["messages"],
        "minChars": 20
      },
      "keyword": {
        "keywords": ["openclaw"],
        "splitMode": "line",
        "minChars": 8
      }
    }
  }
}
```

`driverOptions`（agent-browser）常用参数：

- `script`: 必填，步骤数组（每步至少包含 `command`）
- `headed`: 可选，`true` 时可视化执行（等价于 `agent-browser --headed`）
- `profile`: 可选，加载浏览器 profile（等价于 `--profile`）
- `sessionName`: 可选，会话名（等价于 `--session-name`）
- `stateFile`: 可选，加载 state 文件（等价于 `--state`）
- `commandTimeoutMs`: 可选，单步超时，默认 30000
- `instanceId`: 可选，复用上一次返回的实例 ID（不传则创建新实例）
- `ownerId`: 可选，实例归属标识；复用实例时会校验归属
- `sessionKey`: 可选，会话隔离键；默认不需要与 `sourceId` 重复
- `instanceTtlSeconds`: 可选，实例空闲 TTL（默认 900 秒）；超过后会在后续请求中被自动清理
- `heartbeat`: 可选，`true` 时可发送空脚本续租实例（需配合 `instanceId`）
- `closeOnComplete`: 可选，默认 `false`，为 `true` 时任务结束自动关闭实例
- `verbose`: 可选，默认 `true`，在 gather 服务日志中输出逐步执行信息（定位卡点时建议开启）

> 并发建议：需要多实例并行时，不要在脚本中显式执行 `close`，由 worker 在任务结束时关闭；同时依赖空闲 TTL 做兜底回收。

`driver: "agent-browser"` 的返回项会附带：

- `instanceId`: 浏览器实例 ID（用于下一次请求复用）
- `tabId`: 当前 tab 的逻辑 ID
- `instanceActive`: 当前请求结束后实例是否仍存活

### 循环操作（滚动 + 检查直到命中）

支持在一次请求内执行循环步骤，直到命中条件或达到上限：

```json
{
  "platform": "x",
  "sourceId": "loop_demo_001",
  "driver": "agent-browser",
  "driverOptions": {
    "instanceId": "ab-1234567890",
    "ownerId": "user-1001",
    "script": [
      { "command": "open https://x.com/some-post" },
      {
        "loop": {
          "maxIterations": 20,
          "intervalMs": 1000,
          "steps": [
            { "command": "scroll down 900" },
            { "command": "snapshot", "captureAs": "page_snapshot" }
          ],
          "breakWhen": {
            "captureKey": "page_snapshot",
            "textIncludes": ["目标关键词", "备选关键词"]
          }
        }
      }
    ],
    "filters": {
      "capture": {
        "keys": ["page_snapshot"],
        "perLine": true,
        "minChars": 20,
        "dedupe": true,
        "normalizeRefTags": true,
        "startsWith": ["- article", "- text"]
      }
    }
  }
}
```

`loop` 参数说明（作为 `script` 中的一个步骤对象传入，不再支持顶层 loop 写法）：

- `maxIterations`: 最大循环次数（必填）
- `intervalMs`: 每轮循环间隔（可选）
- `steps`: 每轮要执行的步骤数组（必填）
- `breakWhen.captureKey + breakWhen.textIncludes`: 当指定 capture 的最新输出包含目标文本时停止循环（`textIncludes` 支持字符串或字符串数组）

`captureFilter` 参数说明（可选）：

- `keys`: 仅对指定 capture key 生效（例如 `["page_snapshot"]`）
- `perLine`: `true` 时按行拆分输出（适合 `snapshot` 粗提取）
- `minChars`: 最小字符长度过滤（例如 `20`）
- `dedupe`: 是否去重（同一 capture key 下按字符串精确去重）
- `normalizeRefTags`: 仅用于去重 key 归一化，去掉形如 `[ref=e120]`（含行尾 ` [ref=e120]:`）的引用标签（保留原始输出文本，兼容旧别名 `normalizeRefSuffix`）
- `startsWith`: 白名单前缀，只有以这些前缀开头的行才保留（支持别名 `star_with`）
- `excludes`: 黑名单前缀，以这些前缀开头的行会被过滤（支持别名 `ext`）
- `startsWith` 与 `excludes` 互斥，不能同时传

命名关联说明（`captureAs` / `captureKey` / `captureFilter.keys`）：

- `captureAs`: 在某一步里给输出命名，例如 `snapshot` 步骤写成 `"captureAs": "page_snapshot"`
- `captureKey`: `breakWhen` 里指定要检查哪个命名输出
- `captureFilter.keys`: 指定过滤规则只作用于哪些命名输出
- `page_snapshot` 只是示例名，可以改成任意字符串，只要三处对得上

### Agent Browser 心跳接口 (POST /v2/agent-browser/heartbeat)

用于续租已存在实例的 TTL，不执行任何页面操作。

```json
{
  "platform": "x",
  "sourceId": "heartbeat_001",
  "instanceId": "ab-1234567890",
  "ownerId": "user-1001",
  "sessionKey": "tenant-a",
  "verbose": true
}
```

响应示例：

```json
{
  "instanceId": "ab-1234567890",
  "tabId": "tab-1a2b3c4d",
  "instanceActive": true,
  "ttlSeconds": 900,
  "expiresAt": "2026-03-13T10:15:00+00:00"
}
```

### v2 错误结构

`/v2/fetch` 在参数错误或运行时错误时统一返回：

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "platform: Field required",
    "retryable": false
  }
}
```

**配置选项**：

#### X.com
- `query`: 搜索关键词
- `user`: 用户名（获取用户推文）
- `listId`: 列表 ID（获取列表推文）
- `maxResults`: 最大结果数（默认 10）

#### 小红书
- `query`: 搜索关键词
- `userId`: 用户 ID（获取用户笔记）
- `noteId`: 笔记 ID（获取单个笔记详情）
- `maxResults`: 最大结果数（默认 10）

#### Reddit
- `subreddit`: Subreddit 名称（例如 "programming"）
- `query`: 搜索关键词
- `username`: 用户名（获取用户帖子）
- `sort`: 排序方式（hot, new, top, rising，默认 hot）
- `maxResults`: 最大结果数（默认 10）

#### 抖音 (Douyin)
- `query`: 搜索关键词
- `userId`: 用户 ID 或 sec_uid（获取用户视频）
- `videoId`: 视频 ID（获取单个视频详情）
- `maxResults`: 最大结果数（默认 10）

#### TikTok
- `query`: 搜索关键词
- `username`: 用户名（不带 @）
- `videoId`: 视频 ID（获取单个视频详情）
- `maxResults`: 最大结果数（默认 10）

#### 微博 (Weibo)
- `query`: 搜索关键词
- `userId`: 用户 ID (uid)
- `hotTopics`: 设为 true 获取热搜话题
- `maxResults`: 最大结果数（默认 10）

#### Telegram
- `chatId`: 频道/群组 ID 或用户名（留空则获取最近聊天）
- `maxResults`: 最大结果数（默认 20）

#### WhatsApp
- `contactName`: 联系人/群组名称（留空则获取最近聊天）
- `maxResults`: 最大结果数（默认 20）

## 使用示例

### Worker 对接建议（推荐）

Worker 侧建议统一调用 `/v2/fetch`，并显式传 `driver`，避免默认驱动变化导致行为不一致：

```json
{
  "platform": "x",
  "sourceId": "source-x-001",
  "driver": "xhttp",
  "driverOptions": {
    "url": "https://api.example.com/search",
    "method": "POST",
    "json": { "query": "openai" }
  }
}
```

对于社媒抓取可按 source 配置切换：

- API 直连：`driver: "xhttp"`
- 登录态接口/脚本：`driver: "playwright"`
- 复杂交互兜底：`driver: "agent-browser"`

### Python 调用

```python
import requests

# 验证认证
response = requests.post(
    "http://localhost:8000/verify-auth",
    json={
        "platform": "x",
        "auth_data": {"cookies": [...], "origins": []}
    }
)
print(response.json())

# 获取数据
response = requests.post(
    "http://localhost:8000/v2/fetch",
    json={
        "platform": "x",
        "sourceId": "test",
        "keywords": ["ai", "openai"],
        "driver": "playwright",
        "driverOptions": {
            "playwright": {"mode": "eval-js", "scriptPath": "/path/to/script.js"},
            "filter": {"minChars": 8}
        },
        "output": {"field": ["text", "url"]}
    }
)
for item in response.json():
    print(item["recordContent"].get("text"))
```

### 在 Web UI 中使用

1. 在 Chrome 中登录目标平台
2. 运行 `python export_chrome_cookies.py <platform>` 导出 cookies
3. 在添加 Source 时选择社交媒体类型
4. 上传导出的 auth.json 文件
5. 点击「上传验证」按钮验证 cookies 是否有效
6. 验证通过后，配置其他参数并保存

## 开发

### 项目结构

```
apps/gather/
├── main.py                 # FastAPI 服务入口
├── schemas.py              # 请求/响应模型
├── fetch_processing.py     # 结构化记录解析与关键词过滤
├── export_chrome_cookies.py # 浏览器认证数据导出脚本
├── pyproject.toml          # Python 依赖
└── README.md               # 本文档
```

### 添加新平台

1. 优先在 `site_scripts/<platform>/`（或 bb-site）提供 `me.ts/me.js` 验证脚本
2. 采集逻辑优先走 `driver=agent-browser` 或 `driverOptions.playwright.mode=eval-js`
3. 在 `main.py` 中添加平台映射与校验逻辑
4. 在 `export_chrome_cookies.py` 中添加平台配置（如需）

## 注意事项

- Cookies 可能会过期，需要定期重新导出
- 频繁访问可能导致账号被临时限制
- 建议设置合理的访问频率限制
- 使用代理可以提高稳定性

## 故障排除

### Cookies 导出失败

1. 确保 Chrome 完全关闭
2. 检查是否有足够的权限访问 Chrome 数据目录
3. 在 macOS 上，可能需要给终端应用文件夹访问权限

### 认证验证失败

1. 检查 cookies 是否过期
2. 确保在 Chrome 中已登录目标平台
3. 重新导出 cookies 并再次尝试

### Playwright 错误

1. 确保已安装 Playwright 浏览器：`playwright install chromium`
2. 在某些系统上可能需要安装额外依赖：`playwright install-deps`
