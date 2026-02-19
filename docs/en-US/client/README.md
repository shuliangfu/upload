# Upload Client

> Client module for @dreamer/upload. Universal file upload client for browser and Deno/Bun, with chunked upload, resumable upload, and progress reporting.

**中文**: [客户端文档 (中文)](../../zh-CN/client/README.md) · **Back to main**: [README](../../README.md)

---

## Overview

The upload client communicates with a server that implements the multipart upload API (init → chunk → complete / abort). It supports:

- Chunked upload for large files
- Resumable upload (state persisted in `localStorage` when `persistState: true`)
- Progress and state change callbacks
- Pause, cancel, and resume by upload ID
- Auth token and custom headers
- Retry and timeout

---

## Installation

```typescript
// Import client module
import {
  UploadClient,
  createUploadClient,
  formatSize,
  calculateFileHash,
} from "@dreamer/upload/client";
```

---

## Quick start

### Basic upload

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
  console.log("Upload success:", result.url);
}
```

### With auth and progress

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
    console.log(`Remaining: ${p.remainingTime}s`);
  },
  onStateChange: (state) => {
    console.log(`State: ${state.status}`);
  },
});
```

### Pause, resume, cancel

```typescript
// Cancel upload
client.cancel(uploadId);

// Pause upload (abort in-flight, state kept if persistState is true)
client.pause(uploadId);

// Resume by upload ID (same file required)
await client.resume(uploadId, file);

// List incomplete uploads (when persistState is true)
const pending = await client.getPendingUploads();

// Clean expired state (default: older than 7 days)
client.cleanup(7 * 24 * 60 * 60 * 1000);
```

---

## Configuration

### UploadClientConfig

| Option           | Type                     | Default | Description |
| ---------------- | ------------------------ | ------- | ----------- |
| `endpoint`       | `string`                 | -       | Upload API base URL (required). Server must expose `/init`, `/chunk`, `/complete`, `/abort` (or equivalent). |
| `chunkSize`      | `number`                 | 5MB     | Chunk size in bytes. S3/MinIO require ≥ 5MB per part (except last). |
| `concurrency`    | `number`                 | 3       | Number of concurrent chunk uploads. |
| `retries`        | `number`                 | 3       | Retry count per request. |
| `retryDelay`     | `number`                 | 1000    | Base retry delay in ms (exponential backoff). |
| `timeout`        | `number`                 | 30000   | Request timeout in ms. |
| `headers`        | `Record<string, string>` | -       | Custom request headers. |
| `token`          | `string`                 | -       | Auth token (sent as `Authorization: Bearer <token>`). |
| `persistState`   | `boolean`                | false   | Persist upload state in `localStorage` for resume. |
| `stateKeyPrefix` | `string`                 | `"upload_state_"` | Prefix for state keys in `localStorage`. |

---

## API reference

### UploadClient (class)

| Method | Description | Returns |
| ------ | ----------- | ------- |
| `new UploadClient(config)` | Create client with config. | `UploadClient` |
| `upload(file, options?)` | Upload file (File or Uint8Array). | `Promise<UploadResult>` |
| `resume(uploadId, file, options?)` | Resume upload by ID (same file). | `Promise<UploadResult>` |
| `pause(uploadId)` | Abort in-flight upload; state kept if persistState. | `void` |
| `cancel(uploadId)` | Abort and remove state. | `void` |
| `getPendingUploads()` | List incomplete uploads (when persistState). | `Promise<UploadState[]>` |
| `cleanup(maxAge?)` | Remove persisted state older than maxAge (default 7 days). | `void` |
| `setToken(token)` | Set auth token. | `void` |
| `setHeaders(headers)` | Set or merge custom headers. | `void` |

### Factory and helpers

| API | Description | Returns |
| --- | ----------- | ------- |
| `createUploadClient(config)` | Create client instance. | `UploadClient` |
| `formatSize(bytes)` | Format byte count (e.g. "1.50 MB"). | `string` |
| `calculateFileHash(file)` | SHA-256 hash of file (File or Uint8Array). | `Promise<string>` |

---

## Types

### UploadOptions

| Field | Type | Description |
| ----- | ---- | ----------- |
| `filename` | `string` | Override filename. |
| `mimeType` | `string` | MIME type. |
| `path` | `string` | Target path/prefix on server. |
| `onProgress` | `(progress: UploadProgress) => void` | Progress callback. |
| `onStateChange` | `(state: UploadState) => void` | State change callback. |
| `metadata` | `Record<string, unknown>` | Custom metadata. |
| `overwrite` | `boolean` | Overwrite if exists. |

### UploadProgress

| Field | Type | Description |
| ----- | ---- | ----------- |
| `loaded` | `number` | Bytes uploaded. |
| `total` | `number` | Total bytes. |
| `percentage` | `number` | 0–100. |
| `completedChunks` | `number` | Chunks completed. |
| `totalChunks` | `number` | Total chunks. |
| `speed` | `number` | Bytes per second. |
| `remainingTime` | `number` | Seconds remaining. |
| `status` | `"pending" \| "uploading" \| "paused" \| "completed" \| "failed"` | Current status. |

### UploadResult

| Field | Type | Description |
| ----- | ---- | ----------- |
| `success` | `boolean` | Whether upload succeeded. |
| `fileId` | `string` | Server file ID (if any). |
| `url` | `string` | Access URL (if any). |
| `size` | `number` | File size. |
| `filename` | `string` | Filename. |
| `mimeType` | `string` | MIME type. |
| `duration` | `number` | Duration in ms. |
| `error` | `string` | Error message on failure. |
| `data` | `Record<string, unknown>` | Extra server response. |

### UploadState

Persisted state for resumable uploads (when `persistState` is true).

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `string` | Upload ID. |
| `filename` | `string` | Filename. |
| `fileSize` | `number` | File size. |
| `fileHash` | `string` | File hash for validation. |
| `chunkSize` | `number` | Chunk size. |
| `chunks` | `ChunkInfo[]` | Chunk list. |
| `uploadId` | `string` | Server upload ID. |
| `key` | `string` | Server object key. |
| `status` | `string` | pending \| uploading \| paused \| completed \| failed. |
| `createdAt` | `number` | Timestamp. |
| `updatedAt` | `number` | Timestamp. |
| `metadata` | `Record<string, unknown>` | Custom metadata. |

### ChunkInfo

| Field | Type | Description |
| ----- | ---- | ----------- |
| `index` | `number` | Chunk index (0-based). |
| `start` | `number` | Start offset. |
| `end` | `number` | End offset. |
| `size` | `number` | Chunk size. |
| `status` | `string` | pending \| uploading \| completed \| failed. |
| `etag` | `string` | ETag from server. |
| `error` | `string` | Error message. |

---

## Server contract

The client expects the server to provide:

1. **POST** `{endpoint}/init`  
   Body: `{ filename, fileSize, chunks, mimeType?, path?, metadata?, overwrite? }`  
   Response: `{ uploadId, key?, urls? }`

2. **POST** `{endpoint}/chunk`  
   FormData: `file`, `index`, `uploadId`, `key`  
   Response: `{ etag? }`

3. **POST** `{endpoint}/complete`  
   Body: `{ uploadId, key, chunks: [{ index, etag, size }] }`  
   Response: `{ fileId?, url?, data? }`

4. **POST** `{endpoint}/abort` (optional)  
   Body: `{ uploadId, key }`  
   Used when cancelling.

Use `MultipartUploadHandler` from `@dreamer/upload/server` to implement this API.

---

## Notes

- **Browser**: Uses `localStorage` for state when `persistState` is true.
- **Chunk size**: S3/MinIO require at least 5MB per part (except the last).
- **Resume**: File must be the same (hash and size); otherwise resume returns an error.
- **Token**: Set via `setToken()` or `config.token`; sent as `Authorization: Bearer <token>`.

---

[Back to @dreamer/upload README](../../README.md)
