# MinIO 对象存储配置指南

## 1. 安装依赖

已添加以下依赖到 `package.json`：

- `@aws-sdk/client-s3` - AWS S3 客户端（兼容 MinIO）
- `@aws-sdk/s3-request-presigner` - 预签名 URL 生成

运行安装：

```bash
npm install
```

## 2. 环境变量配置

在 `.env` 文件中添加以下配置：

```bash
# MinIO 配置
MINIO_ENDPOINT=http://localhost:9000
MINIO_REGION=us-east-1
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=oak-research
```

## 3. 启动 MinIO 服务

### 使用 Docker Compose（推荐）

在 `docker-compose.dev.yml` 中添加 MinIO 服务：

```yaml
services:
  minio:
    image: minio/minio:latest
    ports:
      - "9000:9000"
      - "9001:9001"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    command: server /data --console-address ":9001"
    volumes:
      - minio_data:/data
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9000/minio/health/live"]
      interval: 30s
      timeout: 20s
      retries: 3

volumes:
  minio_data:
```

### 使用 Docker 直接运行

```bash
docker run -d \
  -p 9000:9000 \
  -p 9001:9001 \
  --name minio \
  -e "MINIO_ROOT_USER=minioadmin" \
  -e "MINIO_ROOT_PASSWORD=minioadmin" \
  -v minio_data:/data \
  minio/minio server /data --console-address ":9001"
```

### 使用 Homebrew（macOS）

```bash
brew install minio/stable/minio
minio server ~/minio-data
```

## 4. 创建存储桶

### 方法1：使用 MinIO Console（Web UI）

1. 访问 http://localhost:9001
2. 使用 `minioadmin` / `minioadmin` 登录
3. 点击 "Create Bucket"
4. 输入 bucket 名称：`oak-research`

### 方法2：使用代码自动创建

应用启动时会自动检查并创建 bucket（如果不存在）。

### 方法3：使用 MinIO Client (mc)

```bash
# 安装 mc
brew install minio/stable/mc

# 配置 MinIO 服务器
mc alias set local http://localhost:9000 minioadmin minioadmin

# 创建 bucket
mc mb local/oak-research
```

## 5. 验证配置

运行以下命令测试连接：

```bash
curl http://localhost:9000/minio/health/live
```

应该返回 `200 OK`。

## 6. 文件存储位置

文件会存储在 MinIO 中，存储路径格式：

```
knowledge/{knowledgeId}/{fileId}/{sanitizedFileName}
```

例如：

```
knowledge/cmipp0xvh0002x5rbz90dht58/file-123/report.pdf
```

## 7. 生产环境配置

生产环境建议：

- 使用独立的 MinIO 服务器或集群
- 配置 SSL/TLS
- 使用强密码
- 配置备份策略
- 设置访问策略和生命周期规则

## 8. 故障排除

### 连接失败

- 检查 MinIO 服务是否运行：`docker ps | grep minio`
- 检查端口是否被占用：`lsof -i :9000`
- 检查环境变量是否正确

### 权限错误

- 确保 Access Key 和 Secret Key 正确
- 检查 bucket 是否存在
- 检查 bucket 策略是否允许写入

### 文件上传失败

- 检查文件大小是否超过限制（50MB）
- 检查文件类型是否在允许列表中
- 查看服务器日志获取详细错误信息
