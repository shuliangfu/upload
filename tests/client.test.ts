/**
 * @fileoverview 上传客户端测试
 *
 * 测试 UploadClient 的功能，配合 MultipartUploadHandler 进行完整流程测试
 *
 * 运行测试：
 * deno test -A tests/client.test.ts
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
} from "@dreamer/test";
import {
  UploadClient,
  createUploadClient,
  formatSize,
  calculateFileHash,
} from "../src/client/mod.ts";
import { MultipartUploadHandler } from "../src/server/mod.ts";
import { createS3Adapter } from "../src/adapters/s3.ts";
import { serve, type ServeHandle } from "@dreamer/runtime-adapter";

// ============================================================================
// 测试配置
// ============================================================================

/** MinIO 测试配置 */
const TEST_S3_CONFIG = {
  bucket: "test-bucket",
  region: "us-east-1",
  accessKeyId: "root",
  secretAccessKey: "88662310",
  endpoint: "http://localhost:19000",
  forcePathStyle: true,
};

/** 测试服务器端口 */
const TEST_SERVER_PORT = 19998;

/** 测试服务器 URL */
const TEST_ENDPOINT = `http://localhost:${TEST_SERVER_PORT}/upload`;

/** 测试文件内容 - 11MB（跨越多个分片，满足 S3 最小分片 5MB 要求）
 * 分片配置：5MB 分片大小，产生 3 个分片（5MB + 5MB + 1MB）
 */
const TEST_FILE_SIZE = 11 * 1024 * 1024;
const TEST_FILE = new Uint8Array(TEST_FILE_SIZE).fill(68); // 'D'

/** 是否 MinIO 可用 */
let minioAvailable = false;

/** 测试服务器句柄 */
let serverHandle: ServeHandle | null = null;

/** S3 适配器 */
let adapter: ReturnType<typeof createS3Adapter> | null = null;

/** 上传处理器 */
let handler: MultipartUploadHandler | null = null;

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 生成唯一的测试键
 */
function generateTestKey(): string {
  return `client-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * 检查 MinIO 是否可用
 */
async function checkMinioAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${TEST_S3_CONFIG.endpoint}/minio/health/live`, {
      signal: AbortSignal.timeout(3000),
    });
    // 消费响应体以避免资源泄漏
    await response.text();
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * 检查端口是否已被占用
 * @param port 端口号
 * @returns 是否已被占用
 */
async function isPortInUse(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://localhost:${port}`, {
      signal: AbortSignal.timeout(500),
    });
    // 消费响应体以避免资源泄漏
    await response.text().catch(() => {});
    return true;
  } catch {
    return false;
  }
}

/**
 * 启动测试服务器
 * 使用 @dreamer/runtime-adapter 的 serve 函数进行跨运行时适配
 */
async function startTestServer(): Promise<void> {
  // 检查端口是否已被占用
  const portInUse = await isPortInUse(TEST_SERVER_PORT);
  if (portInUse) {
    console.log(`⚠️ 端口 ${TEST_SERVER_PORT} 已被占用，跳过服务器启动`);
    return;
  }

  adapter = createS3Adapter(TEST_S3_CONFIG);
  handler = new MultipartUploadHandler({
    storage: adapter,
    maxFileSize: 100 * 1024 * 1024,
    maxPartSize: 5 * 1024 * 1024,
    pathPrefix: "/upload",
  });

  // 使用 runtime-adapter 的 serve 函数进行跨运行时适配
  serverHandle = serve(
    { port: TEST_SERVER_PORT },
    async (request: Request) => {
      // 使用 /upload 作为基础路径
      const response = await handler!.handle(request, "/upload");
      if (response) return response;
      return new Response("Not Found", { status: 404 });
    }
  );

  // 等待服务器启动
  await new Promise((resolve) => setTimeout(resolve, 100));
}

/**
 * 停止测试服务器
 */
async function stopTestServer(): Promise<void> {
  if (serverHandle) {
    await serverHandle.shutdown();
    serverHandle = null;
  }
}

// ============================================================================
// 客户端测试
// ============================================================================

describe("UploadClient 测试", () => {
  beforeAll(async () => {
    minioAvailable = await checkMinioAvailable();
    if (minioAvailable) {
      await startTestServer();
      console.log("✅ MinIO 可用，测试服务器已启动");
    } else {
      console.log("⚠️ MinIO 不可用，跳过需要连接的测试");
    }
  });

  afterAll(async () => {
    await stopTestServer();
  });

  // ============================================================================
  // 工具函数测试
  // ============================================================================

  describe("工具函数", () => {
    it("应该正确格式化文件大小", () => {
      expect(formatSize(0)).toBe("0 B");
      expect(formatSize(1024)).toBe("1.00 KB");
      expect(formatSize(1024 * 1024)).toBe("1.00 MB");
      expect(formatSize(1024 * 1024 * 1024)).toBe("1.00 GB");
      expect(formatSize(512)).toBe("512.00 B");
    });

    it("应该能计算文件哈希", async () => {
      const data = new Uint8Array([1, 2, 3, 4, 5]);
      const hash = await calculateFileHash(data);
      
      expect(hash).toBeDefined();
      expect(hash.length).toBe(64); // SHA-256 哈希长度
      expect(/^[a-f0-9]+$/.test(hash)).toBe(true);
    });

    it("相同文件应该有相同哈希", async () => {
      const data1 = new Uint8Array([1, 2, 3, 4, 5]);
      const data2 = new Uint8Array([1, 2, 3, 4, 5]);
      
      const hash1 = await calculateFileHash(data1);
      const hash2 = await calculateFileHash(data2);
      
      expect(hash1).toBe(hash2);
    });

    it("不同文件应该有不同哈希", async () => {
      const data1 = new Uint8Array([1, 2, 3, 4, 5]);
      const data2 = new Uint8Array([5, 4, 3, 2, 1]);
      
      const hash1 = await calculateFileHash(data1);
      const hash2 = await calculateFileHash(data2);
      
      expect(hash1).not.toBe(hash2);
    });
  });

  // ============================================================================
  // 客户端实例测试
  // ============================================================================

  describe("客户端实例", () => {
    it("应该能创建客户端实例", () => {
      const client = createUploadClient({
        endpoint: TEST_ENDPOINT,
      });
      
      expect(client).toBeDefined();
      expect(client).toBeInstanceOf(UploadClient);
    });

    it("应该能使用自定义配置创建客户端", () => {
      const client = new UploadClient({
        endpoint: TEST_ENDPOINT,
        chunkSize: 10 * 1024 * 1024,
        concurrency: 5,
        retries: 5,
        timeout: 60000,
        headers: { "X-Custom": "value" },
        token: "test-token",
      });
      
      expect(client).toBeDefined();
    });

    it("应该能设置认证令牌", () => {
      const client = createUploadClient({
        endpoint: TEST_ENDPOINT,
      });
      
      client.setToken("new-token");
      // 验证不抛出错误
      expect(client).toBeDefined();
    });

    it("应该能设置自定义请求头", () => {
      const client = createUploadClient({
        endpoint: TEST_ENDPOINT,
      });
      
      client.setHeaders({ "X-Custom": "value" });
      // 验证不抛出错误
      expect(client).toBeDefined();
    });
  });

  // ============================================================================
  // 上传功能测试
  // ============================================================================

  describe("上传功能", () => {
    it("应该能完成小文件上传", async () => {
      if (!minioAvailable) return;

      const client = createUploadClient({
        endpoint: TEST_ENDPOINT,
        chunkSize: 5 * 1024 * 1024,
      });

      const smallFile = new Uint8Array(1024 * 100).fill(65); // 100KB
      const key = generateTestKey();

      const result = await client.upload(smallFile, {
        filename: `${key}.bin`,
        path: key,
      });

      expect(result.success).toBe(true);
      expect(result.size).toBe(smallFile.length);
      expect(result.filename).toBe(`${key}.bin`);
      expect(result.duration).toBeGreaterThan(0);
    }, { timeout: 30000 });

    it("应该能完成分片上传", async () => {
      if (!minioAvailable) return;

      const client = createUploadClient({
        endpoint: TEST_ENDPOINT,
        chunkSize: 5 * 1024 * 1024, // 5MB 分片（S3 最小分片大小要求）
        concurrency: 2,
      });

      const key = generateTestKey();
      let progressCalled = false;

      const result = await client.upload(TEST_FILE, {
        filename: `${key}.bin`,
        path: key,
        onProgress: (progress) => {
          progressCalled = true;
          expect(progress.percentage).toBeGreaterThanOrEqual(0);
          expect(progress.percentage).toBeLessThanOrEqual(100);
          expect(progress.totalChunks).toBeGreaterThan(1);
        },
      });

      expect(result.success).toBe(true);
      expect(result.size).toBe(TEST_FILE_SIZE);
      expect(progressCalled).toBe(true);
    }, { timeout: 60000 });

    it("应该能跟踪上传进度", async () => {
      if (!minioAvailable) return;

      const client = createUploadClient({
        endpoint: TEST_ENDPOINT,
        chunkSize: 5 * 1024 * 1024, // 5MB 分片（S3 最小分片大小要求）
        concurrency: 1, // 串行上传以便观察进度
      });

      const key = generateTestKey();
      const progressValues: number[] = [];

      await client.upload(TEST_FILE, {
        filename: `${key}.bin`,
        path: key,
        onProgress: (progress) => {
          progressValues.push(progress.percentage);
        },
      });

      // 验证进度是递增的
      for (let i = 1; i < progressValues.length; i++) {
        expect(progressValues[i]).toBeGreaterThanOrEqual(progressValues[i - 1]);
      }

      // 最终进度应该是 100%
      expect(progressValues[progressValues.length - 1]).toBe(100);
    }, { timeout: 60000 });

    it("应该能跟踪状态变化", async () => {
      if (!minioAvailable) return;

      const client = createUploadClient({
        endpoint: TEST_ENDPOINT,
        chunkSize: 5 * 1024 * 1024, // 5MB 分片（S3 最小分片大小要求）
      });

      const key = generateTestKey();
      let stateChangeCalled = false;

      await client.upload(TEST_FILE, {
        filename: `${key}.bin`,
        path: key,
        onStateChange: (state) => {
          stateChangeCalled = true;
          expect(state.id).toBeDefined();
          expect(state.filename).toBe(`${key}.bin`);
          expect(state.fileSize).toBe(TEST_FILE_SIZE);
        },
      });

      expect(stateChangeCalled).toBe(true);
    }, { timeout: 60000 });
  });

  // ============================================================================
  // 暂停/取消测试
  // ============================================================================

  describe("暂停和取消", () => {
    it("应该能取消上传", async () => {
      if (!minioAvailable) return;

      const client = createUploadClient({
        endpoint: TEST_ENDPOINT,
        chunkSize: 1 * 1024 * 1024, // 小分片以便有时间取消
        concurrency: 1,
      });

      const key = generateTestKey();
      let uploadId: string | undefined;

      // 启动上传并在进度回调中取消
      const uploadPromise = client.upload(TEST_FILE, {
        filename: `${key}.bin`,
        path: key,
        onStateChange: (state) => {
          uploadId = state.id;
          // 第一个分片开始后取消
          if (state.chunks.some((c) => c.status === "uploading")) {
            client.cancel(uploadId);
          }
        },
      });

      const result = await uploadPromise;

      // 取消后应该失败
      expect(result.success).toBe(false);
    }, { timeout: 30000 });
  });

  // ============================================================================
  // 清理功能测试
  // ============================================================================

  describe("清理功能", () => {
    it("应该能获取未完成的上传列表", async () => {
      const client = createUploadClient({
        endpoint: TEST_ENDPOINT,
        persistState: true,
      });

      // 初始状态应该为空或返回数组
      const pending = await client.getPendingUploads();
      expect(Array.isArray(pending)).toBe(true);
    });

    it("应该能清理过期状态", () => {
      const client = createUploadClient({
        endpoint: TEST_ENDPOINT,
        persistState: true,
      });

      // 不应该抛出错误
      client.cleanup(7 * 24 * 60 * 60 * 1000);
      expect(client).toBeDefined();
    });
  });
}, { sanitizeOps: false, sanitizeResources: false });
