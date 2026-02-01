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
import { formatFileSize, generateFilename, validateFile } from "./utils.ts";

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
  private config: Required<UploaderConfig>;

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
   * @returns 上传的文件信息
   */
  async upload(
    content: Uint8Array,
    originalName: string,
    mimeType: string,
    fieldName = "file",
  ): Promise<UploadedFile> {
    // 验证文件
    const validation = validateFile(
      { name: originalName, type: mimeType, size: content.length },
      this.config.validation,
    );

    if (!validation.valid) {
      throw new Error(validation.error);
    }

    // 生成文件名
    const filename = this.config.generateFilename(originalName, mimeType);

    // 生成子目录
    const subdir = this.config.generateSubdir();
    const dir = subdir
      ? `${this.config.uploadDir}/${subdir}`
      : this.config.uploadDir;

    // 确保目录存在
    await this.config.storage.mkdir(dir);

    // 完整路径
    const path = `${dir}/${filename}`;

    // 保存文件
    await this.config.storage.save(path, content);

    return {
      originalName,
      filename,
      path,
      size: content.length,
      mimeType,
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
        error: `总文件大小超过限制，最大允许 ${formatFileSize(this.config.maxTotalSize)}`,
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
   * 删除已上传的文件
   *
   * @param path - 文件路径
   */
  async delete(path: string): Promise<void> {
    await this.config.storage.delete(path);
  }

  /**
   * 读取已上传的文件
   *
   * @param path - 文件路径
   * @returns 文件内容
   */
  async read(path: string): Promise<Uint8Array> {
    return await this.config.storage.read(path);
  }

  /**
   * 检查文件是否存在
   *
   * @param path - 文件路径
   * @returns 是否存在
   */
  async exists(path: string): Promise<boolean> {
    return await this.config.storage.exists(path);
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
