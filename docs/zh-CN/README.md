# @dreamer/upload

> 一个兼容 Deno 和 Bun
> 的完整的文件上传解决方案，支持分片上传、断点续传、多云存储适配

**English**: [README](../../README.md) · **客户端文档**:
[README](client/README.md)

[![JSR](https://jsr.io/badges/@dreamer/upload)](https://jsr.io/@dreamer/upload)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](../../LICENSE)
[![Tests](https://img.shields.io/badge/tests-107%20passed-brightgreen)](./TEST_REPORT.md)

---

## 🎯 功能

完整的文件上传包，提供客户端、服务端和云存储适配器全链路解决方案。纯 TypeScript
实现，支持分片上传、断点续传、文件安全扫描等企业级功能，适用于文件管理系统、云存储应用、内容管理平台等场景。

核心功能：

- **多云存储**: 支持 AWS S3、阿里云 OSS、腾讯云 COS、本地存储
- **分片上传**: 大文件自动分片，支持并发上传和断点续传
- **安全扫描**: 文件类型检测、病毒扫描、敏感内容识别
- **存储管理**: 自动清理、配额管理、文件生命周期

---

## 📦 安装

### Deno

```bash
deno add jsr:@dreamer/upload
```

### Bun

```bash
bunx jsr add @dreamer/upload
```

### 客户端（浏览器）

```typescript
// 直接导入客户端模块
import { UploadClient } from "@dreamer/upload/client";
```

---

## 🌍 环境兼容性

| 环境       | 版本要求 | 状态                               |
| ---------- | -------- | ---------------------------------- |
| **Deno**   | 2.5+     | ✅ 完全支持                        |
| **Bun**    | 1.0+     | ✅ 完全支持                        |
| **服务端** | -        | ✅ 支持（兼容 Deno 和 Bun 运行时） |
| **浏览器** | -        | ✅ 支持（客户端模块）              |

---

## ✨ 特性

- **多云存储适配器**：
  - AWS S3（完整支持 Signature V4）
  - 阿里云 OSS（原生签名 + S3 兼容模式）
  - 腾讯云 COS（原生签名 + S3 兼容模式）
  - 本地文件系统存储
- **分片上传**：
  - 支持大文件分片上传
  - 自动计算最优分片大小
  - 并发分片上传
  - 支持取消和重试
- **断点续传**：
  - 状态持久化（浏览器 localStorage）
  - 支持暂停/恢复上传
  - 上传进度跟踪
- **服务端处理**：
  - HTTP 分片上传处理器
  - 文件大小/类型验证
  - 自定义路径生成
  - 统一路由处理
- **客户端上传**：
  - 浏览器/Deno/Bun 通用
  - 进度回调
  - 状态变化回调
  - 速度和剩余时间计算
- **工具函数**：
  - 文件名处理和安全过滤
  - MIME 类型检测和匹配
  - 文件类型识别（图片/视频/音频/文档）
  - 文件哈希计算
  - 路径安全验证
- **统一存储管理**：
  - 统一的存储 API 接口
  - 支持环境变量配置
  - 自动选择存储后端

---

## 🎯 使用场景

- **Web 应用文件上传**：图片、视频、文档上传
- **大文件处理**：GB 级别文件分片上传
- **多云存储切换**：统一 API 适配不同云服务
- **断点续传场景**：网络不稳定环境下的可靠上传

---

## 🚀 快速开始

### 服务端基础示例

```typescript
import {
  generateFilename,
  getMimeType,
  Uploader,
  validateFile,
} from "@dreamer/upload";

// 创建上传处理器
const uploader = new Uploader({
  uploadDir: "./uploads",
  validation: {
    maxFileSize: 10 * 1024 * 1024, // 10MB
    allowedMimeTypes: ["image/*", "video/*"],
  },
});

// 处理 FormData 上传
const result = await uploader.handleFormData(formData);
console.log("上传结果:", result);
```

### 客户端基础示例

```typescript
import { createUploadClient, UploadClient } from "@dreamer/upload/client";

// 创建上传客户端
const client = createUploadClient({
  endpoint: "https://api.example.com/upload",
  chunkSize: 5 * 1024 * 1024, // 5MB
});

// 上传文件
const result = await client.upload(file, {
  filename: "example.jpg",
  onProgress: (progress) => {
    console.log(`${progress.percentage}%`);
  },
});

if (result.success) {
  console.log("上传成功:", result.url);
}
```

---

## 🎨 使用示例

### 使用云存储适配器

```typescript
import {
  createCOSAdapter,
  createOSSAdapter,
  createS3Adapter,
} from "@dreamer/upload/adapters";

// AWS S3
const s3 = createS3Adapter({
  bucket: "my-bucket",
  region: "us-east-1",
  accessKeyId: "your-access-key-id",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
});

// 阿里云 OSS
const oss = createOSSAdapter({
  bucket: "my-bucket",
  region: "oss-cn-hangzhou",
  accessKeyId: "LTAIxxxxxxxx",
  accessKeySecret: "xxxxxxxxxxxxxxxx",
});

// 腾讯云 COS
const cos = createCOSAdapter({
  bucket: "my-bucket-1250000000",
  region: "ap-guangzhou",
  secretId: "your-secret-id",
  secretKey: "xxxxxxxxxxxxxxxx",
});

// 上传文件
await s3.upload("path/to/file.jpg", fileData, {
  contentType: "image/jpeg",
});

// 下载文件
const data = await s3.download("path/to/file.jpg");

// 生成预签名 URL
const url = await s3.getPresignedUrl("path/to/file.jpg", {
  expiresIn: 3600,
});
```

### 分片上传

```typescript
import {
  getRecommendedPartSize,
  MultipartUploader,
} from "@dreamer/upload/multipart";
import { createS3Adapter } from "@dreamer/upload/adapters";

const adapter = createS3Adapter({/* ... */});

// 计算推荐分片大小
const partSize = getRecommendedPartSize(fileSize);

// 创建分片上传器
const uploader = new MultipartUploader(adapter, {
  partSize,
  concurrency: 3,
});

// 上传文件
const result = await uploader.upload("large-file.zip", fileData, {
  onProgress: (progress) => {
    console.log(`进度: ${progress.percentage}%`);
  },
});
```

### 客户端高级用法

```typescript
import { formatSize, UploadClient } from "@dreamer/upload/client";

const client = new UploadClient({
  endpoint: "https://api.example.com/upload",
  chunkSize: 5 * 1024 * 1024,
  concurrency: 3,
  retries: 3,
  persistState: true, // 启用状态持久化
});

// 设置认证令牌
client.setToken("your-auth-token");

// 上传文件
const result = await client.upload(file, {
  filename: "example.jpg",
  onProgress: (progress) => {
    console.log(
      `${progress.percentage}% - 速度: ${formatSize(progress.speed)}/s`,
    );
    console.log(`剩余时间: ${progress.remainingTime}s`);
  },
  onStateChange: (state) => {
    console.log(`状态: ${state.status}`);
  },
});

// 取消上传
client.cancel(uploadId);

// 暂停上传
client.pause(uploadId);

// 恢复上传
await client.resume(uploadId);

// 获取未完成的上传
const pending = await client.getPendingUploads();
```

### 服务端分片处理

```typescript
import { MultipartUploadHandler } from "@dreamer/upload/server";
import { createS3Adapter } from "@dreamer/upload/adapters";
import { serve } from "@dreamer/runtime-adapter";

const adapter = createS3Adapter({/* ... */});

// 创建处理器
const handler = new MultipartUploadHandler({
  storage: adapter,
  maxFileSize: 100 * 1024 * 1024, // 100MB
  maxPartSize: 10 * 1024 * 1024, // 10MB
  allowedMimeTypes: ["image/*", "video/*"],
  pathPrefix: "uploads",
});

// 在 HTTP 服务器中使用
serve({ port: 3000 }, async (request) => {
  // 使用统一路由处理
  const response = await handler.handle(request, "/upload");
  if (response) return response;

  return new Response("Not Found", { status: 404 });
});
```

### 统一存储管理

```typescript
import { createStorageManagerFromEnv, StorageManager } from "@dreamer/upload";

// 方式1：手动配置
const storage = new StorageManager({
  type: "s3",
  s3: {
    bucket: "my-bucket",
    region: "us-east-1",
    accessKeyId: "...",
    secretAccessKey: "...",
  },
});

// 方式2：从环境变量创建
// 设置环境变量：STORAGE_TYPE, S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY
const storageFromEnv = createStorageManagerFromEnv();

// 统一的存储操作
await storage.upload("path/to/file.jpg", fileData, {
  contentType: "image/jpeg",
});

const data = await storage.download("path/to/file.jpg");
const exists = await storage.exists("path/to/file.jpg");
const url = await storage.getPublicUrl("path/to/file.jpg");
```

### 工具函数

```typescript
import {
  // 哈希计算
  computeHash,
  computeShortHash,
  // 格式化
  formatFileSize,
  // 子目录生成
  generateDateSubdir,
  generateFilename,
  generateMonthSubdir,
  generateTimestampFilename,
  getBaseName,
  // 文件名处理
  getFileExtension,
  // MIME 类型
  getMimeType,
  isArchive,
  isAudio,
  isDocument,
  // 文件类型检测
  isImage,
  isPathSafe,
  isVideo,
  matchMimeType,
  sanitizeFilename,
  // 验证
  validateFile,
  validateFiles,
} from "@dreamer/upload";

// 文件名处理
const ext = getFileExtension("photo.jpg"); // "jpg"
const safe = sanitizeFilename("危险<文件>.txt"); // "危险_文件_.txt"
const unique = generateFilename("photo.jpg"); // "a1b2c3d4-e5f6-...-photo.jpg"

// MIME 类型检测
const mime = getMimeType("photo.jpg"); // "image/jpeg"
const isMatch = matchMimeType("image/jpeg", "image/*"); // true

// 文件类型检测
if (isImage("photo.jpg")) {
  console.log("这是一张图片");
}

// 文件验证
const result = validateFile(file, {
  maxSize: 10 * 1024 * 1024,
  allowedMimeTypes: ["image/*"],
  allowedExtensions: ["jpg", "png", "gif"],
});

if (!result.valid) {
  console.error("验证失败:", result.errors);
}

// 哈希计算
const hash = await computeHash(fileData); // SHA-256 哈希
const shortHash = await computeShortHash(fileData, 8); // 8位短哈希

// 格式化文件大小
console.log(formatFileSize(1024 * 1024)); // "1.00 MB"

// 生成日期子目录
const subdir = generateDateSubdir(); // "2026/01/30"
```

---

## 📚 API 文档

### 主模块 (@dreamer/upload)

#### 上传处理器

| API                                 | 说明               | 返回值                  |
| ----------------------------------- | ------------------ | ----------------------- |
| `new Uploader(config)`              | 创建上传处理器     | `Uploader`              |
| `uploader.handleFormData(formData)` | 处理 FormData 上传 | `Promise<UploadResult>` |

#### 存储管理器

| API                                   | 说明           | 返回值                      |
| ------------------------------------- | -------------- | --------------------------- |
| `new StorageManager(config)`          | 创建存储管理器 | `StorageManager`            |
| `createStorageManagerFromEnv()`       | 从环境变量创建 | `StorageManager`            |
| `storage.upload(key, data, options?)` | 上传文件       | `Promise<UploadedFileInfo>` |
| `storage.download(key)`               | 下载文件       | `Promise<Uint8Array>`       |
| `storage.exists(key)`                 | 检查是否存在   | `Promise<boolean>`          |
| `storage.delete(key)`                 | 删除文件       | `Promise<void>`             |
| `storage.list(prefix?, options?)`     | 列出文件       | `Promise<ListResult>`       |
| `storage.getPublicUrl(key)`           | 获取公开 URL   | `Promise<string>`           |

#### 工具函数

| API                                   | 说明               | 返回值                   |
| ------------------------------------- | ------------------ | ------------------------ |
| `getFileExtension(filename)`          | 获取文件扩展名     | `string`                 |
| `getBaseName(filename)`               | 获取文件基本名     | `string`                 |
| `sanitizeFilename(filename)`          | 安全过滤文件名     | `string`                 |
| `generateFilename(filename)`          | 生成唯一文件名     | `string`                 |
| `generateTimestampFilename(filename)` | 生成时间戳文件名   | `string`                 |
| `getMimeType(filename)`               | 获取 MIME 类型     | `string`                 |
| `matchMimeType(mimeType, pattern)`    | 匹配 MIME 类型     | `boolean`                |
| `isImage(filename)`                   | 检查是否为图片     | `boolean`                |
| `isVideo(filename)`                   | 检查是否为视频     | `boolean`                |
| `isAudio(filename)`                   | 检查是否为音频     | `boolean`                |
| `isDocument(filename)`                | 检查是否为文档     | `boolean`                |
| `isArchive(filename)`                 | 检查是否为压缩文件 | `boolean`                |
| `validateFile(file, options)`         | 验证单个文件       | `FileValidationResult`   |
| `validateFiles(files, options)`       | 验证多个文件       | `FileValidationResult[]` |
| `isPathSafe(path)`                    | 检查路径是否安全   | `boolean`                |
| `computeHash(data)`                   | 计算 SHA-256 哈希  | `Promise<string>`        |
| `computeShortHash(data, length)`      | 计算短哈希         | `Promise<string>`        |
| `formatFileSize(bytes)`               | 格式化文件大小     | `string`                 |
| `generateDateSubdir()`                | 生成日期格式子目录 | `string`                 |
| `generateMonthSubdir()`               | 生成月份格式子目录 | `string`                 |

### 适配器模块 (@dreamer/upload/adapters)

#### CloudStorageAdapter 接口

| API                                             | 说明           | 返回值                         |
| ----------------------------------------------- | -------------- | ------------------------------ |
| `upload(key, data, options?)`                   | 上传文件       | `Promise<void>`                |
| `download(key, options?)`                       | 下载文件       | `Promise<Uint8Array>`          |
| `delete(key)`                                   | 删除文件       | `Promise<void>`                |
| `exists(key)`                                   | 检查是否存在   | `Promise<boolean>`             |
| `getMetadata(key)`                              | 获取元数据     | `Promise<ObjectMetadata>`      |
| `list(prefix?, options?)`                       | 列出对象       | `Promise<ListResult>`          |
| `copy(sourceKey, destKey, options?)`            | 复制对象       | `Promise<void>`                |
| `getPresignedUrl(key, options?)`                | 生成预签名 URL | `Promise<string>`              |
| `initiateMultipartUpload(key, options?)`        | 初始化分片上传 | `Promise<MultipartUploadInit>` |
| `uploadPart(key, uploadId, partNumber, data)`   | 上传分片       | `Promise<UploadPartResult>`    |
| `completeMultipartUpload(key, uploadId, parts)` | 完成分片上传   | `Promise<void>`                |
| `abortMultipartUpload(key, uploadId)`           | 取消分片上传   | `Promise<void>`                |
| `listParts(key, uploadId)`                      | 列出已上传分片 | `Promise<ListPartsResult>`     |

#### 适配器创建函数

| API                        | 说明            | 配置参数                                             |
| -------------------------- | --------------- | ---------------------------------------------------- |
| `createS3Adapter(config)`  | 创建 S3 适配器  | `bucket`, `region`, `accessKeyId`, `secretAccessKey` |
| `createOSSAdapter(config)` | 创建 OSS 适配器 | `bucket`, `region`, `accessKeyId`, `accessKeySecret` |
| `createCOSAdapter(config)` | 创建 COS 适配器 | `bucket`, `region`, `secretId`, `secretKey`          |

### 客户端模块 (@dreamer/upload/client)

| API                             | 说明           | 返回值                   |
| ------------------------------- | -------------- | ------------------------ |
| `new UploadClient(config)`      | 创建上传客户端 | `UploadClient`           |
| `createUploadClient(config)`    | 工厂函数       | `UploadClient`           |
| `client.setToken(token)`        | 设置认证令牌   | `void`                   |
| `client.setHeaders(headers)`    | 设置请求头     | `void`                   |
| `client.upload(file, options?)` | 上传文件       | `Promise<UploadResult>`  |
| `client.pause(uploadId)`        | 暂停上传       | `void`                   |
| `client.resume(uploadId)`       | 恢复上传       | `Promise<UploadResult>`  |
| `client.cancel(uploadId)`       | 取消上传       | `void`                   |
| `client.getPendingUploads()`    | 获取未完成上传 | `Promise<UploadState[]>` |
| `client.cleanup(maxAge?)`       | 清理过期状态   | `void`                   |
| `formatSize(bytes)`             | 格式化文件大小 | `string`                 |
| `calculateFileHash(data)`       | 计算文件哈希   | `Promise<string>`        |

**UploadClientConfig 配置项：**

| 选项             | 类型                     | 默认值 | 说明                 |
| ---------------- | ------------------------ | ------ | -------------------- |
| `endpoint`       | `string`                 | -      | 上传端点 URL（必填） |
| `chunkSize`      | `number`                 | 5MB    | 分片大小             |
| `concurrency`    | `number`                 | 3      | 并发上传数           |
| `retries`        | `number`                 | 3      | 重试次数             |
| `retryDelay`     | `number`                 | 1000   | 重试延迟（毫秒）     |
| `timeout`        | `number`                 | 30000  | 请求超时（毫秒）     |
| `headers`        | `Record<string, string>` | -      | 自定义请求头         |
| `token`          | `string`                 | -      | 认证令牌             |
| `persistState`   | `boolean`                | false  | 是否持久化状态       |
| `stateKeyPrefix` | `string`                 | -      | 状态存储键前缀       |

### 服务端模块 (@dreamer/upload/server)

| API                                  | 说明             | 返回值                      |
| ------------------------------------ | ---------------- | --------------------------- |
| `new MultipartUploadHandler(config)` | 创建处理器       | `MultipartUploadHandler`    |
| `handler.handle(request, basePath)`  | 统一处理（推荐） | `Promise<Response \| null>` |
| `handler.handleInit(request)`        | 处理初始化请求   | `Promise<Response>`         |
| `handler.handleChunk(request)`       | 处理分片上传请求 | `Promise<Response>`         |
| `handler.handleComplete(request)`    | 处理完成请求     | `Promise<Response>`         |
| `handler.handleAbort(request)`       | 处理取消请求     | `Promise<Response>`         |
| `handler.handleStatus(request)`      | 处理状态查询请求 | `Promise<Response>`         |

**MultipartUploadHandlerConfig 配置项：**

| 选项               | 类型                                | 默认值 | 说明               |
| ------------------ | ----------------------------------- | ------ | ------------------ |
| `storage`          | `CloudStorageAdapter`               | -      | 存储适配器（必填） |
| `maxPartSize`      | `number`                            | 100MB  | 最大分片大小       |
| `maxFileSize`      | `number`                            | 5GB    | 最大文件大小       |
| `allowedMimeTypes` | `string[]`                          | []     | 允许的 MIME 类型   |
| `pathPrefix`       | `string`                            | ""     | 上传路径前缀       |
| `generatePath`     | `(filename, meta) => string`        | -      | 自定义路径生成     |
| `validate`         | `(filename, size, mime) => boolean` | -      | 自定义验证函数     |

---

## 🚀 性能优化

- **分片上传**：大文件自动分片，支持并发上传
- **断点续传**：状态持久化，避免重复上传
- **流式处理**：减少内存占用
- **连接复用**：适配器内部复用 HTTP 连接
- **智能分片**：根据文件大小自动计算最优分片大小

---

## 📊 测试报告

详细的测试报告请查看 [TEST_REPORT.md](./TEST_REPORT.md)。

### 测试统计

- **测试时间**: 2026-01-30
- **测试环境**: Deno 2.6.4 / Bun 1.3.5
- **总测试数**: 107
- **通过**: 107 ✅
- **失败**: 0
- **通过率**: 100%

---

## 📝 注意事项

- **服务端和客户端分离**：通过 `/client` 和 `/server` 子路径明确区分
- **统一接口**：所有存储适配器使用相同的 `CloudStorageAdapter` 接口
- **跨运行时**：使用 `@dreamer/runtime-adapter` 实现 Deno/Bun 兼容
- **S3 兼容模式**：OSS 和 COS 适配器支持 S3 兼容模式，可使用 MinIO 测试
- **分片大小**：S3/MinIO 要求分片（除最后一个外）至少 5MB
- **类型安全**：完全采用 TypeScript，所有 API 都有完整的类型定义

---

## 变更日志

### [1.0.1] - 2026-03-27

- **新增**：**`LocalCloudStorageAdapter`** /
  **`createLocalCloudStorageAdapter`** （**`@dreamer/upload/adapters`**）—
  本地磁盘 **`CloudStorageAdapter`**，支持分片暂存以配合
  **`MultipartUploadHandler`**。**`package.json`** 与 **`deno.json`** 的
  **`exports`** 对齐。
- **变更**：CI 发布使用 **`npx jsr publish`**；**`.gitignore`** 更新。

完整历史：[CHANGELOG](./CHANGELOG.md)。

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

---

## 📄 许可证

Apache License 2.0 - 详见 [LICENSE](../../LICENSE)

---

<div align="center">

**Made with ❤️ by Dreamer Team**

</div>
