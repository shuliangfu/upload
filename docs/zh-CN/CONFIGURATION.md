# @dreamer/upload 配置说明（2.0.1）

**默认即安全。** 生产请保持安全相关默认；逃生开关仅用于
**本地／开发／测试**，除非你完全清楚风险。

相关：[BYPASS_MATRIX.md](./BYPASS_MATRIX.md) · [CHANGELOG.md](./CHANGELOG.md)

---

## 1. 必须保持开启的默认（生产）

| 配置                                             | 默认                   | 为何                                       | 危险改法                                      |
| ------------------------------------------------ | ---------------------- | ------------------------------------------ | --------------------------------------------- |
| `MultipartUploadHandler.requireAuth`             | **`true`**             | 未配 `authenticate` 时拒写                 | `false` → 匿名可写；**仅测／本地**            |
| `authenticate`                                   | _(生产必配)_           | 会话绑定 `userId`                          | 配 `requireAuth: false` 且无钩子 → 任何人可写 |
| 路径牢笼（`assertPathSafe`／`resolveSafePath`）  | 本地路径始终生效       | 防 `../`／绝对路径逃逸                     | 勿改回裸 `join(baseDir, key)`                 |
| 会话绑定（`uploadId → key`）                     | 始终生效               | chunk／complete 忽略客户端 key             | 不可关                                        |
| `verifyContentAfterComplete`                     | **`true`**             | 合并后魔数／内容策略；失败删对象           | `false` → 合并后盲信客户端                    |
| `verifyContentHeadBytes`                         | **`65536`**            | Range 只验对象头（魔数＋浅层 polyglot 窗） | 过小削弱检测；全量／极大值牺牲内存            |
| `Uploader.verifyMagicBytes`                      | **`true`**             | 不信客户端 MIME                            | `false` → 跳过内容策略；**仅测**              |
| 默拒扩展名／MIME（js／html／svg／wasm／可执行…） | 开启                   | 防脚本／XSS／可执行冒充图片                | 收窄黑名单会重开攻击面                        |
| `assertSafeAcl`／`allowDangerousAcl`             | 拒 `public-read-write` | 防桶对象对全世界可写                       | `allowDangerousAcl: true` **生产勿开**        |

### 迁移（行为 BREAKING）

```ts
// ≤1.1：无 authenticate 也可匿名写
new MultipartUploadHandler({ storage });

// 2.0 生产
new MultipartUploadHandler({
  storage,
  authenticate: async (req) => {
    const user = await verifySession(req);
    return user ? { userId: user.id } : null; // null → 401
  },
});

// 仅本地／测试逃生 — 生产禁止
new MultipartUploadHandler({ storage, requireAuth: false });
```

---

## 2. `MultipartUploadHandler`（`@dreamer/upload/server`）

| 名称                         | 类型                                       | 默认                           | 含义                               | 备注                               |
| ---------------------------- | ------------------------------------------ | ------------------------------ | ---------------------------------- | ---------------------------------- |
| `storage`                    | `CloudStorageAdapter`                      | _(必填)_                       | 分片后端                           |                                    |
| `maxPartSize`                | `number`                                   | `100MB`                        | 单分片上限                         |                                    |
| `maxFileSize`                | `number`                                   | `5GB`                          | 声明文件上限                       | 超限 → **413** `PAYLOAD_TOO_LARGE` |
| `allowedMimeTypes`           | `string[]`                                 | `[]`                           | 非空则缺／不匹配 MIME 拒           |                                    |
| `pathPrefix`                 | `string`                                   | `""`                           | key 前缀                           |                                    |
| `generatePath`               | `(filename, meta) => string`               | —                              | 自定义 key                         | 仍会 sanitize                      |
| `validate`                   | `(filename, size, mime) => boolean`        | —                              | 额外 init 门                       |                                    |
| `authenticate`               | `(req) => AuthContext \| null \| Response` | —                              | 鉴权钩子                           | 生产必配                           |
| `authorizeUpload`            | `(ctx, init, req) => boolean \| Response`  | —                              | 鉴权后、业务前                     | false → 403                        |
| `requireAuth`                | `boolean`                                  | **`true`**                     | 要求鉴权                           | 逃生 `false`：**仅测／本地**       |
| `sessionTtlMs`               | `number`                                   | `86400000`（24h）              | 内存会话 TTL                       |                                    |
| `sessionCleanupIntervalMs`   | `number`                                   | `60000`                        | 周期扫；`0` 关定时器（仍惰性过期） |                                    |
| `defaultOverwrite`           | `boolean`                                  | `true`                         | init 未传 overwrite 时             | 生产 API 宜显式 `overwrite: false` |
| `verifyContentAfterComplete` | `boolean`                                  | **`true`**                     | 合并后内容策略                     | 逃生 `false`：**仅测**             |
| `verifyContentHeadBytes`     | `number`                                   | **`65536`**                    | 二次校验 Range 字节                | 加大＝更严／更耗内存               |
| `onEvent`                    | `(UploadServerEvent) => void`              | —                              | 可观测；钩子异常吞掉               |                                    |
| `forbiddenExtensions`        | `string[]`                                 | `DEFAULT_FORBIDDEN_EXTENSIONS` | 禁止扩展名                         | 收窄危险                           |
| `virusScan`                  | `false \| VirusScanOptions`               | **关**（`false`／省略）        | complete 可选 ClamAV（或注入）杀毒 | 需 `enable:true`；全量下载；失败→删对象+422 |

错误 JSON 含稳定
`code`（`UploadErrorCode`：`UNAUTHORIZED`、`FORBIDDEN`、`CONTENT_REJECTED`、`ABORTED`
等）。

complete 可选杀毒（默认关）：

```ts
new MultipartUploadHandler({
  storage,
  authenticate,
  virusScan: { enable: true }, // ClamAV @ 127.0.0.1:3310；required=true
  // virusScan: { enable: true, required: false, host, port, scanner },
});
```


---

## 3. `Uploader`（`@dreamer/upload`）

| 名称                          | 类型                    | 默认           | 含义                     | 备注                   |
| ----------------------------- | ----------------------- | -------------- | ------------------------ | ---------------------- |
| `uploadDir`                   | `string`                | _(必填)_       | 本地根（牢笼内）         |                        |
| `storage`                     | `FileStorage`           | `LocalStorage` | 持久化                   |                        |
| `validation`                  | `FileValidationOptions` | `{}`           | 大小／MIME／扩展名       |                        |
| `maxTotalSize`                | `number`                | `100MB`        | FormData 总大小          |                        |
| `generateFilename`            | fn                      | UUID 风格      |                          |                        |
| `preserveExtension`           | `boolean`               | `true`         |                          |                        |
| `generateSubdir`              | `() => string`          | `""`           | 会 sanitize              |                        |
| `verifyMagicBytes`            | `boolean`               | **`true`**     | 内容策略                 | 逃生 `false`：**仅测** |
| `requireMimeType`             | `boolean`               | `false`        | 无 allowlist 也拒缺 MIME | 生产建议配 allowlist   |
| `quota`                       | `QuotaGuard`            | —              | 进程内薄配额             | 非计费系统             |
| `upload(..., options.signal)` | `AbortSignal`           | —              | 取消                     | 加法                   |

---

## 4. `LocalCloudStorageConfig`

| 名称                 | 类型     | 默认              | 含义                     | 备注                          |
| -------------------- | -------- | ----------------- | ------------------------ | ----------------------------- |
| `baseDir`            | `string` | _(必填)_          | 根目录；key 一律牢笼     |                               |
| `publicFileBasePath` | `string` | `"/uploads/file"` | 预签名 URL 前缀          |                               |
| `stagingTtlMs`       | `number` | `86400000`        | 暂存 TTL；`0` 关自动清理 | init／`cleanupExpiredStaging` |

分片 complete **顺序 append**（峰值≈单分片）。可选
`uploadStream`／`downloadStream`。

---

## 5. 云上传／下载选项与 S3

| 名称                                  | 类型          | 默认    | 含义                        | 备注                                 |
| ------------------------------------- | ------------- | ------- | --------------------------- | ------------------------------------ |
| `CloudUploadOptions.signal`           | `AbortSignal` | —       | 取消                        |                                      |
| `CloudUploadOptions.unsignedPayload`  | `boolean`     | `false` | S3 SigV4 `UNSIGNED-PAYLOAD` | 流式需要；缓冲 `upload` 默认精确哈希 |
| `S3Config.defaultUnsignedPayload`     | `boolean`     | `false` | 适配器级默认 unsigned       | 建议仅对流式按次开启                 |
| `allowDangerousAcl`（S3／OSS／COS）   | `boolean`     | `false` | 允许 `public-read-write`    | **生产勿开**                         |
| `DownloadOptions.rangeStart/rangeEnd` | `number`      | —       | Range／本地头读             | complete 二次校验使用                |
| `uploadStream`／`downloadStream`      | 可选方法      | —       | 加法流式                    | local-cloud＋S3 已实现               |

---

## 6. 残留风险（已文档化，非「留给下版」搪塞）

| 项                                   | 状态                                         |
| ------------------------------------ | -------------------------------------------- |
| 仅验头 vs 超过 64KiB 的深层 polyglot | 残留；可加大 `verifyContentHeadBytes` 或全量 |
| 真杀毒／加壳样本                     | 可选 `virusScan`（ClamAV，**默认关**）；深层加壳仍残留；默认可走启发式 |
| Zip 解压／zip-slip                   | 本包无解压入口                               |
| `defaultOverwrite: true`             | 兼容默认；生产 API 宜显式 `overwrite: false` |
| GCS／Azure 适配器                    | HOLD — 无凭证／无实现                        |
