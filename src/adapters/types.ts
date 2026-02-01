/**
 * @fileoverview 云存储适配器类型定义
 *
 * 提供云存储适配器的通用接口和类型
 */

import type { FileStorage } from "../mod.ts";

// ============================================================================
// 通用云存储类型
// ============================================================================

/**
 * 云存储对象元数据
 */
export interface ObjectMetadata {
  /** 内容类型 */
  contentType?: string;
  /** 内容长度（字节） */
  contentLength?: number;
  /** ETag */
  etag?: string;
  /** 最后修改时间 */
  lastModified?: Date;
  /** 自定义元数据 */
  metadata?: Record<string, string>;
  /** 存储类型 */
  storageClass?: string;
}

/**
 * 云存储对象信息
 */
export interface ObjectInfo {
  /** 对象键 */
  key: string;
  /** 对象大小（字节） */
  size: number;
  /** 最后修改时间 */
  lastModified: Date;
  /** ETag */
  etag?: string;
  /** 存储类型 */
  storageClass?: string;
}

/**
 * 列表选项
 */
export interface ListOptions {
  /** 前缀 */
  prefix?: string;
  /** 分隔符 */
  delimiter?: string;
  /** 最大返回数量 */
  maxKeys?: number;
  /** 起始位置标记 */
  marker?: string;
  /** 续传标记（用于分页） */
  continuationToken?: string;
}

/**
 * 列表结果
 */
export interface ListResult {
  /** 对象列表 */
  objects: ObjectInfo[];
  /** 公共前缀（用于目录模拟） */
  commonPrefixes?: string[];
  /** 是否有更多结果 */
  isTruncated: boolean;
  /** 下一页标记 */
  nextContinuationToken?: string;
  /** 下一个标记 */
  nextMarker?: string;
}

/**
 * 上传选项
 */
export interface CloudUploadOptions {
  /** 内容类型 */
  contentType?: string;
  /** 自定义元数据 */
  metadata?: Record<string, string>;
  /** 存储类型 */
  storageClass?: string;
  /** ACL 权限 */
  acl?: "private" | "public-read" | "public-read-write";
  /** 缓存控制 */
  cacheControl?: string;
  /** 内容编码 */
  contentEncoding?: string;
}

/**
 * 下载选项
 */
export interface DownloadOptions {
  /** 范围开始（字节） */
  rangeStart?: number;
  /** 范围结束（字节） */
  rangeEnd?: number;
}

/**
 * 预签名 URL 选项
 */
export interface PresignedUrlOptions {
  /** 过期时间（秒） */
  expiresIn?: number;
  /** HTTP 方法 */
  method?: "GET" | "PUT";
  /** 内容类型（仅用于 PUT） */
  contentType?: string;
}

/**
 * 复制选项
 */
export interface CopyOptions {
  /** 源存储桶 */
  sourceBucket?: string;
  /** 元数据指令 */
  metadataDirective?: "COPY" | "REPLACE";
  /** 新元数据 */
  metadata?: Record<string, string>;
}

// ============================================================================
// 分片上传类型
// ============================================================================

/**
 * 分片信息
 */
export interface PartInfo {
  /** 分片编号（从 1 开始） */
  partNumber: number;
  /** ETag */
  etag: string;
  /** 分片大小（可选） */
  size?: number;
}

/**
 * 分片上传初始化结果
 */
export interface MultipartUploadInit {
  /** 上传 ID */
  uploadId: string;
  /** 对象键 */
  key: string;
}

/**
 * 分片上传结果
 */
export interface UploadPartResult {
  /** 分片编号 */
  partNumber: number;
  /** ETag */
  etag: string;
}

/**
 * 列出分片结果
 */
export interface ListPartsResult {
  /** 分片列表 */
  parts: PartInfo[];
  /** 是否有更多分片 */
  isTruncated: boolean;
  /** 下一个分片标记 */
  nextPartNumberMarker?: number;
}

// ============================================================================
// 云存储适配器接口
// ============================================================================

/**
 * 云存储适配器接口
 *
 * 扩展基础存储接口，添加云存储特有功能
 */
export interface CloudStorageAdapter extends FileStorage {
  /**
   * 获取存储桶名称
   */
  getBucket(): string;

  /**
   * 获取区域
   */
  getRegion(): string;

  /**
   * 上传文件（带选项）
   *
   * @param path - 对象键/路径
   * @param content - 数据
   * @param options - 上传选项
   */
  upload(
    path: string,
    content: Uint8Array,
    options?: CloudUploadOptions,
  ): Promise<void>;

  /**
   * 下载文件（带选项）
   *
   * @param path - 对象键/路径
   * @param options - 下载选项
   */
  download(path: string, options?: DownloadOptions): Promise<Uint8Array>;

  /**
   * 获取对象元数据
   *
   * @param path - 对象键/路径
   */
  getMetadata(path: string): Promise<ObjectMetadata | null>;

  /**
   * 列出对象（带分页）
   *
   * @param options - 列表选项
   */
  listObjects(options?: ListOptions): Promise<ListResult>;

  /**
   * 复制对象
   *
   * @param sourcePath - 源对象路径
   * @param destPath - 目标对象路径
   * @param options - 复制选项
   */
  copy(sourcePath: string, destPath: string, options?: CopyOptions): Promise<void>;

  /**
   * 生成预签名 URL
   *
   * @param path - 对象键/路径
   * @param options - 预签名选项
   */
  getPresignedUrl(path: string, options?: PresignedUrlOptions): Promise<string>;

  // ============================================================================
  // 分片上传方法
  // ============================================================================

  /**
   * 初始化分片上传
   *
   * @param key - 对象键
   * @param options - 上传选项
   * @returns 包含 uploadId 的初始化结果
   */
  initiateMultipartUpload(
    key: string,
    options?: CloudUploadOptions,
  ): Promise<MultipartUploadInit>;

  /**
   * 上传分片
   *
   * @param key - 对象键
   * @param uploadId - 上传 ID
   * @param partNumber - 分片编号（从 1 开始）
   * @param data - 分片数据
   * @returns 包含 ETag 的上传结果
   */
  uploadPart(
    key: string,
    uploadId: string,
    partNumber: number,
    data: Uint8Array,
  ): Promise<UploadPartResult>;

  /**
   * 完成分片上传
   *
   * @param key - 对象键
   * @param uploadId - 上传 ID
   * @param parts - 已上传的分片列表
   */
  completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: PartInfo[],
  ): Promise<void>;

  /**
   * 取消分片上传
   *
   * @param key - 对象键
   * @param uploadId - 上传 ID
   */
  abortMultipartUpload(key: string, uploadId: string): Promise<void>;

  /**
   * 列出已上传的分片
   *
   * @param key - 对象键
   * @param uploadId - 上传 ID
   * @returns 分片列表
   */
  listParts(key: string, uploadId: string): Promise<ListPartsResult>;
}

// ============================================================================
// 云存储配置类型
// ============================================================================

/**
 * AWS S3 配置
 */
export interface S3Config {
  /** 存储桶名称 */
  bucket: string;
  /** 区域 */
  region: string;
  /** Access Key ID */
  accessKeyId: string;
  /** Secret Access Key */
  secretAccessKey: string;
  /** 会话令牌（可选，用于临时凭证） */
  sessionToken?: string;
  /** 自定义端点（用于兼容 S3 的服务） */
  endpoint?: string;
  /** 是否强制路径样式访问 */
  forcePathStyle?: boolean;
}

/**
 * 阿里云 OSS 配置
 */
export interface OSSConfig {
  /** 存储桶名称 */
  bucket: string;
  /** 区域 */
  region: string;
  /** Access Key ID */
  accessKeyId: string;
  /** Access Key Secret */
  accessKeySecret: string;
  /** 安全令牌（可选，用于 STS） */
  securityToken?: string;
  /** 自定义端点 */
  endpoint?: string;
  /** 是否使用内网端点 */
  internal?: boolean;
  /** 是否使用 HTTPS */
  secure?: boolean;
  /** 是否使用 S3 兼容模式（用于 MinIO 等 S3 兼容服务测试） */
  useS3Compatible?: boolean;
  /** 是否强制路径样式访问（S3 兼容模式下使用） */
  forcePathStyle?: boolean;
}

/**
 * 腾讯云 COS 配置
 */
export interface COSConfig {
  /** 存储桶名称（包含 AppId） */
  bucket: string;
  /** 区域 */
  region: string;
  /** Secret ID */
  secretId: string;
  /** Secret Key */
  secretKey: string;
  /** 临时令牌（可选） */
  sessionToken?: string;
  /** 是否使用加速域名 */
  accelerate?: boolean;
  /** 自定义端点（用于 S3 兼容服务） */
  endpoint?: string;
  /** 是否使用 S3 兼容模式（用于 MinIO 等 S3 兼容服务测试） */
  useS3Compatible?: boolean;
  /** 是否强制路径样式访问（S3 兼容模式下使用） */
  forcePathStyle?: boolean;
}
