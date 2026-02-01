/**
 * @fileoverview 文件验证示例
 *
 * 展示文件类型、大小、安全性验证
 */

import {
  validateFile,
  validateFiles,
  isPathSafe,
  sanitizeFilename,
  isImage,
  isVideo,
  isAudio,
  isDocument,
  isArchive,
  isHiddenFile,
  getMimeType,
} from "../src/mod.ts";

// ============================================================================
// 文件大小验证
// ============================================================================

console.log("=== 文件大小验证 ===\n");

const files = [
  { name: "small.jpg", type: "image/jpeg", size: 100 * 1024 },      // 100KB
  { name: "medium.jpg", type: "image/jpeg", size: 5 * 1024 * 1024 }, // 5MB
  { name: "large.mp4", type: "video/mp4", size: 50 * 1024 * 1024 },  // 50MB
];

for (const file of files) {
  const result = validateFile(file, {
    maxFileSize: 10 * 1024 * 1024, // 10MB 限制
  });
  console.log(`${file.name} (${(file.size / 1024 / 1024).toFixed(1)}MB):`, result);
}

// ============================================================================
// 文件类型验证
// ============================================================================

console.log("\n=== 文件类型验证 ===\n");

const typeTests = [
  { name: "photo.jpg", type: "image/jpeg", size: 1024 },
  { name: "video.mp4", type: "video/mp4", size: 1024 },
  { name: "doc.pdf", type: "application/pdf", size: 1024 },
  { name: "script.js", type: "text/javascript", size: 1024 },
];

const imageOnlyOptions = {
  allowedMimeTypes: ["image/*"],
};

console.log("只允许图片:");
for (const file of typeTests) {
  const result = validateFile(file, imageOnlyOptions);
  console.log(`  ${file.name}: ${result.valid ? "✓" : `✗ ${result.error}`}`);
}

const mediaOptions = {
  allowedMimeTypes: ["image/*", "video/*", "audio/*"],
};

console.log("\n允许媒体文件:");
for (const file of typeTests) {
  const result = validateFile(file, mediaOptions);
  console.log(`  ${file.name}: ${result.valid ? "✓" : `✗ ${result.error}`}`);
}

// ============================================================================
// 扩展名验证
// ============================================================================

console.log("\n=== 扩展名验证 ===\n");

const extTests = [
  { name: "image.jpg", type: "image/jpeg", size: 1024 },
  { name: "image.png", type: "image/png", size: 1024 },
  { name: "image.webp", type: "image/webp", size: 1024 },
  { name: "script.exe", type: "application/x-executable", size: 1024 },
  { name: "data.bat", type: "application/x-bat", size: 1024 },
];

const safeExtOptions = {
  allowedExtensions: [".jpg", ".jpeg", ".png", ".gif"],
  forbiddenExtensions: [".exe", ".bat", ".sh", ".cmd"],
};

for (const file of extTests) {
  const result = validateFile(file, safeExtOptions);
  console.log(`${file.name}: ${result.valid ? "✓" : `✗ ${result.error}`}`);
}

// ============================================================================
// 批量文件验证
// ============================================================================

console.log("\n=== 批量文件验证 ===\n");

const batchFiles = [
  { name: "photo1.jpg", type: "image/jpeg", size: 1024 * 1024 },
  { name: "photo2.jpg", type: "image/jpeg", size: 2 * 1024 * 1024 },
  { name: "photo3.jpg", type: "image/jpeg", size: 3 * 1024 * 1024 },
];

// 验证总大小
const batchResult = validateFiles(
  batchFiles,
  { allowedMimeTypes: ["image/*"] },
  5 * 1024 * 1024 // 总大小限制 5MB
);

console.log("批量验证结果:", batchResult);

// ============================================================================
// 文件类型检测
// ============================================================================

console.log("\n=== 文件类型检测 ===\n");

const mimeTypeTests = [
  { name: "photo.jpg", mimeType: "image/jpeg" },
  { name: "video.mp4", mimeType: "video/mp4" },
  { name: "audio.mp3", mimeType: "audio/mpeg" },
  { name: "document.pdf", mimeType: "application/pdf" },
  { name: "archive.zip", mimeType: "application/zip" },
];

for (const { name, mimeType } of mimeTypeTests) {
  console.log(`${name}:`);
  console.log(`  是图片: ${isImage(mimeType)}`);
  console.log(`  是视频: ${isVideo(mimeType)}`);
  console.log(`  是音频: ${isAudio(mimeType)}`);
  console.log(`  是文档: ${isDocument(mimeType)}`);
  console.log(`  是压缩包: ${isArchive(mimeType)}`);
}

// ============================================================================
// MIME 类型获取
// ============================================================================

console.log("\n=== MIME 类型获取 ===\n");

const fileNames = [
  "photo.jpg",
  "document.pdf",
  "video.mp4",
  "audio.mp3",
  "data.json",
  "style.css",
  "script.js",
];

for (const fileName of fileNames) {
  console.log(`${fileName} -> ${getMimeType(fileName)}`);
}

// ============================================================================
// 文件名安全处理
// ============================================================================

console.log("\n=== 文件名安全处理 ===\n");

const dangerousNames = [
  "normal.jpg",
  "../../../etc/passwd",
  "file<script>.jpg",
  "file:name.jpg",
  ".hiddenfile",
  "   spaces.jpg   ",
  "very" + "x".repeat(100) + ".jpg", // 超长文件名
];

for (const name of dangerousNames) {
  const safe = sanitizeFilename(name);
  const display = name.length > 30 ? name.slice(0, 30) + "..." : name;
  console.log(`"${display}" -> "${safe}"`);
}

// ============================================================================
// 路径安全检查
// ============================================================================

console.log("\n=== 路径安全检查 ===\n");

const basePath = "/var/www/uploads";
const paths = [
  "images/photo.jpg",           // 安全
  "documents/2024/01/doc.pdf",   // 安全
  "../../../etc/passwd",          // 危险：路径遍历
  "/etc/passwd",                  // 危险：绝对路径
  "images/../../../root",         // 危险：隐藏遍历
];

for (const path of paths) {
  const safe = isPathSafe(path, basePath);
  console.log(`${path}: ${safe ? "✓ 安全" : "✗ 危险"}`);
}

// ============================================================================
// 隐藏文件检测
// ============================================================================

console.log("\n=== 隐藏文件检测 ===\n");

const hiddenTests = [
  ".htaccess",
  ".env",
  ".gitignore",
  "normal.txt",
  ".hidden/file.txt",
];

for (const name of hiddenTests) {
  console.log(`${name}: ${isHiddenFile(name) ? "隐藏文件" : "普通文件"}`);
}
