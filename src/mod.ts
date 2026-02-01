/**
 * @module @dreamer/upload
 *
 * 文件上传库
 *
 * 提供完整的文件上传处理功能，支持：
 * - 文件大小验证
 * - 文件类型验证
 * - 文件扩展名验证
 * - 文件名生成
 * - MIME 类型检测
 * - 文件存储管理
 * - FormData 处理
 * - 文件哈希计算
 *
 * @example
 * ```typescript
 * import {
 *   Uploader,
 *   validateFile,
 *   generateFilename,
 *   getMimeType,
 * } from "@dreamer/upload";
 *
 * // 使用上传处理器
 * const uploader = new Uploader({
 *   uploadDir: "./uploads",
 *   validation: {
 *     maxFileSize: 10 * 1024 * 1024,
 *     allowedMimeTypes: ["image/*"],
 *   },
 * });
 *
 * // 处理 FormData 上传
 * const result = await uploader.handleFormData(formData);
 * ```
 */

// ============================================================================
// 类型导出
// ============================================================================

export type {
  FileStorage,
  FileValidationInput,
  FileValidationOptions,
  FileValidationResult,
  UploadedFile,
  UploaderConfig,
  UploadResult,
} from "./types.ts";

// ============================================================================
// 常量导出
// ============================================================================

export { DEFAULT_FORBIDDEN_EXTENSIONS, MIME_TYPES } from "./constants.ts";

// ============================================================================
// 工具函数导出
// ============================================================================

export {
  // 文件名处理
  computeHash,
  computeShortHash,
  // 响应创建
  createFileResponse,
  // 文件大小格式化
  formatFileSize,
  // 子目录生成
  generateDateSubdir,
  generateFilename,
  generateMonthSubdir,
  generateTimestampFilename,
  getBaseName,
  getFileExtension,
  getFilenameFromUrl,
  getMimeType,
  isArchive,
  isAudio,
  isDocument,
  isHiddenFile,
  isImage,
  isPathSafe,
  isVideo,
  // MIME 类型匹配
  matchMimeType,
  sanitizeFilename,
  // 验证函数
  validateFile,
  validateFiles,
} from "./utils.ts";

// ============================================================================
// 存储导出
// ============================================================================

export { createLocalStorage, LocalStorage } from "./storage.ts";

// ============================================================================
// 存储管理器导出
// ============================================================================

export {
  createStorageManager,
  createStorageManagerFromEnv,
  StorageManager,
} from "./storage-manager.ts";

export type {
  LocalStorageConfig,
  StorageManagerConfig,
  StorageType,
  UploadedFileInfo,
  UploadOptions,
} from "./storage-manager.ts";

// ============================================================================
// 上传处理器导出
// ============================================================================

export { createUploader, Uploader } from "./uploader.ts";
