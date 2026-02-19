/**
 * @fileoverview 分片上传测试
 *
 * 测试 MultipartUploader 的功能
 *
 * 运行测试：
 * deno test -A tests/multipart.test.ts
 */

import { beforeAll, describe, expect, it } from "@dreamer/test";
import {
  calculatePartSize,
  createMultipartUploader,
  MultipartUploader,
} from "../src/multipart.ts";
import { createS3Adapter } from "../src/adapters/s3.ts";

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

/** 测试文件内容 - 15MB */
const TEST_FILE_SIZE = 15 * 1024 * 1024;
const TEST_LARGE_FILE = new Uint8Array(TEST_FILE_SIZE).fill(65);

/** 是否 MinIO 可用 */
let minioAvailable = false;

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 生成唯一的测试键
 */
function generateTestKey(prefix: string): string {
  return `multipart-${prefix}-${Date.now()}-${
    Math.random().toString(36).slice(2)
  }`;
}

/**
 * 检查 MinIO 是否可用
 */
async function checkMinioAvailable(): Promise<boolean> {
  try {
    const response = await fetch(
      `${TEST_S3_CONFIG.endpoint}/minio/health/live`,
      {
        signal: AbortSignal.timeout(3000),
      },
    );
    // 消费响应体以避免资源泄漏
    await response.text();
    return response.ok;
  } catch {
    return false;
  }
}

// ============================================================================
// 分片上传测试
// ============================================================================

describe("MultipartUploader 测试", () => {
  beforeAll(async () => {
    minioAvailable = await checkMinioAvailable();
    if (minioAvailable) {
      console.log("✅ MinIO 可用，开始分片上传测试");
    } else {
      console.log("⚠️ MinIO 不可用，跳过需要连接的测试");
    }
  });

  // ============================================================================
  // 工具函数测试
  // ============================================================================

  describe("工具函数", () => {
    it("应该正确计算推荐分片大小", () => {
      // calculatePartSize 返回合适的分片大小
      const partSize = calculatePartSize(50 * 1024 * 1024);
      expect(partSize).toBeGreaterThan(0);
      expect(partSize).toBeLessThanOrEqual(100 * 1024 * 1024);
    });

    it("应该能创建 MultipartUploader 实例", () => {
      const uploader = createMultipartUploader({
        partSize: 5 * 1024 * 1024,
        concurrency: 3,
      });

      expect(uploader).toBeDefined();
      expect(uploader).toBeInstanceOf(MultipartUploader);
    });

    it("应该正确计算分片", () => {
      const uploader = new MultipartUploader({
        partSize: 5 * 1024 * 1024,
      });

      // 使用反射访问私有方法进行测试
      // deno-lint-ignore no-explicit-any
      const parts = (uploader as any).calculateParts(
        15 * 1024 * 1024,
        5 * 1024 * 1024,
      );

      expect(parts.length).toBe(3);
      expect(parts[0].partNumber).toBe(1);
      expect(parts[0].size).toBe(5 * 1024 * 1024);
      expect(parts[2].partNumber).toBe(3);
    });
  });

  // ============================================================================
  // 上传功能测试
  // ============================================================================

  describe("上传功能", () => {
    it("应该能完成分片上传", async () => {
      if (!minioAvailable) return;

      const adapter = createS3Adapter(TEST_S3_CONFIG);
      const uploader = createMultipartUploader({
        partSize: 5 * 1024 * 1024,
        concurrency: 2,
        retries: 3,
      });

      const key = generateTestKey("upload");
      let progressCalled = false;
      let stateChangeCalled = false;

      const result = await uploader.upload({
        file: TEST_LARGE_FILE,
        key,
        storage: adapter,
        onProgress: (progress) => {
          progressCalled = true;
          expect(progress.percentage).toBeGreaterThanOrEqual(0);
          expect(progress.percentage).toBeLessThanOrEqual(100);
        },
        onStateChange: (state) => {
          stateChangeCalled = true;
          expect(state.uploadId).toBeDefined();
        },
      });

      expect(result.success).toBe(true);
      expect(result.size).toBe(TEST_FILE_SIZE);
      expect(result.partCount).toBe(3);
      expect(progressCalled).toBe(true);
      expect(stateChangeCalled).toBe(true);

      // 验证文件存在
      const exists = await adapter.exists(key);
      expect(exists).toBe(true);

      // 清理
      await adapter.delete(key);
    }, { timeout: 30000 });

    it("应该能取消分片上传", async () => {
      const adapter = createS3Adapter(TEST_S3_CONFIG);
      const uploader = createMultipartUploader({
        partSize: 5 * 1024 * 1024,
      });

      const key = generateTestKey("abort");

      // 初始化上传获取状态
      const initResult = await adapter.initiateMultipartUpload(key);

      // 模拟部分上传状态
      const state = {
        uploadId: initResult.uploadId,
        key,
        fileSize: TEST_FILE_SIZE,
        partSize: 5 * 1024 * 1024,
        parts: [
          {
            partNumber: 1,
            start: 0,
            end: 5 * 1024 * 1024,
            size: 5 * 1024 * 1024,
            status: "completed" as const,
            etag: "test",
          },
        ],
        startTime: Date.now(),
        options: {},
      };

      // 取消上传
      await uploader.abort(adapter, state);

      // 验证文件不存在
      const exists = await adapter.exists(key);
      expect(exists).toBe(false);
    });

    it("应该支持进度回调", async () => {
      if (!minioAvailable) return;

      const adapter = createS3Adapter(TEST_S3_CONFIG);
      const uploader = createMultipartUploader({
        partSize: 5 * 1024 * 1024,
        concurrency: 1, // 串行上传以便观察进度
      });

      const key = generateTestKey("progress");
      const progressValues: number[] = [];

      await uploader.upload({
        file: TEST_LARGE_FILE,
        key,
        storage: adapter,
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

      // 清理
      await adapter.delete(key);
    }, { timeout: 30000 });
  });
}, { sanitizeOps: false, sanitizeResources: false });
