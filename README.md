# @dreamer/upload

> A complete file upload solution compatible with Deno and Bun, supporting chunked upload, resumable upload, and multi-cloud storage adapters.

**中文**: [README (中文)](./docs/zh-CN/README.md) · **Client**: [README](./docs/en-US/client/README.md)

[![JSR](https://jsr.io/badges/@dreamer/upload)](https://jsr.io/@dreamer/upload)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](./LICENSE)
[![Tests](https://img.shields.io/badge/tests-107%20passed-brightgreen)](./docs/en-US/TEST_REPORT.md)

---

## Features

A complete file upload package providing client, server, and cloud storage adapters in one pipeline. Pure TypeScript implementation with enterprise-oriented features such as chunked upload, resumable upload, and file security scanning. Suitable for file management systems, cloud storage applications, and content management platforms.

Core features:

- **Multi-cloud storage**: AWS S3, Aliyun OSS, Tencent Cloud COS, and local storage
- **Chunked upload**: Automatic chunking for large files, concurrent upload and resumable upload
- **Security scanning**: File type detection, virus scanning, sensitive content detection
- **Storage management**: Auto cleanup, quota management, file lifecycle

---

## Installation

### Deno

```bash
deno add jsr:@dreamer/upload
```

### Bun

```bash
bunx jsr add @dreamer/upload
```

### Client (browser)

```typescript
// Import client module directly
import { UploadClient } from "@dreamer/upload/client";
```

---

## Environment compatibility

| Environment   | Version  | Status                                      |
| ------------- | -------- | ------------------------------------------- |
| **Deno**      | 2.5+     | ✅ Fully supported                           |
| **Bun**       | 1.0+     | ✅ Fully supported                           |
| **Server**    | -        | ✅ Supported (Deno and Bun runtimes)        |
| **Browser**   | -        | ✅ Supported (client module)                |

---

## Capabilities

- **Multi-cloud storage adapters**:
  - AWS S3 (full Signature V4 support)
  - Aliyun OSS (native signing + S3-compatible mode)
  - Tencent Cloud COS (native signing + S3-compatible mode)
  - Local filesystem storage
- **Chunked upload**:
  - Large-file chunked upload
  - Automatic optimal chunk size calculation
  - Concurrent chunk upload
  - Cancel and retry
- **Resumable upload**:
  - State persistence (browser localStorage)
  - Pause/resume upload
  - Upload progress tracking
- **Server handling**:
  - HTTP chunked upload handler
  - File size/type validation
  - Custom path generation
  - Unified route handling
- **Client upload**:
  - Browser/Deno/Bun universal
  - Progress callbacks
  - State change callbacks
  - Speed and ETA calculation
- **Utilities**:
  - Filename handling and sanitization
  - MIME type detection and matching
  - File type detection (image/video/audio/document)
  - File hash computation
  - Path safety validation
- **Unified storage management**:
  - Unified storage API
  - Environment variable configuration
  - Automatic backend selection

---

## Use cases

- **Web application file upload**: Images, video, documents
- **Large file handling**: GB-scale chunked upload
- **Multi-cloud switching**: One API across different cloud providers
- **Resumable upload**: Reliable upload on unstable networks

---

## Quick start

### Server basic example

```typescript
import {
  Uploader,
  validateFile,
  generateFilename,
  getMimeType,
} from "@dreamer/upload";

// Create upload handler
const uploader = new Uploader({
  uploadDir: "./uploads",
  validation: {
    maxFileSize: 10 * 1024 * 1024, // 10MB
    allowedMimeTypes: ["image/*", "video/*"],
  },
});

// Handle FormData upload
const result = await uploader.handleFormData(formData);
console.log("Upload result:", result);
```

### Client basic example

```typescript
import { UploadClient, createUploadClient } from "@dreamer/upload/client";

// Create upload client
const client = createUploadClient({
  endpoint: "https://api.example.com/upload",
  chunkSize: 5 * 1024 * 1024, // 5MB
});

// Upload file
const result = await client.upload(file, {
  filename: "example.jpg",
  onProgress: (progress) => {
    console.log(`${progress.percentage}%`);
  },
});

if (result.success) {
  console.log("Upload success:", result.url);
}
```

---

## Usage examples

### Using cloud storage adapters

```typescript
import {
  createS3Adapter,
  createOSSAdapter,
  createCOSAdapter,
} from "@dreamer/upload/adapters";

// AWS S3
const s3 = createS3Adapter({
  bucket: "my-bucket",
  region: "us-east-1",
  accessKeyId: "your-access-key-id",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
});

// Aliyun OSS
const oss = createOSSAdapter({
  bucket: "my-bucket",
  region: "oss-cn-hangzhou",
  accessKeyId: "LTAIxxxxxxxx",
  accessKeySecret: "xxxxxxxxxxxxxxxx",
});

// Tencent Cloud COS
const cos = createCOSAdapter({
  bucket: "my-bucket-1250000000",
  region: "ap-guangzhou",
  secretId: "your-secret-id",
  secretKey: "xxxxxxxxxxxxxxxx",
});

// Upload file
await s3.upload("path/to/file.jpg", fileData, {
  contentType: "image/jpeg",
});

// Download file
const data = await s3.download("path/to/file.jpg");

// Generate presigned URL
const url = await s3.getPresignedUrl("path/to/file.jpg", {
  expiresIn: 3600,
});
```

### Chunked upload

```typescript
import { MultipartUploader, getRecommendedPartSize } from "@dreamer/upload/multipart";
import { createS3Adapter } from "@dreamer/upload/adapters";

const adapter = createS3Adapter({ /* ... */ });

// Compute recommended part size
const partSize = getRecommendedPartSize(fileSize);

// Create multipart uploader
const uploader = new MultipartUploader(adapter, {
  partSize,
  concurrency: 3,
});

// Upload file
const result = await uploader.upload("large-file.zip", fileData, {
  onProgress: (progress) => {
    console.log(`Progress: ${progress.percentage}%`);
  },
});
```

### Client advanced usage

```typescript
import { UploadClient, formatSize } from "@dreamer/upload/client";

const client = new UploadClient({
  endpoint: "https://api.example.com/upload",
  chunkSize: 5 * 1024 * 1024,
  concurrency: 3,
  retries: 3,
  persistState: true, // Enable state persistence
});

// Set auth token
client.setToken("your-auth-token");

// Upload file
const result = await client.upload(file, {
  filename: "example.jpg",
  onProgress: (progress) => {
    console.log(`${progress.percentage}% - Speed: ${formatSize(progress.speed)}/s`);
    console.log(`Remaining time: ${progress.remainingTime}s`);
  },
  onStateChange: (state) => {
    console.log(`State: ${state.status}`);
  },
});

// Cancel upload
client.cancel(uploadId);

// Pause upload
client.pause(uploadId);

// Resume upload
await client.resume(uploadId);

// Get incomplete uploads
const pending = await client.getPendingUploads();
```

### Server multipart handling

```typescript
import { MultipartUploadHandler } from "@dreamer/upload/server";
import { createS3Adapter } from "@dreamer/upload/adapters";
import { serve } from "@dreamer/runtime-adapter";

const adapter = createS3Adapter({ /* ... */ });

// Create handler
const handler = new MultipartUploadHandler({
  storage: adapter,
  maxFileSize: 100 * 1024 * 1024, // 100MB
  maxPartSize: 10 * 1024 * 1024,  // 10MB
  allowedMimeTypes: ["image/*", "video/*"],
  pathPrefix: "uploads",
});

// Use in HTTP server
serve({ port: 3000 }, async (request) => {
  // Unified route handling
  const response = await handler.handle(request, "/upload");
  if (response) return response;

  return new Response("Not Found", { status: 404 });
});
```

### Unified storage management

```typescript
import { StorageManager, createStorageManagerFromEnv } from "@dreamer/upload";

// Option 1: Manual config
const storage = new StorageManager({
  type: "s3",
  s3: {
    bucket: "my-bucket",
    region: "us-east-1",
    accessKeyId: "...",
    secretAccessKey: "...",
  },
});

// Option 2: Create from environment variables
// Set: STORAGE_TYPE, S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY
const storageFromEnv = createStorageManagerFromEnv();

// Unified storage operations
await storage.upload("path/to/file.jpg", fileData, {
  contentType: "image/jpeg",
});

const data = await storage.download("path/to/file.jpg");
const exists = await storage.exists("path/to/file.jpg");
const url = await storage.getPublicUrl("path/to/file.jpg");
```

### Utility functions

```typescript
import {
  // Filename handling
  getFileExtension,
  getBaseName,
  sanitizeFilename,
  generateFilename,
  generateTimestampFilename,

  // MIME type
  getMimeType,
  matchMimeType,

  // File type detection
  isImage,
  isVideo,
  isAudio,
  isDocument,
  isArchive,

  // Validation
  validateFile,
  validateFiles,
  isPathSafe,

  // Hash computation
  computeHash,
  computeShortHash,

  // Formatting
  formatFileSize,

  // Subdir generation
  generateDateSubdir,
  generateMonthSubdir,
} from "@dreamer/upload";

// Filename handling
const ext = getFileExtension("photo.jpg"); // "jpg"
const safe = sanitizeFilename("dangerous<file>.txt"); // "dangerous_file_.txt"
const unique = generateFilename("photo.jpg"); // "a1b2c3d4-e5f6-...-photo.jpg"

// MIME type detection
const mime = getMimeType("photo.jpg"); // "image/jpeg"
const isMatch = matchMimeType("image/jpeg", "image/*"); // true

// File type detection
if (isImage("photo.jpg")) {
  console.log("This is an image");
}

// File validation
const result = validateFile(file, {
  maxSize: 10 * 1024 * 1024,
  allowedMimeTypes: ["image/*"],
  allowedExtensions: ["jpg", "png", "gif"],
});

if (!result.valid) {
  console.error("Validation failed:", result.errors);
}

// Hash computation
const hash = await computeHash(fileData); // SHA-256 hash
const shortHash = await computeShortHash(fileData, 8); // 8-char short hash

// Format file size
console.log(formatFileSize(1024 * 1024)); // "1.00 MB"

// Generate date subdir
const subdir = generateDateSubdir(); // "2026/01/30"
```

---

## API reference

### Main module (@dreamer/upload)

#### Upload handler

| API                                  | Description              | Returns                  |
| ------------------------------------ | ------------------------ | ------------------------ |
| `new Uploader(config)`               | Create upload handler    | `Uploader`               |
| `uploader.handleFormData(formData)`  | Handle FormData upload    | `Promise<UploadResult>`  |

#### Storage manager

| API                                    | Description              | Returns                          |
| -------------------------------------- | ------------------------ | -------------------------------- |
| `new StorageManager(config)`          | Create storage manager   | `StorageManager`                 |
| `createStorageManagerFromEnv()`       | Create from env vars     | `StorageManager`                 |
| `storage.upload(key, data, options?)` | Upload file              | `Promise<UploadedFileInfo>`      |
| `storage.download(key)`               | Download file            | `Promise<Uint8Array>`            |
| `storage.exists(key)`                 | Check existence          | `Promise<boolean>`               |
| `storage.delete(key)`                 | Delete file              | `Promise<void>`                  |
| `storage.list(prefix?, options?)`     | List files               | `Promise<ListResult>`            |
| `storage.getPublicUrl(key)`           | Get public URL           | `Promise<string>`                |

#### Utility functions

| API                                      | Description                | Returns                   |
| ---------------------------------------- | -------------------------- | ------------------------- |
| `getFileExtension(filename)`             | Get file extension         | `string`                 |
| `getBaseName(filename)`                 | Get base name              | `string`                 |
| `sanitizeFilename(filename)`            | Sanitize filename          | `string`                 |
| `generateFilename(filename)`            | Generate unique filename   | `string`                 |
| `generateTimestampFilename(filename)`   | Generate timestamp filename| `string`                 |
| `getMimeType(filename)`                 | Get MIME type              | `string`                 |
| `matchMimeType(mimeType, pattern)`       | Match MIME type            | `boolean`                |
| `isImage(filename)`                     | Check if image             | `boolean`                |
| `isVideo(filename)`                     | Check if video             | `boolean`                |
| `isAudio(filename)`                     | Check if audio             | `boolean`                |
| `isDocument(filename)`                  | Check if document          | `boolean`                |
| `isArchive(filename)`                   | Check if archive           | `boolean`                |
| `validateFile(file, options)`           | Validate single file       | `FileValidationResult`   |
| `validateFiles(files, options)`         | Validate multiple files    | `FileValidationResult[]` |
| `isPathSafe(path)`                      | Check path safety          | `boolean`                |
| `computeHash(data)`                     | Compute SHA-256 hash        | `Promise<string>`        |
| `computeShortHash(data, length)`       | Compute short hash         | `Promise<string>`        |
| `formatFileSize(bytes)`                | Format file size           | `string`                 |
| `generateDateSubdir()`                  | Generate date subdir       | `string`                 |
| `generateMonthSubdir()`                 | Generate month subdir      | `string`                 |

### Adapter module (@dreamer/upload/adapters)

#### CloudStorageAdapter interface

| API                                            | Description              | Returns                         |
| ---------------------------------------------- | ------------------------ | ------------------------------- |
| `upload(key, data, options?)`                  | Upload file              | `Promise<void>`                 |
| `download(key, options?)`                      | Download file            | `Promise<Uint8Array>`           |
| `delete(key)`                                  | Delete file              | `Promise<void>`                 |
| `exists(key)`                                  | Check existence          | `Promise<boolean>`              |
| `getMetadata(key)`                             | Get metadata             | `Promise<ObjectMetadata>`       |
| `list(prefix?, options?)`                      | List objects             | `Promise<ListResult>`           |
| `copy(sourceKey, destKey, options?)`           | Copy object              | `Promise<void>`                 |
| `getPresignedUrl(key, options?)`               | Generate presigned URL   | `Promise<string>`              |
| `initiateMultipartUpload(key, options?)`       | Init multipart upload    | `Promise<MultipartUploadInit>`  |
| `uploadPart(key, uploadId, partNumber, data)`   | Upload part              | `Promise<UploadPartResult>`     |
| `completeMultipartUpload(key, uploadId, parts)`| Complete multipart       | `Promise<void>`                 |
| `abortMultipartUpload(key, uploadId)`          | Abort multipart          | `Promise<void>`                 |
| `listParts(key, uploadId)`                     | List uploaded parts      | `Promise<ListPartsResult>`      |

#### Adapter factory functions

| API                        | Description           | Config parameters                                                                 |
| -------------------------- | --------------------- | --------------------------------------------------------------------------------- |
| `createS3Adapter(config)`  | Create S3 adapter     | `bucket`, `region`, `accessKeyId`, `secretAccessKey`                               |
| `createOSSAdapter(config)` | Create OSS adapter    | `bucket`, `region`, `accessKeyId`, `accessKeySecret`                              |
| `createCOSAdapter(config)` | Create COS adapter    | `bucket`, `region`, `secretId`, `secretKey`                                       |

### Client module (@dreamer/upload/client)

| API                          | Description           | Returns                     |
| ----------------------------- | --------------------- | --------------------------- |
| `new UploadClient(config)`    | Create upload client  | `UploadClient`              |
| `createUploadClient(config)`  | Factory function      | `UploadClient`              |
| `client.setToken(token)`     | Set auth token        | `void`                      |
| `client.setHeaders(headers)` | Set request headers   | `void`                      |
| `client.upload(file, options?)` | Upload file        | `Promise<UploadResult>`     |
| `client.pause(uploadId)`     | Pause upload          | `void`                      |
| `client.resume(uploadId)`    | Resume upload         | `Promise<UploadResult>`     |
| `client.cancel(uploadId)`    | Cancel upload         | `void`                      |
| `client.getPendingUploads()` | Get incomplete uploads| `Promise<UploadState[]>`    |
| `client.cleanup(maxAge?)`    | Clean expired state   | `void`                      |
| `formatSize(bytes)`          | Format file size      | `string`                    |
| `calculateFileHash(data)`    | Compute file hash     | `Promise<string>`           |

**UploadClientConfig options:**

| Option           | Type                     | Default | Description                    |
| ---------------- | ------------------------ | ------- | ------------------------------ |
| `endpoint`       | `string`                 | -       | Upload endpoint URL (required)|
| `chunkSize`      | `number`                 | 5MB     | Chunk size                     |
| `concurrency`    | `number`                 | 3       | Concurrency count             |
| `retries`        | `number`                 | 3       | Retry count                    |
| `retryDelay`     | `number`                 | 1000    | Retry delay (ms)              |
| `timeout`        | `number`                 | 30000   | Request timeout (ms)          |
| `headers`        | `Record<string, string>` | -       | Custom headers                 |
| `token`          | `string`                 | -       | Auth token                     |
| `persistState`   | `boolean`                | false   | Whether to persist state       |
| `stateKeyPrefix` | `string`                 | -       | State storage key prefix      |

### Server module (@dreamer/upload/server)

| API                                | Description              | Returns                       |
| ---------------------------------- | ------------------------ | ----------------------------- |
| `new MultipartUploadHandler(config)` | Create handler        | `MultipartUploadHandler`      |
| `handler.handle(request, basePath)`  | Unified handle (recommended) | `Promise<Response \| null>` |
| `handler.handleInit(request)`     | Handle init request      | `Promise<Response>`           |
| `handler.handleChunk(request)`    | Handle chunk upload      | `Promise<Response>`           |
| `handler.handleComplete(request)`  | Handle complete          | `Promise<Response>`           |
| `handler.handleAbort(request)`    | Handle abort             | `Promise<Response>`           |
| `handler.handleStatus(request)`   | Handle status query      | `Promise<Response>`           |

**MultipartUploadHandlerConfig options:**

| Option             | Type                                  | Default | Description                |
| ------------------ | ------------------------------------- | ------- | -------------------------- |
| `storage`          | `CloudStorageAdapter`                 | -       | Storage adapter (required)|
| `maxPartSize`      | `number`                              | 100MB   | Max part size             |
| `maxFileSize`      | `number`                              | 5GB     | Max file size             |
| `allowedMimeTypes` | `string[]`                            | []      | Allowed MIME types        |
| `pathPrefix`       | `string`                              | ""      | Upload path prefix        |
| `generatePath`     | `(filename, meta) => string`          | -       | Custom path generator     |
| `validate`         | `(filename, size, mime) => boolean`   | -       | Custom validation function |

---

## Performance optimization

- **Chunked upload**: Large files auto-chunked, concurrent upload supported
- **Resumable upload**: State persistence to avoid re-upload
- **Streaming**: Lower memory usage
- **Connection reuse**: Adapters reuse HTTP connections internally
- **Smart chunking**: Optimal part size computed from file size

---

## Test report

See [TEST_REPORT.md](docs/en-US/TEST_REPORT.md) for the full test report.

### Test summary

- **Test date**: 2026-01-30
- **Environment**: Deno 2.6.4 / Bun 1.3.5
- **Total tests**: 107
- **Passed**: 107 ✅
- **Failed**: 0
- **Pass rate**: 100%

---

## Notes

- **Server vs client**: Clearly separated via `/client` and `/server` subpaths
- **Unified interface**: All storage adapters implement `CloudStorageAdapter`
- **Cross-runtime**: Uses `@dreamer/runtime-adapter` for Deno/Bun
- **S3-compatible mode**: OSS and COS adapters support S3-compatible mode (e.g. MinIO for testing)
- **Part size**: S3/MinIO require at least 5MB per part (except the last)
- **Type safety**: Full TypeScript with complete type definitions for all APIs

---

## Changelog

### [1.0.0] - 2026-02-20

- **Added**: Initial stable release. Uploader, StorageManager, multi-cloud adapters (S3, OSS, COS), multipart & resumable upload, UploadClient, MultipartUploadHandler, utilities (filename, MIME, validation, hash), i18n (en-US, zh-CN). Compatible with Deno 2.6+, Bun 1.3.5+, and browser (client).

Full history: [CHANGELOG](docs/en-US/CHANGELOG.md).

---

## Contributing

Issues and Pull Requests are welcome.

---

## License

Apache License 2.0 — see [LICENSE](./LICENSE)

---

<div align="center">

**Made with ❤️ by Dreamer Team**

</div>
