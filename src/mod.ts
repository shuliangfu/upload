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

export {
  DANGEROUS_ACLS,
  DEFAULT_FORBIDDEN_EXTENSIONS,
  DEFAULT_FORBIDDEN_MIME_TYPES,
  MIME_TYPES,
} from "./constants.ts";

// ============================================================================
// 工具函数导出
// ============================================================================

export {
  // 路径牢笼
  assertPathSafe,
  assertSafeAcl,
  // 响应创建
  buildContentDisposition,
  // 文件名处理
  computeHash,
  computeShortHash,
  createFileResponse,
  // MIME 类型匹配／魔数
  detectMimeType,
  findForbiddenExtension,
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
  isUuid,
  isVideo,
  matchMimeType,
  // 验证函数
  normalizeFilenameForPolicy,
  // 薄配额
  QuotaGuard,
  redactErrorMessage,
  resolveSafePath,
  sanitizeFilename,
  sanitizeObjectKey,
  scanDangerousPayload,
  validateContentExtensionConsistency,
  validateFile,
  validateFiles,
  validateMimeType,
  validateUploadContent,
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
