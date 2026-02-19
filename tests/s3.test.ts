/**
 * @fileoverview S3 适配器测试
 *
 * 使用 MinIO 测试 S3 兼容存储功能
 *
 * 运行测试前确保 MinIO 已启动：
 * docker run -d --name minio -p 19000:9000 -p 19001:9001 \
 *   -e MINIO_ROOT_USER=minioadmin \
 *   -e MINIO_ROOT_PASSWORD=minioadmin \
 *   minio/minio server /data --console-address ":9001"
 *
 * 运行测试：
 * deno test -A tests/s3.test.ts
 */

import { beforeAll, describe, expect, it } from "@dreamer/test";
import { createS3Adapter } from "../src/adapters/s3.ts";

// ============================================================================
// 测试配置
// ============================================================================

/** MinIO 测试配置 */
const TEST_CONFIG = {
  bucket: "test-bucket",
  region: "us-east-1",
  accessKeyId: "root",
  secretAccessKey: "88662310",
  endpoint: "http://localhost:19000",
  forcePathStyle: true, // MinIO 需要路径风格
};

/** 测试文件内容 */
const TEST_CONTENT = new TextEncoder().encode("Hello, MinIO!");
const TEST_LARGE_CONTENT = new Uint8Array(10 * 1024 * 1024).fill(65); // 10MB 的 'A'

/** 是否 MinIO 可用 */
let minioAvailable = false;

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 生成唯一的测试键
 */
function generateTestKey(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * 检查 MinIO 是否可用
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
  const adapter = createS3Adapter(TEST_CONFIG);
  try {
    // 尝试上传一个测试文件来验证桶是否存在
    await adapter.upload("__test__", new Uint8Array([1]));
    await adapter.delete("__test__");
  } catch {
    // 桶可能不存在，这里不处理，让测试自己失败
  }
}

// ============================================================================
// S3 适配器测试
// ============================================================================

describe("S3 适配器测试（MinIO）", () => {
  // 测试前检查 MinIO 是否可用
  beforeAll(async () => {
    minioAvailable = await checkMinioAvailable();
    if (minioAvailable) {
      await createTestBucket();
      console.log("✅ MinIO 可用，开始测试");
    } else {
      console.log("⚠️ MinIO 不可用，跳过需要连接的测试");
    }
  });

  // ============================================================================
  // 基础功能测试
  // ============================================================================

  describe("基础功能", () => {
    it("应该能创建适配器实例", () => {
      const adapter = createS3Adapter(TEST_CONFIG);
      expect(adapter).toBeDefined();
      expect(adapter.getBucket()).toBe(TEST_CONFIG.bucket);
      expect(adapter.getRegion()).toBe(TEST_CONFIG.region);
    });

    it("应该能上传和下载文件", async () => {
      if (!minioAvailable) return; // 跳过测试

      const adapter = createS3Adapter(TEST_CONFIG);
      const key = generateTestKey("test-file.txt");

      // 上传文件
      await adapter.upload(key, TEST_CONTENT, {
        contentType: "text/plain",
      });

      // 下载文件
      const downloaded = await adapter.download(key);
      expect(downloaded).toEqual(TEST_CONTENT);

      // 清理
      await adapter.delete(key);
    });

    it("应该能检查文件是否存在", async () => {
      if (!minioAvailable) return;
      const adapter = createS3Adapter(TEST_CONFIG);
      const key = generateTestKey("exists-test.txt");

      // 文件不存在
      const existsBefore = await adapter.exists(key);
      expect(existsBefore).toBe(false);

      // 上传后存在
      await adapter.upload(key, TEST_CONTENT);
      const existsAfter = await adapter.exists(key);
      expect(existsAfter).toBe(true);

      // 删除后不存在
      await adapter.delete(key);
      const existsDeleted = await adapter.exists(key);
      expect(existsDeleted).toBe(false);
    });

    it("应该能获取文件元数据", async () => {
      if (!minioAvailable) return;
      const adapter = createS3Adapter(TEST_CONFIG);
      const key = generateTestKey("metadata-test.txt");

      // 上传带元数据的文件
      await adapter.upload(key, TEST_CONTENT, {
        contentType: "text/plain",
        metadata: {
          "custom-key": "custom-value",
        },
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
      const adapter = createS3Adapter(TEST_CONFIG);
      const prefix = `list-test-${Date.now()}`;
      const keys = [
        `${prefix}/file1.txt`,
        `${prefix}/file2.txt`,
        `${prefix}/subdir/file3.txt`,
      ];

      // 上传多个文件
      for (const key of keys) {
        await adapter.upload(key, TEST_CONTENT);
      }

      // 列出所有文件
      const result = await adapter.listObjects({ prefix });
      expect(result.objects.length).toBeGreaterThanOrEqual(3);

      // 清理
      for (const key of keys) {
        await adapter.delete(key);
      }
    });

    it("应该能复制对象", async () => {
      if (!minioAvailable) return;
      const adapter = createS3Adapter(TEST_CONFIG);
      const sourceKey = generateTestKey("copy-source.txt");
      const destKey = generateTestKey("copy-dest.txt");

      // 上传源文件
      await adapter.upload(sourceKey, TEST_CONTENT);

      // 复制文件
      await adapter.copy(sourceKey, destKey);

      // 验证复制
      const copied = await adapter.download(destKey);
      expect(copied).toEqual(TEST_CONTENT);

      // 清理
      await adapter.delete(sourceKey);
      await adapter.delete(destKey);
    });

    it("应该能生成预签名 URL", async () => {
      if (!minioAvailable) return;
      const adapter = createS3Adapter(TEST_CONFIG);
      const key = generateTestKey("presigned-test.txt");

      // 上传文件
      await adapter.upload(key, TEST_CONTENT);

      // 生成预签名 URL
      const url = await adapter.getPresignedUrl(key, {
        expiresIn: 3600,
        method: "GET",
      });

      expect(url).toBeDefined();
      expect(url).toContain("X-Amz-Signature");

      // 清理
      await adapter.delete(key);
    });
  });

  // ============================================================================
  // 分片上传测试
  // ============================================================================

  describe("分片上传", () => {
    it("应该能完成分片上传流程", async () => {
      if (!minioAvailable) return;
      const adapter = createS3Adapter(TEST_CONFIG);
      const key = generateTestKey("multipart-test.bin");

      // 初始化分片上传
      const initResult = await adapter.initiateMultipartUpload(key, {
        contentType: "application/octet-stream",
      });
      expect(initResult.uploadId).toBeDefined();
      expect(initResult.key).toBe(key);

      // 上传分片（分成 2 个 5MB 的分片）
      const partSize = 5 * 1024 * 1024;
      const parts: Array<{ partNumber: number; etag: string }> = [];

      for (let i = 0; i < 2; i++) {
        const partData = TEST_LARGE_CONTENT.slice(
          i * partSize,
          (i + 1) * partSize,
        );
        const result = await adapter.uploadPart(
          key,
          initResult.uploadId,
          i + 1,
          partData,
        );
        parts.push({ partNumber: result.partNumber, etag: result.etag });
      }

      // 列出已上传的分片
      const listResult = await adapter.listParts(key, initResult.uploadId);
      expect(listResult.parts.length).toBe(2);

      // 完成分片上传
      await adapter.completeMultipartUpload(key, initResult.uploadId, parts);

      // 验证上传结果
      const downloaded = await adapter.download(key);
      expect(downloaded.length).toBe(TEST_LARGE_CONTENT.length);

      // 清理
      await adapter.delete(key);
    });

    it("应该能取消分片上传", async () => {
      if (!minioAvailable) return;
      const adapter = createS3Adapter(TEST_CONFIG);
      const key = generateTestKey("abort-multipart-test.bin");

      // 初始化分片上传
      const initResult = await adapter.initiateMultipartUpload(key);

      // 上传一个分片
      const partData = new Uint8Array(5 * 1024 * 1024).fill(66);
      await adapter.uploadPart(key, initResult.uploadId, 1, partData);

      // 取消上传
      await adapter.abortMultipartUpload(key, initResult.uploadId);

      // 验证文件不存在
      const exists = await adapter.exists(key);
      expect(exists).toBe(false);
    });
  });
}, { sanitizeOps: false, sanitizeResources: false });
