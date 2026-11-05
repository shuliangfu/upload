# @dreamer/upload bypass matrix (2.0.0 hardening)

Fixtures are **harmless stand-ins** (truncated headers / string markers), not
real malware.

| Attack surface                                                 | Pre-2.0                          | Bypassable?                               | This campaign                                                                                                       | Tests                            |
| -------------------------------------------------------------- | -------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| Path traversal `../` / absolute write (local-cloud / Uploader) | `isPathSafe` unwired; raw `join` | Yes                                       | Closed: `resolveSafePath` / `assertPathSafe`                                                                        | `tests/security.test.ts` P0-path |
| Staging `uploadId=../../`                                      | No UUID check                    | Yes                                       | Closed: `isUuid`                                                                                                    | LocalCloud non-UUID              |
| Client tampers chunk/complete `key`                            | Trusted client key               | Yes                                       | Closed: server session owns key                                                                                     | P0-session                       |
| Forged `uploadId` / session collision                          | No session table                 | Yes                                       | Closed: unknown UUID → 404                                                                                          | forged uploadId → 404            |
| Cross-user resume                                              | No auth binding                  | Yes                                       | Closed: `authUserId` + owner check → 403                                                                            | cross-user → 403                 |
| Anonymous write without `authenticate`                         | Allowed by default               | Yes                                       | Closed: `requireAuth` **defaults true** → 401                                                                       | requireAuth default              |
| Double ext `a.php.jpg`                                         | Last ext only                    | Yes                                       | Closed: per-segment forbidden check                                                                                 | double ext / case                |
| NUL truncate `a.php\0.jpg`                                     | Unnormalized                     | Yes                                       | Closed: filename policy normalize                                                                                   | NUL truncate                     |
| Fullwidth dot / RTL spoof                                      | Unnormalized                     | Yes                                       | Closed: NFKC + fullwidth `.` + strip RTL                                                                            | fullwidth / RTL                  |
| Default allow `.js` / `.html` / `.svg` / `.wasm`               | Narrow denylist                  | Yes                                       | Closed: expanded ext + MIME denylist                                                                                | default deny HTML/SVG/MZ/js      |
| HTML/SVG claimed as `image/jpeg`                               | Trust client MIME                | Yes                                       | Closed: `scanDangerousPayload` + magic for media                                                                    | HTML/SVG spoof                   |
| Claimed image without magic                                    | Allowed                          | Yes                                       | Closed: image/audio/video require magic                                                                             | no-magic image                   |
| GIF+JS / PDF+MZ polyglot                                       | Unchecked                        | Yes                                       | Closed: shallow polyglot heuristics                                                                                 | polyglot reject                  |
| Content vs extension mismatch                                  | Loose                            | Yes                                       | Closed: ext MIME ≠ magic MIME → reject                                                                              | mismatch                         |
| Init-only type check; no post-merge verify                     | None                             | Yes                                       | Closed: complete → Range head + `validateUploadContent`; fail deletes object                                        | session HTML re-verify           |
| Missing / OOB / duplicate parts                                | Weak index checks                | Yes                                       | Closed: index ∈ [0,chunks) + full coverage                                                                          | missing/OOB parts                |
| Dangerous ACL `public-read-write`                              | Passed through                   | Yes                                       | Closed: `assertSafeAcl` denies by default                                                                           | ACL tests                        |
| 500 leaks absolute paths                                       | Raw `error.message`              | Yes                                       | Closed: `redactErrorMessage` + generic 500                                                                          | redact tests                     |
| zip-slip / zip bomb                                            | **No unpack entry**              | N/A                                       | Confirmed no unzip/inflate write; HOLD if unpack added later                                                        | source scan                      |
| Real AV / deep polyglot / packers                              | None                             | Partial                                   | **Not closed** (out of scope); heuristics documented                                                                | —                                |
| Complete verify reads object **head only** (default 64 KiB)    | Full download                    | Payload after head may evade shallow scan | **Deliberate tradeoff**: raise `verifyContentHeadBytes` / full object; default covers magic + 8 KiB + PDF MZ window | smoke + security                 |
| `verifyContentAfterComplete: false`                            | Switchable                       | Yes                                       | Escape hatch — **tests only**; see CONFIGURATION                                                                    | CONFIGURATION                    |
| `requireAuth: false`                                           | Switchable                       | Yes                                       | Escape — **local/dev/tests only**                                                                                   | CONFIGURATION                    |
| AbortSignal mid-upload                                         | None                             | No                                        | Additive: Request.signal → 499 `ABORTED`                                                                            | smoke AbortSignal                |
| listParts/complete etag sidecar                                | Re-hash every part               | Sidecar tampered on same host             | Staging is server-local; client etag must still match                                                               | local-cloud                      |

## Migration (breaking behavior)

- `MultipartUploadHandler.requireAuth` defaults to `true`. Code without
  `authenticate` gets **401**.
  - Migrate: wire `authenticate`, or set `requireAuth: false` (**local/dev/tests
    only**, never production).
- Default denylist includes `.js` / `.html` / `.svg` / `.wasm` etc. To allow
  static assets, explicitly narrow `forbiddenExtensions` / `forbiddenMimeTypes`
  (understand XSS risk).

See also: [CONFIGURATION.md](./CONFIGURATION.md).
