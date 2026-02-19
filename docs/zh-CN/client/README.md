# 上传客户端

> @dreamer/upload 的客户端模块。面向浏览器与 Deno/Bun 的通用文件上传客户端，支持分片上传、断点续传与进度回调。

**English**: [Client (EN)](../../en-US/client/README.md) · **返回主文档**: [README (中文)](../README.md)

---

## 概述

上传客户端与实现了分片上传 API（init → chunk → complete / abort）的服务端配合使用，支持：

- 大文件分片上传
- 断点续传（`persistState: true` 时状态持久化到 `localStorage`）
- 进度与状态变化回调
- 按上传 ID 暂停、取消、恢复
- 认证令牌与自定义请求头
- 重试与超时

---

## 安装

```typescript
// 导入客户端模块
import {
  UploadClient,
  createUploadClient,
  formatSize,
  calculateFileHash,
} from "@dreamer/upload/client";
```

---

## 快速开始

### 基础上传

```typescript
import { createUploadClient } from "@dreamer/upload/client";

const client = createUploadClient({
  endpoint: "https://api.example.com/upload",
  chunkSize: 5 * 1024 * 1024, // 5MB
});

const result = await client.upload(file, {
  filename: "example.jpg",
  onProgress: (p) => {
    console.log(`${p.percentage}%`);
  },
});

if (result.success) {
  console.log("上传成功:", result.url);
}
```

### 带认证与进度

```typescript
import { UploadClient, formatSize } from "@dreamer/upload/client";

const client = new UploadClient({
  endpoint: "https://api.example.com/upload",
  chunkSize: 5 * 1024 * 1024,
  concurrency: 3,
  retries: 3,
  persistState: true,
});

client.setToken("your-auth-token");

const result = await client.upload(file, {
  filename: "example.jpg",
  onProgress: (p) => {
    console.log(`${p.percentage}% - ${formatSize(p.speed)}/s`);
    console.log(`剩余: ${p.remainingTime}s`);
  },
  onStateChange: (state) => {
    console.log(`状态: ${state.status}`);
  },
});
```

### 暂停、恢复、取消

```typescript
// 取消上传
client.cancel(uploadId);

// 暂停上传（中止进行中的请求，若开启 persistState 则保留状态）
client.pause(uploadId);

// 按上传 ID 恢复（需传入同一文件）
await client.resume(uploadId, file);

// 获取未完成的上传列表（persistState 为 true 时）
const pending = await client.getPendingUploads();

// 清理过期状态（默认：超过 7 天）
client.cleanup(7 * 24 * 60 * 60 * 1000);
```

---

## 配置

### UploadClientConfig

| 选项             | 类型                      | 默认值           | 说明 |
| ---------------- | ------------------------- | ---------------- | ---- |
| `endpoint`       | `string`                  | -                | 上传 API 基础 URL（必填）。服务端需提供 `/init`、`/chunk`、`/complete`、`/abort`（或等价路径）。 |
| `chunkSize`      | `number`                  | 5MB              | 分片大小（字节）。S3/MinIO 要求每分片 ≥ 5MB（最后一个除外）。 |
| `concurrency`    | `number`                  | 3                | 并发上传分片数。 |
| `retries`        | `number`                  | 3                | 单次请求重试次数。 |
| `retryDelay`     | `number`                  | 1000             | 基础重试延迟（毫秒），指数退避。 |
| `timeout`        | `number`                  | 30000            | 请求超时（毫秒）。 |
| `headers`        | `Record<string, string>`  | -                | 自定义请求头。 |
| `token`          | `string`                  | -                | 认证令牌（以 `Authorization: Bearer <token>` 发送）。 |
| `persistState`   | `boolean`                 | false            | 是否将上传状态持久化到 `localStorage` 以支持恢复。 |
| `stateKeyPrefix` | `string`                  | `"upload_state_"` | `localStorage` 状态键前缀。 |

---

## API 参考

### UploadClient（类）

| 方法 | 说明 | 返回值 |
| ---- | ---- | ------ |
| `new UploadClient(config)` | 使用配置创建客户端。 | `UploadClient` |
| `upload(file, options?)` | 上传文件（File 或 Uint8Array）。 | `Promise<UploadResult>` |
| `resume(uploadId, file, options?)` | 按 ID 恢复上传（需同一文件）。 | `Promise<UploadResult>` |
| `pause(uploadId)` | 中止进行中的上传；若开启 persistState 则保留状态。 | `void` |
| `cancel(uploadId)` | 中止并移除状态。 | `void` |
| `getPendingUploads()` | 获取未完成的上传列表（persistState 为 true 时）。 | `Promise<UploadState[]>` |
| `cleanup(maxAge?)` | 清除超过 maxAge 的持久化状态（默认 7 天）。 | `void` |
| `setToken(token)` | 设置认证令牌。 | `void` |
| `setHeaders(headers)` | 设置或合并自定义请求头。 | `void` |

### 工厂函数与工具

| API | 说明 | 返回值 |
| --- | ---- | ------ |
| `createUploadClient(config)` | 创建客户端实例。 | `UploadClient` |
| `formatSize(bytes)` | 格式化字节数（如 "1.50 MB"）。 | `string` |
| `calculateFileHash(file)` | 计算文件 SHA-256 哈希（File 或 Uint8Array）。 | `Promise<string>` |

---

## 类型

### UploadOptions

| 字段 | 类型 | 说明 |
| ----- | ---- | ---- |
| `filename` | `string` | 覆盖文件名。 |
| `mimeType` | `string` | MIME 类型。 |
| `path` | `string` | 服务端目标路径/前缀。 |
| `onProgress` | `(progress: UploadProgress) => void` | 进度回调。 |
| `onStateChange` | `(state: UploadState) => void` | 状态变化回调。 |
| `metadata` | `Record<string, unknown>` | 自定义元数据。 |
| `overwrite` | `boolean` | 是否覆盖已存在文件。 |

### UploadProgress

| 字段 | 类型 | 说明 |
| ----- | ---- | ---- |
| `loaded` | `number` | 已上传字节数。 |
| `total` | `number` | 总字节数。 |
| `percentage` | `number` | 0–100。 |
| `completedChunks` | `number` | 已完成分片数。 |
| `totalChunks` | `number` | 总分片数。 |
| `speed` | `number` | 当前速度（字节/秒）。 |
| `remainingTime` | `number` | 预计剩余时间（秒）。 |
| `status` | `"pending" \| "uploading" \| "paused" \| "completed" \| "failed"` | 当前状态。 |

### UploadResult

| 字段 | 类型 | 说明 |
| ----- | ---- | ---- |
| `success` | `boolean` | 是否成功。 |
| `fileId` | `string` | 服务端文件 ID（如有）。 |
| `url` | `string` | 访问 URL（如有）。 |
| `size` | `number` | 文件大小。 |
| `filename` | `string` | 文件名。 |
| `mimeType` | `string` | MIME 类型。 |
| `duration` | `number` | 耗时（毫秒）。 |
| `error` | `string` | 失败时错误信息。 |
| `data` | `Record<string, unknown>` | 服务端额外响应。 |

### UploadState

断点续传时持久化的状态（`persistState` 为 true 时使用）。

| 字段 | 类型 | 说明 |
| ----- | ---- | ---- |
| `id` | `string` | 上传 ID。 |
| `filename` | `string` | 文件名。 |
| `fileSize` | `number` | 文件大小。 |
| `fileHash` | `string` | 文件哈希（用于校验）。 |
| `chunkSize` | `number` | 分片大小。 |
| `chunks` | `ChunkInfo[]` | 分片列表。 |
| `uploadId` | `string` | 服务端上传 ID。 |
| `key` | `string` | 服务端对象键。 |
| `status` | `string` | pending \| uploading \| paused \| completed \| failed。 |
| `createdAt` | `number` | 创建时间戳。 |
| `updatedAt` | `number` | 更新时间戳。 |
| `metadata` | `Record<string, unknown>` | 自定义元数据。 |

### ChunkInfo

| 字段 | 类型 | 说明 |
| ----- | ---- | ---- |
| `index` | `number` | 分片索引（从 0 开始）。 |
| `start` | `number` | 起始偏移。 |
| `end` | `number` | 结束偏移。 |
| `size` | `number` | 分片大小。 |
| `status` | `string` | pending \| uploading \| completed \| failed。 |
| `etag` | `string` | 服务端返回的 ETag。 |
| `error` | `string` | 错误信息。 |

---

## 服务端约定

客户端要求服务端提供以下接口：

1. **POST** `{endpoint}/init`  
   请求体：`{ filename, fileSize, chunks, mimeType?, path?, metadata?, overwrite? }`  
   响应：`{ uploadId, key?, urls? }`

2. **POST** `{endpoint}/chunk`  
   FormData：`file`、`index`、`uploadId`、`key`  
   响应：`{ etag? }`

3. **POST** `{endpoint}/complete`  
   请求体：`{ uploadId, key, chunks: [{ index, etag, size }] }`  
   响应：`{ fileId?, url?, data? }`

4. **POST** `{endpoint}/abort`（可选）  
   请求体：`{ uploadId, key }`  
   用于取消上传时。

可使用 `@dreamer/upload/server` 的 `MultipartUploadHandler` 实现上述 API。

---

## 注意事项

- **浏览器**：`persistState` 为 true 时使用 `localStorage` 存储状态。
- **分片大小**：S3/MinIO 要求每分片至少 5MB（最后一个除外）。
- **恢复**：必须使用同一文件（哈希与大小一致），否则恢复会报错。
- **令牌**：通过 `setToken()` 或 `config.token` 设置，以 `Authorization: Bearer <token>` 形式发送。

---

[返回 @dreamer/upload README](../../README.md)
