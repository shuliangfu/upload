/**
 * @fileoverview 云存储适配器模块入口
 *
 * 导出所有云存储适配器和相关类型
 *
 * @example
 * ```typescript
 * import {
 *   S3StorageAdapter,
 *   OSSStorageAdapter,
 *   COSStorageAdapter,
 *   createS3Adapter,
 *   createOSSAdapter,
 *   createCOSAdapter,
 * } from "@dreamer/upload/adapters";
 *
 * // 使用 AWS S3
 * const s3 = createS3Adapter({
 *   bucket: "my-bucket",
 *   region: "us-east-1",
 *   accessKeyId: "...",
 *   secretAccessKey: "...",
 * });
 *
 * // 使用阿里云 OSS
 * const oss = createOSSAdapter({
 *   bucket: "my-bucket",
 *   region: "oss-cn-hangzhou",
 *   accessKeyId: "...",
 *   accessKeySecret: "...",
 * });
 *
 * // 使用腾讯云 COS
 * const cos = createCOSAdapter({
 *   bucket: "my-bucket-1250000000",
 *   region: "ap-guangzhou",
 *   secretId: "...",
 *   secretKey: "...",
 * });
 * ```
 */

// ============================================================================
// 类型导出
// ============================================================================

export type {
  CloudStorageAdapter,
  CloudUploadOptions,
  CopyOptions,
  COSConfig,
  DownloadOptions,
  ListOptions,
  ListPartsResult,
  ListResult,
  MultipartUploadInit,
  ObjectInfo,
  ObjectMetadata,
  OSSConfig,
  PartInfo,
  PresignedUrlOptions,
  S3Config,
  UploadPartResult,
} from "./types.ts";

// ============================================================================
// S3 适配器
// ============================================================================

export { createS3Adapter, S3StorageAdapter } from "./s3.ts";

// ============================================================================
// OSS 适配器
// ============================================================================

export { createOSSAdapter, OSSStorageAdapter } from "./oss.ts";

// ============================================================================
// COS 适配器
// ============================================================================

export { COSStorageAdapter, createCOSAdapter } from "./cos.ts";
