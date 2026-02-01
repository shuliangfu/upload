/**
 * @fileoverview 分片上传模块
 *
 * 提供大文件分片上传功能，支持：
 * - 自动分片计算
 * - 并发上传
 * - 进度回调
 * - 重试机制
 *
 * @example
 * ```typescript
 * import { MultipartUploader } from "@dreamer/upload/multipart";
 *
 * const uploader = new MultipartUploader({
 *   partSize: 5 * 1024 * 1024, // 5MB 分片
 *   concurrency: 3,            // 3 个并发
 *   retries: 3,                // 重试 3 次
 * });
 *
 * const result = await uploader.upload({
 *   file: fileData,
 *   key: "large-file.zip",
 *   storage: s3Adapter,
 *   onProgress: (progress) => console.log(`${progress.percentage}%`),
 * });
 * ```
 */

import type { CloudStorageAdapter, CloudUploadOptions } from "./adapters/types.ts";
import { formatFileSize } from "./utils.ts";

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 分片信息
 */
export interface UploadPart {
  /** 分片编号（从 1 开始） */
  partNumber: number;
  /** 分片开始位置 */
  start: number;
  /** 分片结束位置 */
  end: number;
  /** 分片大小 */
  size: number;
  /** 分片 ETag（上传后填充） */
  etag?: string;
  /** 上传状态 */
  status: "pending" | "uploading" | "completed" | "failed";
  /** 错误信息 */
  error?: string;
}

/**
 * 分片上传状态
 */
export interface MultipartUploadState {
  /** 上传 ID（云存储返回） */
  uploadId: string;
  /** 对象键 */
  key: string;
  /** 文件大小 */
  fileSize: number;
  /** 分片大小 */
  partSize: number;
  /** 分片列表 */
  parts: UploadPart[];
  /** 开始时间 */
  startTime: number;
  /** 上传选项 */
  options?: CloudUploadOptions;
}

/**
 * 分片上传配置
 */
export interface MultipartUploadConfig {
  /** 分片大小（默认 5MB） */
  partSize?: number;
  /** 并发数（默认 3） */
  concurrency?: number;
  /** 重试次数（默认 3） */
  retries?: number;
  /** 重试延迟（毫秒，默认 1000） */
  retryDelay?: number;
}

/**
 * 上传进度信息
 */
export interface UploadProgress {
  /** 已上传字节数 */
  loaded: number;
  /** 总字节数 */
  total: number;
  /** 百分比（0-100） */
  percentage: number;
  /** 已完成分片数 */
  completedParts: number;
  /** 总分片数 */
  totalParts: number;
  /** 当前上传速度（字节/秒） */
  speed: number;
  /** 预计剩余时间（秒） */
  remainingTime: number;
}

/**
 * 分片上传参数
 */
export interface MultipartUploadParams {
  /** 文件数据 */
  file: Uint8Array;
  /** 对象键 */
  key: string;
  /** 存储适配器 */
  storage: CloudStorageAdapter;
  /** 上传选项 */
  options?: CloudUploadOptions;
  /** 进度回调 */
  onProgress?: (progress: UploadProgress) => void;
  /** 状态变化回调（用于断点续传） */
  onStateChange?: (state: MultipartUploadState) => void;
  /** 恢复的上传状态（用于断点续传） */
  resumeState?: MultipartUploadState;
}

/**
 * 分片上传结果
 */
export interface MultipartUploadResult {
  /** 是否成功 */
  success: boolean;
  /** 对象键 */
  key: string;
  /** 文件大小 */
  size: number;
  /** ETag */
  etag?: string;
  /** 分片数量 */
  partCount: number;
  /** 耗时（毫秒） */
  duration: number;
  /** 错误信息 */
  error?: string;
}

// ============================================================================
// 常量
// ============================================================================

/** 最小分片大小（5MB） */
const MIN_PART_SIZE = 5 * 1024 * 1024;

/** 最大分片大小（5GB） */
const MAX_PART_SIZE = 5 * 1024 * 1024 * 1024;

/** 最大分片数量 */
const MAX_PARTS = 10000;

/** 默认分片大小（5MB） */
const DEFAULT_PART_SIZE = 5 * 1024 * 1024;

/** 默认并发数 */
const DEFAULT_CONCURRENCY = 3;

/** 默认重试次数 */
const DEFAULT_RETRIES = 3;

/** 默认重试延迟（毫秒） */
const DEFAULT_RETRY_DELAY = 1000;

// ============================================================================
// 分片上传器
// ============================================================================

/**
 * 分片上传器
 *
 * 提供大文件分片上传功能
 *
 * @example
 * ```typescript
 * const uploader = new MultipartUploader({
 *   partSize: 10 * 1024 * 1024, // 10MB
 *   concurrency: 5,
 * });
 *
 * const result = await uploader.upload({
 *   file: largeFileData,
 *   key: "videos/movie.mp4",
 *   storage: s3Adapter,
 *   onProgress: (p) => console.log(`${p.percentage}%`),
 * });
 * ```
 */
export class MultipartUploader {
  private config: Required<MultipartUploadConfig>;

  /**
   * 创建分片上传器实例
   *
   * @param config - 分片上传配置
   */
  constructor(config: MultipartUploadConfig = {}) {
    const partSize = config.partSize || DEFAULT_PART_SIZE;

    // 验证分片大小
    if (partSize < MIN_PART_SIZE) {
      throw new Error(`分片大小不能小于 ${formatFileSize(MIN_PART_SIZE)}`);
    }
    if (partSize > MAX_PART_SIZE) {
      throw new Error(`分片大小不能大于 ${formatFileSize(MAX_PART_SIZE)}`);
    }

    this.config = {
      partSize,
      concurrency: config.concurrency || DEFAULT_CONCURRENCY,
      retries: config.retries || DEFAULT_RETRIES,
      retryDelay: config.retryDelay || DEFAULT_RETRY_DELAY,
    };
  }

  /**
   * 计算分片信息
   *
   * @param fileSize - 文件大小
   * @param partSize - 分片大小
   * @returns 分片列表
   */
  private calculateParts(fileSize: number, partSize: number): UploadPart[] {
    const parts: UploadPart[] = [];
    let partNumber = 1;
    let offset = 0;

    while (offset < fileSize) {
      const start = offset;
      const end = Math.min(offset + partSize, fileSize);
      const size = end - start;

      parts.push({
        partNumber,
        start,
        end,
        size,
        status: "pending",
      });

      partNumber++;
      offset = end;
    }

    // 检查分片数量限制
    if (parts.length > MAX_PARTS) {
      throw new Error(
        `文件过大，分片数量 ${parts.length} 超过最大限制 ${MAX_PARTS}`,
      );
    }

    return parts;
  }

  /**
   * 上传单个分片（带重试）
   *
   * @param storage - 存储适配器
   * @param key - 对象键
   * @param uploadId - 上传 ID
   * @param part - 分片信息
   * @param data - 分片数据
   * @returns 分片 ETag
   */
  private async uploadPartWithRetry(
    storage: CloudStorageAdapter,
    key: string,
    uploadId: string,
    part: UploadPart,
    data: Uint8Array,
  ): Promise<string> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.config.retries; attempt++) {
      try {
        // 调用存储适配器上传分片
        const etag = await this.uploadPart(storage, key, uploadId, part, data);
        return etag;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // 如果不是最后一次重试，等待后重试
        if (attempt < this.config.retries) {
          const delay = this.config.retryDelay * Math.pow(2, attempt);
          await this.sleep(delay);
        }
      }
    }

    throw lastError || new Error("上传分片失败");
  }

  /**
   * 上传单个分片
   *
   * 使用云存储的原生分片上传 API
   *
   * @param storage - 存储适配器
   * @param key - 对象键
   * @param uploadId - 上传 ID
   * @param part - 分片信息
   * @param data - 分片数据
   * @returns 分片 ETag
   */
  private async uploadPart(
    storage: CloudStorageAdapter,
    key: string,
    uploadId: string,
    part: UploadPart,
    data: Uint8Array,
  ): Promise<string> {
    // 使用云存储的原生分片上传 API
    const result = await storage.uploadPart(key, uploadId, part.partNumber, data);
    return result.etag;
  }

  /**
   * 延迟函数
   *
   * @param ms - 延迟毫秒数
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 执行分片上传
   *
   * @param params - 上传参数
   * @returns 上传结果
   */
  async upload(params: MultipartUploadParams): Promise<MultipartUploadResult> {
    const {
      file,
      key,
      storage,
      options,
      onProgress,
      onStateChange,
      resumeState,
    } = params;

    const startTime = Date.now();

    try {
      // 初始化或恢复状态
      let state: MultipartUploadState;

      if (resumeState) {
        // 恢复上传
        state = resumeState;
      } else {
        // 新上传 - 使用云存储的原生分片上传 API 初始化
        const parts = this.calculateParts(file.length, this.config.partSize);
        const initResult = await storage.initiateMultipartUpload(key, options);
        state = {
          uploadId: initResult.uploadId,
          key,
          fileSize: file.length,
          partSize: this.config.partSize,
          parts,
          startTime,
          options,
        };
      }

      // 通知状态变化
      onStateChange?.(state);

      // 获取待上传的分片
      const pendingParts = state.parts.filter(
        (p) => p.status === "pending" || p.status === "failed",
      );

      // 并发上传控制
      const uploadQueue: Promise<void>[] = [];
      let completedSize = state.parts
        .filter((p) => p.status === "completed")
        .reduce((sum, p) => sum + p.size, 0);

      // 进度更新函数
      const updateProgress = () => {
        if (!onProgress) return;

        const elapsed = (Date.now() - startTime) / 1000;
        const speed = elapsed > 0 ? completedSize / elapsed : 0;
        const remaining = file.length - completedSize;
        const remainingTime = speed > 0 ? remaining / speed : 0;

        onProgress({
          loaded: completedSize,
          total: file.length,
          percentage: Math.round((completedSize / file.length) * 100),
          completedParts: state.parts.filter((p) => p.status === "completed").length,
          totalParts: state.parts.length,
          speed,
          remainingTime,
        });
      };

      // 上传分片
      for (const part of pendingParts) {
        // 控制并发数
        if (uploadQueue.length >= this.config.concurrency) {
          await Promise.race(uploadQueue);
        }

        // 获取分片数据
        const partData = file.slice(part.start, part.end);

        // 创建上传任务
        const uploadTask = (async () => {
          part.status = "uploading";
          onStateChange?.(state);

          try {
            const etag = await this.uploadPartWithRetry(
              storage,
              key,
              state.uploadId,
              part,
              partData,
            );

            part.etag = etag;
            part.status = "completed";
            completedSize += part.size;
            updateProgress();
            onStateChange?.(state);
          } catch (error) {
            part.status = "failed";
            part.error = error instanceof Error ? error.message : String(error);
            onStateChange?.(state);
            throw error;
          }
        })();

        uploadQueue.push(uploadTask);

        // 移除已完成的任务
        uploadTask.finally(() => {
          const index = uploadQueue.indexOf(uploadTask);
          if (index > -1) {
            uploadQueue.splice(index, 1);
          }
        });
      }

      // 等待所有分片上传完成
      await Promise.all(uploadQueue);

      // 检查是否所有分片都上传成功
      const failedParts = state.parts.filter((p) => p.status !== "completed");
      if (failedParts.length > 0) {
        throw new Error(`${failedParts.length} 个分片上传失败`);
      }

      // 合并分片（简化实现）
      await this.completeMultipartUpload(storage, key, state);

      const duration = Date.now() - startTime;

      return {
        success: true,
        key,
        size: file.length,
        partCount: state.parts.length,
        duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      return {
        success: false,
        key,
        size: file.length,
        partCount: 0,
        duration,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 完成分片上传
   *
   * 使用云存储的原生 API 完成分片上传，由云端合并分片
   *
   * @param storage - 存储适配器
   * @param key - 对象键
   * @param state - 上传状态
   */
  private async completeMultipartUpload(
    storage: CloudStorageAdapter,
    key: string,
    state: MultipartUploadState,
  ): Promise<void> {
    // 收集已完成的分片信息
    const completedParts = state.parts
      .filter((p) => p.status === "completed" && p.etag)
      .map((p) => ({
        partNumber: p.partNumber,
        etag: p.etag!,
      }));

    // 使用云存储的原生 API 完成分片上传
    await storage.completeMultipartUpload(key, state.uploadId, completedParts);
  }

  /**
   * 取消上传
   *
   * 使用云存储的原生 API 取消分片上传
   *
   * @param storage - 存储适配器
   * @param state - 上传状态
   */
  async abort(storage: CloudStorageAdapter, state: MultipartUploadState): Promise<void> {
    try {
      // 使用云存储的原生 API 取消分片上传
      await storage.abortMultipartUpload(state.key, state.uploadId);
    } catch {
      // 忽略取消错误（可能已经完成或不存在）
    }
  }
}

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 计算推荐的分片大小
 *
 * 根据文件大小自动计算最优分片大小
 *
 * @param fileSize - 文件大小
 * @returns 推荐的分片大小
 */
export function calculatePartSize(fileSize: number): number {
  // 小于 100MB：5MB 分片
  if (fileSize < 100 * 1024 * 1024) {
    return 5 * 1024 * 1024;
  }

  // 100MB - 1GB：10MB 分片
  if (fileSize < 1024 * 1024 * 1024) {
    return 10 * 1024 * 1024;
  }

  // 1GB - 10GB：50MB 分片
  if (fileSize < 10 * 1024 * 1024 * 1024) {
    return 50 * 1024 * 1024;
  }

  // 大于 10GB：100MB 分片
  return 100 * 1024 * 1024;
}

// formatFileSize 已从 utils.ts 导入，避免重复定义

/**
 * 创建分片上传器
 *
 * @param config - 配置选项
 * @returns 分片上传器实例
 *
 * @example
 * ```typescript
 * const uploader = createMultipartUploader({
 *   partSize: 10 * 1024 * 1024,
 *   concurrency: 5,
 * });
 * ```
 */
export function createMultipartUploader(
  config?: MultipartUploadConfig,
): MultipartUploader {
  return new MultipartUploader(config);
}
