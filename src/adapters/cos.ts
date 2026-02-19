/**
 * @fileoverview 腾讯云 COS 存储适配器
 *
 * 提供腾讯云对象存储服务（COS）的存储适配器实现
 * 支持 S3 兼容模式，可用于 MinIO 等 S3 兼容服务测试
 */

import { S3Signer } from "./s3-signature.ts";
import type {
  CloudStorageAdapter,
  CloudUploadOptions,
  CopyOptions,
  COSConfig,
  DownloadOptions,
  ListOptions,
  ListPartsResult,
  ListResult,
  MultipartUploadInit,
  ObjectInfo,
  ObjectMetadata,
  PartInfo,
  PresignedUrlOptions,
  UploadPartResult,
} from "./types.ts";
import { $tr } from "../i18n.ts";

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 计算 SHA1 哈希
 *
 * @param data - 输入数据
 * @returns 哈希值
 */
async function sha1(data: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-1", data.slice());
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * 计算 HMAC-SHA1
 *
 * @param key - 密钥
 * @param data - 数据
 * @returns HMAC 签名的十六进制字符串
 */
async function hmacSha1Hex(key: string, data: string): Promise<string> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    encoder.encode(data),
  );
  const hashArray = Array.from(new Uint8Array(signature));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * URL 编码（符合 COS 要求）
 *
 * @param str - 输入字符串
 * @returns 编码后的字符串
 */
function cosEncode(str: string): string {
  return encodeURIComponent(str)
    .replace(/!/g, "%21")
    .replace(/'/g, "%27")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29")
    .replace(/\*/g, "%2A");
}

// ============================================================================
// COS 存储适配器
// ============================================================================

/**
 * 腾讯云 COS 存储适配器
 *
 * @example
 * ```typescript
 * const adapter = new COSStorageAdapter({
 *   bucket: "examplebucket-1250000000",
 *   region: "ap-guangzhou",
 *   secretId: "your-secret-id",
 *   secretKey: "your-secret-key",
 * });
 *
 * await adapter.save("test.txt", new TextEncoder().encode("Hello"));
 * const data = await adapter.read("test.txt");
 * ```
 */
export class COSStorageAdapter implements CloudStorageAdapter {
  private config: COSConfig;
  private endpoint: string;
  /** S3 兼容模式签名器 */
  private s3Signer: S3Signer | null = null;

  /**
   * 创建 COS 适配器实例
   *
   * @param config - COS 配置
   */
  constructor(config: COSConfig) {
    this.config = config;

    // 构建端点 URL
    if (config.endpoint) {
      // 自定义端点（S3 兼容模式）
      this.endpoint = config.endpoint;
    } else if (config.accelerate) {
      this.endpoint = `https://${config.bucket}.cos.accelerate.myqcloud.com`;
    } else {
      this.endpoint =
        `https://${config.bucket}.cos.${config.region}.myqcloud.com`;
    }

    // 如果启用 S3 兼容模式，创建 S3 签名器
    if (config.useS3Compatible) {
      this.s3Signer = new S3Signer({
        accessKeyId: config.secretId,
        secretAccessKey: config.secretKey,
        region: config.region,
        sessionToken: config.sessionToken,
      });
    }
  }

  /**
   * 获取存储桶名称
   */
  getBucket(): string {
    return this.config.bucket;
  }

  /**
   * 获取区域
   */
  getRegion(): string {
    return this.config.region;
  }

  /**
   * 构建请求 URL
   *
   * @param key - 对象键
   * @param queryParams - 查询参数
   * @returns 完整 URL
   */
  private buildUrl(key: string, queryParams?: Record<string, string>): string {
    let url: string;

    // S3 兼容模式下使用路径样式访问
    if (this.config.useS3Compatible && this.config.forcePathStyle) {
      url = `${this.endpoint}/${this.config.bucket}/${key}`;
    } else {
      url = `${this.endpoint}/${key}`;
    }

    if (queryParams && Object.keys(queryParams).length > 0) {
      const params = new URLSearchParams(queryParams);
      url += `?${params.toString()}`;
    }

    return url;
  }

  /**
   * 生成签名
   *
   * @param method - HTTP 方法
   * @param key - 对象键
   * @param headers - 请求头
   * @param queryParams - 查询参数
   * @param expireTime - 签名有效期（秒）
   * @returns 签名字符串
   */
  private async generateSignature(
    method: string,
    key: string,
    headers: Record<string, string>,
    queryParams?: Record<string, string>,
    expireTime: number = 600,
  ): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const keyTime = `${now};${now + expireTime}`;

    // SignKey = HMAC-SHA1(SecretKey, KeyTime)
    const signKey = await hmacSha1Hex(this.config.secretKey, keyTime);

    // 处理 headers
    const headerList = Object.entries(headers)
      .filter(([k]) => {
        const lk = k.toLowerCase();
        return lk === "host" ||
          lk === "content-type" ||
          lk === "content-length" ||
          lk.startsWith("x-cos-");
      })
      .map(([k, v]) => [k.toLowerCase(), cosEncode(v)])
      .sort((a, b) => a[0].localeCompare(b[0]));

    const headerListStr = headerList.map(([k]) => k).join(";");
    const httpHeaders = headerList.map(([k, v]) => `${k}=${v}`).join("&");

    // 处理 query params
    const paramList = Object.entries(queryParams || {})
      .map(([k, v]) => [k.toLowerCase(), cosEncode(v)])
      .sort((a, b) => a[0].localeCompare(b[0]));

    const paramListStr = paramList.map(([k]) => k).join(";");
    const httpParams = paramList.map(([k, v]) => `${k}=${v}`).join("&");

    // HttpString
    const httpString = [
      method.toLowerCase(),
      `/${key}`,
      httpParams,
      httpHeaders,
      "",
    ].join("\n");

    // StringToSign
    const stringToSign = [
      "sha1",
      keyTime,
      await sha1(new TextEncoder().encode(httpString)),
      "",
    ].join("\n");

    // Signature
    const signature = await hmacSha1Hex(signKey, stringToSign);

    // 构建授权字符串
    const auth = [
      "q-sign-algorithm=sha1",
      `q-ak=${this.config.secretId}`,
      `q-sign-time=${keyTime}`,
      `q-key-time=${keyTime}`,
      `q-header-list=${headerListStr}`,
      `q-url-param-list=${paramListStr}`,
      `q-signature=${signature}`,
    ].join("&");

    return auth;
  }

  /**
   * 发送签名请求
   */
  private async request(
    method: string,
    key: string,
    options: {
      queryParams?: Record<string, string>;
      headers?: Record<string, string>;
      body?: Uint8Array;
    } = {},
  ): Promise<Response> {
    const url = this.buildUrl(key, options.queryParams);
    const parsedUrl = new URL(url);
    const body = options.body || new Uint8Array();

    // S3 兼容模式使用 AWS Signature V4
    if (this.s3Signer) {
      // S3 兼容模式：不预设 Host，让签名器自动处理
      let headers: Record<string, string> = { ...options.headers };
      headers = await this.s3Signer.sign(method, url, headers, body);

      return await fetch(url, {
        method,
        headers,
        body: method !== "GET" && method !== "HEAD" && method !== "DELETE"
          ? body.slice()
          : undefined,
      });
    }

    // 原生 COS 签名
    const headers: Record<string, string> = {
      Host: parsedUrl.host,
      ...options.headers,
    };

    // 添加会话令牌
    if (this.config.sessionToken) {
      headers["x-cos-security-token"] = this.config.sessionToken;
    }

    // 生成签名
    const auth = await this.generateSignature(
      method,
      key,
      headers,
      options.queryParams,
    );
    headers["Authorization"] = auth;

    return await fetch(url, {
      method,
      headers,
      body: method !== "GET" && method !== "HEAD" && method !== "DELETE"
        ? body.slice()
        : undefined,
    });
  }

  // ============================================================================
  // FileStorage 接口实现
  // ============================================================================

  async save(path: string, content: Uint8Array): Promise<void> {
    await this.upload(path, content);
  }

  async read(path: string): Promise<Uint8Array> {
    return await this.download(path);
  }

  async delete(path: string): Promise<void> {
    const response = await this.request("DELETE", path);
    if (!response.ok && response.status !== 404) {
      throw new Error(
        $tr("upload.cos.deleteFailed", {
          status: String(response.status),
          statusText: response.statusText,
        }),
      );
    }
  }

  async exists(path: string): Promise<boolean> {
    const response = await this.request("HEAD", path);
    return response.ok;
  }

  async mkdir(_path: string): Promise<void> {
    await Promise.resolve();
  }

  // ============================================================================
  // CloudStorageAdapter 接口实现
  // ============================================================================

  async upload(
    path: string,
    content: Uint8Array,
    options?: CloudUploadOptions,
  ): Promise<void> {
    const headers: Record<string, string> = {
      "Content-Length": content.length.toString(),
    };

    if (options?.contentType) {
      headers["Content-Type"] = options.contentType;
    }
    if (options?.cacheControl) {
      headers["Cache-Control"] = options.cacheControl;
    }
    if (options?.acl) {
      headers["x-cos-acl"] = options.acl;
    }
    if (options?.storageClass) {
      headers["x-cos-storage-class"] = options.storageClass;
    }
    if (options?.metadata) {
      for (const [k, v] of Object.entries(options.metadata)) {
        headers[`x-cos-meta-${k}`] = v;
      }
    }

    const response = await this.request("PUT", path, {
      headers,
      body: content,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        $tr("upload.cos.uploadFailed", {
          status: String(response.status),
          text,
        }),
      );
    }
  }

  async download(path: string, options?: DownloadOptions): Promise<Uint8Array> {
    const headers: Record<string, string> = {};

    if (options?.rangeStart !== undefined || options?.rangeEnd !== undefined) {
      const start = options.rangeStart ?? 0;
      const end = options.rangeEnd !== undefined ? options.rangeEnd : "";
      headers["Range"] = `bytes=${start}-${end}`;
    }

    const response = await this.request("GET", path, { headers });

    if (response.status === 404) {
      throw new Error($tr("upload.fileNotFound", { path }));
    }

    if (!response.ok && response.status !== 206) {
      throw new Error(
        $tr("upload.cos.downloadFailed", {
          status: String(response.status),
          statusText: response.statusText,
        }),
      );
    }

    return new Uint8Array(await response.arrayBuffer());
  }

  async getMetadata(path: string): Promise<ObjectMetadata | null> {
    const response = await this.request("HEAD", path);

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new Error(
        $tr("upload.cos.getMetadataFailed", {
          status: String(response.status),
        }),
      );
    }

    const metadata: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      if (key.toLowerCase().startsWith("x-cos-meta-")) {
        metadata[key.substring(11)] = value;
      }
    });

    return {
      contentType: response.headers.get("Content-Type") || undefined,
      contentLength: parseInt(
        response.headers.get("Content-Length") || "0",
        10,
      ),
      etag: response.headers.get("ETag")?.replace(/"/g, "") || undefined,
      lastModified: response.headers.get("Last-Modified")
        ? new Date(response.headers.get("Last-Modified")!)
        : undefined,
      storageClass: response.headers.get("x-cos-storage-class") || undefined,
      metadata,
    };
  }

  async listObjects(options?: ListOptions): Promise<ListResult> {
    const queryParams: Record<string, string> = {};

    if (options?.prefix) queryParams["prefix"] = options.prefix;
    if (options?.delimiter) queryParams["delimiter"] = options.delimiter;
    if (options?.maxKeys) queryParams["max-keys"] = options.maxKeys.toString();
    if (options?.marker) queryParams["marker"] = options.marker;

    const response = await this.request("GET", "", { queryParams });

    if (!response.ok) {
      throw new Error(
        $tr("upload.cos.listFailed", { status: String(response.status) }),
      );
    }

    const text = await response.text();
    const objects: ObjectInfo[] = [];
    const contentMatches = text.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g);

    for (const match of contentMatches) {
      const content = match[1];
      const key = content.match(/<Key>(.*?)<\/Key>/)?.[1] || "";
      const size = parseInt(
        content.match(/<Size>(.*?)<\/Size>/)?.[1] || "0",
        10,
      );
      const lastModified = content.match(/<LastModified>(.*?)<\/LastModified>/)
        ?.[1];
      const etag = content.match(/<ETag>(.*?)<\/ETag>/)?.[1]?.replace(
        /&quot;/g,
        "",
      );
      const storageClass = content.match(/<StorageClass>(.*?)<\/StorageClass>/)
        ?.[1];

      objects.push({
        key,
        size,
        lastModified: lastModified ? new Date(lastModified) : new Date(),
        etag,
        storageClass,
      });
    }

    const isTruncated = text.includes("<IsTruncated>true</IsTruncated>");
    const nextMarker = text.match(/<NextMarker>(.*?)<\/NextMarker>/)?.[1];

    return {
      objects,
      isTruncated,
      nextMarker,
    };
  }

  async copy(
    sourcePath: string,
    destPath: string,
    options?: CopyOptions,
  ): Promise<void> {
    const sourceBucket = options?.sourceBucket || this.config.bucket;
    const headers: Record<string, string> = {
      "x-cos-copy-source":
        `${sourceBucket}.cos.${this.config.region}.myqcloud.com/${sourcePath}`,
    };

    if (options?.metadataDirective) {
      headers["x-cos-metadata-directive"] = options.metadataDirective;
    }

    const response = await this.request("PUT", destPath, { headers });
    if (!response.ok) {
      throw new Error(
        $tr("upload.cos.copyFailed", { status: String(response.status) }),
      );
    }
  }

  async getPresignedUrl(
    path: string,
    options?: PresignedUrlOptions,
  ): Promise<string> {
    const method = options?.method || "GET";
    const expiresIn = options?.expiresIn || 3600;

    const url = new URL(this.buildUrl(path));
    const headers: Record<string, string> = {
      Host: url.host,
    };

    if (options?.contentType) {
      headers["Content-Type"] = options.contentType;
    }

    const auth = await this.generateSignature(
      method,
      path,
      headers,
      {},
      expiresIn,
    );

    // 将签名参数添加到 URL
    for (const param of auth.split("&")) {
      const [k, v] = param.split("=");
      url.searchParams.set(k, v);
    }

    return url.toString();
  }

  // ============================================================================
  // 分片上传方法
  // ============================================================================

  /**
   * 初始化分片上传
   */
  async initiateMultipartUpload(
    key: string,
    options?: CloudUploadOptions,
  ): Promise<MultipartUploadInit> {
    const headers: Record<string, string> = {};

    if (options?.contentType) {
      headers["Content-Type"] = options.contentType;
    }
    if (options?.cacheControl) {
      headers["Cache-Control"] = options.cacheControl;
    }
    if (options?.acl) {
      headers["x-cos-acl"] = options.acl;
    }
    if (options?.storageClass) {
      headers["x-cos-storage-class"] = options.storageClass;
    }
    if (options?.metadata) {
      for (const [k, v] of Object.entries(options.metadata)) {
        headers[`x-cos-meta-${k}`] = v;
      }
    }

    const response = await this.request("POST", key, {
      queryParams: { uploads: "" },
      headers,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        $tr("upload.cos.initMultipartFailed", {
          status: String(response.status),
          text,
        }),
      );
    }

    const text = await response.text();
    const uploadId = text.match(/<UploadId>(.*?)<\/UploadId>/)?.[1];

    if (!uploadId) {
      throw new Error($tr("upload.cos.initMultipartNoUploadId"));
    }

    return { uploadId, key };
  }

  /**
   * 上传分片
   */
  async uploadPart(
    key: string,
    uploadId: string,
    partNumber: number,
    data: Uint8Array,
  ): Promise<UploadPartResult> {
    const response = await this.request("PUT", key, {
      queryParams: {
        partNumber: partNumber.toString(),
        uploadId,
      },
      headers: {
        "Content-Length": data.length.toString(),
      },
      body: data,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        $tr("upload.cos.uploadPartFailed", {
          status: String(response.status),
          text,
        }),
      );
    }

    const etag = response.headers.get("ETag")?.replace(/"/g, "") || "";

    return { partNumber, etag };
  }

  /**
   * 完成分片上传
   */
  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: PartInfo[],
  ): Promise<void> {
    const sortedParts = [...parts].sort((a, b) => a.partNumber - b.partNumber);

    const partsXml = sortedParts
      .map(
        (p) =>
          `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>"${p.etag}"</ETag></Part>`,
      )
      .join("");
    const body =
      `<CompleteMultipartUpload>${partsXml}</CompleteMultipartUpload>`;
    const bodyData = new TextEncoder().encode(body);

    const response = await this.request("POST", key, {
      queryParams: { uploadId },
      headers: {
        "Content-Type": "application/xml",
        "Content-Length": bodyData.length.toString(),
      },
      body: bodyData,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        $tr("upload.cos.completeMultipartFailed", {
          status: String(response.status),
          text,
        }),
      );
    }
  }

  /**
   * 取消分片上传
   */
  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    const response = await this.request("DELETE", key, {
      queryParams: { uploadId },
    });

    if (!response.ok && response.status !== 404) {
      throw new Error(
        $tr("upload.cos.abortMultipartFailed", {
          status: String(response.status),
        }),
      );
    }
  }

  /**
   * 列出已上传的分片
   */
  async listParts(key: string, uploadId: string): Promise<ListPartsResult> {
    const response = await this.request("GET", key, {
      queryParams: { uploadId },
    });

    if (!response.ok) {
      throw new Error(
        $tr("upload.cos.listPartsFailed", { status: String(response.status) }),
      );
    }

    const text = await response.text();
    const parts: PartInfo[] = [];

    const partMatches = text.matchAll(/<Part>([\s\S]*?)<\/Part>/g);
    for (const match of partMatches) {
      const content = match[1];
      const partNumber = parseInt(
        content.match(/<PartNumber>(.*?)<\/PartNumber>/)?.[1] || "0",
        10,
      );
      const etag =
        content.match(/<ETag>(.*?)<\/ETag>/)?.[1]?.replace(/&quot;|"/g, "") ||
        "";
      const size = parseInt(
        content.match(/<Size>(.*?)<\/Size>/)?.[1] || "0",
        10,
      );

      parts.push({ partNumber, etag, size });
    }

    const isTruncated = text.includes("<IsTruncated>true</IsTruncated>");
    const nextMarker = text.match(
      /<NextPartNumberMarker>(.*?)<\/NextPartNumberMarker>/,
    )?.[1];

    return {
      parts,
      isTruncated,
      nextPartNumberMarker: nextMarker ? parseInt(nextMarker, 10) : undefined,
    };
  }
}

// ============================================================================
// 工厂函数
// ============================================================================

/**
 * 创建腾讯云 COS 存储适配器
 *
 * @param config - COS 配置
 * @returns COS 适配器实例
 */
export function createCOSAdapter(config: COSConfig): COSStorageAdapter {
  return new COSStorageAdapter(config);
}
