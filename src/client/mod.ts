/**
 * @fileoverview 上传客户端模块
 *
 * 提供浏览器和 Deno 环境通用的文件上传客户端
 * 支持分片上传、断点续传、进度显示等功能
 *
 * @example
 * ```typescript
 * import { UploadClient } from "@dreamer/upload/client";
 *
 * const client = new UploadClient({
 *   endpoint: "https://api.example.com/upload",
 *   chunkSize: 5 * 1024 * 1024,
 * });
 *
 * const result = await client.upload(file, {
 *   onProgress: (p) => console.log(`${p.percentage}%`),
 * });
 * ```
 */

import { $tr } from "../i18n.ts";

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 上传客户端配置
 */
export interface UploadClientConfig {
  /** 上传端点 URL */
  endpoint: string;
  /** 分片大小（默认 5MB） */
  chunkSize?: number;
  /** 并发数（默认 3） */
  concurrency?: number;
  /** 重试次数（默认 3） */
  retries?: number;
  /** 重试延迟（毫秒，默认 1000） */
  retryDelay?: number;
  /** 请求超时（毫秒，默认 30000） */
  timeout?: number;
  /** 自定义请求头 */
  headers?: Record<string, string>;
  /** 认证令牌 */
  token?: string;
  /** 是否自动持久化状态（浏览器使用 localStorage） */
  persistState?: boolean;
  /** 状态存储键前缀 */
  stateKeyPrefix?: string;
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
  completedChunks: number;
  /** 总分片数 */
  totalChunks: number;
  /** 当前上传速度（字节/秒） */
  speed: number;
  /** 预计剩余时间（秒） */
  remainingTime: number;
  /** 当前状态 */
  status: "pending" | "uploading" | "paused" | "completed" | "failed";
}

/**
 * 上传选项
 */
export interface UploadOptions {
  /** 自定义文件名 */
  filename?: string;
  /** 文件 MIME 类型 */
  mimeType?: string;
  /** 目标路径/目录 */
  path?: string;
  /** 进度回调 */
  onProgress?: (progress: UploadProgress) => void;
  /** 状态变化回调 */
  onStateChange?: (state: UploadState) => void;
  /** 自定义元数据 */
  metadata?: Record<string, unknown>;
  /** 是否覆盖同名文件 */
  overwrite?: boolean;
}

/**
 * 上传结果
 */
export interface UploadResult {
  /** 是否成功 */
  success: boolean;
  /** 文件 ID 或路径 */
  fileId?: string;
  /** 访问 URL */
  url?: string;
  /** 文件大小 */
  size: number;
  /** 文件名 */
  filename: string;
  /** MIME 类型 */
  mimeType?: string;
  /** 上传耗时（毫秒） */
  duration: number;
  /** 错误信息 */
  error?: string;
  /** 服务器响应数据 */
  data?: Record<string, unknown>;
}

/**
 * 分片信息
 */
export interface ChunkInfo {
  /** 分片索引（从 0 开始） */
  index: number;
  /** 开始位置 */
  start: number;
  /** 结束位置 */
  end: number;
  /** 分片大小 */
  size: number;
  /** 上传状态 */
  status: "pending" | "uploading" | "completed" | "failed";
  /** ETag（上传后返回） */
  etag?: string;
  /** 错误信息 */
  error?: string;
}

/**
 * 上传状态（用于持久化和恢复）
 */
export interface UploadState {
  /** 上传 ID */
  id: string;
  /** 文件名 */
  filename: string;
  /** 文件大小 */
  fileSize: number;
  /** 文件哈希（用于验证） */
  fileHash: string;
  /** 分片大小 */
  chunkSize: number;
  /** 分片列表 */
  chunks: ChunkInfo[];
  /** 服务器返回的上传 ID */
  uploadId?: string;
  /** 服务器返回的对象键（存储路径） */
  key?: string;
  /** 上传状态 */
  status: "pending" | "uploading" | "paused" | "completed" | "failed";
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;
  /** 自定义元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * 服务器初始化响应
 */
interface InitResponse {
  /** 上传 ID */
  uploadId: string;
  /** 对象键（服务端生成的存储路径） */
  key?: string;
  /** 分片上传 URL 列表 */
  urls?: string[];
  /** 额外数据 */
  data?: Record<string, unknown>;
}

/**
 * 分片上传响应
 */
interface ChunkResponse {
  /** ETag */
  etag?: string;
  /** 额外数据 */
  data?: Record<string, unknown>;
}

/**
 * 完成上传响应
 */
interface CompleteResponse {
  /** 文件 ID */
  fileId?: string;
  /** 访问 URL */
  url?: string;
  /** 额外数据 */
  data?: Record<string, unknown>;
}

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 计算文件哈希
 *
 * @param file - 文件数据
 * @returns 哈希值
 */
async function calculateFileHash(file: Uint8Array | File): Promise<string> {
  let data: Uint8Array;

  if (file instanceof File) {
    // 只取头尾各 1MB 计算哈希（提高大文件性能）
    const sampleSize = 1024 * 1024;
    if (file.size <= sampleSize * 2) {
      data = new Uint8Array(await file.arrayBuffer());
    } else {
      const head = new Uint8Array(
        await file.slice(0, sampleSize).arrayBuffer(),
      );
      const tail = new Uint8Array(await file.slice(-sampleSize).arrayBuffer());
      data = new Uint8Array(sampleSize * 2 + 8);
      data.set(head, 0);
      data.set(tail, sampleSize);
      // 添加文件大小
      const view = new DataView(data.buffer);
      view.setBigUint64(sampleSize * 2, BigInt(file.size));
    }
  } else {
    data = file;
  }

  const hashBuffer = await crypto.subtle.digest("SHA-256", data.slice());
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * 延迟函数
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 格式化文件大小
 */
function formatSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

// ============================================================================
// 上传客户端
// ============================================================================

/**
 * 上传客户端
 *
 * 提供完整的文件上传功能，支持分片上传和断点续传
 *
 * @example
 * ```typescript
 * // 基本使用
 * const client = new UploadClient({
 *   endpoint: "https://api.example.com/upload",
 * });
 *
 * // 上传文件
 * const result = await client.upload(file, {
 *   onProgress: (p) => {
 *     console.log(`进度: ${p.percentage}%`);
 *     console.log(`速度: ${formatSize(p.speed)}/s`);
 *   },
 * });
 *
 * if (result.success) {
 *   console.log(`上传成功: ${result.url}`);
 * }
 * ```
 *
 * @example
 * ```typescript
 * // 断点续传
 * const client = new UploadClient({
 *   endpoint: "https://api.example.com/upload",
 *   persistState: true,
 * });
 *
 * // 查看未完成的上传
 * const pending = await client.getPendingUploads();
 *
 * // 恢复上传
 * if (pending.length > 0) {
 *   const result = await client.resume(pending[0].id, file);
 * }
 * ```
 */
export class UploadClient {
  private config: Required<UploadClientConfig>;
  private activeUploads: Map<string, { abort: () => void }> = new Map();

  /**
   * 创建上传客户端
   *
   * @param config - 客户端配置
   */
  constructor(config: UploadClientConfig) {
    this.config = {
      endpoint: config.endpoint,
      chunkSize: config.chunkSize || 5 * 1024 * 1024, // 5MB
      concurrency: config.concurrency || 3,
      retries: config.retries || 3,
      retryDelay: config.retryDelay || 1000,
      timeout: config.timeout || 30000,
      headers: config.headers || {},
      token: config.token || "",
      persistState: config.persistState ?? false,
      stateKeyPrefix: config.stateKeyPrefix || "upload_state_",
    };
  }

  /**
   * 获取请求头
   */
  private getHeaders(extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
      ...this.config.headers,
      ...extra,
    };

    if (this.config.token) {
      headers["Authorization"] = `Bearer ${this.config.token}`;
    }

    return headers;
  }

  /**
   * 发送请求（带超时和重试）
   */
  private async request<T>(
    url: string,
    options: RequestInit & { retries?: number },
  ): Promise<T> {
    const retries = options.retries ?? this.config.retries;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(
          () => controller.abort(),
          this.config.timeout,
        );

        const response = await fetch(url, {
          ...options,
          signal: controller.signal,
          headers: this.getHeaders(options.headers as Record<string, string>),
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(
            $tr("upload.client.httpError", {
              status: String(response.status),
              statusText: response.statusText,
            }),
          );
        }

        return await response.json() as T;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt < retries) {
          await sleep(this.config.retryDelay * Math.pow(2, attempt));
        }
      }
    }

    throw lastError || new Error("请求失败");
  }

  /**
   * 初始化分片上传
   */
  private async initUpload(
    filename: string,
    fileSize: number,
    chunks: number,
    options?: UploadOptions,
  ): Promise<InitResponse> {
    return await this.request<InitResponse>(`${this.config.endpoint}/init`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename,
        fileSize,
        chunks,
        mimeType: options?.mimeType,
        path: options?.path,
        metadata: options?.metadata,
        overwrite: options?.overwrite,
      }),
    });
  }

  /**
   * 上传单个分片
   *
   * @param uploadId - 上传 ID
   * @param key - 对象键（服务端存储路径）
   * @param chunk - 分片信息
   * @param data - 分片数据
   * @param url - 自定义上传 URL（可选）
   */
  private async uploadChunk(
    uploadId: string,
    key: string,
    chunk: ChunkInfo,
    data: Uint8Array,
    url?: string,
  ): Promise<ChunkResponse> {
    const formData = new FormData();
    formData.append("file", new Blob([data.slice()]));
    formData.append("index", chunk.index.toString());
    formData.append("uploadId", uploadId);
    formData.append("key", key);

    const targetUrl = url || `${this.config.endpoint}/chunk`;

    return await this.request<ChunkResponse>(targetUrl, {
      method: "POST",
      body: formData,
    });
  }

  /**
   * 完成分片上传
   *
   * @param uploadId - 上传 ID
   * @param key - 对象键（服务端存储路径）
   * @param chunks - 分片列表
   * @param _options - 上传选项（保留用于扩展）
   */
  private async completeUpload(
    uploadId: string,
    key: string,
    chunks: ChunkInfo[],
    _options?: UploadOptions,
  ): Promise<CompleteResponse> {
    return await this.request<CompleteResponse>(
      `${this.config.endpoint}/complete`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          uploadId,
          key,
          chunks: chunks.map((c) => ({
            index: c.index,
            etag: c.etag,
            size: c.size,
          })),
        }),
      },
    );
  }

  /**
   * 计算分片信息
   */
  private calculateChunks(fileSize: number): ChunkInfo[] {
    const chunks: ChunkInfo[] = [];
    const chunkSize = this.config.chunkSize;
    let index = 0;
    let offset = 0;

    while (offset < fileSize) {
      const start = offset;
      const end = Math.min(offset + chunkSize, fileSize);

      chunks.push({
        index,
        start,
        end,
        size: end - start,
        status: "pending",
      });

      index++;
      offset = end;
    }

    return chunks;
  }

  /**
   * 保存上传状态
   */
  private saveState(state: UploadState): void {
    if (!this.config.persistState) return;

    try {
      const key = this.config.stateKeyPrefix + state.id;
      globalThis.localStorage?.setItem(key, JSON.stringify(state));
    } catch {
      // 忽略存储错误
    }
  }

  /**
   * 获取上传状态
   */
  private getState(id: string): UploadState | null {
    if (!this.config.persistState) return null;

    try {
      const key = this.config.stateKeyPrefix + id;
      const data = globalThis.localStorage?.getItem(key);
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  }

  /**
   * 删除上传状态
   */
  private deleteState(id: string): void {
    if (!this.config.persistState) return;

    try {
      const key = this.config.stateKeyPrefix + id;
      globalThis.localStorage?.removeItem(key);
    } catch {
      // 忽略删除错误
    }
  }

  /**
   * 上传文件
   *
   * @param file - 要上传的文件（File 对象或 Uint8Array）
   * @param options - 上传选项
   * @returns 上传结果
   */
  async upload(
    file: File | Uint8Array,
    options?: UploadOptions,
  ): Promise<UploadResult> {
    const startTime = Date.now();

    // 获取文件信息
    const filename = options?.filename ||
      (file instanceof File ? file.name : "file");
    const fileSize = file instanceof File ? file.size : file.length;
    const mimeType = options?.mimeType ||
      (file instanceof File ? file.type : "application/octet-stream");

    // 计算文件哈希
    const fileHash = await calculateFileHash(file);

    // 检查是否有可恢复的上传
    if (this.config.persistState) {
      const existingState = await this.findExistingUpload(fileHash, fileSize);
      if (existingState) {
        return this.resumeUpload(existingState, file, options);
      }
    }

    // 计算分片
    const chunks = this.calculateChunks(fileSize);

    // 创建上传状态
    const id = crypto.randomUUID();
    const state: UploadState = {
      id,
      filename,
      fileSize,
      fileHash,
      chunkSize: this.config.chunkSize,
      chunks,
      status: "pending",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      metadata: options?.metadata,
    };

    return this.executeUpload(state, file, { ...options, mimeType }, startTime);
  }

  /**
   * 执行上传
   */
  private async executeUpload(
    state: UploadState,
    file: File | Uint8Array,
    options: UploadOptions & { mimeType?: string },
    startTime: number,
  ): Promise<UploadResult> {
    let aborted = false;

    // 注册活动上传
    this.activeUploads.set(state.id, {
      abort: () => {
        aborted = true;
      },
    });

    try {
      // 初始化上传
      const initResponse = await this.initUpload(
        state.filename,
        state.fileSize,
        state.chunks.length,
        options,
      );

      state.uploadId = initResponse.uploadId;
      state.key = initResponse.key || state.filename; // 保存服务端返回的 key
      state.status = "uploading";
      state.updatedAt = Date.now();
      this.saveState(state);
      options.onStateChange?.(state);

      // 并发上传分片
      let completedSize = 0;
      const uploadQueue: Promise<void>[] = [];

      // 进度更新
      const updateProgress = () => {
        if (!options.onProgress) return;

        const elapsed = (Date.now() - startTime) / 1000;
        const speed = elapsed > 0 ? completedSize / elapsed : 0;
        const remaining = state.fileSize - completedSize;

        options.onProgress({
          loaded: completedSize,
          total: state.fileSize,
          percentage: Math.round((completedSize / state.fileSize) * 100),
          completedChunks: state.chunks.filter((c) =>
            c.status === "completed"
          ).length,
          totalChunks: state.chunks.length,
          speed,
          remainingTime: speed > 0 ? remaining / speed : 0,
          status: state.status,
        });
      };

      // 获取待上传的分片
      const pendingChunks = state.chunks.filter(
        (c) => c.status === "pending" || c.status === "failed",
      );

      for (const chunk of pendingChunks) {
        if (aborted) throw new Error($tr("upload.client.uploadCancelled"));

        // 控制并发
        if (uploadQueue.length >= this.config.concurrency) {
          await Promise.race(uploadQueue);
        }

        // 获取分片数据
        let chunkData: Uint8Array;
        if (file instanceof File) {
          chunkData = new Uint8Array(
            await file.slice(chunk.start, chunk.end).arrayBuffer(),
          );
        } else {
          chunkData = file.slice(chunk.start, chunk.end);
        }

        // 创建上传任务
        const uploadTask = (async () => {
          chunk.status = "uploading";
          state.updatedAt = Date.now();
          this.saveState(state);
          options.onStateChange?.(state);

          try {
            const response = await this.uploadChunk(
              state.uploadId!,
              state.key!,
              chunk,
              chunkData,
              initResponse.urls?.[chunk.index],
            );

            chunk.etag = response.etag;
            chunk.status = "completed";
            completedSize += chunk.size;
            updateProgress();
            state.updatedAt = Date.now();
            this.saveState(state);
            options.onStateChange?.(state);
          } catch (error) {
            chunk.status = "failed";
            chunk.error = error instanceof Error
              ? error.message
              : String(error);
            state.updatedAt = Date.now();
            this.saveState(state);
            options.onStateChange?.(state);
            throw error;
          }
        })();

        uploadQueue.push(uploadTask);

        // 清理已完成的任务
        uploadTask.finally(() => {
          const index = uploadQueue.indexOf(uploadTask);
          if (index > -1) uploadQueue.splice(index, 1);
        });
      }

      // 等待所有分片完成
      await Promise.all(uploadQueue);

      // 检查是否全部成功
      const failedChunks = state.chunks.filter((c) => c.status !== "completed");
      if (failedChunks.length > 0) {
        throw new Error(
          $tr("upload.client.chunksUploadFailed", {
            count: String(failedChunks.length),
          }),
        );
      }

      // 完成上传
      const completeResponse = await this.completeUpload(
        state.uploadId!,
        state.key!,
        state.chunks,
        options,
      );

      state.status = "completed";
      state.updatedAt = Date.now();
      this.deleteState(state.id);

      updateProgress();

      return {
        success: true,
        fileId: completeResponse.fileId,
        url: completeResponse.url,
        size: state.fileSize,
        filename: state.filename,
        mimeType: options.mimeType,
        duration: Date.now() - startTime,
        data: completeResponse.data,
      };
    } catch (error) {
      state.status = aborted ? "paused" : "failed";
      state.updatedAt = Date.now();
      this.saveState(state);
      options.onStateChange?.(state);

      return {
        success: false,
        size: state.fileSize,
        filename: state.filename,
        mimeType: options.mimeType,
        duration: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      this.activeUploads.delete(state.id);
    }
  }

  /**
   * 恢复上传
   */
  private async resumeUpload(
    state: UploadState,
    file: File | Uint8Array,
    options?: UploadOptions,
  ): Promise<UploadResult> {
    const fileSize = file instanceof File ? file.size : file.length;

    // 验证文件
    const fileHash = await calculateFileHash(file);
    if (fileHash !== state.fileHash || fileSize !== state.fileSize) {
      return {
        success: false,
        size: fileSize,
        filename: state.filename,
        duration: 0,
        error: "文件不匹配，无法恢复上传",
      };
    }

    return this.executeUpload(
      state,
      file,
      options || {},
      Date.now(),
    );
  }

  /**
   * 查找现有的未完成上传
   */
  private async findExistingUpload(
    fileHash: string,
    fileSize: number,
  ): Promise<UploadState | null> {
    const pending = await this.getPendingUploads();
    return (
      pending.find((s) => s.fileHash === fileHash && s.fileSize === fileSize) ||
      null
    );
  }

  /**
   * 恢复指定的上传
   *
   * @param uploadId - 上传 ID
   * @param file - 文件数据
   * @param options - 上传选项
   * @returns 上传结果
   */
  resume(
    uploadId: string,
    file: File | Uint8Array,
    options?: UploadOptions,
  ): Promise<UploadResult> {
    const state = this.getState(uploadId);
    if (!state) {
      return Promise.resolve({
        success: false,
        size: file instanceof File ? file.size : file.length,
        filename: options?.filename || "file",
        duration: 0,
        error: "上传状态不存在",
      });
    }

    return this.resumeUpload(state, file, options);
  }

  /**
   * 暂停上传
   *
   * @param uploadId - 上传 ID
   */
  pause(uploadId: string): void {
    const upload = this.activeUploads.get(uploadId);
    if (upload) {
      upload.abort();
    }
  }

  /**
   * 取消上传
   *
   * @param uploadId - 上传 ID
   */
  cancel(uploadId: string): void {
    this.pause(uploadId);
    this.deleteState(uploadId);
  }

  /**
   * 获取未完成的上传列表
   *
   * @returns 未完成的上传状态列表
   */
  getPendingUploads(): Promise<UploadState[]> {
    if (!this.config.persistState) return Promise.resolve([]);

    const pending: UploadState[] = [];
    const storage = globalThis.localStorage;

    if (storage) {
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (key?.startsWith(this.config.stateKeyPrefix)) {
          try {
            const data = storage.getItem(key);
            if (data) {
              const state = JSON.parse(data) as UploadState;
              if (
                state.status === "pending" ||
                state.status === "uploading" ||
                state.status === "paused"
              ) {
                pending.push(state);
              }
            }
          } catch {
            // 忽略解析错误
          }
        }
      }
    }

    return Promise.resolve(pending);
  }

  /**
   * 清理过期的上传状态
   *
   * @param maxAge - 最大保留时间（毫秒，默认 7 天）
   */
  cleanup(maxAge: number = 7 * 24 * 60 * 60 * 1000): void {
    if (!this.config.persistState) return;

    const now = Date.now();
    const storage = globalThis.localStorage;

    if (storage) {
      const keysToDelete: string[] = [];

      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (key?.startsWith(this.config.stateKeyPrefix)) {
          try {
            const data = storage.getItem(key);
            if (data) {
              const state = JSON.parse(data) as UploadState;
              if (now - state.updatedAt > maxAge) {
                keysToDelete.push(key);
              }
            }
          } catch {
            keysToDelete.push(key);
          }
        }
      }

      for (const key of keysToDelete) {
        storage.removeItem(key);
      }
    }
  }

  /**
   * 设置认证令牌
   *
   * @param token - 认证令牌
   */
  setToken(token: string): void {
    this.config.token = token;
  }

  /**
   * 设置自定义请求头
   *
   * @param headers - 请求头
   */
  setHeaders(headers: Record<string, string>): void {
    this.config.headers = { ...this.config.headers, ...headers };
  }
}

// ============================================================================
// 工厂函数
// ============================================================================

/**
 * 创建上传客户端
 *
 * @param config - 客户端配置
 * @returns 上传客户端实例
 *
 * @example
 * ```typescript
 * const client = createUploadClient({
 *   endpoint: "https://api.example.com/upload",
 *   chunkSize: 10 * 1024 * 1024,
 *   concurrency: 5,
 *   persistState: true,
 * });
 * ```
 */
export function createUploadClient(config: UploadClientConfig): UploadClient {
  return new UploadClient(config);
}

// ============================================================================
// 导出辅助函数
// ============================================================================

export { calculateFileHash, formatSize };
