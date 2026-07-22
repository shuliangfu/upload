# 变更日志

@dreamer/upload 的所有重要变更均记录于此。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

---

## [1.1.0] - 2026-07-23

### 新增

- **Node.js 22+ 兼容**：将全部 Deno 专属 API 替换为 `@dreamer/runtime-adapter`
  v1.2.2 的跨运行时等价 API：
  - `src/storage.ts`：`Deno.writeFile/readFile/remove/stat/mkdir` →
    `writeFile/readFile/remove/stat/mkdir`（`mkdir` 别名为 `makeDir` 以避免与类方法冲突）。
  - `src/storage-manager.ts`：`Deno.env.toObject()` → `getEnvAll()`。
  - `src/scanner.ts`：`Deno.connect()` → runtime-adapter `connect()`；将
    `conn.write()/read()` 重构为流式 `writable.getWriter()/readable.getReader()`。
- **test:node** 脚本（`tsx --test --test-force-exit tests/*.test.ts`），适配
  Node.js 22+ 测试运行器。
- **CI 工作流**（9 jobs）：3 Deno v2.9 + 3 Bun + 3 Node 22（Linux/macOS/Windows）。
- **tsconfig.json** 与 **.npmrc**（`@jsr:registry`），供 Node/Bun 解析。
- **minimumDependencyAge: 0**：deno.json 中新增。

### 变更

- 升级依赖：@dreamer/i18n ^1.1.2、@dreamer/runtime-adapter ^1.2.2、
  @dreamer/test ^1.2.3。
- package.json 中 `engines.node` 设为 `>=22`。

### 修复

- multipart.test.ts：为"应该能取消分片上传"测试补上缺失的
  `if (!minioAvailable) return;` 守卫——该测试此前未检查 MinIO 可用性即直连
  （既有 bug，被 CI 暴露）。

---

## [1.0.1] - 2026-03-27

### 新增

- **`LocalCloudStorageAdapter`（`src/adapters/local-cloud.ts`）**：本地磁盘完整实现
  **`CloudStorageAdapter`**，在无 S3/OSS/COS 时仍可配合
  **`MultipartUploadHandler`** 做分片；分片暂存
  **`baseDir/.staging/<uploadId>/`**，合并后写入 **`baseDir/<key>`**； 可选
  **`publicFileBasePath`** 供 **`getPresignedUrl`**。由
  **`@dreamer/upload/adapters`** 导出
  **`createLocalCloudStorageAdapter`**、**`LocalCloudStorageAdapter`**、
  **`LocalCloudStorageConfig`**。
- **`package.json`**：与 **`deno.json`** 的 **`exports`** 及脚本对齐，便于
  Bun/npm 侧使用。

### 变更

- **CI（`.github/workflows/publish.yml`）**：在推送 **`v*`** tag 时使用
  **`npx jsr publish`** 发布。
- **`.gitignore`**：补充测试数据、快照与覆盖率等忽略项。

---

## [1.0.0] - 2026-02-20

### 新增

首个稳定版本。提供客户端、服务端与多云存储适配器的完整文件上传方案。

#### 主模块（`@dreamer/upload`）

- **Uploader**：`createUploader`、`Uploader` 类；`handleFormData`
  处理服务端表单上传，支持校验（最大大小、MIME、扩展名）。
- **StorageManager**：`new StorageManager(config)`、`createStorageManagerFromEnv()`；统一
  API：`upload`、`download`、`exists`、`delete`、`list`、`getPublicUrl`；支持
  `local`、`s3`、`oss`、`cos` 后端。
- **工具函数**：
  - 文件名：`getFileExtension`、`getBaseName`、`sanitizeFilename`、`generateFilename`、`generateTimestampFilename`、`getFilenameFromUrl`
  - MIME：`getMimeType`、`matchMimeType`
  - 类型检测：`isImage`、`isVideo`、`isAudio`、`isDocument`、`isArchive`、`isHiddenFile`
  - 校验：`validateFile`、`validateFiles`、`isPathSafe`
  - 哈希：`computeHash`（SHA-256）、`computeShortHash`
  - 格式化：`formatFileSize`
  - 子目录：`generateDateSubdir`、`generateMonthSubdir`
- **常量**：`DEFAULT_FORBIDDEN_EXTENSIONS`、`MIME_TYPES`。
- **本地存储**：`createLocalStorage`、`LocalStorage` 本地文件存储适配器。

#### 适配器（`@dreamer/upload/adapters`）

- **CloudStorageAdapter**
  接口：`upload`、`download`、`delete`、`exists`、`getMetadata`、`list`、`copy`、`getPresignedUrl`、`initiateMultipartUpload`、`uploadPart`、`completeMultipartUpload`、`abortMultipartUpload`、`listParts`。
- **S3**：`createS3Adapter`、`S3StorageAdapter`；AWS Signature
  V4；路径样式与虚拟主机样式；兼容 MinIO。
- **OSS**：`createOSSAdapter`、`OSSStorageAdapter`；阿里云原生签名；S3
  兼容模式。
- **COS**：`createCOSAdapter`、`COSStorageAdapter`；腾讯云原生签名；S3
  兼容模式。

#### 分片上传（`@dreamer/upload/multipart`）

- **MultipartUploader**：分片上传，可配置分片大小与并发；进度回调；支持取消。
- **getRecommendedPartSize**：为 S3/MinIO 计算分片大小（每分片至少 5MB）。

#### 客户端（`@dreamer/upload/client`）

- **UploadClient**：`new UploadClient(config)`、`createUploadClient(config)`；`upload(file, options?)`、`resume(uploadId, file)`、`pause`、`cancel`、`getPendingUploads`、`cleanup`、`setToken`、`setHeaders`。
- **类型**：`UploadClientConfig`、`UploadProgress`、`UploadOptions`、`UploadResult`、`ChunkInfo`、`UploadState`。
- **辅助**：`formatSize`、`calculateFileHash`。
- 断点续传（`persistState` 使用 localStorage）；进度与状态变化回调。

#### 服务端（`@dreamer/upload/server`）

- **MultipartUploadHandler**：`new MultipartUploadHandler(config)`、`createMultipartUploadHandler`；统一
  `handle(request, basePath)` 处理
  `/init`、`/chunk`、`/complete`、`/abort`、`/status`；单路由方法：`handleInit`、`handleChunk`、`handleComplete`、`handleAbort`、`handleStatus`。
- **类型**：`MultipartUploadHandlerConfig`、`InitRequest`、`InitResponse`、`ChunkRequest`、`ChunkResponse`、`CompleteRequest`、`CompleteResponse`、`AbortRequest`、`UploadStatus`。
- 文件大小与 MIME 校验；自定义路径生成与校验；路径前缀支持。

#### 国际化（i18n）

- 服务端文案（如 S3/COS 上传或删除失败、文件不存在等）提供 **en-US** 与
  **zh-CN**，基于 `@dreamer/i18n`。
- 语言由环境变量决定：`LANGUAGE`、`LC_ALL`、`LANG`。
- 从 `@dreamer/upload/i18n` 导出：`$tr`、`setUploadLocale`、`detectLocale`。

### 兼容性

- **Deno** 2.6+
- **Bun** 1.3.5+
- **浏览器**（客户端模块）
