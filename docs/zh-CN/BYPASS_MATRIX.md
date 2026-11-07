# @dreamer/upload 绕过矩阵（2.0.1）

夹具均为**无害假载荷**（截断头／字符串标记），非真实恶意软件。

| 攻击面                                             | 升级前现状                                    | 是否可绕               | 本战役是否已堵                                                                   | 测试用例                         |
| -------------------------------------------------- | --------------------------------------------- | ---------------------- | -------------------------------------------------------------------------------- | -------------------------------- |
| 路径穿越 `../`／绝对路径写入 local-cloud／Uploader | `isPathSafe` 未接线；`join(baseDir,key)` 直拼 | 是                     | 已堵：`resolveSafePath`／`assertPathSafe` 牢笼                                   | `tests/security.test.ts` P0-path |
| staging `uploadId=../../`                          | 未校验 UUID                                   | 是                     | 已堵：`isUuid`                                                                   | 同上 LocalCloud 非 UUID          |
| 客户端篡改 chunk／complete 的 key                  | 信任 FormData／JSON key                       | 是                     | 已堵：内存会话只认服务端 key                                                     | P0-session 会话绑定              |
| 伪造 uploadId／跨会话撞库                          | 无会话表                                      | 是                     | 已堵：未知 UUID → 404                                                            | 伪造 uploadId → 404              |
| 越权续传（异 userId）                              | 无鉴权绑定                                    | 是                     | 已堵：`authUserId` + `assertSessionOwner` → 403                                  | 越权续传 → 403                   |
| 未配置 authenticate 匿名写                         | 默认允许                                      | 是                     | 已堵：`requireAuth` **默认 true** → 401                                          | requireAuth 默认 true            |
| 双扩展 `a.php.jpg`                                 | 只查末扩展                                    | 是                     | 已堵：`findForbiddenExtension` 各段                                              | 双扩展／大小写                   |
| 空字节截断 `a.php\0.jpg`                           | 未归一                                        | 是                     | 已堵：`normalizeFilenameForPolicy`                                               | 空字节截断                       |
| 全角点／RTL 混淆                                   | 未归一                                        | 是                     | 已堵：NFKC + 全角点→`.` + 剥 RTL                                                 | 全角点／RTL                      |
| 默认放行 `.js`／`.html`／`.svg`／`.wasm`           | 黑名单过窄                                    | 是                     | 已堵：扩展名 + MIME 黑名单                                                       | 默拒 HTML／SVG／MZ／js           |
| HTML／SVG 冒充 `image/jpeg`                        | 信客户端 MIME                                 | 是                     | 已堵：`scanDangerousPayload` + 图片须魔数                                        | HTML／SVG 冒充                   |
| 声称图片但无魔数                                   | 可过                                          | 是                     | 已堵：image／audio／video 无魔数拒                                               | 声称图片但无魔数                 |
| GIF+JS／PDF+MZ polyglot                            | 未检                                          | 是                     | 已堵：浅层 polyglot 启发式                                                       | polyglot 拒                      |
| 内容与扩展名不一致（png 当 .gif）                  | 未比具体 MIME                                 | 是                     | 已堵：扩展 MIME ≠ 魔数 MIME 拒                                                   | 内容与扩展名不一致               |
| 只在 init 验类型、合并后不管                       | 无二次校验                                    | 是                     | 已堵：complete 后 download + `validateUploadContent`，失败删对象                 | 会话绑定 HTML 二次魔数           |
| 缺片／超界／重复分片                               | 索引几乎不校验                                | 是                     | 已堵：index∈[0,chunks)＋complete 全覆盖                                          | 缺片／超界                       |
| 危险 ACL `public-read-write`                       | 直接透传                                      | 是                     | 已堵：`assertSafeAcl` 默认拒                                                     | ACL 测试                         |
| 500 回显绝对路径                                   | `error.message` 原文                          | 是                     | 已堵：`redactErrorMessage` + 通用 500                                            | redact 测试                      |
| zip-slip／zip bomb                                 | **本包无解压入口**                            | 不适用                 | 确认无 unzip／inflate 写盘；HOLD 若未来加解压必补                                | 源码扫描（无命中）               |
| 真杀毒／深层 polyglot／加密壳                      | 可选 `virusScan`（ClamAV）                    | 部分                   | **opt-in**（complete，`enable:true`）；默认关；深层加壳仍残留；启发式仍在        | virus-scan + CONFIGURATION       |
| complete 二次校验仅拉对象头（默认 64KiB）          | 全量 download                                 | 头之后载荷可逃浅层扫描 | **有意权衡**：可加大 `verifyContentHeadBytes`／全量；默认覆盖魔数+8KiB+PDF MZ 窗 | smoke + security                 |
| `verifyContentAfterComplete: false`                | 可关                                          | 是                     | 逃生；**仅测**；见 CONFIGURATION 置顶                                            | CONFIGURATION                    |
| `requireAuth: false`                               | 可关                                          | 是                     | 逃生；**仅测／本地**                                                             | CONFIGURATION                    |
| AbortSignal 取消半截上传                           | 无                                            | 否                     | 已加法：Request.signal → 499 ABORTED                                             | smoke AbortSignal                |
| listParts／complete 旁路 etag                      | 每片重哈希                                    | 旁路被同机篡改         | staging 仅服务端本地；etag 仍须与客户端清单一致                                  | local-cloud                      |

## 迁移（breaking 行为）

- `MultipartUploadHandler`：`requireAuth` 默认 `true`。旧代码未配 `authenticate`
  将得到 401。
  - 迁移：接入 `authenticate`，或显式
    `requireAuth: false`（**仅测／本地**，生产禁止）。
- 默认禁止 `.js`／`.html`／`.svg`／`.wasm` 等；确需静态资源上传时显式收窄
  `forbiddenExtensions`／`forbiddenMimeTypes`。

另见：[CONFIGURATION.md](./CONFIGURATION.md)。
