/**
 * @fileoverview 统一存储管理器
 *
 * 提供配置化的存储管理，自动选择云存储或本地存储
 *
 * @example
 * ```typescript
 * import { StorageManager } from "@dreamer/upload";
 *
 * // 配置了云存储 - 上传到 S3
 * const manager = new StorageManager({
 *   type: "s3",
 *   s3: {
 *     bucket: "my-bucket",
 *     region: "us-east-1",
 *     accessKeyId: "...",
 *     secretAccessKey: "...",
 *   },
 * });
 *
 * // 没有配置云存储 - 上传到本地
 * const localManager = new StorageManager({
 *   type: "local",
 *   local: {
 *     baseDir: "./uploads",
 *     baseUrl: "/uploads",
 *   },
 * });
 *
 * // 使用相同的 API 上传文件
 * const result = await manager.upload("file.jpg", data, { contentType: "image/jpeg" });
 * console.log(result.url);
 * ```
 */

import type {
  CloudStorageAdapter,
  CloudUploadOptions,
  COSConfig,
  ListOptions,
  ListResult,
  ObjectMetadata,
  OSSConfig,
  S3Config,
} from "./adapters/types.ts";
import { S3StorageAdapter } from "./adapters/s3.ts";
import { OSSStorageAdapter } from "./adapters/oss.ts";
import { COSStorageAdapter } from "./adapters/cos.ts";
// 使用跨运行时文件系统 API
import {
  type FileInfo,
  mkdir,
  readdir,
  readFile,
  remove,
  stat,
  writeFile,
} from "@dreamer/runtime-adapter";
import { $tr } from "./i18n.ts";

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 本地存储配置
 */
export interface LocalStorageConfig {
  /** 基础目录 */
  baseDir: string;
  /** 基础 URL（用于生成访问链接） */
  baseUrl?: string;
  /** 创建子目录的函数 */
  generateSubdir?: () => string;
}

/**
 * 存储类型
 */
export type StorageType = "local" | "s3" | "oss" | "cos";

/**
 * 存储管理器配置
 */
export interface StorageManagerConfig {
  /** 存储类型 */
  type: StorageType;
  /** 本地存储配置（type 为 local 时必需） */
  local?: LocalStorageConfig;
  /** S3 配置（type 为 s3 时必需） */
  s3?: S3Config;
  /** OSS 配置（type 为 oss 时必需） */
  oss?: OSSConfig;
  /** COS 配置（type 为 cos 时必需） */
  cos?: COSConfig;
  /** 路径前缀 */
  pathPrefix?: string;
  /** 自定义路径生成函数 */
  generatePath?: (filename: string) => string;
}

/**
 * 上传结果
 */
export interface UploadedFileInfo {
  /** 文件键/路径 */
  key: string;
  /** 访问 URL */
  url: string;
  /** 文件大小 */
  size: number;
  /** MIME 类型 */
  contentType?: string;
  /** ETag */
  etag?: string;
  /** 存储类型 */
  storageType: StorageType;
}

/**
 * 上传选项
 */
export interface UploadOptions extends CloudUploadOptions {
  /** 是否公开访问（本地存储忽略） */
  public?: boolean;
  /** URL 过期时间（秒，用于私有文件） */
  urlExpires?: number;
}

// ============================================================================
// 本地存储适配器（实现 CloudStorageAdapter 接口的子集）
// ============================================================================

/**
 * 本地存储适配器
 *
 * 将本地文件系统包装成与云存储相似的接口
 */
class LocalStorageAdapter {
  private config: LocalStorageConfig;
  private initialized = false;

  constructor(config: LocalStorageConfig) {
    this.config = config;
  }

  /**
   * 初始化（创建基础目录）
   */
  async init(): Promise<void> {
    if (this.initialized) return;
    await mkdir(this.config.baseDir, { recursive: true });
    this.initialized = true;
  }

  /**
   * 获取完整文件路径
   */
  private getFullPath(key: string): string {
    return `${this.config.baseDir}/${key}`;
  }

  /**
   * 获取访问 URL
   */
  getUrl(key: string): string {
    const baseUrl = this.config.baseUrl || this.config.baseDir;
    return `${baseUrl}/${key}`;
  }

  /**
   * 上传文件
   */
  async upload(
    key: string,
    content: Uint8Array,
    _options?: CloudUploadOptions,
  ): Promise<void> {
    await this.init();
    const fullPath = this.getFullPath(key);

    // 确保父目录存在
    const dir = fullPath.substring(0, fullPath.lastIndexOf("/"));
    if (dir) {
      await mkdir(dir, { recursive: true });
    }

    await writeFile(fullPath, content);
  }

  /**
   * 读取文件
   */
  async read(key: string): Promise<Uint8Array> {
    const fullPath = this.getFullPath(key);
    return await readFile(fullPath);
  }

  /**
   * 下载文件（同 read）
   */
  download(key: string): Promise<Uint8Array> {
    return this.read(key);
  }

  /**
   * 删除文件
   */
  async delete(key: string): Promise<void> {
    const fullPath = this.getFullPath(key);
    try {
      await remove(fullPath);
    } catch {
      // 文件不存在时忽略错误
    }
  }

  /**
   * 检查文件是否存在
   */
  async exists(key: string): Promise<boolean> {
    const fullPath = this.getFullPath(key);
    try {
      await stat(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 创建目录
   */
  async mkdirPath(path: string): Promise<void> {
    const fullPath = this.getFullPath(path);
    await mkdir(fullPath, { recursive: true });
  }

  /**
   * 保存文件（同 upload，兼容 FileStorage 接口）
   */
  save(key: string, content: Uint8Array): Promise<void> {
    return this.upload(key, content);
  }

  /**
   * 获取文件元数据
   */
  async getMetadata(key: string): Promise<ObjectMetadata | null> {
    const fullPath = this.getFullPath(key);
    try {
      const fileInfo: FileInfo = await stat(fullPath);
      return {
        contentLength: fileInfo.size,
        lastModified: fileInfo.mtime || new Date(),
      };
    } catch {
      return null;
    }
  }

  /**
   * 列出文件
   */
  async listObjects(options?: ListOptions): Promise<ListResult> {
    await this.init();
    const prefix = options?.prefix || "";
    const dir = prefix
      ? `${this.config.baseDir}/${prefix}`
      : this.config.baseDir;

    const objects: Array<{
      key: string;
      size: number;
      lastModified: Date;
    }> = [];

    try {
      const entries = await readdir(dir);
      for (const entry of entries) {
        if (entry.isFile) {
          const key = prefix ? `${prefix}/${entry.name}` : entry.name;
          const fileInfo: FileInfo = await stat(`${dir}/${entry.name}`);
          objects.push({
            key,
            size: fileInfo.size,
            lastModified: fileInfo.mtime || new Date(),
          });
        }
      }
    } catch {
      // 目录不存在返回空列表
    }

    return {
      objects,
      isTruncated: false,
    };
  }

  /**
   * 生成访问 URL（本地存储直接返回路径）
   */
  getPresignedUrl(
    key: string,
    _options?: { expiresIn?: number },
  ): Promise<string> {
    return Promise.resolve(this.getUrl(key));
  }
}

// ============================================================================
// 存储管理器
// ============================================================================

/**
 * 统一存储管理器
 *
 * 根据配置自动选择本地存储或云存储
 *
 * @example
 * ```typescript
 * // 使用环境变量配置
 * const manager = StorageManager.fromEnv();
 *
 * // 或手动配置
 * const manager = new StorageManager({
 *   type: process.env.STORAGE_TYPE as StorageType || "local",
 *   local: { baseDir: "./uploads", baseUrl: "/uploads" },
 *   s3: {
 *     bucket: process.env.S3_BUCKET,
 *     region: process.env.S3_REGION,
 *     accessKeyId: process.env.S3_ACCESS_KEY,
 *     secretAccessKey: process.env.S3_SECRET_KEY,
 *   },
 * });
 *
 * // 上传文件
 * const result = await manager.upload("avatar.jpg", imageData, {
 *   contentType: "image/jpeg",
 * });
 * console.log(result.url);
 * ```
 */
export class StorageManager {
  private config: StorageManagerConfig;
  private adapter: CloudStorageAdapter | LocalStorageAdapter;
  private storageType: StorageType;

  /**
   * 创建存储管理器
   *
   * @param config - 存储配置
   */
  constructor(config: StorageManagerConfig) {
    this.config = config;
    this.storageType = config.type;

    // 根据配置创建对应的适配器
    switch (config.type) {
      case "s3":
        if (!config.s3) {
          throw new Error($tr("upload.storage.s3ConfigMissing"));
        }
        this.adapter = new S3StorageAdapter(config.s3);
        break;

      case "oss":
        if (!config.oss) {
          throw new Error($tr("upload.storage.ossConfigMissing"));
        }
        this.adapter = new OSSStorageAdapter(config.oss);
        break;

      case "cos":
        if (!config.cos) {
          throw new Error($tr("upload.storage.cosConfigMissing"));
        }
        this.adapter = new COSStorageAdapter(config.cos);
        break;

      case "local":
      default:
        if (!config.local) {
          throw new Error($tr("upload.storage.localConfigMissing"));
        }
        this.adapter = new LocalStorageAdapter(config.local);
        break;
    }
  }

  /**
   * 从环境变量创建存储管理器
   *
   * 环境变量：
   * - STORAGE_TYPE: local | s3 | oss | cos
   * - LOCAL_UPLOAD_DIR: 本地上传目录
   * - LOCAL_UPLOAD_URL: 本地上传 URL 前缀
   * - S3_BUCKET, S3_REGION, S3_ACCESS_KEY, S3_SECRET_KEY, S3_ENDPOINT
   * - OSS_BUCKET, OSS_REGION, OSS_ACCESS_KEY, OSS_SECRET_KEY
   * - COS_BUCKET, COS_REGION, COS_SECRET_ID, COS_SECRET_KEY
   *
   * @returns StorageManager 实例
   */
  static fromEnv(): StorageManager {
    const env = Deno.env.toObject();
    const type = (env.STORAGE_TYPE || "local") as StorageType;

    const config: StorageManagerConfig = {
      type,
      pathPrefix: env.STORAGE_PATH_PREFIX,
    };

    // 本地存储配置
    config.local = {
      baseDir: env.LOCAL_UPLOAD_DIR || "./uploads",
      baseUrl: env.LOCAL_UPLOAD_URL || "/uploads",
    };

    // S3 配置
    if (env.S3_BUCKET && env.S3_REGION) {
      config.s3 = {
        bucket: env.S3_BUCKET,
        region: env.S3_REGION,
        accessKeyId: env.S3_ACCESS_KEY || "",
        secretAccessKey: env.S3_SECRET_KEY || "",
        endpoint: env.S3_ENDPOINT,
      };
    }

    // OSS 配置
    if (env.OSS_BUCKET && env.OSS_REGION) {
      config.oss = {
        bucket: env.OSS_BUCKET,
        region: env.OSS_REGION,
        accessKeyId: env.OSS_ACCESS_KEY || "",
        accessKeySecret: env.OSS_SECRET_KEY || "",
      };
    }

    // COS 配置
    if (env.COS_BUCKET && env.COS_REGION) {
      config.cos = {
        bucket: env.COS_BUCKET,
        region: env.COS_REGION,
        secretId: env.COS_SECRET_ID || "",
        secretKey: env.COS_SECRET_KEY || "",
      };
    }

    return new StorageManager(config);
  }

  /**
   * 获取当前存储类型
   */
  getType(): StorageType {
    return this.storageType;
  }

  /**
   * 是否是云存储
   */
  isCloudStorage(): boolean {
    return this.storageType !== "local";
  }

  /**
   * 获取底层存储适配器
   */
  getAdapter(): CloudStorageAdapter | LocalStorageAdapter {
    return this.adapter;
  }

  /**
   * 生成文件路径
   */
  private generateKey(filename: string): string {
    if (this.config.generatePath) {
      return this.config.generatePath(filename);
    }

    const prefix = this.config.pathPrefix;
    if (prefix) {
      return `${prefix}/${filename}`;
    }

    return filename;
  }

  /**
   * 上传文件
   *
   * @param filename - 文件名
   * @param content - 文件内容
   * @param options - 上传选项
   * @returns 上传结果
   */
  async upload(
    filename: string,
    content: Uint8Array,
    options?: UploadOptions,
  ): Promise<UploadedFileInfo> {
    const key = this.generateKey(filename);

    // 上传文件
    if (this.isCloudStorage()) {
      await (this.adapter as CloudStorageAdapter).upload(key, content, options);
    } else {
      await (this.adapter as LocalStorageAdapter).upload(key, content, options);
    }

    // 获取访问 URL
    let url: string;
    if (this.isCloudStorage()) {
      if (options?.public) {
        // 公开访问直接使用对象 URL
        const cloudAdapter = this.adapter as CloudStorageAdapter;
        const bucket = cloudAdapter.getBucket();
        const region = cloudAdapter.getRegion();

        if (this.storageType === "s3") {
          url = `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
        } else if (this.storageType === "oss") {
          url = `https://${bucket}.oss-${region}.aliyuncs.com/${key}`;
        } else {
          url = `https://${bucket}.cos.${region}.myqcloud.com/${key}`;
        }
      } else {
        // 私有访问使用预签名 URL
        url = await (this.adapter as CloudStorageAdapter).getPresignedUrl(key, {
          expiresIn: options?.urlExpires || 3600,
          method: "GET",
        });
      }
    } else {
      url = (this.adapter as LocalStorageAdapter).getUrl(key);
    }

    return {
      key,
      url,
      size: content.length,
      contentType: options?.contentType,
      storageType: this.storageType,
    };
  }

  /**
   * 下载文件
   *
   * @param key - 文件键/路径
   * @returns 文件内容
   */
  download(key: string): Promise<Uint8Array> {
    if (this.isCloudStorage()) {
      return (this.adapter as CloudStorageAdapter).download(key);
    } else {
      return (this.adapter as LocalStorageAdapter).download(key);
    }
  }

  /**
   * 删除文件
   *
   * @param key - 文件键/路径
   */
  async delete(key: string): Promise<void> {
    await this.adapter.delete(key);
  }

  /**
   * 检查文件是否存在
   *
   * @param key - 文件键/路径
   * @returns 是否存在
   */
  exists(key: string): Promise<boolean> {
    return this.adapter.exists(key);
  }

  /**
   * 获取文件元数据
   *
   * @param key - 文件键/路径
   * @returns 元数据
   */
  getMetadata(key: string): Promise<ObjectMetadata | null> {
    if (this.isCloudStorage()) {
      return (this.adapter as CloudStorageAdapter).getMetadata(key);
    } else {
      return (this.adapter as LocalStorageAdapter).getMetadata(key);
    }
  }

  /**
   * 列出文件
   *
   * @param options - 列表选项
   * @returns 文件列表
   */
  list(options?: ListOptions): Promise<ListResult> {
    if (this.isCloudStorage()) {
      return (this.adapter as CloudStorageAdapter).listObjects(options);
    } else {
      return (this.adapter as LocalStorageAdapter).listObjects(options);
    }
  }

  /**
   * 获取文件访问 URL
   *
   * @param key - 文件键/路径
   * @param options - 选项
   * @returns 访问 URL
   */
  getUrl(
    key: string,
    options?: { expiresIn?: number; public?: boolean },
  ): Promise<string> {
    if (this.isCloudStorage()) {
      if (options?.public) {
        const cloudAdapter = this.adapter as CloudStorageAdapter;
        const bucket = cloudAdapter.getBucket();
        const region = cloudAdapter.getRegion();

        if (this.storageType === "s3") {
          return Promise.resolve(
            `https://${bucket}.s3.${region}.amazonaws.com/${key}`,
          );
        } else if (this.storageType === "oss") {
          return Promise.resolve(
            `https://${bucket}.oss-${region}.aliyuncs.com/${key}`,
          );
        } else {
          return Promise.resolve(
            `https://${bucket}.cos.${region}.myqcloud.com/${key}`,
          );
        }
      }
      return (this.adapter as CloudStorageAdapter).getPresignedUrl(key, {
        expiresIn: options?.expiresIn || 3600,
        method: "GET",
      });
    } else {
      return (this.adapter as LocalStorageAdapter).getPresignedUrl(key);
    }
  }

  /**
   * 复制文件（仅云存储支持）
   *
   * @param sourceKey - 源文件键
   * @param destKey - 目标文件键
   */
  async copy(sourceKey: string, destKey: string): Promise<void> {
    if (this.isCloudStorage()) {
      await (this.adapter as CloudStorageAdapter).copy(sourceKey, destKey);
    } else {
      // 本地存储通过读取和写入实现复制
      const content = await this.download(sourceKey);
      await this.upload(destKey, content);
    }
  }
}

// ============================================================================
// 工厂函数
// ============================================================================

/**
 * 创建存储管理器
 *
 * @param config - 存储配置
 * @returns StorageManager 实例
 */
export function createStorageManager(
  config: StorageManagerConfig,
): StorageManager {
  return new StorageManager(config);
}

/**
 * 从环境变量创建存储管理器
 *
 * @returns StorageManager 实例
 */
export function createStorageManagerFromEnv(): StorageManager {
  return StorageManager.fromEnv();
}
