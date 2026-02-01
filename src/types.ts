/**
 * @fileoverview 类型定义
 *
 * 文件上传相关的类型定义
 */

// ============================================================================
// 文件信息类型
// ============================================================================

/**
 * 上传的文件信息
 */
export interface UploadedFile {
  /** 原始文件名 */
  originalName: string;
  /** 保存后的文件名 */
  filename: string;
  /** 保存的完整路径 */
  path: string;
  /** 文件大小（字节） */
  size: number;
  /** MIME 类型 */
  mimeType: string;
  /** 表单字段名 */
  fieldName: string;
}

// ============================================================================
// 验证类型
// ============================================================================

/**
 * 文件验证参数
 */
export interface FileValidationInput {
  /** 文件名 */
  name: string;
  /** MIME 类型 */
  type: string;
  /** 文件大小（字节） */
  size?: number;
}

/**
 * 文件验证选项
 */
export interface FileValidationOptions {
  /** 单个文件最大大小（字节） */
  maxFileSize?: number;
  /** 允许的 MIME 类型 */
  allowedMimeTypes?: string[];
  /** 禁止的 MIME 类型 */
  forbiddenMimeTypes?: string[];
  /** 允许的文件扩展名 */
  allowedExtensions?: string[];
  /** 禁止的文件扩展名 */
  forbiddenExtensions?: string[];
}

/**
 * 文件验证结果
 */
export interface FileValidationResult {
  /** 是否验证通过 */
  valid: boolean;
  /** 错误信息 */
  error?: string;
}

// ============================================================================
// 存储类型
// ============================================================================

/**
 * 文件存储接口
 */
export interface FileStorage {
  /**
   * 保存文件
   *
   * @param path - 文件路径
   * @param content - 文件内容
   */
  save(path: string, content: Uint8Array): Promise<void>;

  /**
   * 读取文件
   *
   * @param path - 文件路径
   * @returns 文件内容
   */
  read(path: string): Promise<Uint8Array>;

  /**
   * 删除文件
   *
   * @param path - 文件路径
   */
  delete(path: string): Promise<void>;

  /**
   * 检查文件是否存在
   *
   * @param path - 文件路径
   * @returns 是否存在
   */
  exists(path: string): Promise<boolean>;

  /**
   * 创建目录
   *
   * @param path - 目录路径
   */
  mkdir(path: string): Promise<void>;
}

// ============================================================================
// 上传配置类型
// ============================================================================

/**
 * 上传处理器配置
 */
export interface UploaderConfig {
  /** 上传目录 */
  uploadDir: string;
  /** 文件存储实现 */
  storage?: FileStorage;
  /** 文件验证选项 */
  validation?: FileValidationOptions;
  /** 总大小限制（默认 100MB） */
  maxTotalSize?: number;
  /** 文件名生成函数 */
  generateFilename?: (originalName: string, mimeType: string) => string;
  /** 是否保留扩展名（默认 true） */
  preserveExtension?: boolean;
  /** 子目录生成函数（用于按日期等分类） */
  generateSubdir?: () => string;
}

/**
 * 上传结果
 */
export interface UploadResult {
  /** 是否成功 */
  success: boolean;
  /** 上传的文件列表 */
  files: UploadedFile[];
  /** 文件数量 */
  count: number;
  /** 总大小 */
  totalSize: number;
  /** 错误信息 */
  error?: string;
}
