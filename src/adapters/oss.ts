/**
 * @fileoverview 阿里云 OSS 存储适配器
 *
 * 提供阿里云对象存储服务（OSS）的存储适配器实现
 * 支持 S3 兼容模式，可用于 MinIO 等 S3 兼容服务测试
 */

import type {
  CloudStorageAdapter,
  CloudUploadOptions,
  CopyOptions,
  DownloadOptions,
  ListOptions,
  ListPartsResult,
  ListResult,
  MultipartUploadInit,
  ObjectInfo,
  ObjectMetadata,
  OSSConfig,
  PartInfo,
  PresignedUrlOptions,
  UploadPartResult,
} from "./types.ts";
import { S3Signer } from "./s3-signature.ts";

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 计算 HMAC-SHA1
 *
 * @param key - 密钥
 * @param data - 数据
 * @returns HMAC 签名
 */
async function hmacSha1(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key.slice(),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, data.slice());
  return new Uint8Array(signature);
}

/**
 * Base64 编码
 *
 * @param data - 字节数组
 * @returns Base64 字符串
 */
function base64Encode(data: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < data.length; i++) {
    binary += String.fromCharCode(data[i]);
  }
  return btoa(binary);
}

/**
 * 格式化 GMT 日期
 *
 * @param date - 日期对象
 * @returns GMT 格式日期字符串
 */
function formatGMTDate(date: Date): string {
  return date.toUTCString();
}

// ============================================================================
// OSS 存储适配器
// ============================================================================

/**
 * 阿里云 OSS 存储适配器
 *
 * @example
 * ```typescript
 * const adapter = new OSSStorageAdapter({
 *   bucket: "my-bucket",
 *   region: "oss-cn-hangzhou",
 *   accessKeyId: "LTAI5t...",
 *   accessKeySecret: "...",
 * });
 *
 * await adapter.save("test.txt", new TextEncoder().encode("Hello"));
 * const data = await adapter.read("test.txt");
 * ```
 */
export class OSSStorageAdapter implements CloudStorageAdapter {
  private config: OSSConfig;
  private endpoint: string;
  /** S3 兼容模式签名器 */
  private s3Signer: S3Signer | null = null;

  /**
   * 创建 OSS 适配器实例
   *
   * @param config - OSS 配置
   */
  constructor(config: OSSConfig) {
    this.config = config;

    // 构建端点 URL
    if (config.endpoint) {
      this.endpoint = config.endpoint;
    } else {
      const protocol = config.secure !== false ? "https" : "http";
      const domain = config.internal
        ? `${config.region}-internal.aliyuncs.com`
        : `${config.region}.aliyuncs.com`;
      this.endpoint = `${protocol}://${config.bucket}.${domain}`;
    }

    // 如果启用 S3 兼容模式，创建 S3 签名器
    if (config.useS3Compatible) {
      this.s3Signer = new S3Signer({
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.accessKeySecret,
        region: config.region,
        sessionToken: config.securityToken,
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
   * 签名请求
   *
   * @param method - HTTP 方法
   * @param key - 对象键
   * @param headers - 请求头
   * @param queryParams - 查询参数
   * @param body - 请求体（用于 S3 兼容模式计算 payload 哈希）
   * @returns 签名后的请求头
   */
  private async signRequest(
    method: string,
    key: string,
    headers: Record<string, string>,
    queryParams?: Record<string, string>,
    body?: Uint8Array,
  ): Promise<Record<string, string>> {
    // S3 兼容模式使用 AWS Signature V4
    if (this.s3Signer) {
      const url = this.buildUrl(key, queryParams);
      return await this.s3Signer.sign(method, url, headers, body);
    }

    // 原生 OSS 签名
    const encoder = new TextEncoder();
    const date = formatGMTDate(new Date());
    headers["Date"] = date;

    // 收集 OSS 自定义头
    const ossHeaders: [string, string][] = [];
    for (const [k, v] of Object.entries(headers)) {
      const lowerKey = k.toLowerCase();
      if (lowerKey.startsWith("x-oss-")) {
        ossHeaders.push([lowerKey, v]);
      }
    }
    ossHeaders.sort((a, b) => a[0].localeCompare(b[0]));

    const canonicalizedOSSHeaders = ossHeaders
      .map(([k, v]) => `${k}:${v}`)
      .join("\n");

    // 构建 CanonicalizedResource
    let canonicalizedResource = `/${this.config.bucket}/${key}`;
    if (queryParams) {
      const subResources = [
        "acl", "uploadId", "partNumber", "uploads",
        "response-content-type", "response-content-disposition",
      ];
      const resourceParams: string[] = [];
      for (const [k, v] of Object.entries(queryParams)) {
        if (subResources.includes(k)) {
          resourceParams.push(v ? `${k}=${v}` : k);
        }
      }
      if (resourceParams.length > 0) {
        canonicalizedResource += `?${resourceParams.sort().join("&")}`;
      }
    }

    // 构建签名字符串
    const stringToSign = [
      method,
      headers["Content-MD5"] || "",
      headers["Content-Type"] || "",
      date,
      canonicalizedOSSHeaders ? canonicalizedOSSHeaders + "\n" : "",
    ].join("\n") + canonicalizedResource;

    // 计算签名
    const signature = base64Encode(
      await hmacSha1(
        encoder.encode(this.config.accessKeySecret),
        encoder.encode(stringToSign),
      ),
    );

    // 构建授权头
    headers["Authorization"] = `OSS ${this.config.accessKeyId}:${signature}`;

    // 添加安全令牌（如果有）
    if (this.config.securityToken) {
      headers["x-oss-security-token"] = this.config.securityToken;
    }

    return headers;
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
    const headers: Record<string, string> = { ...options.headers };
    const body = options.body || new Uint8Array();

    const signedHeaders = await this.signRequest(
      method,
      key,
      headers,
      options.queryParams,
      body,
    );

    return await fetch(url, {
      method,
      headers: signedHeaders,
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
      throw new Error(`OSS 删除失败: ${response.status} ${response.statusText}`);
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
      headers["x-oss-object-acl"] = options.acl;
    }
    if (options?.storageClass) {
      headers["x-oss-storage-class"] = options.storageClass;
    }
    if (options?.metadata) {
      for (const [k, v] of Object.entries(options.metadata)) {
        headers[`x-oss-meta-${k}`] = v;
      }
    }

    const response = await this.request("PUT", path, { headers, body: content });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OSS 上传失败: ${response.status} ${text}`);
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
      throw new Error(`文件不存在: ${path}`);
    }

    if (!response.ok && response.status !== 206) {
      throw new Error(`OSS 下载失败: ${response.status} ${response.statusText}`);
    }

    return new Uint8Array(await response.arrayBuffer());
  }

  async getMetadata(path: string): Promise<ObjectMetadata | null> {
    const response = await this.request("HEAD", path);

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new Error(`OSS 获取元数据失败: ${response.status}`);
    }

    const metadata: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      if (key.toLowerCase().startsWith("x-oss-meta-")) {
        metadata[key.substring(11)] = value;
      }
    });

    return {
      contentType: response.headers.get("Content-Type") || undefined,
      contentLength: parseInt(response.headers.get("Content-Length") || "0", 10),
      etag: response.headers.get("ETag")?.replace(/"/g, "") || undefined,
      lastModified: response.headers.get("Last-Modified")
        ? new Date(response.headers.get("Last-Modified")!)
        : undefined,
      storageClass: response.headers.get("x-oss-storage-class") || undefined,
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
      throw new Error(`OSS 列表失败: ${response.status}`);
    }

    const text = await response.text();
    const objects: ObjectInfo[] = [];
    const contentMatches = text.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g);

    for (const match of contentMatches) {
      const content = match[1];
      const key = content.match(/<Key>(.*?)<\/Key>/)?.[1] || "";
      const size = parseInt(content.match(/<Size>(.*?)<\/Size>/)?.[1] || "0", 10);
      const lastModified = content.match(/<LastModified>(.*?)<\/LastModified>/)?.[1];
      const etag = content.match(/<ETag>(.*?)<\/ETag>/)?.[1]?.replace(/&quot;/g, "");

      objects.push({
        key,
        size,
        lastModified: lastModified ? new Date(lastModified) : new Date(),
        etag,
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

  async copy(sourcePath: string, destPath: string, options?: CopyOptions): Promise<void> {
    const sourceBucket = options?.sourceBucket || this.config.bucket;
    const headers: Record<string, string> = {
      "x-oss-copy-source": `/${sourceBucket}/${sourcePath}`,
    };

    if (options?.metadataDirective) {
      headers["x-oss-metadata-directive"] = options.metadataDirective;
    }

    const response = await this.request("PUT", destPath, { headers });
    if (!response.ok) {
      throw new Error(`OSS 复制失败: ${response.status}`);
    }
  }

  async getPresignedUrl(path: string, options?: PresignedUrlOptions): Promise<string> {
    const method = options?.method || "GET";
    const expiresIn = options?.expiresIn || 3600;
    const expires = Math.floor(Date.now() / 1000) + expiresIn;

    const encoder = new TextEncoder();
    const canonicalizedResource = `/${this.config.bucket}/${path}`;
    const stringToSign = [
      method,
      "",
      options?.contentType || "",
      expires.toString(),
      canonicalizedResource,
    ].join("\n");

    const signature = encodeURIComponent(
      base64Encode(
        await hmacSha1(
          encoder.encode(this.config.accessKeySecret),
          encoder.encode(stringToSign),
        ),
      ),
    );

    const url = new URL(this.buildUrl(path));
    url.searchParams.set("OSSAccessKeyId", this.config.accessKeyId);
    url.searchParams.set("Expires", expires.toString());
    url.searchParams.set("Signature", signature);

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
      headers["x-oss-object-acl"] = options.acl;
    }
    if (options?.storageClass) {
      headers["x-oss-storage-class"] = options.storageClass;
    }
    if (options?.metadata) {
      for (const [k, v] of Object.entries(options.metadata)) {
        headers[`x-oss-meta-${k}`] = v;
      }
    }

    const response = await this.request("POST", key, {
      queryParams: { uploads: "" },
      headers,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OSS 初始化分片上传失败: ${response.status} ${text}`);
    }

    const text = await response.text();
    const uploadId = text.match(/<UploadId>(.*?)<\/UploadId>/)?.[1];

    if (!uploadId) {
      throw new Error("OSS 初始化分片上传失败: 未获取到 UploadId");
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
      throw new Error(`OSS 上传分片失败: ${response.status} ${text}`);
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
        (p) => `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>"${p.etag}"</ETag></Part>`,
      )
      .join("");
    const body = `<CompleteMultipartUpload>${partsXml}</CompleteMultipartUpload>`;
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
      throw new Error(`OSS 完成分片上传失败: ${response.status} ${text}`);
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
      throw new Error(`OSS 取消分片上传失败: ${response.status}`);
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
      throw new Error(`OSS 列出分片失败: ${response.status}`);
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
      const etag = content.match(/<ETag>(.*?)<\/ETag>/)?.[1]?.replace(/&quot;|"/g, "") || "";
      const size = parseInt(content.match(/<Size>(.*?)<\/Size>/)?.[1] || "0", 10);

      parts.push({ partNumber, etag, size });
    }

    const isTruncated = text.includes("<IsTruncated>true</IsTruncated>");
    const nextMarker = text.match(/<NextPartNumberMarker>(.*?)<\/NextPartNumberMarker>/)?.[1];

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
 * 创建阿里云 OSS 存储适配器
 *
 * @param config - OSS 配置
 * @returns OSS 适配器实例
 */
export function createOSSAdapter(config: OSSConfig): OSSStorageAdapter {
  return new OSSStorageAdapter(config);
}
