/**
 * @fileoverview 断点续传模块
 *
 * 提供上传断点续传功能，支持：
 * - 上传状态持久化
 * - 自动恢复上传
 * - 进度保存
 * - 分片校验
 *
 * @example
 * ```typescript
 * import { ResumableUploader } from "@dreamer/upload/resumable";
 *
 * const uploader = new ResumableUploader({
 *   storage: s3Adapter,
 *   stateStore: new MemoryStateStore(),
 * });
 *
 * // 开始上传
 * const result = await uploader.upload({
 *   file: fileData,
 *   key: "large-file.zip",
 *   onProgress: (p) => console.log(`${p.percentage}%`),
 * });
 *
 * // 恢复上传
 * const pendingUploads = await uploader.listPending();
 * for (const upload of pendingUploads) {
 *   await uploader.resume(upload.id);
 * }
 * ```
 */

import type { CloudStorageAdapter, CloudUploadOptions } from "./adapters/types.ts";
import {
  createMultipartUploader,
  type MultipartUploadConfig,
  type MultipartUploadState,
  type UploadProgress,
} from "./multipart.ts";

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 上传状态存储接口
 */
export interface UploadStateStore {
  /**
   * 保存上传状态
   *
   * @param id - 上传 ID
   * @param state - 上传状态
   */
  save(id: string, state: ResumableUploadState): Promise<void>;

  /**
   * 获取上传状态
   *
   * @param id - 上传 ID
   * @returns 上传状态，不存在返回 null
   */
  get(id: string): Promise<ResumableUploadState | null>;

  /**
   * 删除上传状态
   *
   * @param id - 上传 ID
   */
  delete(id: string): Promise<void>;

  /**
   * 列出所有待处理的上传
   *
   * @returns 待处理的上传状态列表
   */
  listPending(): Promise<ResumableUploadState[]>;

  /**
   * 清理过期的上传状态
   *
   * @param maxAge - 最大保留时间（毫秒）
   */
  cleanup(maxAge: number): Promise<void>;
}

/**
 * 可恢复上传状态
 */
export interface ResumableUploadState {
  /** 上传 ID */
  id: string;
  /** 对象键 */
  key: string;
  /** 文件名 */
  filename: string;
  /** 文件大小 */
  fileSize: number;
  /** 文件哈希（用于验证） */
  fileHash: string;
  /** 上传状态 */
  status: "pending" | "uploading" | "paused" | "completed" | "failed" | "cancelled";
  /** 分片上传状态 */
  multipartState?: MultipartUploadState;
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;
  /** 上传选项 */
  options?: CloudUploadOptions;
  /** 错误信息 */
  error?: string;
  /** 自定义元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * 断点续传配置
 */
export interface ResumableUploaderConfig extends MultipartUploadConfig {
  /** 存储适配器 */
  storage: CloudStorageAdapter;
  /** 状态存储 */
  stateStore: UploadStateStore;
  /** 自动保存间隔（毫秒，默认 1000） */
  autoSaveInterval?: number;
  /** 状态过期时间（毫秒，默认 7 天） */
  stateExpiry?: number;
}

/**
 * 上传参数
 */
export interface ResumableUploadParams {
  /** 文件数据 */
  file: Uint8Array;
  /** 对象键 */
  key: string;
  /** 文件名 */
  filename?: string;
  /** 上传选项 */
  options?: CloudUploadOptions;
  /** 进度回调 */
  onProgress?: (progress: UploadProgress) => void;
  /** 状态变化回调 */
  onStateChange?: (state: ResumableUploadState) => void;
  /** 自定义元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * 上传结果
 */
export interface ResumableUploadResult {
  /** 是否成功 */
  success: boolean;
  /** 上传 ID */
  id: string;
  /** 对象键 */
  key: string;
  /** 文件大小 */
  size: number;
  /** 分片数量 */
  partCount: number;
  /** 耗时（毫秒） */
  duration: number;
  /** 错误信息 */
  error?: string;
}

/**
 * 待处理上传信息
 */
export interface PendingUpload {
  /** 上传 ID */
  id: string;
  /** 对象键 */
  key: string;
  /** 文件名 */
  filename: string;
  /** 文件大小 */
  fileSize: number;
  /** 上传状态 */
  status: string;
  /** 已完成分片数 */
  completedParts: number;
  /** 总分片数 */
  totalParts: number;
  /** 进度百分比 */
  percentage: number;
  /** 创建时间 */
  createdAt: Date;
  /** 更新时间 */
  updatedAt: Date;
}

// ============================================================================
// 内存状态存储
// ============================================================================

/**
 * 内存状态存储实现
 *
 * 将上传状态存储在内存中，适用于开发和测试
 * 生产环境建议使用持久化存储（如 Redis、数据库等）
 */
export class MemoryStateStore implements UploadStateStore {
  private states: Map<string, ResumableUploadState> = new Map();

  /**
   * 保存上传状态
   */
  save(id: string, state: ResumableUploadState): Promise<void> {
    this.states.set(id, { ...state, updatedAt: Date.now() });
    return Promise.resolve();
  }

  /**
   * 获取上传状态
   */
  get(id: string): Promise<ResumableUploadState | null> {
    return Promise.resolve(this.states.get(id) || null);
  }

  /**
   * 删除上传状态
   */
  delete(id: string): Promise<void> {
    this.states.delete(id);
    return Promise.resolve();
  }

  /**
   * 列出待处理的上传
   */
  listPending(): Promise<ResumableUploadState[]> {
    const pending = Array.from(this.states.values()).filter(
      (s) => s.status === "pending" || s.status === "paused" || s.status === "uploading",
    );
    return Promise.resolve(pending);
  }

  /**
   * 清理过期状态
   */
  cleanup(maxAge: number): Promise<void> {
    const now = Date.now();
    for (const [id, state] of this.states.entries()) {
      if (now - state.updatedAt > maxAge) {
        this.states.delete(id);
      }
    }
    return Promise.resolve();
  }
}

/**
 * LocalStorage 状态存储实现
 *
 * 将上传状态存储在浏览器 LocalStorage 中
 * 适用于浏览器环境
 */
export class LocalStorageStateStore implements UploadStateStore {
  private prefix: string;

  /**
   * 创建 LocalStorage 状态存储
   *
   * @param prefix - 存储键前缀
   */
  constructor(prefix = "resumable_upload_") {
    this.prefix = prefix;
  }

  /**
   * 保存上传状态
   */
  save(id: string, state: ResumableUploadState): Promise<void> {
    const key = this.prefix + id;
    const data = { ...state, updatedAt: Date.now() };
    globalThis.localStorage?.setItem(key, JSON.stringify(data));
    return Promise.resolve();
  }

  /**
   * 获取上传状态
   */
  get(id: string): Promise<ResumableUploadState | null> {
    const key = this.prefix + id;
    const data = globalThis.localStorage?.getItem(key);
    if (!data) return Promise.resolve(null);

    try {
      return Promise.resolve(JSON.parse(data));
    } catch {
      return Promise.resolve(null);
    }
  }

  /**
   * 删除上传状态
   */
  delete(id: string): Promise<void> {
    const key = this.prefix + id;
    globalThis.localStorage?.removeItem(key);
    return Promise.resolve();
  }

  /**
   * 列出待处理的上传
   */
  listPending(): Promise<ResumableUploadState[]> {
    const pending: ResumableUploadState[] = [];
    const storage = globalThis.localStorage;

    if (storage) {
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (key?.startsWith(this.prefix)) {
          const data = storage.getItem(key);
          if (data) {
            try {
              const state = JSON.parse(data) as ResumableUploadState;
              if (
                state.status === "pending" ||
                state.status === "paused" ||
                state.status === "uploading"
              ) {
                pending.push(state);
              }
            } catch {
              // 忽略解析错误
            }
          }
        }
      }
    }

    return Promise.resolve(pending);
  }

  /**
   * 清理过期状态
   */
  cleanup(maxAge: number): Promise<void> {
    const now = Date.now();
    const storage = globalThis.localStorage;

    if (storage) {
      const keysToDelete: string[] = [];

      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (key?.startsWith(this.prefix)) {
          const data = storage.getItem(key);
          if (data) {
            try {
              const state = JSON.parse(data) as ResumableUploadState;
              if (now - state.updatedAt > maxAge) {
                keysToDelete.push(key);
              }
            } catch {
              keysToDelete.push(key);
            }
          }
        }
      }

      for (const key of keysToDelete) {
        storage.removeItem(key);
      }
    }

    return Promise.resolve();
  }
}

// ============================================================================
// 断点续传上传器
// ============================================================================

/**
 * 断点续传上传器
 *
 * 提供可恢复的文件上传功能
 *
 * @example
 * ```typescript
 * const uploader = new ResumableUploader({
 *   storage: s3Adapter,
 *   stateStore: new MemoryStateStore(),
 *   partSize: 5 * 1024 * 1024,
 *   concurrency: 3,
 * });
 *
 * // 开始新上传
 * const result = await uploader.upload({
 *   file: fileData,
 *   key: "uploads/large-file.zip",
 *   filename: "large-file.zip",
 *   onProgress: (p) => console.log(`${p.percentage}%`),
 * });
 *
 * // 查看待处理上传
 * const pending = await uploader.listPending();
 * console.log(`有 ${pending.length} 个待处理上传`);
 *
 * // 恢复上传
 * await uploader.resume(pending[0].id, fileData);
 * ```
 */
export class ResumableUploader {
  private config: Required<Omit<ResumableUploaderConfig, keyof MultipartUploadConfig>> &
    MultipartUploadConfig;
  private storage: CloudStorageAdapter;
  private stateStore: UploadStateStore;
  private activeUploads: Map<string, { abort: () => void }> = new Map();

  /**
   * 创建断点续传上传器
   *
   * @param config - 配置选项
   */
  constructor(config: ResumableUploaderConfig) {
    this.storage = config.storage;
    this.stateStore = config.stateStore;
    this.config = {
      storage: config.storage,
      stateStore: config.stateStore,
      autoSaveInterval: config.autoSaveInterval || 1000,
      stateExpiry: config.stateExpiry || 7 * 24 * 60 * 60 * 1000,
      partSize: config.partSize,
      concurrency: config.concurrency,
      retries: config.retries,
      retryDelay: config.retryDelay,
    };
  }

  /**
   * 计算文件哈希
   *
   * @param data - 文件数据
   * @returns 哈希值
   */
  private async calculateFileHash(data: Uint8Array): Promise<string> {
    // 对于大文件，只计算头部和尾部的哈希以提高性能
    const sampleSize = 1024 * 1024; // 1MB

    let sample: Uint8Array;
    if (data.length <= sampleSize * 2) {
      sample = data;
    } else {
      // 取头部 1MB + 尾部 1MB
      sample = new Uint8Array(sampleSize * 2 + 8);
      sample.set(data.slice(0, sampleSize), 0);
      sample.set(data.slice(-sampleSize), sampleSize);

      // 添加文件大小作为额外信息
      const view = new DataView(sample.buffer);
      view.setBigUint64(sampleSize * 2, BigInt(data.length));
    }

    const hashBuffer = await crypto.subtle.digest("SHA-256", sample.slice());
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  /**
   * 开始新的上传
   *
   * @param params - 上传参数
   * @returns 上传结果
   */
  async upload(params: ResumableUploadParams): Promise<ResumableUploadResult> {
    const { file, key, filename, options, onProgress, onStateChange, metadata } = params;

    const startTime = Date.now();
    const id = crypto.randomUUID();
    const fileHash = await this.calculateFileHash(file);

    // 检查是否有相同文件的未完成上传
    const existingUpload = await this.findExistingUpload(key, fileHash, file.length);
    if (existingUpload) {
      // 恢复现有上传
      return this.resume(existingUpload.id, file, onProgress, onStateChange);
    }

    // 创建新的上传状态
    const state: ResumableUploadState = {
      id,
      key,
      filename: filename || key.split("/").pop() || "file",
      fileSize: file.length,
      fileHash,
      status: "uploading",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      options,
      metadata,
    };

    await this.stateStore.save(id, state);

    // 执行上传
    return this.executeUpload(state, file, onProgress, onStateChange, startTime);
  }

  /**
   * 恢复上传
   *
   * @param id - 上传 ID
   * @param file - 文件数据
   * @param onProgress - 进度回调
   * @param onStateChange - 状态变化回调
   * @returns 上传结果
   */
  async resume(
    id: string,
    file: Uint8Array,
    onProgress?: (progress: UploadProgress) => void,
    onStateChange?: (state: ResumableUploadState) => void,
  ): Promise<ResumableUploadResult> {
    const state = await this.stateStore.get(id);
    if (!state) {
      return {
        success: false,
        id,
        key: "",
        size: 0,
        partCount: 0,
        duration: 0,
        error: "上传状态不存在",
      };
    }

    // 验证文件
    const fileHash = await this.calculateFileHash(file);
    if (fileHash !== state.fileHash || file.length !== state.fileSize) {
      return {
        success: false,
        id,
        key: state.key,
        size: file.length,
        partCount: 0,
        duration: 0,
        error: "文件不匹配，无法恢复上传",
      };
    }

    // 更新状态
    state.status = "uploading";
    state.updatedAt = Date.now();
    await this.stateStore.save(id, state);

    return this.executeUpload(state, file, onProgress, onStateChange, Date.now());
  }

  /**
   * 执行上传
   */
  private async executeUpload(
    state: ResumableUploadState,
    file: Uint8Array,
    onProgress?: (progress: UploadProgress) => void,
    onStateChange?: (state: ResumableUploadState) => void,
    startTime: number = Date.now(),
  ): Promise<ResumableUploadResult> {
    let aborted = false;

    // 注册活动上传
    this.activeUploads.set(state.id, {
      abort: () => {
        aborted = true;
      },
    });

    try {
      const uploader = createMultipartUploader({
        partSize: this.config.partSize,
        concurrency: this.config.concurrency,
        retries: this.config.retries,
        retryDelay: this.config.retryDelay,
      });

      // 自动保存状态
      let lastSaveTime = Date.now();
      const autoSave = async (multipartState: MultipartUploadState) => {
        const now = Date.now();
        if (now - lastSaveTime >= this.config.autoSaveInterval) {
          state.multipartState = multipartState;
          state.updatedAt = now;
          await this.stateStore.save(state.id, state);
          lastSaveTime = now;
        }
      };

      const result = await uploader.upload({
        file,
        key: state.key,
        storage: this.storage,
        options: state.options,
        onProgress,
        onStateChange: async (multipartState) => {
          if (aborted) throw new Error("上传已取消");
          state.multipartState = multipartState;
          onStateChange?.(state);
          await autoSave(multipartState);
        },
        resumeState: state.multipartState,
      });

      // 更新最终状态
      state.status = result.success ? "completed" : "failed";
      state.error = result.error;
      state.updatedAt = Date.now();
      await this.stateStore.save(state.id, state);

      // 成功后删除状态
      if (result.success) {
        await this.stateStore.delete(state.id);
      }

      return {
        success: result.success,
        id: state.id,
        key: state.key,
        size: state.fileSize,
        partCount: result.partCount,
        duration: result.duration,
        error: result.error,
      };
    } catch (error) {
      const duration = Date.now() - startTime;

      // 更新错误状态
      state.status = aborted ? "cancelled" : "failed";
      state.error = error instanceof Error ? error.message : String(error);
      state.updatedAt = Date.now();
      await this.stateStore.save(state.id, state);

      return {
        success: false,
        id: state.id,
        key: state.key,
        size: state.fileSize,
        partCount: 0,
        duration,
        error: state.error,
      };
    } finally {
      this.activeUploads.delete(state.id);
    }
  }

  /**
   * 暂停上传
   *
   * @param id - 上传 ID
   */
  async pause(id: string): Promise<void> {
    const upload = this.activeUploads.get(id);
    if (upload) {
      upload.abort();
    }

    const state = await this.stateStore.get(id);
    if (state) {
      state.status = "paused";
      state.updatedAt = Date.now();
      await this.stateStore.save(id, state);
    }
  }

  /**
   * 取消上传
   *
   * @param id - 上传 ID
   */
  async cancel(id: string): Promise<void> {
    const upload = this.activeUploads.get(id);
    if (upload) {
      upload.abort();
    }

    const state = await this.stateStore.get(id);
    if (state) {
      state.status = "cancelled";
      state.updatedAt = Date.now();
      await this.stateStore.save(id, state);

      // 清理已上传的分片
      if (state.multipartState) {
        const uploader = createMultipartUploader();
        await uploader.abort(this.storage, state.multipartState);
      }
    }
  }

  /**
   * 列出待处理的上传
   *
   * @returns 待处理上传列表
   */
  async listPending(): Promise<PendingUpload[]> {
    const states = await this.stateStore.listPending();

    return states.map((state) => {
      const completedParts = state.multipartState?.parts.filter(
        (p) => p.status === "completed",
      ).length || 0;
      const totalParts = state.multipartState?.parts.length || 1;

      return {
        id: state.id,
        key: state.key,
        filename: state.filename,
        fileSize: state.fileSize,
        status: state.status,
        completedParts,
        totalParts,
        percentage: Math.round((completedParts / totalParts) * 100),
        createdAt: new Date(state.createdAt),
        updatedAt: new Date(state.updatedAt),
      };
    });
  }

  /**
   * 获取上传状态
   *
   * @param id - 上传 ID
   * @returns 上传状态
   */
  getState(id: string): Promise<ResumableUploadState | null> {
    return this.stateStore.get(id);
  }

  /**
   * 清理过期的上传状态
   */
  async cleanup(): Promise<void> {
    await this.stateStore.cleanup(this.config.stateExpiry);
  }

  /**
   * 查找现有的未完成上传
   */
  private async findExistingUpload(
    key: string,
    fileHash: string,
    fileSize: number,
  ): Promise<ResumableUploadState | null> {
    const pending = await this.stateStore.listPending();

    return (
      pending.find(
        (s) => s.key === key && s.fileHash === fileHash && s.fileSize === fileSize,
      ) || null
    );
  }
}

// ============================================================================
// 工厂函数
// ============================================================================

/**
 * 创建断点续传上传器
 *
 * @param config - 配置选项
 * @returns 断点续传上传器实例
 */
export function createResumableUploader(
  config: ResumableUploaderConfig,
): ResumableUploader {
  return new ResumableUploader(config);
}
