/**
 * @fileoverview 1.2.x 烟雾：scanner／resumable／perf 钩子（无害夹具）
 *
 * 运行：deno test -A tests/smoke-1.2.test.ts
 */

import { afterAll, beforeAll, describe, expect, it } from "@dreamer/test";
import { makeTempDir, mkdir, remove } from "@dreamer/runtime-adapter";
import { join } from "@dreamer/runtime-adapter";
import { createLocalCloudStorageAdapter } from "../src/adapters/local-cloud.ts";
import { MultipartUploadHandler, UploadErrorCode } from "../src/server/mod.ts";
import {
  createCachedScanner,
  type ScanResult,
  type VirusScannerInterface,
} from "../src/scanner.ts";
import { createResumableUploader, MemoryStateStore } from "../src/resumable.ts";
import { scanDangerousPayload } from "../src/utils.ts";

let TMP = "";

async function ensureTmp(): Promise<void> {
  if (!TMP) TMP = await makeTempDir({ prefix: "upload-smoke-" });
}

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
    0x00,
    0x00,
    0x00,
    0x0d,
    0x49,
    0x48,
    0x44,
    0x52,
    0x00,
    0x00,
    0x00,
    0x01,
    0x00,
    0x00,
    0x00,
    0x01,
    0x08,
    0x02,
    0x00,
    0x00,
    0x00,
    0x90,
    0x77,
    0x53,
    0xde,
    0x00,
    0x00,
    0x00,
    0x0c,
    0x49,
    0x44,
    0x41,
    0x54,
    0x08,
    0xd7,
    0x63,
    0xf8,
    0xff,
    0xff,
    0x3f,
    0x00,
    0x05,
    0xfe,
    0x02,
    0xfe,
    0xa7,
    0x35,
    0x81,
    0x84,
    0x00,
    0x00,
    0x00,
    0x00,
    0x49,
    0x45,
    0x4e,
    0x44,
    0xae,
    0x42,
    0x60,
    0x82,
  ]);
}

/** 假扫描器：不连真 AV，只验证 CachedScanner 包装可构造／扫描 */
class FakeScanner implements VirusScannerInterface {
  readonly name = "fake";
  isAvailable(): Promise<boolean> {
    return Promise.resolve(true);
  }
  scan(content: Uint8Array, _filename?: string): Promise<ScanResult> {
    const safe = content[0] !== 0x4d;
    return Promise.resolve({
      safe,
      engine: this.name,
      threats: safe ? [] : ["EICAR-FAKE"],
      duration: 0,
      scannedAt: new Date(),
    });
  }
}

describe("smoke 1.2 scanner／resumable／perf", () => {
  beforeAll(async () => {
    await ensureTmp();
  });

  afterAll(async () => {
    if (!TMP) return;
    try {
      await remove(TMP, { recursive: true });
    } catch {
      // ignore
    }
  });

  it("scanDangerousPayload 拒 HTML／GIF+script", () => {
    const html = new TextEncoder().encode("<!doctype html><script>x</script>");
    expect(scanDangerousPayload(html)).toBe("text/html");
    const enc = new TextEncoder();
    const script = enc.encode("<script>");
    const gif = new Uint8Array(6 + script.length);
    gif.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 0);
    gif.set(script, 6);
    expect(scanDangerousPayload(gif)).toBe("polyglot-script");
  });

  it("CachedScanner 包装假引擎可 scan", async () => {
    const cached = createCachedScanner(new FakeScanner(), { maxSize: 8 });
    const ok = await cached.scan(fixturePng(), "a.png");
    expect(ok.safe).toBe(true);
    const mz = await cached.scan(new Uint8Array([0x4d, 0x5a]), "x.bin");
    expect(mz.safe).toBe(false);
  });

  it("MemoryStateStore + ResumableUploader 可构造／cleanup", async () => {
    const base = join(TMP, "resumable");
    await mkdir(base, { recursive: true });
    const store = new MemoryStateStore();
    await store.cleanup(0);
    const uploader = createResumableUploader({
      storage: createLocalCloudStorageAdapter({ baseDir: base }),
      stateStore: store,
      stateExpiry: 1000,
    });
    expect(uploader).toBeTruthy();
    await uploader.cleanup();
  });

  it("complete 头校验 + onEvent + error code + session cleanup", async () => {
    const base = join(TMP, "perf-" + Date.now());
    await mkdir(base, { recursive: true });
    const storage = createLocalCloudStorageAdapter({ baseDir: base });
    const events: string[] = [];
    const handler = new MultipartUploadHandler({
      storage,
      sessionTtlMs: 50,
      sessionCleanupIntervalMs: 0,
      verifyContentHeadBytes: 1024,
      onEvent: (e) => events.push(e.type),
      authenticate: () => ({ userId: "u1" }),
    });

    const init = await handler.handleInit(
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
    expect(init.status).toBe(200);
    const { uploadId } = await init.json() as { uploadId: string };

    const fd = new FormData();
    fd.append("uploadId", uploadId);
    fd.append("index", "0");
    fd.append("file", new Blob([fixturePng().slice()]), "a.png");
    const chunk = await handler.handleChunk(
      new Request("http://localhost/upload/chunk", {
        method: "POST",
        body: fd,
      }),
    );
    expect(chunk.status).toBe(200);
    const { etag } = await chunk.json() as { etag: string };

    const complete = await handler.handleComplete(
      new Request("http://localhost/upload/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          uploadId,
          chunks: [{ index: 0, etag }],
        }),
      }),
    );
    expect(complete.status).toBe(200);
    expect(events.includes("init")).toBe(true);
    expect(events.includes("chunk")).toBe(true);
    expect(events.includes("complete")).toBe(true);

    const bare = new MultipartUploadHandler({
      storage: createLocalCloudStorageAdapter({ baseDir: join(base, "b") }),
      sessionCleanupIntervalMs: 0,
    });
    const unauth = await bare.handleInit(
      new Request("http://localhost/upload/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: "a.png",
          fileSize: 1,
          chunks: 1,
        }),
      }),
    );
    expect(unauth.status).toBe(401);
    const body = await unauth.json() as { code?: string };
    expect(body.code).toBe(UploadErrorCode.UNAUTHORIZED);
    bare.dispose();

    const short = new MultipartUploadHandler({
      storage: createLocalCloudStorageAdapter({ baseDir: join(base, "c") }),
      authenticate: () => ({ userId: "u" }),
      sessionTtlMs: 1,
      sessionCleanupIntervalMs: 0,
    });
    const i2 = await short.handleInit(
      new Request("http://localhost/upload/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: "b.png",
          fileSize: 10,
          chunks: 1,
          mimeType: "image/png",
        }),
      }),
    );
    expect(i2.status).toBe(200);
    await new Promise((r) => setTimeout(r, 20));
    const cleaned = short.cleanupExpiredSessions();
    expect(cleaned).toBeGreaterThanOrEqual(1);
    short.dispose();
    handler.dispose();
  });

  it("local-cloud append 合并 + uploadStream／downloadStream", async () => {
    const base = join(TMP, "append-" + Date.now());
    await mkdir(base, { recursive: true });
    const storage = createLocalCloudStorageAdapter({ baseDir: base });
    const key = "big/merge.bin";
    const init = await storage.initiateMultipartUpload(key);
    const p1 = new TextEncoder().encode("AAA");
    const p2 = new TextEncoder().encode("BBB");
    const r1 = await storage.uploadPart(key, init.uploadId, 1, p1);
    const r2 = await storage.uploadPart(key, init.uploadId, 2, p2);
    await storage.completeMultipartUpload(key, init.uploadId, [
      { partNumber: 1, etag: r1.etag },
      { partNumber: 2, etag: r2.etag },
    ]);
    const merged = await storage.download(key);
    expect(new TextDecoder().decode(merged)).toBe("AAABBB");

    const streamKey = "stream/out.bin";
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode("hello-stream"));
        c.close();
      },
    });
    await storage.uploadStream!(streamKey, body);
    const rs = await storage.downloadStream!(streamKey);
    const reader = rs.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const out = new Uint8Array(total);
    let o = 0;
    for (const c of chunks) {
      out.set(c, o);
      o += c.length;
    }
    expect(new TextDecoder().decode(out)).toBe("hello-stream");
  });

  it("AbortSignal 短路 → ABORTED", async () => {
    const base = join(TMP, "abort-" + Date.now());
    await mkdir(base, { recursive: true });
    const handler = new MultipartUploadHandler({
      storage: createLocalCloudStorageAdapter({ baseDir: base }),
      authenticate: () => ({ userId: "u" }),
      sessionCleanupIntervalMs: 0,
    });
    const ac = new AbortController();
    ac.abort();
    const res = await handler.handleInit(
      new Request("http://localhost/upload/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: "a.png",
          fileSize: 1,
          chunks: 1,
        }),
        signal: ac.signal,
      }),
    );
    expect(res.status).toBe(499);
    const j = await res.json() as { code?: string };
    expect(j.code).toBe(UploadErrorCode.ABORTED);
    handler.dispose();
  });
});
