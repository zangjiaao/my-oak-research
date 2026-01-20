# Oak Gather Service

社交媒体数据采集服务，使用 Playwright 和 Cookie 认证来获取社交媒体平台的数据。

## 支持的平台

- **X.com (Twitter)** - 需要 Cookie 认证
- **小红书 (Xiaohongshu)** - 需要 Cookie 认证
- **Reddit** - 需要 Cookie 认证
- **抖音 (Douyin)** - 需要 Cookie 认证
- **TikTok** - 需要 Cookie 认证
- **Telegram** - 计划中

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

**请求体**：
```json
{
  "platform": "x",
  "auth_data": {
    "cookies": [...],
    "origins": []
  }
}
```

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

### 获取数据 (POST /fetch)

使用认证获取社交媒体数据。

**请求体**：
```json
{
  "platform": "x",
  "source_id": "source_123",
  "auth_data": {
    "cookies": [...],
    "origins": []
  },
  "config": {
    "query": "AI",
    "maxResults": 10
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

## 使用示例

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
    "http://localhost:8000/fetch",
    json={
        "platform": "x",
        "source_id": "test",
        "auth_data": {"cookies": [...], "origins": []},
        "config": {"query": "AI news", "maxResults": 5}
    }
)
for item in response.json():
    print(item["text"])
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
├── export_chrome_cookies.py # Chrome cookies 导出脚本
├── clients/
│   ├── __init__.py
│   ├── base_playwright.py  # Playwright 基类
│   ├── x_client.py         # X.com 客户端
│   ├── xiaohongshu_client.py # 小红书客户端
│   ├── reddit_client.py    # Reddit 客户端
│   ├── douyin_client.py    # 抖音客户端
│   └── tiktok_client.py    # TikTok 客户端
├── pyproject.toml          # Python 依赖
└── README.md               # 本文档
```

### 添加新平台

1. 在 `clients/` 目录创建新的客户端类，继承 `BasePlaywrightClient`
2. 实现 `verify_auth()` 和 `fetch_data()` 方法
3. 在 `main.py` 中添加平台处理逻辑
4. 在 `export_chrome_cookies.py` 中添加平台配置

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
