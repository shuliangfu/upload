/**
 * @fileoverview 分片上传示例
 *
 * 展示大文件分片上传功能
 */

import { formatFileSize } from "../src/mod.ts";

// ============================================================================
// 分片计算
// ============================================================================

console.log("=== 分片计算 ===\n");

/**
 * 计算文件分片
 *
 * @param fileSize - 文件大小
 * @param partSize - 分片大小
 * @returns 分片信息数组
 */
function calculateParts(fileSize: number, partSize: number) {
  const parts: Array<{ start: number; end: number; size: number }> = [];
  let start = 0;

  while (start < fileSize) {
    const end = Math.min(start + partSize, fileSize);
    parts.push({
      start,
      end,
      size: end - start,
    });
    start = end;
  }

  return parts;
}

const fileSize = 100 * 1024 * 1024; // 100MB
const partSize = 5 * 1024 * 1024;   // 5MB 每片

const parts = calculateParts(fileSize, partSize);

console.log(`文件大小: ${formatFileSize(fileSize)}`);
console.log(`分片大小: ${formatFileSize(partSize)}`);
console.log(`总分片数: ${parts.length}`);
console.log("\n分片详情:");
parts.slice(0, 3).forEach((part, i) => {
  console.log(`  分片 ${i + 1}: ${formatFileSize(part.start)} - ${formatFileSize(part.end)} (${formatFileSize(part.size)})`);
});
console.log(`  ...`);
console.log(`  分片 ${parts.length}: ${formatFileSize(parts[parts.length - 1].start)} - ${formatFileSize(parts[parts.length - 1].end)}`);

// ============================================================================
// 分片上传配置
// ============================================================================

console.log("\n=== 分片上传配置 ===\n");

interface MultipartUploadConfig {
  /** 分片大小（字节） */
  partSize: number;
  /** 并发数 */
  concurrency: number;
  /** 重试次数 */
  retries: number;
  /** 重试间隔（毫秒） */
  retryDelay: number;
}

const config: MultipartUploadConfig = {
  partSize: 5 * 1024 * 1024,  // 5MB 分片
  concurrency: 3,               // 3 个并发
  retries: 3,                   // 失败重试 3 次
  retryDelay: 1000,             // 重试间隔 1 秒
};

console.log("分片上传配置:");
console.log(`  分片大小: ${formatFileSize(config.partSize)}`);
console.log(`  并发数: ${config.concurrency}`);
console.log(`  重试次数: ${config.retries}`);

// ============================================================================
// 分片上传流程
// ============================================================================

console.log("\n=== 分片上传流程（示例代码）===\n");

console.log(`
import { MultipartUploader } from "@dreamer/upload";

// 1. 创建分片上传器
const uploader = new MultipartUploader({
  partSize: 5 * 1024 * 1024, // 5MB
  concurrency: 3,
  maxRetries: 3,
});

// 2. 准备文件
const file = await Deno.readFile("./large-file.zip");

// 3. 开始上传
const result = await uploader.upload(file, "uploads/large-file.zip", {
  // 进度回调
  onProgress: (progress) => {
    console.log(\`进度: \${progress.percentage.toFixed(1)}%\`);
    console.log(\`已上传: \${formatFileSize(progress.loaded)} / \${formatFileSize(progress.total)}\`);
    console.log(\`当前分片: \${progress.currentPart} / \${progress.totalParts}\`);
  },

  // 分片完成回调
  onPartComplete: (part) => {
    console.log(\`分片 \${part.partNumber} 上传完成\`);
  },
});

console.log("上传完成:", result);
`);

// ============================================================================
// 断点续传
// ============================================================================

console.log("=== 断点续传（示例代码）===\n");

console.log(`
import { ResumableUploader } from "@dreamer/upload";

// 创建可恢复上传器
const uploader = new ResumableUploader({
  partSize: 5 * 1024 * 1024,
  concurrency: 3,
  stateStore: new LocalStorageStateStore("./upload-state"),
});

// 开始或恢复上传
const result = await uploader.upload(file, "uploads/large-file.zip", {
  // 上传 ID（用于恢复）
  uploadId: "my-upload-id",

  onProgress: (progress) => {
    console.log(\`进度: \${progress.percentage.toFixed(1)}%\`);
  },
});

// 如果上传中断，下次调用会自动从断点继续
`);

// ============================================================================
// 取消上传
// ============================================================================

console.log("=== 取消上传（示例代码）===\n");

console.log(`
// 使用 AbortController 取消上传
const controller = new AbortController();

// 开始上传
const uploadPromise = uploader.upload(file, "uploads/large-file.zip", {
  signal: controller.signal,

  onProgress: (progress) => {
    console.log(\`进度: \${progress.percentage}%\`);

    // 用户点击取消按钮
    if (userClickedCancel) {
      controller.abort();
    }
  },
});

try {
  const result = await uploadPromise;
} catch (error) {
  if (error.name === "AbortError") {
    console.log("上传已取消");
  } else {
    throw error;
  }
}
`);

// ============================================================================
// 前端分片上传
// ============================================================================

console.log("=== 前端分片上传（示例代码）===\n");

console.log(`
// 浏览器端代码

async function uploadLargeFile(file: File) {
  const PART_SIZE = 5 * 1024 * 1024; // 5MB
  const totalParts = Math.ceil(file.size / PART_SIZE);

  // 1. 初始化分片上传
  const { uploadId } = await fetch("/api/upload/init", {
    method: "POST",
    body: JSON.stringify({ filename: file.name, size: file.size }),
  }).then(r => r.json());

  // 2. 上传各个分片
  const parts: { partNumber: number; etag: string }[] = [];

  for (let i = 0; i < totalParts; i++) {
    const start = i * PART_SIZE;
    const end = Math.min(start + PART_SIZE, file.size);
    const chunk = file.slice(start, end);

    const formData = new FormData();
    formData.append("file", chunk);
    formData.append("uploadId", uploadId);
    formData.append("partNumber", String(i + 1));

    const { etag } = await fetch("/api/upload/part", {
      method: "POST",
      body: formData,
    }).then(r => r.json());

    parts.push({ partNumber: i + 1, etag });

    // 更新进度
    updateProgress((i + 1) / totalParts * 100);
  }

  // 3. 完成上传
  const result = await fetch("/api/upload/complete", {
    method: "POST",
    body: JSON.stringify({ uploadId, parts }),
  }).then(r => r.json());

  return result;
}
`);

// ============================================================================
// 服务端分片上传处理
// ============================================================================

console.log("=== 服务端分片上传处理（示例代码）===\n");

console.log(`
// Deno/Oak 服务端代码

import { Application, Router } from "oak";

const app = new Application();
const router = new Router();

// 存储分片上传状态
const uploads = new Map<string, UploadState>();

// 初始化分片上传
router.post("/api/upload/init", async (ctx) => {
  const { filename, size } = await ctx.request.body().value;
  const uploadId = crypto.randomUUID();

  uploads.set(uploadId, {
    filename,
    size,
    parts: [],
    createdAt: Date.now(),
  });

  ctx.response.body = { uploadId };
});

// 上传分片
router.post("/api/upload/part", async (ctx) => {
  const form = await ctx.request.body({ type: "form-data" }).value;
  const data = await form.read();

  const uploadId = data.fields.uploadId;
  const partNumber = parseInt(data.fields.partNumber);
  const chunk = data.files?.[0];

  if (!chunk) throw new Error("No file");

  const state = uploads.get(uploadId);
  if (!state) throw new Error("Upload not found");

  // 保存分片
  const etag = await savePartToStorage(uploadId, partNumber, chunk.content);

  state.parts.push({ partNumber, etag });

  ctx.response.body = { etag };
});

// 完成上传
router.post("/api/upload/complete", async (ctx) => {
  const { uploadId, parts } = await ctx.request.body().value;

  const state = uploads.get(uploadId);
  if (!state) throw new Error("Upload not found");

  // 合并分片
  const finalPath = await mergeParts(uploadId, parts);

  // 清理
  uploads.delete(uploadId);

  ctx.response.body = { path: finalPath };
});

app.use(router.routes());
`);
