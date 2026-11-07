/**
 * @fileoverview virusScan 开关：默认关；enable 时 complete 全量杀毒可拒传
 *
 * 运行：deno test -A tests/virus-scan.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from "@dreamer/test";
import { makeTempDir, mkdir, remove } from "@dreamer/runtime-adapter";
import { join } from "@dreamer/runtime-adapter";
import { createLocalCloudStorageAdapter } from "../src/adapters/local-cloud.ts";
import {
  MultipartUploadHandler,
  UploadErrorCode,
} from "../src/server/mod.ts";
import type {
  ScanResult,
  VirusScannerInterface,
} from "../src/scanner.ts";

let TMP = "";

async function ensureTmp(): Promise<void> {
  if (!TMP) TMP = await makeTempDir({ prefix: "upload-virus-" });
}

function fixturePng(): Uint8Array {
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
  ]);
}

class FakeScanner implements VirusScannerInterface {
  readonly name = "fake";
  constructor(
    private opts: {
      available?: boolean;
      safe?: boolean;
      threats?: string[];
      throwOnScan?: boolean;
    } = {},
  ) {}
  isAvailable(): Promise<boolean> {
    return Promise.resolve(this.opts.available ?? true);
  }
  scan(_content: Uint8Array, _filename?: string): Promise<ScanResult> {
    if (this.opts.throwOnScan) {
      return Promise.reject(new Error("scan boom"));
    }
    const safe = this.opts.safe ?? true;
    return Promise.resolve({
      safe,
      threats: safe ? [] : (this.opts.threats ?? ["EICAR-FAKE"]),
      engine: this.name,
      duration: 0,
      scannedAt: new Date(),
    });
  }
}

async function uploadOne(
  handler: MultipartUploadHandler,
  bytes: Uint8Array,
  filename = "a.png",
): Promise<{ complete: Response; key?: string }> {
  const init = await handler.handleInit(
    new Request("http://localhost/upload/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename,
        fileSize: bytes.length,
        chunks: 1,
        mimeType: "image/png",
      }),
    }),
  );
  expect(init.status).toBe(200);
  const { uploadId, key } = await init.json() as {
    uploadId: string;
    key: string;
  };

  const fd = new FormData();
  fd.append("uploadId", uploadId);
  fd.append("index", "0");
  fd.append("file", new Blob([bytes.slice()]), filename);
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
  return { complete, key };
}

describe("virusScan on complete", () => {
  beforeAll(async () => {
    await ensureTmp();
  });

  afterAll(async () => {
    if (!TMP) return;
    try {
      await remove(TMP, { recursive: true });
    } catch {
      /* ignore */
    }
  });

  it("默认关：不扫即可 complete 200", async () => {
    const base = join(TMP, "off-" + Date.now());
    await mkdir(base, { recursive: true });
    const storage = createLocalCloudStorageAdapter({ baseDir: base });
    const handler = new MultipartUploadHandler({
      storage,
      authenticate: () => ({ userId: "u" }),
      sessionCleanupIntervalMs: 0,
      // virusScan omitted → off
    });
    const { complete, key } = await uploadOne(handler, fixturePng());
    expect(complete.status).toBe(200);
    expect(key && await storage.exists(key!)).toBe(true);
    handler.dispose();
  });

  it("virusScan:false 显式关", async () => {
    const base = join(TMP, "false-" + Date.now());
    await mkdir(base, { recursive: true });
    const storage = createLocalCloudStorageAdapter({ baseDir: base });
    const handler = new MultipartUploadHandler({
      storage,
      authenticate: () => ({ userId: "u" }),
      sessionCleanupIntervalMs: 0,
      virusScan: false,
    });
    const { complete } = await uploadOne(handler, fixturePng());
    expect(complete.status).toBe(200);
    handler.dispose();
  });

  it("enable 缺省 false：{ host } 不扫", async () => {
    const base = join(TMP, "enable-default-" + Date.now());
    await mkdir(base, { recursive: true });
    const storage = createLocalCloudStorageAdapter({ baseDir: base });
    let scanned = 0;
    const handler = new MultipartUploadHandler({
      storage,
      authenticate: () => ({ userId: "u" }),
      sessionCleanupIntervalMs: 0,
      virusScan: {
        // enable omitted → off
        scanner: {
          name: "count",
          isAvailable: () => Promise.resolve(true),
          scan: () => {
            scanned++;
            return Promise.resolve({
              safe: true,
              threats: [],
              engine: "count",
              duration: 0,
              scannedAt: new Date(),
            });
          },
        },
      },
    });
    const { complete } = await uploadOne(handler, fixturePng());
    expect(complete.status).toBe(200);
    expect(scanned).toBe(0);
    handler.dispose();
  });

  it("enable+safe → 200", async () => {
    const base = join(TMP, "safe-" + Date.now());
    await mkdir(base, { recursive: true });
    const storage = createLocalCloudStorageAdapter({ baseDir: base });
    const handler = new MultipartUploadHandler({
      storage,
      authenticate: () => ({ userId: "u" }),
      sessionCleanupIntervalMs: 0,
      virusScan: { enable: true, scanner: new FakeScanner({ safe: true }) },
    });
    const { complete, key } = await uploadOne(handler, fixturePng());
    expect(complete.status).toBe(200);
    expect(key && await storage.exists(key!)).toBe(true);
    handler.dispose();
  });

  it("enable+威胁 → 422 删对象", async () => {
    const base = join(TMP, "threat-" + Date.now());
    await mkdir(base, { recursive: true });
    const storage = createLocalCloudStorageAdapter({ baseDir: base });
    const handler = new MultipartUploadHandler({
      storage,
      authenticate: () => ({ userId: "u" }),
      sessionCleanupIntervalMs: 0,
      virusScan: {
        enable: true,
        scanner: new FakeScanner({
          safe: false,
          threats: ["EICAR-FAKE"],
        }),
      },
    });
    const { complete, key } = await uploadOne(handler, fixturePng());
    expect(complete.status).toBe(422);
    const body = await complete.json() as {
      code?: string;
      threats?: string[];
    };
    expect(body.code).toBe(UploadErrorCode.CONTENT_REJECTED);
    expect(body.threats).toContain("EICAR-FAKE");
    expect(key && await storage.exists(key!)).toBe(false);
    handler.dispose();
  });

  it("enable+required+引擎不可用 → 422", async () => {
    const base = join(TMP, "down-req-" + Date.now());
    await mkdir(base, { recursive: true });
    const storage = createLocalCloudStorageAdapter({ baseDir: base });
    const handler = new MultipartUploadHandler({
      storage,
      authenticate: () => ({ userId: "u" }),
      sessionCleanupIntervalMs: 0,
      virusScan: {
        enable: true,
        required: true,
        scanner: new FakeScanner({ available: false }),
      },
    });
    const { complete, key } = await uploadOne(handler, fixturePng());
    expect(complete.status).toBe(422);
    const body = await complete.json() as { code?: string; error?: string };
    expect(body.code).toBe(UploadErrorCode.CONTENT_REJECTED);
    expect(String(body.error)).toMatch(/unavailable/i);
    expect(key && await storage.exists(key!)).toBe(false);
    handler.dispose();
  });

  it("enable+required=false+引擎不可用 → 200 降级", async () => {
    const base = join(TMP, "down-degrade-" + Date.now());
    await mkdir(base, { recursive: true });
    const storage = createLocalCloudStorageAdapter({ baseDir: base });
    const handler = new MultipartUploadHandler({
      storage,
      authenticate: () => ({ userId: "u" }),
      sessionCleanupIntervalMs: 0,
      virusScan: {
        enable: true,
        required: false,
        scanner: new FakeScanner({ available: false }),
      },
    });
    const { complete, key } = await uploadOne(handler, fixturePng());
    expect(complete.status).toBe(200);
    expect(key && await storage.exists(key!)).toBe(true);
    handler.dispose();
  });

  it("enable+required+scan 抛错 → 422", async () => {
    const base = join(TMP, "throw-" + Date.now());
    await mkdir(base, { recursive: true });
    const storage = createLocalCloudStorageAdapter({ baseDir: base });
    const handler = new MultipartUploadHandler({
      storage,
      authenticate: () => ({ userId: "u" }),
      sessionCleanupIntervalMs: 0,
      virusScan: {
        enable: true,
        required: true,
        scanner: new FakeScanner({ throwOnScan: true }),
      },
    });
    const { complete, key } = await uploadOne(handler, fixturePng());
    expect(complete.status).toBe(422);
    expect(key && await storage.exists(key!)).toBe(false);
    handler.dispose();
  });
});
