# Changelog

All notable changes to @dreamer/upload are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

---

## [1.0.0] - 2026-02-20

### Added

Initial stable release. A complete file upload solution with client, server, and multi-cloud storage adapters.

#### Main module (`@dreamer/upload`)

- **Uploader**: `createUploader`, `Uploader` class; `handleFormData` for server-side form upload with validation (max size, MIME, extensions).
- **StorageManager**: `new StorageManager(config)`, `createStorageManagerFromEnv()`; unified API: `upload`, `download`, `exists`, `delete`, `list`, `getPublicUrl`; supports `local`, `s3`, `oss`, `cos` backends.
- **Utilities**:
  - Filename: `getFileExtension`, `getBaseName`, `sanitizeFilename`, `generateFilename`, `generateTimestampFilename`, `getFilenameFromUrl`
  - MIME: `getMimeType`, `matchMimeType`
  - Type detection: `isImage`, `isVideo`, `isAudio`, `isDocument`, `isArchive`, `isHiddenFile`
  - Validation: `validateFile`, `validateFiles`, `isPathSafe`
  - Hash: `computeHash` (SHA-256), `computeShortHash`
  - Format: `formatFileSize`
  - Subdir: `generateDateSubdir`, `generateMonthSubdir`
- **Constants**: `DEFAULT_FORBIDDEN_EXTENSIONS`, `MIME_TYPES`.
- **Local storage**: `createLocalStorage`, `LocalStorage` for local file storage adapter.

#### Adapters (`@dreamer/upload/adapters`)

- **CloudStorageAdapter** interface: `upload`, `download`, `delete`, `exists`, `getMetadata`, `list`, `copy`, `getPresignedUrl`, `initiateMultipartUpload`, `uploadPart`, `completeMultipartUpload`, `abortMultipartUpload`, `listParts`.
- **S3**: `createS3Adapter`, `S3StorageAdapter`; AWS Signature V4; path-style and virtual-host-style; MinIO-compatible.
- **OSS**: `createOSSAdapter`, `OSSStorageAdapter`; native Aliyun signing; S3-compatible mode.
- **COS**: `createCOSAdapter`, `COSStorageAdapter`; native Tencent signing; S3-compatible mode.

#### Multipart (`@dreamer/upload/multipart`)

- **MultipartUploader**: Chunked upload with configurable part size and concurrency; progress callback; cancel support.
- **getRecommendedPartSize**: Computes part size for S3/MinIO (min 5MB per part).

#### Client (`@dreamer/upload/client`)

- **UploadClient**: `new UploadClient(config)`, `createUploadClient(config)`; `upload(file, options?)`, `resume(uploadId, file)`, `pause`, `cancel`, `getPendingUploads`, `cleanup`, `setToken`, `setHeaders`.
- **Types**: `UploadClientConfig`, `UploadProgress`, `UploadOptions`, `UploadResult`, `ChunkInfo`, `UploadState`.
- **Helpers**: `formatSize`, `calculateFileHash`.
- Resumable upload with `persistState` (localStorage); progress and state change callbacks.

#### Server (`@dreamer/upload/server`)

- **MultipartUploadHandler**: `new MultipartUploadHandler(config)`, `createMultipartUploadHandler`; unified `handle(request, basePath)` for `/init`, `/chunk`, `/complete`, `/abort`, `/status`; per-route methods: `handleInit`, `handleChunk`, `handleComplete`, `handleAbort`, `handleStatus`.
- **Types**: `MultipartUploadHandlerConfig`, `InitRequest`, `InitResponse`, `ChunkRequest`, `ChunkResponse`, `CompleteRequest`, `CompleteResponse`, `AbortRequest`, `UploadStatus`.
- File size and MIME validation; custom path generation and validation; path prefix support.

#### Internationalization (i18n)

- Server-side messages (e.g. S3/COS upload or delete failed, file not found) in **en-US** and **zh-CN** via `@dreamer/i18n`.
- Locale from environment: `LANGUAGE`, `LC_ALL`, `LANG`.
- Exports from `@dreamer/upload/i18n`: `$tr`, `setUploadLocale`, `detectLocale`.

### Compatibility

- **Deno** 2.6+
- **Bun** 1.3.5+
- **Browser** (client module)
