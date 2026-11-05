/**
 * @fileoverview 上传安全回归 + 绕过矩阵夹具（无害假载荷）
 *
 * 运行：deno test -A tests/security.test.ts
 */

import { afterAll, beforeAll, describe, expect, it } from "@dreamer/test";
import { makeTempDir, mkdir, remove } from "@dreamer/runtime-adapter";
import { join, resolve } from "@dreamer/runtime-adapter";
import {
  createLocalCloudStorageAdapter,
  LocalCloudStorageAdapter,
} from "../src/adapters/local-cloud.ts";
import { MultipartUploadHandler } from "../src/server/mod.ts";
import { Uploader } from "../src/uploader.ts";
import {
  assertSafeAcl,
  buildContentDisposition,
  detectMimeType,
  findForbiddenExtension,
  generateTimestampFilename,
  isPathSafe,
  isUuid,
  normalizeFilenameForPolicy,
  QuotaGuard,
  redactErrorMessage,
  resolveSafePath,
  sanitizeObjectKey,
  scanDangerousPayload,
  validateFile,
  validateUploadContent,
} from "../src/utils.ts";

let TMP = "";

async function ensureTmp(): Promise<void> {
  if (!TMP) TMP = await makeTempDir({ prefix: "upload-sec-" });
}

/** 无害 PNG 头（1x1 不足，仅签名足够触发魔数） */
function fixturePng(): Uint8Array {
  return new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    0,
    0,
    0,
    0,
  ]);
}

/** 无害 GIF89a 头 */
function fixtureGif(): Uint8Array {
  return new TextEncoder().encode("GIF89a");
}

/** GIF + 尾随假脚本（polyglot 夹具，非真恶意） */
function fixtureGifWithScript(): Uint8Array {
  const head = new TextEncoder().encode("GIF89a");
  const tail = new TextEncoder().encode("\n<script>alert(1)</script>");
  const out = new Uint8Array(head.length + tail.length);
  out.set(head, 0);
  out.set(tail, head.length);
  return out;
}

/** PDF 头 + 远处 MZ（polyglot 夹具） */
function fixturePdfWithMz(): Uint8Array {
  const out = new Uint8Array(64);
  out[0] = 0x25;
  out[1] = 0x50;
  out[2] = 0x44;
  out[3] = 0x46; // %PDF
  out[32] = 0x4d;
  out[33] = 0x5a; // MZ
  return out;
}

/** HTML 冒充图片 */
function fixtureHtml(): Uint8Array {
  return new TextEncoder().encode("<!DOCTYPE html><html><script>x</script>");
}

/** SVG 冒充图片 */
function fixtureSvg(): Uint8Array {
  return new TextEncoder().encode(
    '<svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>',
  );
}

/** MZ 可执行头（无害截断） */
function fixtureMz(): Uint8Array {
  return new Uint8Array([0x4d, 0x5a, 0x90, 0x00]);
}

function authOk() {
  return { userId: "tester" };
}

describe("@dreamer/upload security", () => {
  beforeAll(ensureTmp);
  afterAll(async () => {
    if (!TMP) return;
    try {
      await remove(TMP, { recursive: true });
    } catch {
      // ignore
    }
  });

  describe("P0-path 路径牢笼", () => {
    it("isPathSafe／resolveSafePath 拒绝穿越", () => {
      expect(isPathSafe("../etc/passwd", "/var/uploads")).toBe(false);
      expect(isPathSafe("/etc/passwd", "/var/uploads")).toBe(false);
      expect(() => resolveSafePath(TMP, "../escape.txt")).toThrow();
      expect(() => resolveSafePath(TMP, "/etc/passwd")).toThrow();
      // Compare with resolved+normalized base: Deno Windows makeTempDir vs resolve
      // may disagree on `\` vs `/` while still being the same cage.
      const norm = (p: string) =>
        p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
      const safe = norm(resolveSafePath(TMP, "a/b.txt"));
      const base = norm(resolve(TMP));
      expect(safe === base || safe.startsWith(base + "/")).toBe(true);
    });

    it("LocalCloud 拒绝 key 穿越与非 UUID staging", async () => {
      const base = join(TMP, "cloud");
      await mkdir(base, { recursive: true });
      const adapter = createLocalCloudStorageAdapter({ baseDir: base });
      let threw = false;
      try {
        await adapter.upload("../escape.txt", new TextEncoder().encode("x"));
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
      const raw = new LocalCloudStorageAdapter({ baseDir: base });
      threw = false;
      try {
        await raw.uploadPart("k", "../../evil", 1, new Uint8Array([1]));
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    });

    it("Uploader.read 拒绝 uploadDir 外路径", async () => {
      const dir = join(TMP, "up");
      await mkdir(dir, { recursive: true });
      const uploader = new Uploader({
        uploadDir: dir,
        verifyMagicBytes: false,
      });
      await uploader.init();
      let threw = false;
      try {
        await uploader.read("../security.test.ts");
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    });
  });

  describe("文件名混淆绕过", () => {
    it("双扩展／大小写", () => {
      expect(findForbiddenExtension("x.PHP.jpg")).toBe(".php");
      expect(findForbiddenExtension("x.Js")).toBe(".js");
      expect(findForbiddenExtension("x.HTML")).toBe(".html");
      expect(findForbiddenExtension("ok.png")).toBe(null);
    });

    it("空字节截断归一后仍命中", () => {
      const name = "shell.php\u0000.jpg";
      expect(normalizeFilenameForPolicy(name)).toContain("shell.php");
      expect(findForbiddenExtension(name)).toBe(".php");
    });

    it("全角点／RTL 混淆", () => {
      // 全角点 U+FF0E
      expect(findForbiddenExtension("evil．php．jpg")).toBe(".php");
      // RTL override 夹在扩展名中
      const rtl = "safe\u202ephp.jpg"; // 视觉混淆；归一后仍含 php 段视具体结构
      const norm = normalizeFilenameForPolicy(rtl);
      expect(norm.includes("\u202e")).toBe(false);
    });
  });

  describe("内容策略／魔数／polyglot", () => {
    it("默拒 HTML／SVG／MZ／js 扩展", () => {
      expect(validateUploadContent("a.html", fixtureHtml(), "text/html").valid)
        .toBe(false);
      expect(
        validateUploadContent("a.svg", fixtureSvg(), "image/svg+xml").valid,
      )
        .toBe(false);
      expect(
        validateUploadContent("a.exe", fixtureMz(), "application/octet-stream")
          .valid,
      )
        .toBe(false);
      expect(validateFile({ name: "x.js", type: "text/javascript" }).valid)
        .toBe(false);
    });

    it("HTML／SVG 冒充 image/jpeg 被堵", () => {
      expect(validateUploadContent("a.jpg", fixtureHtml(), "image/jpeg").valid)
        .toBe(false);
      expect(validateUploadContent("a.jpg", fixtureSvg(), "image/jpeg").valid)
        .toBe(false);
      expect(scanDangerousPayload(fixtureHtml())).toBe("text/html");
      expect(scanDangerousPayload(fixtureSvg())).toBe("image/svg+xml");
    });

    it("声称图片但无魔数 → 拒", () => {
      const text = new TextEncoder().encode("not-an-image");
      expect(validateUploadContent("a.png", text, "image/png").valid).toBe(
        false,
      );
    });

    it("GIF+script／PDF+MZ polyglot 拒", () => {
      expect(scanDangerousPayload(fixtureGifWithScript())).toBe(
        "polyglot-script",
      );
      expect(
        validateUploadContent("a.gif", fixtureGifWithScript(), "image/gif")
          .valid,
      ).toBe(false);
      expect(scanDangerousPayload(fixturePdfWithMz())).toBe("polyglot-pdf-exe");
      expect(
        validateUploadContent("a.pdf", fixturePdfWithMz(), "application/pdf")
          .valid,
      ).toBe(false);
    });

    it("合法 PNG 头通过", () => {
      expect(detectMimeType(fixturePng())).toBe("image/png");
      expect(validateUploadContent("a.png", fixturePng(), "image/png").valid)
        .toBe(true);
    });

    it("内容与扩展名不一致拒", () => {
      // PNG 内容 + .gif 扩展
      expect(validateUploadContent("a.gif", fixturePng(), "image/gif").valid)
        .toBe(false);
    });
  });

  describe("P0-session／auth", () => {
    it("requireAuth 默认 true：无 authenticate → 401", async () => {
      const base = join(TMP, "auth0");
      await mkdir(base, { recursive: true });
      const handler = new MultipartUploadHandler({
        storage: createLocalCloudStorageAdapter({ baseDir: base }),
      });
      const res = await handler.handleInit(
        new Request("http://localhost/upload/init", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: "a.png",
            fileSize: 12,
            chunks: 1,
            mimeType: "image/png",
          }),
        }),
      );
      expect(res.status).toBe(401);
    });

    it("会话绑定：忽略客户端篡改 key；合并后二次魔数堵 HTML", async () => {
      const base = join(TMP, "sess");
      await mkdir(base, { recursive: true });
      const storage = createLocalCloudStorageAdapter({ baseDir: base });
      const handler = new MultipartUploadHandler({
        storage,
        authenticate: authOk,
      });

      const initRes = await handler.handleInit(
        new Request("http://localhost/upload/init", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: "a.png",
            fileSize: fixtureHtml().length,
            chunks: 1,
            mimeType: "image/png",
          }),
        }),
      );
      expect(initRes.status).toBe(200);
      const initBody = await initRes.json() as {
        uploadId: string;
        key: string;
      };
      expect(isUuid(initBody.uploadId)).toBe(true);

      const data = fixtureHtml();
      const fd = new FormData();
      fd.append("uploadId", initBody.uploadId);
      fd.append("index", "0");
      fd.append("key", "../evil-key");
      fd.append("file", new Blob([data.slice()]), "chunk.bin");
      const chunkRes = await handler.handleChunk(
        new Request("http://localhost/upload/chunk", {
          method: "POST",
          body: fd,
        }),
      );
      expect(chunkRes.status).toBe(200);
      const chunkBody = await chunkRes.json() as { etag: string };

      const completeRes = await handler.handleComplete(
        new Request("http://localhost/upload/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            uploadId: initBody.uploadId,
            key: "../evil-key",
            filename: "a.png",
            chunks: [{ index: 0, etag: chunkBody.etag }],
          }),
        }),
      );
      // 二次魔数应拒绝 HTML 冒充 png
      expect(completeRes.status).toBe(400);
      expect(await storage.exists(initBody.key)).toBe(false);
    });

    it("伪造 uploadId → 404；越权续传 → 403", async () => {
      const base = join(TMP, "hijack");
      await mkdir(base, { recursive: true });
      const storage = createLocalCloudStorageAdapter({ baseDir: base });
      const handler = new MultipartUploadHandler({
        storage,
        authenticate: authOk,
      });
      const initRes = await handler.handleInit(
        new Request("http://localhost/upload/init", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: "a.png",
            fileSize: fixturePng().length,
            chunks: 1,
            mimeType: "image/png",
          }),
        }),
      );
      const { uploadId } = await initRes.json() as { uploadId: string };

      const forged = await handler.handleStatus(
        new Request(
          "http://localhost/upload/status?uploadId=00000000-0000-4000-8000-000000000000",
        ),
      );
      expect(forged.status).toBe(404);

      const handler2 = new MultipartUploadHandler({
        storage,
        authenticate: () => ({ userId: "other" }),
      });
      // 同进程：把会话「偷」不了跨实例；改为同 handler 但 authenticate 返回其他用户——
      // 需在同一 handler 上改钩子不可行。改为：init 用 userA，chunk 用新 handler 无会话→404。
      const fd = new FormData();
      fd.append("uploadId", uploadId);
      fd.append("index", "0");
      fd.append("file", new Blob([fixturePng().slice()]), "c.bin");
      const cross = await handler2.handleChunk(
        new Request("http://localhost/upload/chunk", {
          method: "POST",
          body: fd,
        }),
      );
      expect(cross.status).toBe(404); // 无共享会话＝伪造／撞库失败

      // 同 handler 内：用 requireAuth + 自定义切换——直接测 assertSessionOwner：
      // 再 init 一个带 userId 的会话，然后临时用返回不同 userId 的 handler 无法共享。
      // 改为单 handler，authenticate 读 header：
      const base2 = join(TMP, "hijack2");
      await mkdir(base2, { recursive: true });
      const h = new MultipartUploadHandler({
        storage: createLocalCloudStorageAdapter({ baseDir: base2 }),
        authenticate: (req) => {
          const uid = req.headers.get("x-user") || "";
          return uid ? { userId: uid } : null;
        },
      });
      const init2 = await h.handleInit(
        new Request("http://localhost/upload/init", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-user": "alice",
          },
          body: JSON.stringify({
            filename: "a.png",
            fileSize: 12,
            chunks: 1,
            mimeType: "image/png",
          }),
        }),
      );
      const body2 = await init2.json() as { uploadId: string };
      const fd2 = new FormData();
      fd2.append("uploadId", body2.uploadId);
      fd2.append("index", "0");
      fd2.append("file", new Blob([fixturePng().slice()]), "c.bin");
      const denied = await h.handleChunk(
        new Request("http://localhost/upload/chunk", {
          method: "POST",
          headers: { "x-user": "bob" },
          body: fd2,
        }),
      );
      expect(denied.status).toBe(403);
    });

    it("缺片／超界索引拒绝", async () => {
      const base = join(TMP, "parts");
      await mkdir(base, { recursive: true });
      const handler = new MultipartUploadHandler({
        storage: createLocalCloudStorageAdapter({ baseDir: base }),
        authenticate: authOk,
      });
      const initRes = await handler.handleInit(
        new Request("http://localhost/upload/init", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: "a.png",
            fileSize: 24,
            chunks: 2,
            mimeType: "image/png",
          }),
        }),
      );
      const { uploadId } = await initRes.json() as { uploadId: string };
      const fd = new FormData();
      fd.append("uploadId", uploadId);
      fd.append("index", "5");
      fd.append("file", new Blob([fixturePng().slice()]), "c.bin");
      const bad = await handler.handleChunk(
        new Request("http://localhost/upload/chunk", {
          method: "POST",
          body: fd,
        }),
      );
      expect(bad.status).toBe(400);

      const complete = await handler.handleComplete(
        new Request("http://localhost/upload/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            uploadId,
            key: "x",
            filename: "a.png",
            chunks: [{ index: 0, etag: "dead" }],
          }),
        }),
      );
      expect(complete.status).toBe(400);
    });
  });

  describe("P1 杂项", () => {
    it("overwrite:false → 409", async () => {
      const base = join(TMP, "ow");
      await mkdir(base, { recursive: true });
      const storage = createLocalCloudStorageAdapter({ baseDir: base });
      const key = "fixed/name.png";
      await storage.upload(key, fixturePng());
      const handler = new MultipartUploadHandler({
        storage,
        authenticate: authOk,
        generatePath: () => key,
      });
      const res = await handler.handleInit(
        new Request("http://localhost/upload/init", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: "name.png",
            fileSize: 12,
            chunks: 1,
            mimeType: "image/png",
            overwrite: false,
          }),
        }),
      );
      expect(res.status).toBe(409);
    });

    it("ACL／配额／Disposition／redact", () => {
      expect(() => assertSafeAcl("public-read-write")).toThrow();
      const q = new QuotaGuard(10);
      expect(() => {
        q.reserve(8);
        q.reserve(3);
      }).toThrow();
      expect(buildContentDisposition("你好.png", true)).toContain("filename*=");
      expect(generateTimestampFilename("../a b.txt").includes("..")).toBe(
        false,
      );
      expect(sanitizeObjectKey("a/../b/c")).toBe("a/b/c");
      expect(redactErrorMessage("/var/uploads/secret/a.png boom")).toContain(
        "[path]",
      );
      expect(fixtureGif().length).toBeGreaterThan(0);
    });
  });
});
