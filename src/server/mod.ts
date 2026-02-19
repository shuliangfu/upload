/**
 * @fileoverview 服务端分片上传处理器
 *
 * 提供 HTTP 服务端分片上传处理功能，配合客户端使用
 *
 * @example
 * ```typescript
 * import { MultipartUploadHandler } from "@dreamer/upload/server";
 *
 * const handler = new MultipartUploadHandler({
 *   storage: s3Adapter,
 *   maxPartSize: 100 * 1024 * 1024,
 * });
 *
 * // 在 HTTP 服务器中使用
 * if (request.url.endsWith("/upload/init")) {
 *   return handler.handleInit(request);
 * }
 * if (request.url.endsWith("/upload/chunk")) {
 *   return handler.handleChunk(request);
 * }
 * if (request.url.endsWith("/upload/complete")) {
 *   return handler.handleComplete(request);
 * }
 * ```
 */

import type {
  CloudStorageAdapter,
  CloudUploadOptions,
  PartInfo,
} from "../adapters/types.ts";
import { $tr } from "../i18n.ts";

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 服务端处理器配置
 */
export interface MultipartUploadHandlerConfig {
  /** 存储适配器 */
  storage: CloudStorageAdapter;
  /** 最大分片大小（默认 100MB） */
  maxPartSize?: number;
  /** 最大文件大小（默认 5GB） */
  maxFileSize?: number;
  /** 允许的 MIME 类型 */
  allowedMimeTypes?: string[];
  /** 上传路径前缀 */
  pathPrefix?: string;
  /** 自定义路径生成函数 */
  generatePath?: (
    filename: string,
    metadata?: Record<string, unknown>,
  ) => string;
  /** 验证函数（返回 true 表示通过） */
  validate?: (
    filename: string,
    fileSize: number,
    mimeType?: string,
  ) => boolean | Promise<boolean>;
}

/**
 * 初始化请求
 */
export interface InitRequest {
  /** 文件名 */
  filename: string;
  /** 文件大小 */
  fileSize: number;
  /** 分片数量 */
  chunks: number;
  /** MIME 类型 */
  mimeType?: string;
  /** 目标路径 */
  path?: string;
  /** 自定义元数据 */
  metadata?: Record<string, unknown>;
  /** 是否覆盖同名文件 */
  overwrite?: boolean;
}

/**
 * 初始化响应
 */
export interface InitResponse {
  /** 上传 ID */
  uploadId: string;
  /** 对象键 */
  key: string;
  /** 分片上传 URL 列表（可选，用于预签名） */
  urls?: string[];
  /** 额外数据 */
  data?: Record<string, unknown>;
}

/**
 * 分片上传请求（通过 FormData） */
export interface ChunkRequest {
  /** 上传 ID */
  uploadId: string;
  /** 分片索引（从 0 开始） */
  index: number;
  /** 对象键 */
  key: string;
}

/**
 * 分片上传响应
 */
export interface ChunkResponse {
  /** 分片索引 */
  index: number;
  /** ETag */
  etag: string;
  /** 额外数据 */
  data?: Record<string, unknown>;
}

/**
 * 完成上传请求
 */
export interface CompleteRequest {
  /** 上传 ID */
  uploadId: string;
  /** 对象键 */
  key: string;
  /** 已上传的分片列表 */
  chunks: Array<{
    index: number;
    etag: string;
    size?: number;
  }>;
  /** 文件名 */
  filename: string;
  /** 自定义元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * 完成上传响应
 */
export interface CompleteResponse {
  /** 文件 ID / 对象键 */
  fileId: string;
  /** 访问 URL */
  url?: string;
  /** 额外数据 */
  data?: Record<string, unknown>;
}

/**
 * 取消上传请求
 */
export interface AbortRequest {
  /** 上传 ID */
  uploadId: string;
  /** 对象键 */
  key: string;
}

/**
 * 上传状态（用于断点续传查询）
 */
export interface UploadStatus {
  /** 上传 ID */
  uploadId: string;
  /** 对象键 */
  key: string;
  /** 已上传的分片 */
  parts: PartInfo[];
  /** 创建时间 */
  createdAt: Date;
}

// ============================================================================
// 服务端处理器
// ============================================================================

/**
 * 服务端分片上传处理器
 *
 * 处理客户端的分片上传请求
 *
 * @example
 * ```typescript
 * const handler = new MultipartUploadHandler({
 *   storage: s3Adapter,
 * });
 *
 * // Deno/Hono/Fresh 等框架中使用
 * app.post("/upload/init", (c) => handler.handleInit(c.req.raw));
 * app.post("/upload/chunk", (c) => handler.handleChunk(c.req.raw));
 * app.post("/upload/complete", (c) => handler.handleComplete(c.req.raw));
 * app.post("/upload/abort", (c) => handler.handleAbort(c.req.raw));
 * ```
 */
export class MultipartUploadHandler {
  private config:
    & Required<
      Omit<MultipartUploadHandlerConfig, "validate" | "generatePath">
    >
    & {
      validate?: MultipartUploadHandlerConfig["validate"];
      generatePath?: MultipartUploadHandlerConfig["generatePath"];
    };

  /**
   * 创建服务端处理器
   *
   * @param config - 处理器配置
   */
  constructor(config: MultipartUploadHandlerConfig) {
    this.config = {
      storage: config.storage,
      maxPartSize: config.maxPartSize || 100 * 1024 * 1024,
      maxFileSize: config.maxFileSize || 5 * 1024 * 1024 * 1024,
      allowedMimeTypes: config.allowedMimeTypes || [],
      pathPrefix: config.pathPrefix || "",
      generatePath: config.generatePath,
      validate: config.validate,
    };
  }

  /**
   * 生成 JSON 响应
   */
  private jsonResponse(
    data: unknown,
    status = 200,
  ): Response {
    return new Response(JSON.stringify(data), {
      status,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  /**
   * 生成错误响应
   */
  private errorResponse(message: string, status = 400): Response {
    return this.jsonResponse({ error: message }, status);
  }

  /**
   * 生成对象键
   */
  private generateKey(
    filename: string,
    path?: string,
    metadata?: Record<string, unknown>,
  ): string {
    if (this.config.generatePath) {
      return this.config.generatePath(filename, metadata);
    }

    const prefix = this.config.pathPrefix;
    const targetPath = path || "";

    // 生成唯一文件名
    const ext = filename.includes(".")
      ? filename.substring(filename.lastIndexOf("."))
      : "";
    const uniqueName = `${crypto.randomUUID()}${ext}`;

    if (prefix && targetPath) {
      return `${prefix}/${targetPath}/${uniqueName}`;
    } else if (prefix) {
      return `${prefix}/${uniqueName}`;
    } else if (targetPath) {
      return `${targetPath}/${uniqueName}`;
    }

    return uniqueName;
  }

  /**
   * 处理初始化请求
   *
   * @param request - HTTP 请求
   * @returns HTTP 响应
   */
  async handleInit(request: Request): Promise<Response> {
    try {
      const body = (await request.json()) as InitRequest;

      // 验证请求
      if (!body.filename || !body.fileSize || !body.chunks) {
        return this.errorResponse("缺少必要参数: filename, fileSize, chunks");
      }

      // 检查文件大小
      if (body.fileSize > this.config.maxFileSize) {
        return this.errorResponse(
          `文件大小超过限制: 最大 ${this.formatSize(this.config.maxFileSize)}`,
        );
      }

      // 检查 MIME 类型
      if (
        this.config.allowedMimeTypes.length > 0 &&
        body.mimeType &&
        !this.config.allowedMimeTypes.some((t) =>
          this.matchMimeType(body.mimeType!, t)
        )
      ) {
        return this.errorResponse(`不支持的文件类型: ${body.mimeType}`);
      }

      // 自定义验证
      if (this.config.validate) {
        const valid = await this.config.validate(
          body.filename,
          body.fileSize,
          body.mimeType,
        );
        if (!valid) {
          return this.errorResponse("文件验证失败");
        }
      }

      // 生成对象键
      const key = this.generateKey(body.filename, body.path, body.metadata);

      // 构建上传选项
      const options: CloudUploadOptions = {};
      if (body.mimeType) {
        options.contentType = body.mimeType;
      }
      if (body.metadata) {
        options.metadata = {};
        for (const [k, v] of Object.entries(body.metadata)) {
          if (typeof v === "string") {
            options.metadata[k] = v;
          } else {
            options.metadata[k] = JSON.stringify(v);
          }
        }
      }

      // 初始化分片上传
      const result = await this.config.storage.initiateMultipartUpload(
        key,
        options,
      );

      const response: InitResponse = {
        uploadId: result.uploadId,
        key: result.key,
      };

      return this.jsonResponse(response);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error($tr("upload.server.initMultipartFailed", { message }));
      return this.errorResponse(message, 500);
    }
  }

  /**
   * 处理分片上传请求
   *
   * @param request - HTTP 请求
   * @returns HTTP 响应
   */
  async handleChunk(request: Request): Promise<Response> {
    try {
      const contentType = request.headers.get("content-type") || "";

      if (!contentType.includes("multipart/form-data")) {
        return this.errorResponse("请求必须是 multipart/form-data 类型");
      }

      const formData = await request.formData();
      const uploadId = formData.get("uploadId") as string;
      const indexStr = formData.get("index") as string;
      const key = formData.get("key") as string;
      const file = formData.get("file") as File;

      if (!uploadId || indexStr === null || !key || !file) {
        return this.errorResponse("缺少必要参数: uploadId, index, key, file");
      }

      const index = parseInt(indexStr, 10);
      if (isNaN(index) || index < 0) {
        return this.errorResponse("无效的分片索引");
      }

      // 检查分片大小
      if (file.size > this.config.maxPartSize) {
        return this.errorResponse(
          `分片大小超过限制: 最大 ${this.formatSize(this.config.maxPartSize)}`,
        );
      }

      // 读取分片数据
      const data = new Uint8Array(await file.arrayBuffer());

      // 上传分片（partNumber 从 1 开始）
      const result = await this.config.storage.uploadPart(
        key,
        uploadId,
        index + 1,
        data,
      );

      const response: ChunkResponse = {
        index,
        etag: result.etag,
      };

      return this.jsonResponse(response);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error($tr("upload.server.uploadPartFailed", { message }));
      return this.errorResponse(message, 500);
    }
  }

  /**
   * 处理完成上传请求
   *
   * @param request - HTTP 请求
   * @returns HTTP 响应
   */
  async handleComplete(request: Request): Promise<Response> {
    try {
      const body = (await request.json()) as CompleteRequest;

      if (!body.uploadId || !body.key || !body.chunks) {
        return this.errorResponse("缺少必要参数: uploadId, key, chunks");
      }

      // 转换分片信息（index 从 0 开始转为 partNumber 从 1 开始）
      const parts: PartInfo[] = body.chunks.map((c) => ({
        partNumber: c.index + 1,
        etag: c.etag,
        size: c.size,
      }));

      // 完成分片上传
      await this.config.storage.completeMultipartUpload(
        body.key,
        body.uploadId,
        parts,
      );

      // 生成访问 URL（可选）
      let url: string | undefined;
      try {
        url = await this.config.storage.getPresignedUrl(body.key, {
          expiresIn: 3600,
          method: "GET",
        });
      } catch {
        // 忽略预签名 URL 生成失败
      }

      const response: CompleteResponse = {
        fileId: body.key,
        url,
      };

      return this.jsonResponse(response);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error($tr("upload.server.completeMultipartFailed", { message }));
      return this.errorResponse(message, 500);
    }
  }

  /**
   * 处理取消上传请求
   *
   * @param request - HTTP 请求
   * @returns HTTP 响应
   */
  async handleAbort(request: Request): Promise<Response> {
    try {
      const body = (await request.json()) as AbortRequest;

      if (!body.uploadId || !body.key) {
        return this.errorResponse("缺少必要参数: uploadId, key");
      }

      // 取消分片上传
      await this.config.storage.abortMultipartUpload(body.key, body.uploadId);

      return this.jsonResponse({ success: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error($tr("upload.server.abortMultipartFailed", { message }));
      return this.errorResponse(message, 500);
    }
  }

  /**
   * 处理查询上传状态请求
   *
   * @param request - HTTP 请求
   * @returns HTTP 响应
   */
  async handleStatus(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      const uploadId = url.searchParams.get("uploadId");
      const key = url.searchParams.get("key");

      if (!uploadId || !key) {
        return this.errorResponse("缺少必要参数: uploadId, key");
      }

      // 列出已上传的分片
      const result = await this.config.storage.listParts(key, uploadId);

      const response: UploadStatus = {
        uploadId,
        key,
        parts: result.parts,
        createdAt: new Date(),
      };

      return this.jsonResponse(response);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error($tr("upload.server.queryUploadStatusFailed", { message }));
      return this.errorResponse(message, 500);
    }
  }

  /**
   * 统一路由处理器
   *
   * @param request - HTTP 请求
   * @param basePath - 基础路径（默认 /upload）
   * @returns HTTP 响应
   */
  handle(
    request: Request,
    basePath = "/upload",
  ): Promise<Response | null> | null {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "POST") {
      if (path === `${basePath}/init`) {
        return this.handleInit(request);
      }
      if (path === `${basePath}/chunk`) {
        return this.handleChunk(request);
      }
      if (path === `${basePath}/complete`) {
        return this.handleComplete(request);
      }
      if (path === `${basePath}/abort`) {
        return this.handleAbort(request);
      }
    }

    if (request.method === "GET") {
      if (path === `${basePath}/status`) {
        return this.handleStatus(request);
      }
    }

    // 不匹配的路径返回 null
    return null;
  }

  /**
   * 格式化文件大小
   */
  private formatSize(bytes: number): string {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  }

  /**
   * 匹配 MIME 类型
   */
  private matchMimeType(mimeType: string, pattern: string): boolean {
    if (pattern.endsWith("/*")) {
      return mimeType.startsWith(pattern.slice(0, -1));
    }
    return mimeType === pattern;
  }
}

// ============================================================================
// 工厂函数
// ============================================================================

/**
 * 创建服务端分片上传处理器
 *
 * @param config - 处理器配置
 * @returns MultipartUploadHandler 实例
 */
export function createMultipartUploadHandler(
  config: MultipartUploadHandlerConfig,
): MultipartUploadHandler {
  return new MultipartUploadHandler(config);
}
