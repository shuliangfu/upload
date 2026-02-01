/**
 * @fileoverview StorageManager 测试
 *
 * 测试统一存储管理器的功能
 *
 * 运行测试：
 * deno test -A tests/storage-manager.test.ts
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  afterEach,
} from "@dreamer/test";
import { remove } from "@dreamer/runtime-adapter";
import {
  StorageManager,
  createStorageManager,
} from "../src/storage-manager.ts";

// ============================================================================
// 测试配置
// ============================================================================

/** 本地存储测试目录 */
const TEST_LOCAL_DIR = "./tests/data";

/** MinIO 测试配置 */
const TEST_S3_CONFIG = {
  bucket: "test-bucket",
  region: "us-east-1",
  accessKeyId: "root",
  secretAccessKey: "88662310",
  endpoint: "http://localhost:19000",
  forcePathStyle: true,
};

/** 测试文件内容 */
const TEST_CONTENT = new TextEncoder().encode("Hello, StorageManager!");

/** 是否 MinIO 可用 */
let minioAvailable = false;

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 生成唯一的测试键
 */
function generateTestKey(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`;
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
 * 清理测试目录
 */
async function cleanupTestDir(): Promise<void> {
  try {
    await remove(TEST_LOCAL_DIR, { recursive: true });
  } catch {
    // 忽略不存在的目录
  }
}

// ============================================================================
// StorageManager 测试
// ============================================================================

describe("StorageManager 测试", () => {
  beforeAll(async () => {
    minioAvailable = await checkMinioAvailable();
    if (minioAvailable) {
      console.log("✅ MinIO 可用");
    } else {
      console.log("⚠️ MinIO 不可用，只测试本地存储");
    }
  });

  afterAll(async () => {
    await cleanupTestDir();
  });

  // ============================================================================
  // 本地存储测试
  // ============================================================================

  describe("本地存储", () => {
    afterEach(async () => {
      await cleanupTestDir();
    });

    it("应该能创建本地存储管理器", () => {
      const manager = createStorageManager({
        type: "local",
        local: {
          baseDir: TEST_LOCAL_DIR,
          baseUrl: "/uploads",
        },
      });

      expect(manager).toBeDefined();
      expect(manager.getType()).toBe("local");
      expect(manager.isCloudStorage()).toBe(false);
    });

    it("应该能上传文件到本地", async () => {
      const manager = createStorageManager({
        type: "local",
        local: {
          baseDir: TEST_LOCAL_DIR,
          baseUrl: "/uploads",
        },
      });

      const key = generateTestKey("local-test");
      const result = await manager.upload(key, TEST_CONTENT, {
        contentType: "text/plain",
      });

      expect(result.key).toBe(key);
      expect(result.size).toBe(TEST_CONTENT.length);
      expect(result.storageType).toBe("local");
      expect(result.url).toContain("/uploads");
    });

    it("应该能下载本地文件", async () => {
      const manager = createStorageManager({
        type: "local",
        local: {
          baseDir: TEST_LOCAL_DIR,
          baseUrl: "/uploads",
        },
      });

      const key = generateTestKey("download-test");
      await manager.upload(key, TEST_CONTENT);

      const downloaded = await manager.download(key);
      expect(downloaded).toEqual(TEST_CONTENT);
    });

    it("应该能检查本地文件是否存在", async () => {
      const manager = createStorageManager({
        type: "local",
        local: {
          baseDir: TEST_LOCAL_DIR,
          baseUrl: "/uploads",
        },
      });

      const key = generateTestKey("exists-test");

      // 文件不存在
      const existsBefore = await manager.exists(key);
      expect(existsBefore).toBe(false);

      // 上传后存在
      await manager.upload(key, TEST_CONTENT);
      const existsAfter = await manager.exists(key);
      expect(existsAfter).toBe(true);
    });

    it("应该能删除本地文件", async () => {
      const manager = createStorageManager({
        type: "local",
        local: {
          baseDir: TEST_LOCAL_DIR,
          baseUrl: "/uploads",
        },
      });

      const key = generateTestKey("delete-test");
      await manager.upload(key, TEST_CONTENT);

      // 删除文件
      await manager.delete(key);

      // 验证已删除
      const exists = await manager.exists(key);
      expect(exists).toBe(false);
    });

    it("应该能列出本地文件", async () => {
      const manager = createStorageManager({
        type: "local",
        local: {
          baseDir: TEST_LOCAL_DIR,
          baseUrl: "/uploads",
        },
      });

      // 上传多个文件
      await manager.upload("file1.txt", TEST_CONTENT);
      await manager.upload("file2.txt", TEST_CONTENT);
      await manager.upload("file3.txt", TEST_CONTENT);

      // 列出文件
      const result = await manager.list();
      expect(result.objects.length).toBeGreaterThanOrEqual(3);
    });

    it("应该支持路径前缀", async () => {
      const manager = createStorageManager({
        type: "local",
        local: {
          baseDir: TEST_LOCAL_DIR,
          baseUrl: "/uploads",
        },
        pathPrefix: "images",
      });

      const result = await manager.upload("avatar.jpg", TEST_CONTENT);
      expect(result.key).toContain("images/");
    });

    it("应该支持自定义路径生成", async () => {
      const manager = createStorageManager({
        type: "local",
        local: {
          baseDir: TEST_LOCAL_DIR,
          baseUrl: "/uploads",
        },
        generatePath: (filename) => `custom/${Date.now()}/${filename}`,
      });

      const result = await manager.upload("test.txt", TEST_CONTENT);
      expect(result.key).toContain("custom/");
    });
  });

  // ============================================================================
  // S3 存储测试
  // ============================================================================

  describe("S3 存储", () => {
    it("应该能创建 S3 存储管理器", () => {
      if (!minioAvailable) return;

      const manager = createStorageManager({
        type: "s3",
        s3: TEST_S3_CONFIG,
      });

      expect(manager).toBeDefined();
      expect(manager.getType()).toBe("s3");
      expect(manager.isCloudStorage()).toBe(true);
    });

    it("应该能上传文件到 S3", async () => {
      if (!minioAvailable) return;

      const manager = createStorageManager({
        type: "s3",
        s3: TEST_S3_CONFIG,
      });

      const key = generateTestKey("s3-test");
      const result = await manager.upload(key, TEST_CONTENT, {
        contentType: "text/plain",
      });

      expect(result.key).toBe(key);
      expect(result.size).toBe(TEST_CONTENT.length);
      expect(result.storageType).toBe("s3");

      // 清理
      await manager.delete(key);
    });

    it("应该能下载 S3 文件", async () => {
      if (!minioAvailable) return;

      const manager = createStorageManager({
        type: "s3",
        s3: TEST_S3_CONFIG,
      });

      const key = generateTestKey("s3-download-test");
      await manager.upload(key, TEST_CONTENT);

      const downloaded = await manager.download(key);
      expect(downloaded).toEqual(TEST_CONTENT);

      // 清理
      await manager.delete(key);
    });

    it("应该能生成公开访问 URL", async () => {
      if (!minioAvailable) return;

      const manager = createStorageManager({
        type: "s3",
        s3: TEST_S3_CONFIG,
      });

      const key = generateTestKey("url-test");
      await manager.upload(key, TEST_CONTENT);

      const publicUrl = await manager.getUrl(key, { public: true });
      expect(publicUrl).toContain(TEST_S3_CONFIG.bucket);

      const presignedUrl = await manager.getUrl(key, { expiresIn: 3600 });
      expect(presignedUrl).toContain("X-Amz-Signature");

      // 清理
      await manager.delete(key);
    });
  });

  // ============================================================================
  // 配置验证测试
  // ============================================================================

  describe("配置验证", () => {
    it("缺少本地配置应该抛出错误", () => {
      expect(() => {
        new StorageManager({
          type: "local",
        });
      }).toThrow("本地存储配置缺失");
    });

    it("缺少 S3 配置应该抛出错误", () => {
      expect(() => {
        new StorageManager({
          type: "s3",
        });
      }).toThrow("S3 配置缺失");
    });

    it("缺少 OSS 配置应该抛出错误", () => {
      expect(() => {
        new StorageManager({
          type: "oss",
        });
      }).toThrow("OSS 配置缺失");
    });

    it("缺少 COS 配置应该抛出错误", () => {
      expect(() => {
        new StorageManager({
          type: "cos",
        });
      }).toThrow("COS 配置缺失");
    });
  });
}, { sanitizeOps: false, sanitizeResources: false });
