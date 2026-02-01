/**
 * @fileoverview 文件上传基础示例
 *
 * 展示 @dreamer/upload 的基本用法
 */

import {
  Uploader,
  LocalStorage,
  validateFile,
  generateFilename,
  formatFileSize,
  getMimeType,
  getFileExtension,
} from "../src/mod.ts";

// ============================================================================
// 文件工具函数
// ============================================================================

console.log("=== 文件工具函数 ===\n");

// 获取文件扩展名
console.log("扩展名: image.png ->", getFileExtension("image.png"));
console.log("扩展名: document.PDF ->", getFileExtension("document.PDF"));
console.log("扩展名: no-extension ->", getFileExtension("no-extension"));

// 获取 MIME 类型
console.log("\nMIME 类型: .png ->", getMimeType(".png"));
console.log("MIME 类型: photo.jpg ->", getMimeType("photo.jpg"));
console.log("MIME 类型: data.json ->", getMimeType("data.json"));

// 生成唯一文件名
console.log("\n生成文件名: avatar.png ->", generateFilename("avatar.png"));
console.log("生成文件名: document.pdf ->", generateFilename("document.pdf"));

// 格式化文件大小
console.log("\n格式化大小: 1024 ->", formatFileSize(1024));
console.log("格式化大小: 1048576 ->", formatFileSize(1048576));
console.log("格式化大小: 1073741824 ->", formatFileSize(1073741824));

// ============================================================================
// 文件验证
// ============================================================================

console.log("\n=== 文件验证 ===\n");

// 验证单个文件
const file1 = { name: "photo.jpg", type: "image/jpeg", size: 1024 * 500 };
const result1 = validateFile(file1, {
  maxFileSize: 5 * 1024 * 1024, // 5MB
  allowedMimeTypes: ["image/*"],
});
console.log("photo.jpg 验证:", result1);

// 验证失败：文件过大
const file2 = { name: "video.mp4", type: "video/mp4", size: 100 * 1024 * 1024 };
const result2 = validateFile(file2, {
  maxFileSize: 10 * 1024 * 1024, // 10MB
});
console.log("video.mp4 验证:", result2);

// 验证失败：不允许的类型
const file3 = { name: "script.exe", type: "application/x-executable", size: 1024 };
const result3 = validateFile(file3, {
  allowedMimeTypes: ["image/*", "application/pdf"],
});
console.log("script.exe 验证:", result3);

// ============================================================================
// 创建上传处理器
// ============================================================================

console.log("\n=== 创建上传处理器 ===\n");

// 使用本地存储
const storage = new LocalStorage();

const uploader = new Uploader({
  uploadDir: "./uploads",
  storage,
  validation: {
    maxFileSize: 10 * 1024 * 1024, // 10MB
    allowedMimeTypes: ["image/*", "application/pdf"],
    allowedExtensions: [".jpg", ".jpeg", ".png", ".gif", ".pdf"],
  },
  // 自定义文件名生成函数
  generateFilename: (originalName: string, _mimeType: string) => {
    return generateFilename(originalName);
  },
});

console.log("上传处理器创建成功");
console.log("Uploader:", uploader);

// ============================================================================
// 上传文件示例
// ============================================================================

console.log("\n=== 上传文件（示例代码）===\n");

console.log(`
// 模拟文件内容
const imageContent = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

// 上传
const uploadResult = await uploader.upload(
  imageContent,
  "avatar.png",
  "image/png"
);

console.log("上传结果:");
console.log("  文件名:", uploadResult.filename);
console.log("  原始名:", uploadResult.originalName);
console.log("  路径:", uploadResult.path);
console.log("  大小:", formatFileSize(uploadResult.size));
console.log("  类型:", uploadResult.mimeType);
`);

// ============================================================================
// 处理 FormData
// ============================================================================

console.log("=== 处理 FormData（示例代码）===\n");

console.log(`
// Deno/Oak 处理文件上传
import { Application, Router } from "oak";

const app = new Application();
const router = new Router();

router.post("/upload", async (ctx) => {
  const form = await ctx.request.body({ type: "form-data" }).value;
  const formData = await form.read();

  // 处理上传的文件
  const results = await uploader.handleFormData(formData);

  ctx.response.body = {
    success: true,
    files: results.map(r => ({
      filename: r.filename,
      size: r.size,
      url: \`/uploads/\${r.filename}\`,
    })),
  };
});

app.use(router.routes());
await app.listen({ port: 3000 });
`);

// ============================================================================
// 获取和删除文件
// ============================================================================

console.log("=== 获取和删除文件（示例代码）===\n");

console.log(`
// 读取文件
const content = await storage.read(uploadResult.path);
console.log("读取文件成功，大小:", content.length, "字节");

// 检查文件是否存在
const exists = await storage.exists(uploadResult.path);
console.log("文件是否存在:", exists);

// 删除文件
await storage.delete(uploadResult.path);
console.log("文件已删除");
`);

// ============================================================================
// 配置选项
// ============================================================================

console.log("=== 配置选项 ===\n");

console.log(`
const uploader = new Uploader({
  uploadDir: "./uploads",
  storage: new LocalStorage(),

  // 验证选项
  validation: {
    maxFileSize: 50 * 1024 * 1024,     // 50MB
    maxTotalSize: 100 * 1024 * 1024,   // 100MB（总大小）
    maxFiles: 10,                       // 最多 10 个文件
    allowedMimeTypes: ["image/*", "video/*", "application/pdf"],
    allowedExtensions: [".jpg", ".png", ".mp4", ".pdf"],
    forbiddenExtensions: [".exe", ".bat", ".sh"],
  },

  // 自定义文件名生成
  generateFilename: (originalName, mimeType) => {
    const ext = getFileExtension(originalName);
    const timestamp = Date.now();
    return \`\${timestamp}_\${crypto.randomUUID()}\${ext}\`;
  },
});
`);
