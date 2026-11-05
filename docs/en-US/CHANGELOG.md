# Changelog

All notable changes to @dreamer/upload are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

---

## [2.0.0] - 2026-11-05

### BREAKING

- `MultipartUploadHandler.requireAuth` defaults to **true**. Writes without
  `authenticate` return **401**.
  - **Migration**: wire `authenticate` for production, **or** set
    `requireAuth: false` explicitly (local/dev/test only — do not disable in
    production).

### Security

- Path cage via `resolveSafePath` / `assertPathSafe` on local adapters and
  Uploader.
- Multipart session binding; post-merge content re-validation (default **head
  Range**, see below); expanded forbidden ext/MIME; polyglot heuristics;
  dangerous ACL denied by default; error redaction.
- Bypass matrix: `docs/en-US/BYPASS_MATRIX.md`.

### Performance / reliability

- **Complete verify**: `verifyContentHeadBytes` (default 64 KiB) downloads only
  the object head via Range instead of the full object.
- **local-cloud merge**: `completeMultipartUpload` **appends parts in order**
  (peak ≈ one part); etag sidecars avoid double SHA on list/complete.
- Hot path: fewer defensive `.slice()` copies on digests / part writes.
- Handler **session TTL sweep** (`cleanupExpiredSessions`, optional interval) +
  staging TTL docs.
- **AbortSignal** on handler Request, `uploadPart` options, `Uploader.upload`,
  download/upload options.
- **onEvent** observability hook; typed **`UploadErrorCode`** on JSON errors.

### Added

- `QuotaGuard`, `buildContentDisposition` (RFC 5987), auth hooks, overwrite 409,
  staging TTL.
- Optional **`uploadStream` / `downloadStream`** on `CloudStorageAdapter`
  (implemented for local-cloud + S3).
- S3 **`unsignedPayload` / `defaultUnsignedPayload`**: Signature V4
  `UNSIGNED-PAYLOAD` for streaming / unknown-length bodies (buffered `upload`
  still hashes by default).

### Docs

- **CONFIGURATION.md** (en): full config tables — secure defaults first, escape
  hatches marked test/local only.
- README: Node 22+, auth defaults, magic-byte policy, large-file / memory
  guidance, storage boundary, changelog tip for 2.0.0 only.
- BYPASS_MATRIX: head-verify residual + escape-hatch rows.

### Still out of scope (HOLD)

- Real antivirus engines; zip entry / zip-slip; upload@2 default flips; merging
  into `@dreamer/storage`; GCS/Azure adapters without credentials/impl.

---

## [1.1.0] - 2026-07-23

### Added

- **Node.js 22+ compatibility**: Replaced all Deno-specific APIs with
  cross-runtime equivalents from `@dreamer/runtime-adapter` v1.2.2:
  - `src/storage.ts`: `Deno.writeFile/readFile/remove/stat/mkdir` →
    `writeFile/readFile/remove/stat/mkdir` (aliased `mkdir as makeDir` to avoid
    collision with the class method).
  - `src/storage-manager.ts`: `Deno.env.toObject()` → `getEnvAll()`.
  - `src/scanner.ts`: `Deno.connect()` → runtime-adapter `connect()`; refactored
    `conn.write()/read()` to stream-based
    `writable.getWriter()/readable.getReader()`.
- **test:node** script (`tsx --test --test-force-exit tests/*.test.ts`) for the
  Node.js 22+ test runner.
- **CI workflow** (9 jobs): 3 Deno v2.9 + 3 Bun + 3 Node 22
  (Linux/macOS/Windows).
- **tsconfig.json** and **.npmrc** (`@jsr:registry`) for Node/Bun resolution.
- **minimumDependencyAge: 0** in deno.json.

### Changed

- Upgraded deps: @dreamer/i18n ^1.1.2, @dreamer/runtime-adapter ^1.2.2,
  @dreamer/test ^1.2.3.
- `engines.node` set to `>=22` in package.json.

### Fixed

- multipart.test.ts: added missing `if (!minioAvailable) return;` guard to the
  "应该能取消分片上传" test, which was connecting to MinIO without checking
  availability (pre-existing bug surfaced by CI).

---

## [1.0.1] - 2026-03-27

### Added

- **`LocalCloudStorageAdapter` (`src/adapters/local-cloud.ts`)**: Full
  **`CloudStorageAdapter`** on local disk for **`MultipartUploadHandler`** when
  S3/OSS/COS is not used; multipart staging under
  **`baseDir/.staging/<uploadId>/`** with merge to **`baseDir/<key>`**; optional
  **`publicFileBasePath`** for **`getPresignedUrl`**. Exported from
  **`@dreamer/upload/adapters`** as **`createLocalCloudStorageAdapter`**,
  **`LocalCloudStorageAdapter`**, **`LocalCloudStorageConfig`**.
- **`package.json`**: Mirrors **`deno.json`** **`exports`** and scripts for
  Bun/npm workflows alongside JSR.

### Changed

- **CI (`.github/workflows/publish.yml`)**: Publish step runs
  **`npx jsr publish`** on **`v*`** tag pushes.
- **`.gitignore`**: Broader ignores for test data, snapshots, and coverage.

---

## [1.0.0] - 2026-02-20

### Added

Initial stable release. A complete file upload solution with client, server, and
multi-cloud storage adapters.

#### Main module (`@dreamer/upload`)

- **Uploader**: `createUploader`, `Uploader` class; `handleFormData` for
  server-side form upload with validation (max size, MIME, extensions).
- **StorageManager**: `new StorageManager(config)`,
  `createStorageManagerFromEnv()`; unified API: `upload`, `download`, `exists`,
  `delete`, `list`, `getPublicUrl`; supports `local`, `s3`, `oss`, `cos`
  backends.
- **Utilities**:
  - Filename: `getFileExtension`, `getBaseName`, `sanitizeFilename`,
    `generateFilename`, `generateTimestampFilename`, `getFilenameFromUrl`
  - MIME: `getMimeType`, `matchMimeType`
  - Type detection: `isImage`, `isVideo`, `isAudio`, `isDocument`, `isArchive`,
    `isHiddenFile`
  - Validation: `validateFile`, `validateFiles`, `isPathSafe`
  - Hash: `computeHash` (SHA-256), `computeShortHash`
  - Format: `formatFileSize`
  - Subdir: `generateDateSubdir`, `generateMonthSubdir`
- **Constants**: `DEFAULT_FORBIDDEN_EXTENSIONS`, `MIME_TYPES`.
- **Local storage**: `createLocalStorage`, `LocalStorage` for local file storage
  adapter.

#### Adapters (`@dreamer/upload/adapters`)

- **CloudStorageAdapter** interface: `upload`, `download`, `delete`, `exists`,
  `getMetadata`, `list`, `copy`, `getPresignedUrl`, `initiateMultipartUpload`,
  `uploadPart`, `completeMultipartUpload`, `abortMultipartUpload`, `listParts`.
- **S3**: `createS3Adapter`, `S3StorageAdapter`; AWS Signature V4; path-style
  and virtual-host-style; MinIO-compatible.
- **OSS**: `createOSSAdapter`, `OSSStorageAdapter`; native Aliyun signing;
  S3-compatible mode.
- **COS**: `createCOSAdapter`, `COSStorageAdapter`; native Tencent signing;
  S3-compatible mode.

#### Multipart (`@dreamer/upload/multipart`)

- **MultipartUploader**: Chunked upload with configurable part size and
  concurrency; progress callback; cancel support.
- **getRecommendedPartSize**: Computes part size for S3/MinIO (min 5MB per
  part).

#### Client (`@dreamer/upload/client`)

- **UploadClient**: `new UploadClient(config)`, `createUploadClient(config)`;
  `upload(file, options?)`, `resume(uploadId, file)`, `pause`, `cancel`,
  `getPendingUploads`, `cleanup`, `setToken`, `setHeaders`.
- **Types**: `UploadClientConfig`, `UploadProgress`, `UploadOptions`,
  `UploadResult`, `ChunkInfo`, `UploadState`.
- **Helpers**: `formatSize`, `calculateFileHash`.
- Resumable upload with `persistState` (localStorage); progress and state change
  callbacks.

#### Server (`@dreamer/upload/server`)

- **MultipartUploadHandler**: `new MultipartUploadHandler(config)`,
  `createMultipartUploadHandler`; unified `handle(request, basePath)` for
  `/init`, `/chunk`, `/complete`, `/abort`, `/status`; per-route methods:
  `handleInit`, `handleChunk`, `handleComplete`, `handleAbort`, `handleStatus`.
- **Types**: `MultipartUploadHandlerConfig`, `InitRequest`, `InitResponse`,
  `ChunkRequest`, `ChunkResponse`, `CompleteRequest`, `CompleteResponse`,
  `AbortRequest`, `UploadStatus`.
- File size and MIME validation; custom path generation and validation; path
  prefix support.

#### Internationalization (i18n)

- Server-side messages (e.g. S3/COS upload or delete failed, file not found) in
  **en-US** and **zh-CN** via `@dreamer/i18n`.
- Locale from environment: `LANGUAGE`, `LC_ALL`, `LANG`.
- Exports from `@dreamer/upload/i18n`: `$tr`, `setUploadLocale`, `detectLocale`.

### Compatibility

- **Deno** 2.6+
- **Bun** 1.3.5+
- **Browser** (client module)
