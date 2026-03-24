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
uv run tools/export_chrome_cookies.py x

# 导出小红书 cookies
uv run tools/export_chrome_cookies.py xiaohongshu

# 导出 Reddit cookies
uv run tools/export_chrome_cookies.py reddit

# 导出抖音 cookies
uv run tools/export_chrome_cookies.py douyin

# 导出 TikTok cookies
uv run tools/export_chrome_cookies.py tiktok

# 导出微博 cookies
uv run tools/export_chrome_cookies.py weibo

# 导出 Telegram cookies + localStorage
uv run tools/export_chrome_cookies.py telegram

# 导出 WhatsApp（启动浏览器，需要扫码登录）
uv run tools/export_chrome_cookies.py whatsapp
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
python -m api.app
```

或者使用 uvicorn：

```bash
uvicorn api.app:app --host 0.0.0.0 --port 8000 --reload
```

## API 接口

### 验证认证 (POST /v1/verify-auth)

验证 cookies 是否有效。

当前使用内置校验探针，不再依赖 `bb-site` 或 `site_scripts`：  
- `x/twitter`: 检查 `ct0` + `auth_token` cookie  
- `reddit`: Playwright 打开站点并请求 `/api/me.json`  
- `whatsapp`: 使用 Playwright profile 探测登录态
- 其他平台：返回 `built-in-probe-missing`

**请求体**：
```json
{
  "platform": "x",
  "stateFile": ".auth/x_auth.json",
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

### 获取数据（POST /v1/fetch)

`/v1/fetch` 是唯一 fetch 契约入口，返回 `{ items, meta }`。

**请求体**：
```json
{
  "platform": "x",
  "sourceId": "source_123",
  "userId": "user_123",
  "keywords": ["openai"],
  "driver": {
    "name": "playwright",
    "option": {
      "args": {
        "query": "openai",
        "limit": 20
      },
      "network": {
        "proxy": {
          "url": "socks5h://127.0.0.1:9050"
        }
      }
    },
    "filter": {
      "minChars": 8
    }
  },
  "output": {
    "field": ["text", "meta.image", "url", "comments"],
    "type": "x.post"
  }
}
```

`driver.name` 必填，可选值为 `xhttp`、`playwright`。
`driver.option` 透传给对应 driver；`driver.filter` 为关键词过滤参数（如 `minChars`）。
`userId` 建议与 `sourceId` 同级传入（系统用户 ID，用于 Playwright 资源池复用隔离）。
`output.field` 必填，控制 `recordContent` 输出字段（支持点路径）：

- `["text"]`：只返回 `recordContent.text`
- `["text", "url"]`：返回 `recordContent.text` + `recordContent.url`
- `["meta.image"]`：返回嵌套字段 `recordContent.meta.image`
- `{"query":"query","product":"product","text":"tweets"}`：按映射重组输出字段（左侧是输出字段名，右侧是原始输出字段路径）
- 当映射路径命中数组字段（如 `text.id`、`text.author`）时，会按数组元素自动拆分为多条 record 输出
- 当原始字段名是 `tweets`（或 `items/posts/results/data/notes`）时，也支持用 `text.xxx` 作为映射路径别名

`output.keywordScope` 可选，限制关键词过滤只检查 `recordContent` 指定字段（例如 `["text"]`）。

`driver.filter` 关键词匹配参数（`/v1/fetch` 与 `/v1/fetch` 一致）：

- `minChars`：最小正文长度门槛（默认 `1`）
- `matchMode`：匹配模式，`smart`（默认，词级匹配）或 `contains`（子串匹配兼容模式）
- `includeUrl`：是否把 `url` 字段纳入关键词匹配（默认 `false`）
- `minCjkTermChars`：CJK 关键词最小长度（默认 `2`）

`smart` 模式说明：

- 英文/数字词按词边界匹配（避免 `ai` 命中 `airport/campaign`）
- CJK 关键词按子串匹配（受 `minCjkTermChars` 限制）
- 未显式开启 `includeUrl` 时，URL 不参与关键词命中

`/v1/fetch` 推荐使用 `driver.script` 契约；服务端会对旧 `driver.option`/顶层 `intent` 做兼容归一化。

### 通用网络代理配置（支持 HTTP/SOCKS/Tor）

两个 driver（`xhttp` / `playwright`）都支持在 `driver.option.network.proxy` 下统一配置代理：

```json
{
  "driver": {
    "name": "playwright",
    "option": {
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
}
```

- `url`: 必填，支持 `http://`、`https://`、`socks5://`、`socks5h://`
- `username/password`: 可选，未写入 URL 时会自动注入
- `bypass`: 可选，主要用于浏览器类 driver（Playwright）
- Tor 推荐使用 `socks5h://127.0.0.1:9050`（DNS 也走 Tor）

### xhttp 驱动（`driver.name: "xhttp"`）

适用于直接调用搜索 API 或普通 HTTP 页面，不依赖浏览器环境。

```json
{
  "platform": "search",
  "sourceId": "source_search_demo",
  "driver": {
    "name": "xhttp",
    "option": {
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

### v2 错误结构

`/v1/fetch` 在参数错误或运行时错误时统一返回：

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

Worker 侧建议统一调用 `/v1/fetch`，并显式传 `driver`，避免默认驱动变化导致行为不一致：

```json
{
  "platform": "x",
  "sourceId": "source-x-001",
  "driver": {
    "name": "xhttp",
    "option": {
      "url": "https://api.example.com/search",
      "method": "POST",
      "json": { "query": "openai" }
    }
  }
}
```

对于社媒抓取可按 source 配置切换：

- API 直连：`driver.name: "xhttp"`
- 登录态接口/脚本：`driver.name: "playwright"`
- 复杂交互兜底：`driver.name: "playwright"`（`intercept-*` / `eval-js`）

### Python 调用

```python
import requests

# 验证认证
response = requests.post(
    "http://localhost:8000/v1/verify-auth",
    json={
        "platform": "x",
        "auth_data": {"cookies": [...], "origins": []}
    }
)
print(response.json())

# 获取数据
response = requests.post(
    "http://localhost:8000/v1/fetch",
    json={
        "platform": "x",
        "sourceId": "test",
        "userId": "user-123",
        "keywords": ["ai", "openai"],
        "driver": {
            "name": "playwright",
            "option": {"args": {"query": "openai", "limit": 20}},
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
2. 运行 `python tools/export_chrome_cookies.py <platform>` 导出 cookies
3. 在添加 Source 时选择社交媒体类型
4. 上传导出的 auth.json 文件
5. 点击「上传验证」按钮验证 cookies 是否有效
6. 验证通过后，配置其他参数并保存

## 开发

### 项目结构

```
apps/gather/
├── api/app.py              # FastAPI 服务入口
├── schemas.py              # 请求/响应模型
├── libs/fetch_processing.py # 结构化记录解析与关键词过滤
├── tools/export_chrome_cookies.py # 浏览器认证数据导出脚本
├── pyproject.toml          # Python 依赖
└── README.md               # 本文档
```

### 添加新平台

1. 在 `apps/gather/auth_verify.py` 增加该平台的内置 verify probe
2. 采集逻辑优先走 `driver.name=playwright` 的内置 `intercept-*` 能力
3. 在 `api/app.py` 中添加平台映射与采集逻辑
4. 在 `tools/export_chrome_cookies.py` 中添加平台配置（如需）

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
