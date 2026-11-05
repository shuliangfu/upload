/**
 * @fileoverview 服务端上传处理器
 *
 * 提供服务端文件上传处理功能
 */

import type {
  FileStorage,
  FileValidationOptions,
  UploadedFile,
  UploaderConfig,
  UploadResult,
} from "./types.ts";
import { LocalStorage } from "./storage.ts";
import {
  assertPathSafe,
  formatFileSize,
  generateFilename,
  type QuotaGuard,
  sanitizeFilename,
  sanitizeObjectKey,
  validateFile,
  validateUploadContent,
} from "./utils.ts";

/**
 * 文件上传处理器
 *
 * 用于服务端处理文件上传请求
 *
 * @example
 * ```typescript
 * const uploader = new Uploader({
 *   uploadDir: "./uploads",
 *   validation: {
 *     maxFileSize: 10 * 1024 * 1024,
 *     allowedMimeTypes: ["image/*"],
 *   },
 * });
 *
 * // 初始化
 * await uploader.init();
 *
 * // 从 FormData 上传
 * const result = await uploader.handleFormData(formData);
 *
 * // 上传单个文件
 * const file = await uploader.upload(content, "photo.jpg", "image/jpeg");
 * ```
 */
export class Uploader {
  private config:
    & Required<
      Omit<UploaderConfig, "quota" | "verifyMagicBytes" | "requireMimeType">
    >
    & {
      quota?: QuotaGuard;
      verifyMagicBytes: boolean;
      requireMimeType: boolean;
    };

  /**
   * 创建上传处理器
   *
   * @param config - 上传配置
   */
  constructor(config: UploaderConfig) {
    this.config = {
      uploadDir: config.uploadDir,
      storage: config.storage || new LocalStorage(),
      validation: config.validation || {},
      maxTotalSize: config.maxTotalSize || 100 * 1024 * 1024,
      generateFilename: config.generateFilename ||
        ((name) => generateFilename(name, true)),
      preserveExtension: config.preserveExtension ?? true,
      generateSubdir: config.generateSubdir || (() => ""),
      verifyMagicBytes: config.verifyMagicBytes ?? true,
      requireMimeType: config.requireMimeType ?? false,
      quota: config.quota,
    };
  }

  /**
   * 初始化上传目录
   */
  async init(): Promise<void> {
    await this.config.storage.mkdir(this.config.uploadDir);
  }

  /**
   * 获取存储实例
   */
  getStorage(): FileStorage {
    return this.config.storage;
  }

  /**
   * 获取验证配置
   */
  getValidation(): FileValidationOptions {
    return this.config.validation;
  }

  /**
   * 上传单个文件
   *
   * @param content - 文件内容
   * @param originalName - 原始文件名
   * @param mimeType - MIME 类型
   * @param fieldName - 表单字段名
   * @param options.signal - 取消信号（加法）
   * @returns 上传的文件信息
   */
  async upload(
    content: Uint8Array,
    originalName: string,
    mimeType: string,
    fieldName = "file",
    options?: { signal?: AbortSignal },
  ): Promise<UploadedFile> {
    if (options?.signal?.aborted) {
      throw new DOMException("Upload aborted", "AbortError");
    }
    const safeName = sanitizeFilename(originalName) || "file";
    const allowed = this.config.validation.allowedMimeTypes;
    // 缺 MIME：若配置了 allowlist 或显式 requireMimeType 则拒绝
    if (
      (!mimeType || !mimeType.trim()) &&
      ((allowed && allowed.length > 0) || this.config.requireMimeType)
    ) {
      throw new Error("缺少 MIME 类型");
    }

    const validation = validateFile(
      {
        name: safeName,
        type: mimeType || "application/octet-stream",
        size: content.length,
      },
      this.config.validation,
    );
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    // 魔数／扩展名／危险载荷统一策略（不信客户端 MIME）
    if (this.config.verifyMagicBytes && content.length > 0) {
      const magic = validateUploadContent(
        safeName,
        content,
        mimeType || undefined,
      );
      if (!magic.valid) {
        throw new Error(magic.error || "文件内容校验失败");
      }
    }

    if (this.config.quota) {
      this.config.quota.reserve(content.length);
    }

    const filename = sanitizeFilename(
      this.config.generateFilename(safeName, mimeType),
    ) || generateFilename(safeName, true);

    const rawSubdir = this.config.generateSubdir() || "";
    const subdir = rawSubdir ? sanitizeObjectKey(rawSubdir) : "";
    // 相对键：subdir/filename；落盘路径必须在 uploadDir 牢笼内
    const relativeKey = subdir ? `${subdir}/${filename}` : filename;
    const absPath = assertPathSafe(this.config.uploadDir, relativeKey);

    // LocalStorage 按绝对／原样路径读写；mkdir 父目录
    const dir = subdir
      ? assertPathSafe(this.config.uploadDir, subdir)
      : this.config.uploadDir;
    await this.config.storage.mkdir(dir);
    await this.config.storage.save(absPath, content);

    return {
      originalName,
      filename,
      path: absPath,
      size: content.length,
      mimeType: mimeType || "application/octet-stream",
      fieldName,
    };
  }

  /**
   * 从 File 对象上传
   *
   * @param file - File 对象
   * @param fieldName - 表单字段名
   * @returns 上传的文件信息
   */
  async uploadFile(file: File, fieldName = "file"): Promise<UploadedFile> {
    const content = new Uint8Array(await file.arrayBuffer());
    return this.upload(content, file.name, file.type, fieldName);
  }

  /**
   * 处理 FormData 上传
   *
   * @param formData - FormData 对象
   * @returns 上传结果
   */
  async handleFormData(formData: FormData): Promise<UploadResult> {
    const files: UploadedFile[] = [];
    let totalSize = 0;

    // 收集所有文件
    const fileEntries: Array<{ fieldName: string; file: File }> = [];
    for (const [fieldName, value] of formData.entries()) {
      if (value instanceof File) {
        fileEntries.push({ fieldName, file: value });
        totalSize += value.size;
      }
    }

    // 检查总大小
    if (totalSize > this.config.maxTotalSize) {
      return {
        success: false,
        files: [],
        count: 0,
        error: `总文件大小超过限制，最大允许 ${
          formatFileSize(this.config.maxTotalSize)
        }`,
        totalSize,
      };
    }

    // 上传每个文件
    try {
      for (const { fieldName, file } of fileEntries) {
        const uploaded = await this.uploadFile(file, fieldName);
        files.push(uploaded);
      }

      return {
        success: true,
        files,
        count: files.length,
        totalSize,
      };
    } catch (error) {
      return {
        success: false,
        files,
        count: files.length,
        error: error instanceof Error ? error.message : "上传失败",
        totalSize,
      };
    }
  }

  /**
   * 处理 Request 对象的上传
   *
   * @param request - Request 对象
   * @returns 上传结果
   */
  async handleRequest(request: Request): Promise<UploadResult> {
    const contentType = request.headers.get("content-type") || "";

    if (!contentType.includes("multipart/form-data")) {
      return {
        success: false,
        files: [],
        count: 0,
        error: "请求必须是 multipart/form-data 类型",
        totalSize: 0,
      };
    }

    const formData = await request.formData();
    return this.handleFormData(formData);
  }

  /**
   * 将调用方路径约束到 uploadDir 牢笼。
   *
   * 支持：相对键（推荐）或已是牢笼内的绝对路径。
   * 为何拒绝牢笼外绝对路径：Uploader.delete/read 曾直接透传，可删读任意文件。
   */
  private cagePath(path: string): string {
    const uploadDir = this.config.uploadDir;
    if (path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path)) {
      const normalizedUpload = uploadDir.replace(/\\/g, "/").replace(
        /\/+$/,
        "",
      );
      const normalizedPath = path.replace(/\\/g, "/");
      const prefix = normalizedUpload + "/";
      if (
        normalizedPath === normalizedUpload ||
        normalizedPath.startsWith(prefix)
      ) {
        const rel = normalizedPath.slice(prefix.length) || ".";
        if (rel === ".") return assertPathSafe(uploadDir, ".");
        return assertPathSafe(uploadDir, sanitizeObjectKey(rel));
      }
      throw new Error(`Path outside uploadDir: ${path}`);
    }
    return assertPathSafe(uploadDir, sanitizeObjectKey(path));
  }

  /**
   * 删除已上传的文件
   *
   * @param path - 文件路径
   */
  async delete(path: string): Promise<void> {
    await this.config.storage.delete(this.cagePath(path));
  }

  /**
   * 读取已上传的文件
   *
   * @param path - 文件路径
   * @returns 文件内容
   */
  async read(path: string): Promise<Uint8Array> {
    return await this.config.storage.read(this.cagePath(path));
  }

  /**
   * 检查文件是否存在
   *
   * @param path - 文件路径
   * @returns 是否存在
   */
  async exists(path: string): Promise<boolean> {
    return await this.config.storage.exists(this.cagePath(path));
  }

  /**
   * 获取上传目录
   */
  getUploadDir(): string {
    return this.config.uploadDir;
  }
}

/**
 * 创建上传处理器
 *
 * @param config - 上传配置
 * @returns Uploader 实例
 */
export function createUploader(config: UploaderConfig): Uploader {
  return new Uploader(config);
}
