# @dreamer/upload 示例

本目录包含 `@dreamer/upload` 库的使用示例。

## 示例列表

| 文件 | 说明 |
|------|------|
| [basic.ts](./basic.ts) | 基础用法：工具函数、文件验证、上传处理器 |
| [validation.ts](./validation.ts) | 文件验证：大小、类型、扩展名、安全检查 |
| [storage.ts](./storage.ts) | 存储适配器：本地存储、自定义适配器 |
| [multipart.ts](./multipart.ts) | 分片上传：大文件上传、断点续传 |
| [cloud.ts](./cloud.ts) | 云存储：AWS S3、阿里云 OSS、腾讯云 COS |
| [server.ts](./server.ts) | 服务端：HTTP 上传服务器示例 |
| [client.ts](./client.ts) | 客户端：使用 UploadClient 上传文件 |

## 运行示例

```bash
# 运行基础示例
deno run -A examples/basic.ts

# 运行验证示例
deno run -A examples/validation.ts

# 运行存储示例
deno run -A examples/storage.ts

# 运行分片上传示例
deno run -A examples/multipart.ts

# 运行云存储示例（需要配置凭证）
deno run -A examples/cloud.ts

# 启动上传服务器
deno run -A examples/server.ts

# 运行客户端上传示例
deno run -A examples/client.ts
```

## 功能概览

### 基础功能

- 文件扩展名、MIME 类型处理
- 唯一文件名生成
- 文件大小格式化
- FormData 处理
- 文件下载响应生成

### 文件验证

- 文件大小验证
- MIME 类型验证（支持通配符）
- 扩展名白名单/黑名单
- Magic Bytes 检测（防伪装）
- 路径遍历防护
- 文件名安全处理

### 存储适配器

- 内存存储（开发/测试）
- 本地文件存储
- AWS S3
- 阿里云 OSS
- 腾讯云 COS
- 自定义适配器接口

### 分片上传

- 大文件分片
- 并发上传
- 断点续传
- 上传取消
- 进度回调
- 重试机制

### 高级功能

- 文件去重（基于哈希）
- 按日期分目录
- CDN 集成
- 预签名 URL（前端直传）
- 跨域配置
