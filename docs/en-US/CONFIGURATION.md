# @dreamer/upload configuration (1.2.0)

**Secure-by-default.** Prefer leaving security toggles at their defaults. Escape
hatches are for **local/dev/tests only** unless you fully understand the risk.

Related: [BYPASS_MATRIX.md](./BYPASS_MATRIX.md) · [CHANGELOG.md](./CHANGELOG.md)

---

## 1. Defaults that must stay on (production)

| Setting                                             | Default                   | Why                                                                       | Dangerous if changed                                                                                    |
| --------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `MultipartUploadHandler.requireAuth`                | **`true`**                | Rejects anonymous writes when `authenticate` is missing                   | `false` → open write surface; **local/dev only**                                                        |
| `authenticate`                                      | _(required in prod)_      | Binds sessions to `userId`                                                | Omitting with `requireAuth: true` → all writes 401 (safe); with `requireAuth: false` → anyone can write |
| Path cage (`assertPathSafe` / `resolveSafePath`)    | always on for local paths | Blocks `../` and absolute escapes                                         | Do not bypass with raw `join(baseDir, key)`                                                             |
| Session binding (`uploadId → key`)                  | always on                 | Ignores client-supplied keys on chunk/complete                            | N/A (not configurable)                                                                                  |
| `verifyContentAfterComplete`                        | **`true`**                | Magic/content policy after merge; deletes object on fail                  | `false` → trust client MIME/ext after merge                                                             |
| `verifyContentHeadBytes`                            | **`65536`**               | Range head verify (magic + shallow polyglot window) without full download | `0` / too small → weaker detect; use large/`Infinity` only if you accept memory cost                    |
| `Uploader.verifyMagicBytes`                         | **`true`**                | Do not trust client MIME                                                  | `false` → content policy skipped                                                                        |
| Default forbidden ext/MIME (js/html/svg/wasm/exec…) | on                        | Blocks script/XSS/exec upload-as-image                                    | Narrowing lists re-opens XSS/RCE vectors                                                                |
| `assertSafeAcl` / `allowDangerousAcl`               | deny `public-read-write`  | Prevents world-writable objects                                           | `allowDangerousAcl: true` → bucket may be world-writable                                                |

### Migration (BREAKING behavior)

```ts
// Before ≤1.1 (anonymous writes worked with no authenticate)
new MultipartUploadHandler({ storage });

// 1.2 production
new MultipartUploadHandler({
  storage,
  authenticate: async (req) => {
    const user = await verifySession(req);
    return user ? { userId: user.id } : null; // null → 401
  },
});

// Local/dev escape ONLY — never in production
new MultipartUploadHandler({ storage, requireAuth: false });
```

---

## 2. `MultipartUploadHandler` (`@dreamer/upload/server`)

| Name                         | Type                                       | Default                        | Meaning                                                  | Notes                                      |
| ---------------------------- | ------------------------------------------ | ------------------------------ | -------------------------------------------------------- | ------------------------------------------ |
| `storage`                    | `CloudStorageAdapter`                      | _(required)_                   | Backend for multipart                                    |                                            |
| `maxPartSize`                | `number`                                   | `100 * 1024 * 1024`            | Max bytes per chunk                                      |                                            |
| `maxFileSize`                | `number`                                   | `5 * 1024 * 1024 * 1024`       | Max declared file size                                   | Oversize → **413** `PAYLOAD_TOO_LARGE`     |
| `allowedMimeTypes`           | `string[]`                                 | `[]`                           | If non-empty, missing/mismatch MIME rejected             |                                            |
| `pathPrefix`                 | `string`                                   | `""`                           | Key prefix                                               |                                            |
| `generatePath`               | `(filename, meta) => string`               | —                              | Custom object key                                        | Output still sanitized                     |
| `validate`                   | `(filename, size, mime) => boolean`        | —                              | Extra init gate                                          |                                            |
| `authenticate`               | `(req) => AuthContext \| null \| Response` | —                              | Auth hook                                                | Prod: required                             |
| `authorizeUpload`            | `(ctx, init, req) => boolean \| Response`  | —                              | After auth, before init                                  | false → 403                                |
| `requireAuth`                | `boolean`                                  | **`true`**                     | Require authenticate                                     | Escape: `false` **test/local only**        |
| `sessionTtlMs`               | `number`                                   | `86400000` (24h)               | In-memory session TTL                                    |                                            |
| `sessionCleanupIntervalMs`   | `number`                                   | `60000`                        | Periodic sweep; `0` disables timer (lazy expiry remains) |                                            |
| `defaultOverwrite`           | `boolean`                                  | `true`                         | Default when init omits `overwrite`                      | Set `false` to prefer 409                  |
| `verifyContentAfterComplete` | `boolean`                                  | **`true`**                     | Post-merge content policy                                | Escape: `false` **test only**              |
| `verifyContentHeadBytes`     | `number`                                   | **`65536`**                    | Range bytes for verify                                   | Raise for stricter/full; lowers memory win |
| `onEvent`                    | `(UploadServerEvent) => void`              | —                              | Observability; errors swallowed                          |                                            |
| `forbiddenExtensions`        | `string[]`                                 | `DEFAULT_FORBIDDEN_EXTENSIONS` | Extra/override list                                      | Narrowing is dangerous                     |

JSON errors include stable `code` (`UploadErrorCode`: `UNAUTHORIZED`,
`FORBIDDEN`, `CONTENT_REJECTED`, `ABORTED`, …).

---

## 3. `Uploader` (`@dreamer/upload`)

| Name                          | Type                    | Default        | Meaning                                    | Notes                         |
| ----------------------------- | ----------------------- | -------------- | ------------------------------------------ | ----------------------------- |
| `uploadDir`                   | `string`                | _(required)_   | Local root (path-caged)                    |                               |
| `storage`                     | `FileStorage`           | `LocalStorage` | Persistence                                |                               |
| `validation`                  | `FileValidationOptions` | `{}`           | size/MIME/ext gates                        |                               |
| `maxTotalSize`                | `number`                | `100MB`        | FormData total                             |                               |
| `generateFilename`            | fn                      | UUID-ish       |                                            |                               |
| `preserveExtension`           | `boolean`               | `true`         |                                            |                               |
| `generateSubdir`              | `() => string`          | `""`           | Sanitized subdir                           |                               |
| `verifyMagicBytes`            | `boolean`               | **`true`**     | Content policy                             | Escape: `false` **test only** |
| `requireMimeType`             | `boolean`               | `false`        | Reject missing MIME even without allowlist | Prefer allowlist in prod      |
| `quota`                       | `QuotaGuard`            | —              | Thin in-process quota                      | Not a billing system          |
| `upload(..., options.signal)` | `AbortSignal`           | —              | Cancel                                     | Additive                      |

---

## 4. `LocalCloudStorageConfig`

| Name                 | Type     | Default           | Meaning                                    | Notes                                          |
| -------------------- | -------- | ----------------- | ------------------------------------------ | ---------------------------------------------- |
| `baseDir`            | `string` | _(required)_      | Root; all keys path-caged                  |                                                |
| `publicFileBasePath` | `string` | `"/uploads/file"` | Presign URL prefix                         |                                                |
| `stagingTtlMs`       | `number` | `86400000`        | Staging dir TTL; `0` disables auto cleanup | Call `cleanupExpiredStaging` / cleaned on init |

Multipart complete **appends parts in order** (peak ≈ one part). Optional
`uploadStream` / `downloadStream`.

---

## 5. Cloud upload / download options & S3

| Name                                       | Type             | Default | Meaning                           | Notes                                                   |
| ------------------------------------------ | ---------------- | ------- | --------------------------------- | ------------------------------------------------------- |
| `CloudUploadOptions.signal`                | `AbortSignal`    | —       | Cancel                            |                                                         |
| `CloudUploadOptions.unsignedPayload`       | `boolean`        | `false` | S3 SigV4 `UNSIGNED-PAYLOAD`       | Needed for streams; buffered `upload` hashes by default |
| `S3Config.defaultUnsignedPayload`          | `boolean`        | `false` | Default unsigned for that adapter | Prefer per-call for streams only                        |
| `S3Config.allowDangerousAcl` (OSS/COS too) | `boolean`        | `false` | Allow `public-read-write`         | **Do not enable in prod**                               |
| `DownloadOptions.rangeStart/rangeEnd`      | `number`         | —       | HTTP Range / local head read      | Used by complete verify                                 |
| `uploadStream` / `downloadStream`          | optional methods | —       | Additive streaming                | local-cloud + S3 implemented                            |

---

## 6. Residual risks (documented, not “next version” excuses)

| Item                                                 | Status                                                              |
| ---------------------------------------------------- | ------------------------------------------------------------------- |
| Head-only verify vs full-object polyglot past 64 KiB | Residual; raise `verifyContentHeadBytes` or full download if needed |
| Real AV / packed malware                             | HOLD — not in scope; heuristics only                                |
| Zip unpack / zip-slip                                | No unpack entry in this package                                     |
| `defaultOverwrite: true`                             | Compat default; prefer explicit `overwrite: false` in prod APIs     |
| GCS / Azure adapters                                 | HOLD — no credentials/impl in-tree                                  |
