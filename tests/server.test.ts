/**
 * @fileoverview 服务端分片上传处理器测试
 *
 * 测试 MultipartUploadHandler 的功能
 *
 * 运行测试：
 * deno test -A tests/server.test.ts
 */

import {
  describe,
  it,
  expect,
  beforeAll,
} from "@dreamer/test";
import {
  MultipartUploadHandler,
  createMultipartUploadHandler,
} from "../src/server/mod.ts";
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

/** 测试文件内容 */
const TEST_CONTENT = new TextEncoder().encode("Hello, Server Handler!");

/** 是否 MinIO 可用 */
let minioAvailable = false;

// ============================================================================
// 辅助函数
// ============================================================================

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
 * 创建测试 JSON 请求
 */
function createJsonRequest(
  url: string,
  method: string,
  body?: unknown,
): Request {
  return new Request(url, {
    method,
    headers: {
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

/**
 * 创建分片上传 FormData 请求
 */
function createChunkRequest(
  url: string,
  uploadId: string,
  key: string,
  index: number,
  data: Uint8Array,
): Request {
  const formData = new FormData();
  formData.append("uploadId", uploadId);
  formData.append("key", key);
  formData.append("index", index.toString());
  // 使用 slice() 避免 SharedArrayBuffer 类型问题
  formData.append("file", new Blob([data.slice()]), "chunk.bin");

  return new Request(url, {
    method: "POST",
    body: formData,
  });
}

// ============================================================================
// 服务端处理器测试
// ============================================================================

describe("MultipartUploadHandler 测试", () => {
  beforeAll(async () => {
    minioAvailable = await checkMinioAvailable();
    if (minioAvailable) {
      console.log("✅ MinIO 可用，开始服务端处理器测试");
    } else {
      console.log("⚠️ MinIO 不可用，跳过需要连接的测试");
    }
  });

  // ============================================================================
  // 基础功能测试
  // ============================================================================

  describe("基础功能", () => {
    it("应该能创建处理器实例", () => {
      const storage = createS3Adapter(TEST_S3_CONFIG);
      const handler = createMultipartUploadHandler({
        storage,
      });

      expect(handler).toBeDefined();
      expect(handler).toBeInstanceOf(MultipartUploadHandler);
    });

    it("应该拒绝缺少参数的初始化请求", async () => {
      const storage = createS3Adapter(TEST_S3_CONFIG);
      const handler = createMultipartUploadHandler({ storage });

      const request = createJsonRequest(
        "http://localhost/upload/init",
        "POST",
        { filename: "test.txt" }, // 缺少 fileSize 和 chunks
      );

      const response = await handler.handleInit(request);
      expect(response.status).toBe(400);

      const body = await response.json();
      expect(body.error).toContain("缺少必要参数");
    });

    it("应该拒绝超过大小限制的文件", async () => {
      const storage = createS3Adapter(TEST_S3_CONFIG);
      const handler = createMultipartUploadHandler({
        storage,
        maxFileSize: 1024, // 1KB 限制
      });

      const request = createJsonRequest(
        "http://localhost/upload/init",
        "POST",
        {
          filename: "large.bin",
          fileSize: 1024 * 1024, // 1MB
          chunks: 10,
        },
      );

      const response = await handler.handleInit(request);
      expect(response.status).toBe(400);

      const body = await response.json();
      expect(body.error).toContain("文件大小超过限制");
    });

    it("应该拒绝不支持的 MIME 类型", async () => {
      const storage = createS3Adapter(TEST_S3_CONFIG);
      const handler = createMultipartUploadHandler({
        storage,
        allowedMimeTypes: ["image/*"],
      });

      const request = createJsonRequest(
        "http://localhost/upload/init",
        "POST",
        {
          filename: "script.js",
          fileSize: 1024,
          chunks: 1,
          mimeType: "application/javascript",
        },
      );

      const response = await handler.handleInit(request);
      expect(response.status).toBe(400);

      const body = await response.json();
      expect(body.error).toContain("不支持的文件类型");
    });
  });

  // ============================================================================
  // 完整上传流程测试
  // ============================================================================

  describe("完整上传流程", () => {
    it("应该能完成初始化-上传-完成流程", async () => {
      if (!minioAvailable) return;

      const storage = createS3Adapter(TEST_S3_CONFIG);
      const handler = createMultipartUploadHandler({
        storage,
        pathPrefix: "test-uploads",
      });

      // 1. 初始化上传
      const initRequest = createJsonRequest(
        "http://localhost/upload/init",
        "POST",
        {
          filename: "test-file.txt",
          fileSize: TEST_CONTENT.length,
          chunks: 1,
          mimeType: "text/plain",
        },
      );

      const initResponse = await handler.handleInit(initRequest);
      expect(initResponse.status).toBe(200);

      const initBody = await initResponse.json();
      expect(initBody.uploadId).toBeDefined();
      expect(initBody.key).toBeDefined();

      const { uploadId, key } = initBody;

      // 2. 上传分片
      const chunkRequest = createChunkRequest(
        "http://localhost/upload/chunk",
        uploadId,
        key,
        0,
        TEST_CONTENT,
      );

      const chunkResponse = await handler.handleChunk(chunkRequest);
      expect(chunkResponse.status).toBe(200);

      const chunkBody = await chunkResponse.json();
      expect(chunkBody.index).toBe(0);
      expect(chunkBody.etag).toBeDefined();

      // 3. 完成上传
      const completeRequest = createJsonRequest(
        "http://localhost/upload/complete",
        "POST",
        {
          uploadId,
          key,
          filename: "test-file.txt",
          chunks: [
            { index: 0, etag: chunkBody.etag, size: TEST_CONTENT.length },
          ],
        },
      );

      const completeResponse = await handler.handleComplete(completeRequest);
      expect(completeResponse.status).toBe(200);

      const completeBody = await completeResponse.json();
      expect(completeBody.fileId).toBe(key);

      // 4. 验证文件存在
      const exists = await storage.exists(key);
      expect(exists).toBe(true);

      // 5. 清理
      await storage.delete(key);
    });

    it("应该能取消上传", async () => {
      if (!minioAvailable) return;

      const storage = createS3Adapter(TEST_S3_CONFIG);
      const handler = createMultipartUploadHandler({ storage });

      // 初始化上传
      const initRequest = createJsonRequest(
        "http://localhost/upload/init",
        "POST",
        {
          filename: "abort-test.txt",
          fileSize: 1024,
          chunks: 1,
        },
      );

      const initResponse = await handler.handleInit(initRequest);
      const { uploadId, key } = await initResponse.json();

      // 取消上传
      const abortRequest = createJsonRequest(
        "http://localhost/upload/abort",
        "POST",
        { uploadId, key },
      );

      const abortResponse = await handler.handleAbort(abortRequest);
      expect(abortResponse.status).toBe(200);

      const abortBody = await abortResponse.json();
      expect(abortBody.success).toBe(true);
    });
  });

  // ============================================================================
  // 统一路由处理测试
  // ============================================================================

  describe("统一路由处理", () => {
    it("应该正确路由 init 请求", async () => {
      const storage = createS3Adapter(TEST_S3_CONFIG);
      const handler = createMultipartUploadHandler({ storage });

      const request = createJsonRequest(
        "http://localhost/upload/init",
        "POST",
        { filename: "test.txt" },
      );

      const response = await handler.handle(request, "/upload");
      expect(response).not.toBeNull();
      // 缺少参数应该返回 400
      expect(response?.status).toBe(400);
    });

    it("应该对不匹配的路径返回 null", () => {
      const storage = createS3Adapter(TEST_S3_CONFIG);
      const handler = createMultipartUploadHandler({ storage });

      const request = new Request("http://localhost/other/path", {
        method: "POST",
      });

      const response = handler.handle(request, "/upload");
      expect(response).toBeNull();
    });

    it("应该正确处理自定义路径前缀", async () => {
      const storage = createS3Adapter(TEST_S3_CONFIG);
      const handler = createMultipartUploadHandler({ storage });

      const request = createJsonRequest(
        "http://localhost/api/v1/files/init",
        "POST",
        { filename: "test.txt" },
      );

      const response = await handler.handle(request, "/api/v1/files");
      expect(response).not.toBeNull();
    });
  });
}, { sanitizeOps: false, sanitizeResources: false });
