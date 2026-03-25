# Oak Gather Service

Oak Gather 是一个基于 FastAPI 的平台数据采集服务，统一通过 `/v1` API 调用 Playwright / xhttp 执行脚本并返回结构化数据。

## 能力概览

### 可抓取平台（以 `scripts/` 为准）

- 社交/社区：X(Twitter)、Reddit、小红书、微博、Bilibili、YouTube、知乎、LinkedIn、Linux Do
- 资讯/内容：BBC、Reuters、Hacker News、36Kr、Hupu、Toutiao
- 搜索/检索：Google、Bing、DuckDuckGo、Baidu、CNBlogs、CSDN、Dev.to、Arxiv、Ctrip

### 认证能力

- Cookie / storage_state 校验：`/v1/verify-auth`
- stateFile 生命周期：`/v1/auth/state-file`
- WhatsApp Profile 上传与校验：`/v1/auth/profile`

## 快速开始

### 1. 安装依赖

```bash
cd apps/gather
uv sync
playwright install chromium
```

### 2. 导出浏览器认证数据

```bash
# X
uv run tools/export_chrome_cookies.py x

# 小红书
uv run tools/export_chrome_cookies.py xiaohongshu

# Reddit
uv run tools/export_chrome_cookies.py reddit

# 微博
uv run tools/export_chrome_cookies.py weibo

# WhatsApp（导出 profile，需扫码）
uv run tools/export_chrome_cookies.py whatsapp
```

注意：

- 导出前请完全关闭 Chrome
- 认证文件默认写入 `.auth/`（已在 `.gitignore` 中）

### 3. 启动服务

```bash
python -m app
```

或：

```bash
uvicorn app:app --host 0.0.0.0 --port 8000 --reload
```

## API 接口（/v1）

### 路由总览

- `POST /v1/verify-auth`：校验认证数据是否有效
- `POST /v1/fetch`：执行采集请求并返回 `{ items, meta }`
- `GET /v1/scripts/catalog`：列出可用脚本目录与 sample 元数据
- `POST /v1/auth/state-file`：保存 `authData` 为 `.auth/*.json`
- `DELETE /v1/auth/state-file`：删除指定 state file
- `POST /v1/auth/profile`：上传并校验 WhatsApp profile zip
- `DELETE /v1/auth/profile/{profile_name}`：删除已上传 profile

### `POST /v1/verify-auth`

用于验证 cookies/state file 是否有效。

内置探针：

- `x/twitter`：检查 `ct0` + `auth_token`
- `reddit`：Playwright 打开站点并请求 `/api/me.json`
- `whatsapp`：Playwright profile 探针
- 其他平台：返回 `built-in-probe-missing`

请求示例：

```json
{
  "platform": "x",
  "stateFile": ".auth/x_auth.json",
  "verifyTargetUrl": "https://x.com",
  "verifyTimeoutMs": 90000,
  "verifyPostWaitMs": 5000
}
```

说明：

- `authData` 与 `stateFile` 二选一
- `stateFile` 路径以 gather 服务本机文件系统为准

### `POST /v1/fetch`

`/v1/fetch` 是唯一采集入口，标准响应结构为 `{ items, meta }`。

标准请求示例（Playwright）：

```json
{
  "platform": "x",
  "sourceId": "source_123",
  "userId": "user_123",
  "keywords": ["openai"],
  "driver": {
    "name": "playwright",
    "script": {
      "type": "search",
      "args": {
        "query": "openai",
        "limit": 20
      }
    },
    "mode": "intercept-x-search",
    "network": {
      "proxy": {
        "url": "socks5h://127.0.0.1:9050"
      }
    },
    "filter": {
      "minChars": 8,
      "matchMode": "smart"
    }
  },
  "output": {
    "field": ["text", "url"],
    "type": "x.post",
    "keywordScope": ["text"]
  }
}
```

标准请求示例（xhttp）：

```json
{
  "platform": "google",
  "sourceId": "source_google_001",
  "keywords": ["openai"],
  "driver": {
    "name": "xhttp",
    "script": {
      "type": "search",
      "args": {
        "query": "openai"
      }
    },
    "url": "https://www.google.com/search",
    "method": "GET",
    "params": {
      "q": "openai"
    }
  },
  "output": {
    "field": ["title", "url", "snippet"]
  }
}
```

响应示例：

```json
{
  "items": [
    {
      "sourceId": "source_123",
      "sourceType": "SOCIAL_MEDIA",
      "recordId": "source_123:1",
      "recordType": "x.post",
      "recordTime": "2026-03-25T10:00:00Z",
      "recordContent": {
        "text": "OpenAI update",
        "url": "https://x.com/..."
      }
    }
  ],
  "meta": {
    "adapter": "x.search",
    "strategyTried": ["cookie", "header", "intercept", "ui"],
    "strategyUsed": "cookie",
    "driverUsed": "playwright"
  }
}
```

字段说明：

- `driver.name`：`playwright` 或 `xhttp`
- `driver.script.type`：intent 名称（如 `search` / `profile` / `news`）
- `driver.script.args`：intent 参数
- `driver.filter`：关键词硬过滤
- `output.field`：输出字段白名单或字段映射
- `output.type`：覆盖 `recordType`
- `output.keywordScope`：限定关键词匹配范围

关键词过滤参数（`driver.filter`）：

- `minChars`：最小正文长度，默认 `1`
- `matchMode`：`smart`（默认）或 `contains` 或 `term_and_word_boundary`
- `includeUrl`：是否将 URL 纳入关键词匹配，默认 `false`
- `minCjkTermChars`：CJK 关键词最小长度，默认 `2`

### 通用代理配置

`playwright` 与 `xhttp` 都支持：

```json
{
  "driver": {
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

### `GET /v1/scripts/catalog`

返回当前可用脚本目录信息（按平台/intent 聚合），可用于 UI 下拉和参数提示。

### `POST /v1/auth/state-file`

把认证数据保存为 `.auth/*.json`：

```json
{
  "platform": "x",
  "authData": {
    "cookies": [],
    "origins": []
  },
  "name": "prod"
}
```

### `DELETE /v1/auth/state-file`

```json
{
  "stateFile": ".auth/x_prod_abcd1234.json"
}
```

### `POST /v1/auth/profile`

- `multipart/form-data`
- 字段：`file`(zip), `profile_name`, `platform`（当前仅 `whatsapp`）

### `DELETE /v1/auth/profile/{profile_name}`

删除已上传 profile 目录。

### 错误响应结构

`/v1/fetch` 参数错误或运行时错误统一返回：

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "platform: Field required",
    "retryable": false
  }
}
```

## 使用示例

### Worker 调用建议

建议统一调用 `/v1/fetch`，并显式传递 `driver` 与 `driver.script`：

```json
{
  "platform": "x",
  "sourceId": "source-x-001",
  "driver": {
    "name": "playwright",
    "script": {
      "type": "search",
      "args": {
        "query": "openai",
        "limit": 20
      }
    }
  },
  "output": {
    "field": ["text", "url"]
  }
}
```

### Python 调用

```python
import requests

verify_resp = requests.post(
    "http://localhost:8000/v1/verify-auth",
    json={
        "platform": "x",
        "stateFile": ".auth/x_auth.json",
    },
)
print(verify_resp.json())

fetch_resp = requests.post(
    "http://localhost:8000/v1/fetch",
    json={
        "platform": "x",
        "sourceId": "test",
        "userId": "user-123",
        "keywords": ["ai", "openai"],
        "driver": {
            "name": "playwright",
            "script": {
                "type": "search",
                "args": {"query": "openai", "limit": 20},
            },
            "filter": {"minChars": 8},
        },
        "output": {"field": ["text", "url"]},
    },
)

for item in fetch_resp.json().get("items", []):
    print(item["recordContent"].get("text"))
```

## 开发

### 项目结构

```text
apps/gather/
├── app.py                         # FastAPI 主入口（uvicorn 启动点）
├── schemas.py                     # 请求/响应 Pydantic 模型
├── api/                           # HTTP 路由层（薄 wrapper）
│   ├── auth.py                    # /v1/verify-auth, /v1/auth/*
│   ├── catalog.py                 # /v1/scripts/catalog
│   ├── fetch.py                   # /v1/fetch
│   └── system.py                  # /（健康检查）
├── core/                          # 业务逻辑层
│   ├── browser_pool.py            # Playwright 浏览器池生命周期
│   ├── catalog.py                 # 脚本目录构建
│   ├── config.py                  # 环境变量、路径常量、intent 注册表
│   ├── errors.py                  # 标准化错误响应
│   ├── fetch.py                   # fetch 调度与 driver 注册
│   ├── intercept/                 # 按平台拆分的 intercept handler
│   ├── io_logging.py              # API I/O 日志
│   ├── normalize.py               # 请求规范化与输出字段映射
│   ├── playwright_runner.py       # Playwright 脚本执行引擎
│   └── profile.py                 # 认证状态文件与 profile 管理
├── drivers/                       # Driver 抽象（playwright / xhttp）
├── libs/                          # 独立工具库
│   ├── auth_verify.py             # 认证校验探针
│   ├── fetch_processing.py        # 关键词硬过滤
│   └── script_framework.py        # 脚本注册与模板构建
├── scripts/                       # 源脚本（按平台/intent）
├── scripts-dist/                  # 编译后运行时脚本
├── tools/export_chrome_cookies.py # 浏览器认证数据导出工具
├── tests/                         # 测试用例
├── pyproject.toml
└── README.md
```

### 添加新平台/新 intent

1. 在 `scripts/<platform>/<intent>.ts` 增加脚本
2. 确认脚本可被 `ScriptRegistry` 识别并出现在 `/v1/scripts/catalog`
3. 如需认证探针，在 `libs/auth_verify.py` 增加平台校验逻辑
4. 如需 `intercept-*` 模式，在 `core/intercept/` 增加对应平台 handler
5. 在 `core/config.py` 注册新平台的 intent 集合
6. 补充/更新对应测试用例

## 注意事项

- 认证数据会过期，需要定期重新导出
- 高频访问可能触发平台限流或风控
- 建议在生产环境配置代理与合理节流

## 故障排除

### 认证导出失败

1. 确保 Chrome 完全关闭
2. 检查终端对浏览器数据目录的访问权限
3. macOS 下确保终端有“文件与文件夹”权限

### 认证验证失败

1. 检查 cookies / profile 是否过期
2. 确认当前账号在浏览器中可正常访问目标平台
3. 重新导出认证数据后重试

### Playwright 错误

1. 确认已安装浏览器：`playwright install chromium`
2. 必要时安装系统依赖：`playwright install-deps`
