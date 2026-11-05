/**
 * @fileoverview 服务端分片上传处理器
 *
 * 提供 HTTP 服务端分片上传处理功能，配合客户端使用。
 *
 * 安全不变量（1.2.x）：
 * - 内存会话绑定 uploadId → key／chunks／size；chunk／complete／abort／status
 *   **只认服务端登记**，忽略客户端篡改的 key。
 * - **requireAuth 默认 true**：未配置 authenticate 则拒写（401）。1.x 迁移：显式
 *   `requireAuth: false` 或接入 `authenticate`。
 * - 分片合并后二次魔数／内容策略校验（默认只拉对象头 N KiB，可配）；失败则尽量删除对象。
 * - 内存会话按 TTL 惰性失效 + 周期／显式 cleanupExpiredSessions 扫除。
 * - body.path／filename 经 sanitize；默认扩展名／MIME 黑名单；不信客户端 Content-Type。
 * - 500／错误响应脱敏，不回显绝对路径／内部键。
 *
 * @example
 * ```typescript
 * import { MultipartUploadHandler } from "@dreamer/upload/server";
 *
 * const handler = new MultipartUploadHandler({
 *   storage: s3Adapter,
 *   authenticate: async (req) => {
 *     const user = await verifySession(req);
 *     return user ? { userId: user.id } : null; // null → 401
 *   },
 * });
 * ```
 */

import type {
  CloudStorageAdapter,
  CloudUploadOptions,
  PartInfo,
} from "../adapters/types.ts";
import { $tr } from "../i18n.ts";
import { DEFAULT_FORBIDDEN_EXTENSIONS } from "../constants.ts";
import {
  findForbiddenExtension,
  isUuid,
  matchMimeType,
  redactErrorMessage,
  sanitizeFilename,
  sanitizeObjectKey,
  validateUploadContent,
} from "../utils.ts";

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 鉴权上下文（由 authenticate 钩子返回）
 */
export interface UploadAuthContext {
  /** 主体 ID（用户／服务账号） */
  userId?: string;
  /** 任意附加声明 */
  claims?: Record<string, unknown>;
}

/**
 * 可观测事件（加法；默认不发射副作用）。
 *
 * 意图：运维／指标钩子；不替代日志脱敏——payload 不含绝对路径。
 */
export type UploadServerEventType =
  | "init"
  | "chunk"
  | "complete"
  | "abort"
  | "error"
  | "session_cleanup";

export interface UploadServerEvent {
  type: UploadServerEventType;
  uploadId?: string;
  key?: string;
  /** 已清理的过期会话数（仅 session_cleanup） */
  cleaned?: number;
  /** 机器可读错误码（仅 error） */
  code?: string;
  status?: number;
}

/**
 * 稳定错误码（JSON `code` 字段）。消息仍可本地化；客户端应以 code 分支。
 */
export const UploadErrorCode = {
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  BAD_REQUEST: "BAD_REQUEST",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  PAYLOAD_TOO_LARGE: "PAYLOAD_TOO_LARGE",
  UNSUPPORTED_MEDIA: "UNSUPPORTED_MEDIA",
  VALIDATION_FAILED: "VALIDATION_FAILED",
  CONTENT_REJECTED: "CONTENT_REJECTED",
  ABORTED: "ABORTED",
  INTERNAL: "INTERNAL",
} as const;

export type UploadErrorCode =
  typeof UploadErrorCode[keyof typeof UploadErrorCode];

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
  /** 允许的 MIME 类型（非空时：缺 mime／不匹配均拒绝） */
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
  /**
   * 鉴权钩子。返回 AuthContext 表示通过；返回 null／undefined → 401；
   * 返回 Response 则原样回复。
   *
   * 与 {@link requireAuth} 配合：默认 requireAuth=true，未配置本钩子则拒写。
   */
  authenticate?: (
    request: Request,
  ) =>
    | UploadAuthContext
    | null
    | undefined
    | Response
    | Promise<UploadAuthContext | null | undefined | Response>;
  /**
   * 授权钩子（在 authenticate 之后、init 业务校验前）。
   * 返回 false → 403；返回 Response 则原样回复。
   */
  authorizeUpload?: (
    ctx: UploadAuthContext | undefined,
    init: InitRequest,
    request: Request,
  ) => boolean | Response | Promise<boolean | Response>;
  /**
   * 是否要求鉴权。默认 **true**（安全优先）。
   * 1.x 迁移：设 `requireAuth: false` 恢复匿名写，或接入 authenticate。
   */
  requireAuth?: boolean;
  /**
   * 会话 TTL（毫秒），默认 24h。过期会话拒绝 chunk／complete。
   */
  sessionTtlMs?: number;
  /**
   * 默认 overwrite 行为（当请求未显式传 overwrite 时）。默认 true（1.x 兼容）。
   */
  defaultOverwrite?: boolean;
  /**
   * 合并完成后是否二次魔数／内容策略校验。默认 true。
   */
  verifyContentAfterComplete?: boolean;
  /**
   * 二次校验时下载的对象头字节数（含）。默认 65536。
   *
   * 意图：避免 complete 全量 download 撑爆内存；仍覆盖魔数 + `scanDangerousPayload`
   * 前 8KiB 与 PDF 浅层 MZ 扫描窗口（64KiB）。
   * 不变量：头不足文件实际长度时只验头——与全量比是有意权衡；要全量设
   * `verifyContentHeadBytes: Infinity` 或极大值（仍受对象大小限制）。
   * 为何不默认全量：大文件 complete 会双倍内存；云适配器可走 Range。
   */
  verifyContentHeadBytes?: number;
  /**
   * 会话 TTL 周期扫间隔（毫秒）。默认 60_000；设 0 关闭定时器（仍惰性过期）。
   */
  sessionCleanupIntervalMs?: number;
  /**
   * 可观测钩子（加法）。异常会被吞掉以免打断主路径。
   */
  onEvent?: (event: UploadServerEvent) => void;
  /** 额外禁止扩展名（默认合并 DEFAULT_FORBIDDEN_EXTENSIONS） */
  forbiddenExtensions?: string[];
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
  /** 是否覆盖同名文件；false → 已存在时 409 */
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
 * 分片上传请求（通过 FormData）
 */
export interface ChunkRequest {
  /** 上传 ID */
  uploadId: string;
  /** 分片索引（从 0 开始） */
  index: number;
  /** 对象键（服务端忽略，仅兼容旧客户端） */
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
  /** 对象键（服务端忽略，只认会话） */
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
  /** 对象键（服务端忽略） */
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

/**
 * 服务端内存会话（uploadId → 绑定信息）
 *
 * 不变量：chunk／complete／abort／status 使用的 key 必须来自本结构，
 * 禁止信任客户端回传的 key（防会话劫持改写目标对象）。
 */
interface UploadSession {
  uploadId: string;
  key: string;
  filename: string;
  fileSize: number;
  chunks: number;
  mimeType?: string;
  createdAt: number;
  expiresAt: number;
  authUserId?: string;
  /** 已登记分片：index(0-based) → etag/size */
  parts: Map<number, { etag: string; size: number }>;
}

// ============================================================================
// 服务端处理器
// ============================================================================

/**
 * 服务端分片上传处理器
 *
 * 处理客户端的分片上传请求
 */
export class MultipartUploadHandler {
  private config: {
    storage: CloudStorageAdapter;
    maxPartSize: number;
    maxFileSize: number;
    allowedMimeTypes: string[];
    pathPrefix: string;
    generatePath?: MultipartUploadHandlerConfig["generatePath"];
    validate?: MultipartUploadHandlerConfig["validate"];
    authenticate?: MultipartUploadHandlerConfig["authenticate"];
    authorizeUpload?: MultipartUploadHandlerConfig["authorizeUpload"];
    requireAuth: boolean;
    sessionTtlMs: number;
    defaultOverwrite: boolean;
    verifyContentAfterComplete: boolean;
    verifyContentHeadBytes: number;
    sessionCleanupIntervalMs: number;
    onEvent?: MultipartUploadHandlerConfig["onEvent"];
    forbiddenExtensions: string[];
  };

  /** uploadId → 会话 */
  private sessions = new Map<string, UploadSession>();

  /** 周期扫定时器句柄（browser/Deno/Node 兼容 number） */
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

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
      authenticate: config.authenticate,
      authorizeUpload: config.authorizeUpload,
      requireAuth: config.requireAuth ?? true,
      sessionTtlMs: config.sessionTtlMs ?? 24 * 60 * 60 * 1000,
      defaultOverwrite: config.defaultOverwrite ?? true,
      verifyContentAfterComplete: config.verifyContentAfterComplete ?? true,
      // 64KiB：覆盖 scanDangerousPayload 头窗与 PDF 浅层 MZ 扫描
      verifyContentHeadBytes: config.verifyContentHeadBytes ?? 64 * 1024,
      sessionCleanupIntervalMs: config.sessionCleanupIntervalMs ?? 60_000,
      onEvent: config.onEvent,
      forbiddenExtensions: config.forbiddenExtensions ??
        [...DEFAULT_FORBIDDEN_EXTENSIONS],
    };
    this.startSessionCleanupTimer();
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
  private errorResponse(
    message: string,
    status = 400,
    code: UploadErrorCode = UploadErrorCode.BAD_REQUEST,
  ): Response {
    return this.jsonResponse({ error: message, code }, status);
  }

  /**
   * 发射可观测事件；钩子抛错不影响主路径。
   */
  private emit(event: UploadServerEvent): void {
    try {
      this.config.onEvent?.(event);
    } catch (err) {
      console.error(
        "[upload] onEvent error:",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  /**
   * AbortSignal：Request.signal 已 abort 则短路。
   * 加法：不改协议；浏览器／fetch 取消自然透传。
   */
  private assertNotAborted(request: Request): Response | null {
    if (request.signal?.aborted) {
      return this.errorResponse(
        "Upload aborted",
        499,
        UploadErrorCode.ABORTED,
      );
    }
    return null;
  }

  /**
   * 扫掉过期内存会话。
   *
   * 为何不只靠 getSession 惰性删：长时间只有 status／无写时 Map 会堆积。
   * staging 磁盘清理见 LocalCloudStorageAdapter.cleanupExpiredStaging（init 时触发）。
   */
  cleanupExpiredSessions(now: number = Date.now()): number {
    let cleaned = 0;
    for (const [id, session] of this.sessions) {
      if (now > session.expiresAt) {
        this.sessions.delete(id);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      this.emit({ type: "session_cleanup", cleaned });
    }
    return cleaned;
  }

  private startSessionCleanupTimer(): void {
    const ms = this.config.sessionCleanupIntervalMs;
    if (!ms || ms <= 0) return;
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredSessions();
    }, ms);
    // Node／Bun：避免阻止进程退出
    const t = this.cleanupTimer as unknown as { unref?: () => void };
    t.unref?.();
  }

  /**
   * 停止周期扫（测试／进程退出时调用）。
   */
  dispose(): void {
    if (this.cleanupTimer != null) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * 500 脱敏：日志留原文，响应只给通用句。
   *
   * 为何不回传 error.message：可能含本地路径／凭证／内部键名。
   */
  private internalError(scope: string, error: unknown): Response {
    const message = error instanceof Error ? error.message : String(error);
    console.error($tr(scope, { message: redactErrorMessage(message) }));
    return this.errorResponse(
      "Internal server error",
      500,
      UploadErrorCode.INTERNAL,
    );
  }

  /**
   * 跑鉴权钩子。
   *
   * requireAuth=true（默认）且未配置 authenticate → 401。
   * 返回 Response 表示应短路；AuthContext／undefined 表示继续。
   */
  private async runAuth(
    request: Request,
  ): Promise<UploadAuthContext | undefined | Response> {
    if (!this.config.authenticate) {
      if (this.config.requireAuth) {
        return this.errorResponse(
          "Unauthorized",
          401,
          UploadErrorCode.UNAUTHORIZED,
        );
      }
      return undefined;
    }
    const result = await this.config.authenticate(request);
    if (result instanceof Response) return result;
    if (result == null) {
      return this.errorResponse(
        "Unauthorized",
        401,
        UploadErrorCode.UNAUTHORIZED,
      );
    }
    return result;
  }

  /**
   * 会话所有者校验：init 时记下 authUserId，后续写操作必须同一主体。
   * 堵住伪造 uploadId 撞会话／越权续传。
   */
  private assertSessionOwner(
    session: UploadSession,
    auth: UploadAuthContext | undefined,
  ): Response | null {
    if (session.authUserId == null || session.authUserId === "") {
      return null;
    }
    if (!auth?.userId || auth.userId !== session.authUserId) {
      return this.errorResponse("Forbidden", 403, UploadErrorCode.FORBIDDEN);
    }
    return null;
  }

  /**
   * 取会话；过期或不存在 → null（并删除过期项）。
   */
  private getSession(uploadId: string): UploadSession | null {
    if (!isUuid(uploadId)) return null;
    const session = this.sessions.get(uploadId);
    if (!session) return null;
    if (Date.now() > session.expiresAt) {
      this.sessions.delete(uploadId);
      return null;
    }
    return session;
  }

  /**
   * 生成对象键（sanitize path／filename；禁穿越）。
   */
  private generateKey(
    filename: string,
    path?: string,
    metadata?: Record<string, unknown>,
  ): string {
    const safeFilename = sanitizeFilename(filename) || "file";

    if (this.config.generatePath) {
      const raw = this.config.generatePath(safeFilename, metadata);
      const cleaned = sanitizeObjectKey(raw);
      if (!cleaned) {
        throw new Error("generatePath returned empty key");
      }
      return cleaned;
    }

    const prefix = sanitizeObjectKey(this.config.pathPrefix || "");
    const targetPath = path ? sanitizeObjectKey(path) : "";

    const ext = safeFilename.includes(".")
      ? safeFilename.substring(safeFilename.lastIndexOf("."))
      : "";
    const uniqueName = `${crypto.randomUUID()}${ext}`;

    const parts = [prefix, targetPath, uniqueName].filter((p) => p.length > 0);
    return parts.join("/");
  }

  /**
   * 处理初始化请求
   *
   * @param request - HTTP 请求
   * @returns HTTP 响应
   */
  async handleInit(request: Request): Promise<Response> {
    try {
      const aborted = this.assertNotAborted(request);
      if (aborted) return aborted;
      this.cleanupExpiredSessions();
      const auth = await this.runAuth(request);
      if (auth instanceof Response) return auth;

      const body = (await request.json()) as InitRequest;

      if (!body.filename || !body.fileSize || !body.chunks) {
        return this.errorResponse(
          "缺少必要参数: filename, fileSize, chunks",
          400,
          UploadErrorCode.BAD_REQUEST,
        );
      }

      if (
        !Number.isInteger(body.chunks) || body.chunks < 1 || body.chunks > 10000
      ) {
        return this.errorResponse(
          "无效的分片数量: chunks 须为 1..10000",
          400,
          UploadErrorCode.BAD_REQUEST,
        );
      }

      const forbiddenHit = findForbiddenExtension(
        body.filename,
        this.config.forbiddenExtensions,
      );
      if (forbiddenHit) {
        return this.errorResponse(
          `禁止上传 ${forbiddenHit} 类型的文件`,
          400,
          UploadErrorCode.UNSUPPORTED_MEDIA,
        );
      }

      if (body.fileSize > this.config.maxFileSize) {
        return this.errorResponse(
          `文件大小超过限制: 最大 ${this.formatSize(this.config.maxFileSize)}`,
          413,
          UploadErrorCode.PAYLOAD_TOO_LARGE,
        );
      }

      // MIME：配置了 allowlist 则缺省／不匹配均拒
      if (this.config.allowedMimeTypes.length > 0) {
        if (!body.mimeType) {
          return this.errorResponse(
            "缺少 MIME 类型",
            400,
            UploadErrorCode.UNSUPPORTED_MEDIA,
          );
        }
        if (
          !this.config.allowedMimeTypes.some((t) =>
            matchMimeType(body.mimeType!, t)
          )
        ) {
          return this.errorResponse(
            `不支持的文件类型: ${body.mimeType}`,
            400,
            UploadErrorCode.UNSUPPORTED_MEDIA,
          );
        }
      }

      if (this.config.validate) {
        const valid = await this.config.validate(
          body.filename,
          body.fileSize,
          body.mimeType,
        );
        if (!valid) {
          return this.errorResponse(
            "文件验证失败",
            400,
            UploadErrorCode.VALIDATION_FAILED,
          );
        }
      }

      if (this.config.authorizeUpload) {
        const allowed = await this.config.authorizeUpload(auth, body, request);
        if (allowed instanceof Response) return allowed;
        if (!allowed) {
          return this.errorResponse(
            "Forbidden",
            403,
            UploadErrorCode.FORBIDDEN,
          );
        }
      }

      const key = this.generateKey(body.filename, body.path, body.metadata);

      const overwrite = body.overwrite ?? this.config.defaultOverwrite;
      if (!overwrite) {
        const exists = await this.config.storage.exists(key);
        if (exists) {
          return this.errorResponse(
            "Object already exists",
            409,
            UploadErrorCode.CONFLICT,
          );
        }
      }

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

      const result = await this.config.storage.initiateMultipartUpload(
        key,
        options,
      );

      const now = Date.now();
      const session: UploadSession = {
        uploadId: result.uploadId,
        key: result.key,
        filename: sanitizeFilename(body.filename) || body.filename,
        fileSize: body.fileSize,
        chunks: body.chunks,
        mimeType: body.mimeType,
        createdAt: now,
        expiresAt: now + this.config.sessionTtlMs,
        authUserId: auth?.userId,
        parts: new Map(),
      };
      this.sessions.set(result.uploadId, session);
      this.emit({
        type: "init",
        uploadId: result.uploadId,
        key: result.key,
      });

      const response: InitResponse = {
        uploadId: result.uploadId,
        key: result.key,
      };

      return this.jsonResponse(response);
    } catch (error) {
      return this.internalError("upload.server.initMultipartFailed", error);
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
      const aborted = this.assertNotAborted(request);
      if (aborted) return aborted;
      const auth = await this.runAuth(request);
      if (auth instanceof Response) return auth;

      const contentType = request.headers.get("content-type") || "";

      if (!contentType.includes("multipart/form-data")) {
        return this.errorResponse("请求必须是 multipart/form-data 类型");
      }

      const formData = await request.formData();
      const uploadId = formData.get("uploadId") as string;
      const indexStr = formData.get("index") as string;
      // 客户端 key 忽略——只认会话
      const file = formData.get("file") as File;

      if (!uploadId || indexStr === null || !file) {
        return this.errorResponse("缺少必要参数: uploadId, index, file");
      }

      const session = this.getSession(uploadId);
      if (!session) {
        return this.errorResponse(
          "未知或已过期的 uploadId",
          404,
          UploadErrorCode.NOT_FOUND,
        );
      }
      const ownerErr = this.assertSessionOwner(session, auth);
      if (ownerErr) return ownerErr;

      const index = parseInt(indexStr, 10);
      if (isNaN(index) || index < 0 || index >= session.chunks) {
        return this.errorResponse(
          `无效的分片索引: 期望 0..${session.chunks - 1}`,
        );
      }

      if (file.size > this.config.maxPartSize) {
        return this.errorResponse(
          `分片大小超过限制: 最大 ${this.formatSize(this.config.maxPartSize)}`,
        );
      }

      const data = new Uint8Array(await file.arrayBuffer());

      const result = await this.config.storage.uploadPart(
        session.key,
        uploadId,
        index + 1,
        data,
        { signal: request.signal },
      );

      session.parts.set(index, { etag: result.etag, size: data.length });
      this.emit({ type: "chunk", uploadId, key: session.key });

      const response: ChunkResponse = {
        index,
        etag: result.etag,
      };

      return this.jsonResponse(response);
    } catch (error) {
      return this.internalError("upload.server.uploadPartFailed", error);
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
      const aborted = this.assertNotAborted(request);
      if (aborted) return aborted;
      const auth = await this.runAuth(request);
      if (auth instanceof Response) return auth;

      const body = (await request.json()) as CompleteRequest;

      if (!body.uploadId || !body.chunks) {
        return this.errorResponse(
          "缺少必要参数: uploadId, chunks",
          400,
          UploadErrorCode.BAD_REQUEST,
        );
      }

      const session = this.getSession(body.uploadId);
      if (!session) {
        return this.errorResponse(
          "未知或已过期的 uploadId",
          404,
          UploadErrorCode.NOT_FOUND,
        );
      }
      const ownerErr = this.assertSessionOwner(session, auth);
      if (ownerErr) return ownerErr;

      // 完整性：必须覆盖 0..chunks-1；etag 与会话登记一致（若会话有记录）
      if (body.chunks.length !== session.chunks) {
        return this.errorResponse(
          `分片不完整: 期望 ${session.chunks} 个，收到 ${body.chunks.length}`,
        );
      }

      const seen = new Set<number>();
      for (const c of body.chunks) {
        if (
          !Number.isInteger(c.index) ||
          c.index < 0 ||
          c.index >= session.chunks
        ) {
          return this.errorResponse(`无效分片索引: ${c.index}`);
        }
        if (seen.has(c.index)) {
          return this.errorResponse(`重复分片索引: ${c.index}`);
        }
        seen.add(c.index);
        const registered = session.parts.get(c.index);
        if (registered && registered.etag !== c.etag) {
          return this.errorResponse(`分片 ${c.index} etag 与登记不符`);
        }
      }
      for (let i = 0; i < session.chunks; i++) {
        if (!seen.has(i)) {
          return this.errorResponse(`缺少分片: ${i}`);
        }
      }

      const parts: PartInfo[] = body.chunks
        .map((c) => ({
          partNumber: c.index + 1,
          etag: c.etag,
          size: c.size ?? session.parts.get(c.index)?.size,
        }))
        .sort((a, b) => a.partNumber - b.partNumber);

      await this.config.storage.completeMultipartUpload(
        session.key,
        body.uploadId,
        parts,
      );

      // 合并后二次魔数／内容策略：默认只拉头 N 字节（Range），避免大文件全量进内存。
      // 不变量：仍不信客户端 MIME；头窗默认 64KiB 覆盖魔数 + 浅层 polyglot 扫描。
      if (this.config.verifyContentAfterComplete) {
        try {
          const headLimit = this.config.verifyContentHeadBytes;
          const downloadOpts = Number.isFinite(headLimit) && headLimit > 0
            ? {
              rangeStart: 0,
              rangeEnd: Math.max(0, Math.floor(headLimit) - 1),
            }
            : undefined;
          const sample = await this.config.storage.download(
            session.key,
            {
              ...(downloadOpts ?? {}),
              signal: request.signal,
            },
          );
          const check = validateUploadContent(
            session.filename,
            sample,
            session.mimeType,
          );
          if (!check.valid) {
            try {
              await this.config.storage.delete(session.key);
            } catch {
              // 尽力删除毒文件
            }
            this.sessions.delete(body.uploadId);
            this.emit({
              type: "error",
              uploadId: body.uploadId,
              key: session.key,
              code: UploadErrorCode.CONTENT_REJECTED,
              status: 400,
            });
            return this.errorResponse(
              check.error || "内容校验失败",
              400,
              UploadErrorCode.CONTENT_REJECTED,
            );
          }
        } catch (verifyErr) {
          // 下载失败不直接 500 泄露；记日志并拒
          const msg = verifyErr instanceof Error
            ? verifyErr.message
            : String(verifyErr);
          console.error(
            $tr("upload.server.completeMultipartFailed", {
              message: redactErrorMessage(msg),
            }),
          );
          try {
            await this.config.storage.delete(session.key);
          } catch {
            // ignore
          }
          this.sessions.delete(body.uploadId);
          this.emit({
            type: "error",
            uploadId: body.uploadId,
            key: session.key,
            code: UploadErrorCode.CONTENT_REJECTED,
            status: 400,
          });
          return this.errorResponse(
            "内容校验失败",
            400,
            UploadErrorCode.CONTENT_REJECTED,
          );
        }
      }

      this.sessions.delete(body.uploadId);
      this.emit({
        type: "complete",
        uploadId: body.uploadId,
        key: session.key,
      });

      let url: string | undefined;
      try {
        url = await this.config.storage.getPresignedUrl(session.key, {
          expiresIn: 3600,
          method: "GET",
        });
      } catch {
        // 忽略预签名 URL 生成失败
      }

      const response: CompleteResponse = {
        fileId: session.key,
        url,
      };

      return this.jsonResponse(response);
    } catch (error) {
      return this.internalError(
        "upload.server.completeMultipartFailed",
        error,
      );
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
      const aborted = this.assertNotAborted(request);
      if (aborted) return aborted;
      const auth = await this.runAuth(request);
      if (auth instanceof Response) return auth;

      const body = (await request.json()) as AbortRequest;

      if (!body.uploadId) {
        return this.errorResponse(
          "缺少必要参数: uploadId",
          400,
          UploadErrorCode.BAD_REQUEST,
        );
      }

      const session = this.getSession(body.uploadId);
      if (!session) {
        // 幂等：无会话也返回成功（不泄露是否存在）
        this.sessions.delete(body.uploadId);
        return this.jsonResponse({ success: true });
      }
      const ownerErr = this.assertSessionOwner(session, auth);
      if (ownerErr) return ownerErr;

      await this.config.storage.abortMultipartUpload(
        session.key,
        body.uploadId,
      );
      this.sessions.delete(body.uploadId);
      this.emit({
        type: "abort",
        uploadId: body.uploadId,
        key: session.key,
      });

      return this.jsonResponse({ success: true });
    } catch (error) {
      return this.internalError("upload.server.abortMultipartFailed", error);
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
      const aborted = this.assertNotAborted(request);
      if (aborted) return aborted;
      const auth = await this.runAuth(request);
      if (auth instanceof Response) return auth;

      const url = new URL(request.url);
      const uploadId = url.searchParams.get("uploadId");

      if (!uploadId) {
        return this.errorResponse(
          "缺少必要参数: uploadId",
          400,
          UploadErrorCode.BAD_REQUEST,
        );
      }

      const session = this.getSession(uploadId);
      if (!session) {
        return this.errorResponse(
          "未知或已过期的 uploadId",
          404,
          UploadErrorCode.NOT_FOUND,
        );
      }
      const ownerErr = this.assertSessionOwner(session, auth);
      if (ownerErr) return ownerErr;

      const result = await this.config.storage.listParts(
        session.key,
        uploadId,
      );

      const response: UploadStatus = {
        uploadId,
        key: session.key,
        parts: result.parts,
        createdAt: new Date(session.createdAt),
      };

      return this.jsonResponse(response);
    } catch (error) {
      return this.internalError(
        "upload.server.queryUploadStatusFailed",
        error,
      );
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
    // 顺带扫过期会话（周期定时器之外的热路径兜底）
    this.cleanupExpiredSessions();
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

    return null;
  }

  /**
   * 测试／运维：当前内存会话数
   */
  getSessionCount(): number {
    return this.sessions.size;
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
