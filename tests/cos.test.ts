/**
 * @fileoverview COS 适配器测试
 *
 * 使用 MinIO（S3 兼容模式）测试 COS 适配器功能
 *
 * 运行测试前确保 MinIO 已启动：
 * docker run -d --name minio -p 19000:9000 -p 19001:9001 \
 *   -e MINIO_ROOT_USER=root \
 *   -e MINIO_ROOT_PASSWORD=88662310 \
 *   minio/minio server /data --console-address ":9001"
 *
 * 运行测试：
 * deno test -A tests/cos.test.ts
 */

import { beforeAll, describe, expect, it } from "@dreamer/test";
import { createCOSAdapter } from "../src/adapters/cos.ts";

// ============================================================================
// 测试配置
// ============================================================================

/**
 * MinIO 测试配置（S3 兼容模式）
 * 使用 useS3Compatible: true 启用 S3 签名，从而可以连接 MinIO
 */
const TEST_CONFIG = {
  bucket: "test-bucket",
  region: "us-east-1",
  secretId: "root",
  secretKey: "88662310",
  endpoint: "http://localhost:19000",
  useS3Compatible: true, // 启用 S3 兼容模式
  forcePathStyle: true, // MinIO 需要路径风格
};

/** 测试文件内容 */
const TEST_CONTENT = new TextEncoder().encode("Hello, COS via MinIO!");
const TEST_LARGE_CONTENT = new Uint8Array(10 * 1024 * 1024).fill(67); // 10MB 的 'C'

/** 是否 MinIO 可用 */
let minioAvailable = false;

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 生成唯一的测试键
 *
 * @param prefix - 前缀
 * @returns 唯一键
 */
function generateTestKey(prefix: string): string {
  return `cos-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * 检查 MinIO 是否可用
 *
 * @returns 是否可用
 */
async function checkMinioAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${TEST_CONFIG.endpoint}/minio/health/live`, {
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
 * 创建测试存储桶
 */
async function createTestBucket(): Promise<void> {
  const adapter = createCOSAdapter(TEST_CONFIG);
  try {
    // 尝试上传一个测试文件来验证桶是否存在
    await adapter.upload("__test_cos__", new Uint8Array([1]));
    await adapter.delete("__test_cos__");
  } catch {
    // 桶可能不存在，这里不处理，让测试自己失败
  }
}

// ============================================================================
// COS 适配器测试（使用 MinIO S3 兼容模式）
// ============================================================================

describe("COS 适配器测试（MinIO S3 兼容模式）", () => {
  // 测试前检查 MinIO 是否可用
  beforeAll(async () => {
    minioAvailable = await checkMinioAvailable();
    if (minioAvailable) {
      await createTestBucket();
      console.log("✅ MinIO 可用，开始 COS 适配器测试");
    } else {
      console.log("⚠️ MinIO 不可用，跳过需要连接的测试");
    }
  });

  describe("基础功能", () => {
    it("应该能创建适配器实例", () => {
      const adapter = createCOSAdapter(TEST_CONFIG);
      expect(adapter).toBeDefined();
      expect(adapter.getBucket()).toBe(TEST_CONFIG.bucket);
      expect(adapter.getRegion()).toBe(TEST_CONFIG.region);
    });

    it("应该能上传和下载文件", async () => {
      if (!minioAvailable) return;

      const adapter = createCOSAdapter(TEST_CONFIG);
      const key = generateTestKey("upload-test.txt");

      // 上传文件
      await adapter.upload(key, TEST_CONTENT, {
        contentType: "text/plain",
      });

      // 下载文件
      const downloaded = await adapter.download(key);
      expect(new TextDecoder().decode(downloaded)).toBe(
        new TextDecoder().decode(TEST_CONTENT),
      );

      // 清理
      await adapter.delete(key);
    });

    it("应该能检查文件是否存在", async () => {
      if (!minioAvailable) return;

      const adapter = createCOSAdapter(TEST_CONFIG);
      const key = generateTestKey("exists-test.txt");

      // 文件不存在
      expect(await adapter.exists(key)).toBe(false);

      // 上传后存在
      await adapter.upload(key, TEST_CONTENT);
      expect(await adapter.exists(key)).toBe(true);

      // 清理
      await adapter.delete(key);
    });

    it("应该能获取文件元数据", async () => {
      if (!minioAvailable) return;

      const adapter = createCOSAdapter(TEST_CONFIG);
      const key = generateTestKey("metadata-test.txt");

      // 上传带元数据的文件
      await adapter.upload(key, TEST_CONTENT, {
        contentType: "text/plain",
        metadata: { author: "test" },
      });

      // 获取元数据
      const metadata = await adapter.getMetadata(key);
      expect(metadata).toBeDefined();
      expect(metadata?.contentLength).toBe(TEST_CONTENT.length);

      // 清理
      await adapter.delete(key);
    });

    it("应该能列出对象", async () => {
      if (!minioAvailable) return;

      const adapter = createCOSAdapter(TEST_CONFIG);
      const prefix = `cos-list-test-${Date.now()}`;
      const keys = [
        `${prefix}/file1.txt`,
        `${prefix}/file2.txt`,
        `${prefix}/file3.txt`,
      ];

      // 上传多个文件
      for (const key of keys) {
        await adapter.upload(key, TEST_CONTENT);
      }

      // 列出文件
      const result = await adapter.listObjects({ prefix });
      expect(result.objects.length).toBeGreaterThanOrEqual(3);

      // 清理
      for (const key of keys) {
        await adapter.delete(key);
      }
    });

    it("应该能生成预签名 URL", async () => {
      if (!minioAvailable) return;

      const adapter = createCOSAdapter(TEST_CONFIG);
      const key = generateTestKey("presigned-test.txt");

      // 上传文件
      await adapter.upload(key, TEST_CONTENT);

      // 生成预签名 URL（COS 原生签名，S3 兼容模式下可能不工作）
      // 注意：S3 兼容模式下预签名 URL 使用的是 COS 原生签名
      const url = await adapter.getPresignedUrl(key, {
        expiresIn: 3600,
        method: "GET",
      });
      expect(url).toContain(key);

      // 清理
      await adapter.delete(key);
    });
  });

  describe("分片上传", () => {
    it("应该能完成分片上传流程", async () => {
      if (!minioAvailable) return;

      const adapter = createCOSAdapter(TEST_CONFIG);
      const key = generateTestKey("multipart-test.bin");
      const partSize = 5 * 1024 * 1024; // 5MB

      // 初始化分片上传
      const { uploadId } = await adapter.initiateMultipartUpload(key, {
        contentType: "application/octet-stream",
      });
      expect(uploadId).toBeDefined();

      // 上传分片
      const parts = [];
      for (let i = 0; i < 2; i++) {
        const partData = TEST_LARGE_CONTENT.slice(
          i * partSize,
          (i + 1) * partSize,
        );
        const result = await adapter.uploadPart(key, uploadId, i + 1, partData);
        parts.push({ partNumber: result.partNumber, etag: result.etag });
      }

      // 列出分片
      const listResult = await adapter.listParts(key, uploadId);
      expect(listResult.parts.length).toBe(2);

      // 完成分片上传
      await adapter.completeMultipartUpload(key, uploadId, parts);

      // 验证文件存在
      expect(await adapter.exists(key)).toBe(true);

      // 清理
      await adapter.delete(key);
    }, { timeout: 30000 });

    it("应该能取消分片上传", async () => {
      if (!minioAvailable) return;

      const adapter = createCOSAdapter(TEST_CONFIG);
      const key = generateTestKey("abort-test.bin");

      // 初始化分片上传
      const { uploadId } = await adapter.initiateMultipartUpload(key);

      // 上传一个分片
      const partData = TEST_LARGE_CONTENT.slice(0, 5 * 1024 * 1024);
      await adapter.uploadPart(key, uploadId, 1, partData);

      // 取消上传
      await adapter.abortMultipartUpload(key, uploadId);

      // 文件不应该存在
      expect(await adapter.exists(key)).toBe(false);
    });
  });
}, { sanitizeOps: false, sanitizeResources: false });
