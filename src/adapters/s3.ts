/**
 * @fileoverview AWS S3 存储适配器
 *
 * 提供 AWS S3 兼容的存储适配器实现
 * 支持 AWS S3、MinIO、Cloudflare R2 等 S3 兼容服务
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
  PartInfo,
  PresignedUrlOptions,
  S3Config,
  UploadPartResult,
} from "./types.ts";
import { $tr } from "../i18n.ts";

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 将字节数组转换为十六进制字符串
 *
 * @param bytes - 字节数组
 * @returns 十六进制字符串
 */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * 计算 SHA256 哈希
 *
 * @param data - 输入数据
 * @returns 哈希值
 */
async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", data.slice());
  return new Uint8Array(hashBuffer);
}

/**
 * 计算 HMAC-SHA256
 *
 * @param key - 密钥
 * @param data - 数据
 * @returns HMAC 签名
 */
async function hmacSha256(
  key: Uint8Array,
  data: Uint8Array,
): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key.slice(),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, data.slice());
  return new Uint8Array(signature);
}

/**
 * 获取 AWS 签名密钥
 *
 * @param secretKey - Secret Access Key
 * @param dateStamp - 日期戳（YYYYMMDD）
 * @param region - 区域
 * @param service - 服务名称
 * @returns 签名密钥
 */
async function getSignatureKey(
  secretKey: string,
  dateStamp: string,
  region: string,
  service: string,
): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const kDate = await hmacSha256(
    encoder.encode(`AWS4${secretKey}`),
    encoder.encode(dateStamp),
  );
  const kRegion = await hmacSha256(kDate, encoder.encode(region));
  const kService = await hmacSha256(kRegion, encoder.encode(service));
  const kSigning = await hmacSha256(kService, encoder.encode("aws4_request"));
  return kSigning;
}

/**
 * URL 编码（符合 AWS 签名要求）
 *
 * @param str - 输入字符串
 * @returns 编码后的字符串
 */
function awsUriEncode(str: string): string {
  return encodeURIComponent(str)
    .replace(/!/g, "%21")
    .replace(/'/g, "%27")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29")
    .replace(/\*/g, "%2A");
}

/**
 * 格式化日期为 ISO8601 格式
 *
 * @param date - 日期对象
 * @returns ISO8601 格式字符串
 */
function formatAmzDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

/**
 * 格式化日期为日期戳
 *
 * @param date - 日期对象
 * @returns 日期戳（YYYYMMDD）
 */
function formatDateStamp(date: Date): string {
  return formatAmzDate(date).substring(0, 8);
}

// ============================================================================
// S3 存储适配器
// ============================================================================

/**
 * AWS S3 存储适配器
 *
 * 支持 AWS S3 及兼容 S3 API 的服务（如 MinIO、Cloudflare R2）
 *
 * @example
 * ```typescript
 * const adapter = new S3StorageAdapter({
 *   bucket: "my-bucket",
 *   region: "us-east-1",
 *   accessKeyId: "your-access-key-id",
 *   secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
 * });
 *
 * await adapter.save("test.txt", new TextEncoder().encode("Hello"));
 * const data = await adapter.read("test.txt");
 * ```
 */
export class S3StorageAdapter implements CloudStorageAdapter {
  private config: S3Config;
  private endpoint: string;

  /**
   * 创建 S3 适配器实例
   *
   * @param config - S3 配置
   */
  constructor(config: S3Config) {
    this.config = config;

    // 构建端点 URL
    if (config.endpoint) {
      this.endpoint = config.endpoint;
    } else if (config.forcePathStyle) {
      this.endpoint = `https://s3.${config.region}.amazonaws.com`;
    } else {
      this.endpoint =
        `https://${config.bucket}.s3.${config.region}.amazonaws.com`;
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

    if (this.config.forcePathStyle || this.config.endpoint) {
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
   * 签名请求（AWS Signature Version 4）
   *
   * @param method - HTTP 方法
   * @param url - 请求 URL
   * @param headers - 请求头
   * @param payload - 请求体
   * @returns 签名后的请求头
   */
  private async signRequest(
    method: string,
    url: string,
    headers: Record<string, string>,
    payload: Uint8Array = new Uint8Array(),
  ): Promise<Record<string, string>> {
    const encoder = new TextEncoder();
    const parsedUrl = new URL(url);
    const now = new Date();
    const amzDate = formatAmzDate(now);
    const dateStamp = formatDateStamp(now);

    // 添加必要的头
    headers["x-amz-date"] = amzDate;
    headers["host"] = parsedUrl.host;

    // 计算 payload 哈希
    const payloadHash = bytesToHex(await sha256(payload));
    headers["x-amz-content-sha256"] = payloadHash;

    // 添加会话令牌（如果有）
    if (this.config.sessionToken) {
      headers["x-amz-security-token"] = this.config.sessionToken;
    }

    // 构建规范请求 - 创建小写 key 的 headers map
    const lowercaseHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      lowercaseHeaders[key.toLowerCase()] = value;
    }

    const sortedHeaderKeys = Object.keys(lowercaseHeaders).sort();
    const signedHeaders = sortedHeaderKeys.join(";");
    const canonicalHeaders = sortedHeaderKeys
      .map((k) => `${k}:${lowercaseHeaders[k]}\n`)
      .join("");

    const canonicalUri = parsedUrl.pathname
      .split("/")
      .map((p) => awsUriEncode(decodeURIComponent(p)))
      .join("/");

    const canonicalQueryString = [...parsedUrl.searchParams.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${awsUriEncode(k)}=${awsUriEncode(v)}`)
      .join("&");

    const canonicalRequest = [
      method,
      canonicalUri,
      canonicalQueryString,
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join("\n");

    // 构建待签名字符串
    const algorithm = "AWS4-HMAC-SHA256";
    const credentialScope =
      `${dateStamp}/${this.config.region}/s3/aws4_request`;
    const stringToSign = [
      algorithm,
      amzDate,
      credentialScope,
      bytesToHex(await sha256(encoder.encode(canonicalRequest))),
    ].join("\n");

    // 计算签名
    const signingKey = await getSignatureKey(
      this.config.secretAccessKey,
      dateStamp,
      this.config.region,
      "s3",
    );
    const signature = bytesToHex(
      await hmacSha256(signingKey, encoder.encode(stringToSign)),
    );

    // 构建授权头
    const authorization =
      `${algorithm} Credential=${this.config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    headers["Authorization"] = authorization;

    return headers;
  }

  /**
   * 发送签名请求
   *
   * @param method - HTTP 方法
   * @param key - 对象键
   * @param options - 请求选项
   * @returns 响应
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

    const signedHeaders = await this.signRequest(method, url, headers, body);

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

  /**
   * 保存文件
   */
  async save(path: string, content: Uint8Array): Promise<void> {
    await this.upload(path, content);
  }

  /**
   * 读取文件
   */
  async read(path: string): Promise<Uint8Array> {
    return await this.download(path);
  }

  /**
   * 删除文件
   */
  async delete(path: string): Promise<void> {
    const response = await this.request("DELETE", path);
    if (!response.ok && response.status !== 404) {
      throw new Error(
        $tr("upload.s3.deleteFailed", {
          status: String(response.status),
          statusText: response.statusText,
        }),
      );
    }
  }

  /**
   * 检查文件是否存在
   */
  async exists(path: string): Promise<boolean> {
    const response = await this.request("HEAD", path);
    return response.ok;
  }

  /**
   * 创建目录（S3 不需要显式创建目录）
   */
  async mkdir(_path: string): Promise<void> {
    // S3 使用扁平结构，不需要创建目录
    await Promise.resolve();
  }

  // ============================================================================
  // CloudStorageAdapter 接口实现
  // ============================================================================

  /**
   * 上传文件
   */
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
    if (options?.contentEncoding) {
      headers["Content-Encoding"] = options.contentEncoding;
    }
    if (options?.acl) {
      headers["x-amz-acl"] = options.acl;
    }
    if (options?.storageClass) {
      headers["x-amz-storage-class"] = options.storageClass;
    }
    if (options?.metadata) {
      for (const [k, v] of Object.entries(options.metadata)) {
        headers[`x-amz-meta-${k}`] = v;
      }
    }

    const response = await this.request("PUT", path, {
      headers,
      body: content,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        $tr("upload.s3.uploadFailed", {
          status: String(response.status),
          text,
        }),
      );
    }
  }

  /**
   * 下载文件
   */
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
        $tr("upload.s3.downloadFailed", {
          status: String(response.status),
          statusText: response.statusText,
        }),
      );
    }

    return new Uint8Array(await response.arrayBuffer());
  }

  /**
   * 获取对象元数据
   */
  async getMetadata(path: string): Promise<ObjectMetadata | null> {
    const response = await this.request("HEAD", path);

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new Error(
        $tr("upload.s3.getMetadataFailed", { status: String(response.status) }),
      );
    }

    const metadata: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      if (key.toLowerCase().startsWith("x-amz-meta-")) {
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
      storageClass: response.headers.get("x-amz-storage-class") || undefined,
      metadata,
    };
  }

  /**
   * 列出对象
   */
  async listObjects(options?: ListOptions): Promise<ListResult> {
    const queryParams: Record<string, string> = {
      "list-type": "2",
    };

    if (options?.prefix) {
      queryParams["prefix"] = options.prefix;
    }
    if (options?.delimiter) {
      queryParams["delimiter"] = options.delimiter;
    }
    if (options?.maxKeys) {
      queryParams["max-keys"] = options.maxKeys.toString();
    }
    if (options?.continuationToken) {
      queryParams["continuation-token"] = options.continuationToken;
    }

    const response = await this.request("GET", "", { queryParams });

    if (!response.ok) {
      throw new Error(
        $tr("upload.s3.listFailed", { status: String(response.status) }),
      );
    }

    const text = await response.text();

    // 简单 XML 解析
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

    const commonPrefixes: string[] = [];
    const prefixMatches = text.matchAll(
      /<CommonPrefixes><Prefix>(.*?)<\/Prefix><\/CommonPrefixes>/g,
    );
    for (const match of prefixMatches) {
      commonPrefixes.push(match[1]);
    }

    const isTruncated = text.includes("<IsTruncated>true</IsTruncated>");
    const nextToken = text.match(
      /<NextContinuationToken>(.*?)<\/NextContinuationToken>/,
    )?.[1];

    return {
      objects,
      commonPrefixes: commonPrefixes.length > 0 ? commonPrefixes : undefined,
      isTruncated,
      nextContinuationToken: nextToken,
    };
  }

  /**
   * 复制对象
   */
  async copy(
    sourcePath: string,
    destPath: string,
    options?: CopyOptions,
  ): Promise<void> {
    const sourceBucket = options?.sourceBucket || this.config.bucket;
    const headers: Record<string, string> = {
      "x-amz-copy-source": `/${sourceBucket}/${sourcePath}`,
    };

    if (options?.metadataDirective) {
      headers["x-amz-metadata-directive"] = options.metadataDirective;
    }
    if (options?.metadata && options.metadataDirective === "REPLACE") {
      for (const [k, v] of Object.entries(options.metadata)) {
        headers[`x-amz-meta-${k}`] = v;
      }
    }

    const response = await this.request("PUT", destPath, { headers });

    if (!response.ok) {
      throw new Error(
        $tr("upload.s3.copyFailed", { status: String(response.status) }),
      );
    }
  }

  /**
   * 生成预签名 URL
   */
  async getPresignedUrl(
    path: string,
    options?: PresignedUrlOptions,
  ): Promise<string> {
    const method = options?.method || "GET";
    const expiresIn = options?.expiresIn || 3600;

    const now = new Date();
    const amzDate = formatAmzDate(now);
    const dateStamp = formatDateStamp(now);

    const credential =
      `${this.config.accessKeyId}/${dateStamp}/${this.config.region}/s3/aws4_request`;

    const queryParams: Record<string, string> = {
      "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
      "X-Amz-Credential": credential,
      "X-Amz-Date": amzDate,
      "X-Amz-Expires": expiresIn.toString(),
      "X-Amz-SignedHeaders": "host",
    };

    if (this.config.sessionToken) {
      queryParams["X-Amz-Security-Token"] = this.config.sessionToken;
    }

    const url = this.buildUrl(path, queryParams);
    const parsedUrl = new URL(url);

    // 构建规范请求
    const canonicalUri = parsedUrl.pathname
      .split("/")
      .map((p) => awsUriEncode(decodeURIComponent(p)))
      .join("/");

    const canonicalQueryString = [...parsedUrl.searchParams.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${awsUriEncode(k)}=${awsUriEncode(v)}`)
      .join("&");

    const canonicalRequest = [
      method,
      canonicalUri,
      canonicalQueryString,
      `host:${parsedUrl.host}\n`,
      "host",
      "UNSIGNED-PAYLOAD",
    ].join("\n");

    // 待签名字符串
    const encoder = new TextEncoder();
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      `${dateStamp}/${this.config.region}/s3/aws4_request`,
      bytesToHex(await sha256(encoder.encode(canonicalRequest))),
    ].join("\n");

    // 计算签名
    const signingKey = await getSignatureKey(
      this.config.secretAccessKey,
      dateStamp,
      this.config.region,
      "s3",
    );
    const signature = bytesToHex(
      await hmacSha256(signingKey, encoder.encode(stringToSign)),
    );

    return `${url}&X-Amz-Signature=${signature}`;
  }

  // ============================================================================
  // 分片上传方法
  // ============================================================================

  /**
   * 初始化分片上传
   *
   * @param key - 对象键
   * @param options - 上传选项
   * @returns 包含 uploadId 的初始化结果
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
      headers["x-amz-acl"] = options.acl;
    }
    if (options?.storageClass) {
      headers["x-amz-storage-class"] = options.storageClass;
    }
    if (options?.metadata) {
      for (const [k, v] of Object.entries(options.metadata)) {
        headers[`x-amz-meta-${k}`] = v;
      }
    }

    const response = await this.request("POST", key, {
      queryParams: { uploads: "" },
      headers,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        $tr("upload.s3.initMultipartFailed", {
          status: String(response.status),
          text,
        }),
      );
    }

    const text = await response.text();
    const uploadId = text.match(/<UploadId>(.*?)<\/UploadId>/)?.[1];

    if (!uploadId) {
      throw new Error($tr("upload.s3.initMultipartNoUploadId"));
    }

    return { uploadId, key };
  }

  /**
   * 上传分片
   *
   * @param key - 对象键
   * @param uploadId - 上传 ID
   * @param partNumber - 分片编号（从 1 开始）
   * @param data - 分片数据
   * @returns 包含 ETag 的上传结果
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
        $tr("upload.s3.uploadPartFailed", {
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
   *
   * @param key - 对象键
   * @param uploadId - 上传 ID
   * @param parts - 已上传的分片列表
   */
  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: PartInfo[],
  ): Promise<void> {
    // 按分片编号排序
    const sortedParts = [...parts].sort((a, b) => a.partNumber - b.partNumber);

    // 构建请求体
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
        $tr("upload.s3.completeMultipartFailed", {
          status: String(response.status),
          text,
        }),
      );
    }
  }

  /**
   * 取消分片上传
   *
   * @param key - 对象键
   * @param uploadId - 上传 ID
   */
  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    const response = await this.request("DELETE", key, {
      queryParams: { uploadId },
    });

    if (!response.ok && response.status !== 404) {
      throw new Error(
        $tr("upload.s3.abortMultipartFailed", {
          status: String(response.status),
        }),
      );
    }
  }

  /**
   * 列出已上传的分片
   *
   * @param key - 对象键
   * @param uploadId - 上传 ID
   * @returns 分片列表
   */
  async listParts(key: string, uploadId: string): Promise<ListPartsResult> {
    const response = await this.request("GET", key, {
      queryParams: { uploadId },
    });

    if (!response.ok) {
      throw new Error(
        $tr("upload.s3.listPartsFailed", { status: String(response.status) }),
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
 * 创建 S3 存储适配器
 *
 * @param config - S3 配置
 * @returns S3 适配器实例
 *
 * @example
 * ```typescript
 * const adapter = createS3Adapter({
 *   bucket: "my-bucket",
 *   region: "us-east-1",
 *   accessKeyId: "your-access-key-id",
 *   secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
 * });
 * ```
 */
export function createS3Adapter(config: S3Config): S3StorageAdapter {
  return new S3StorageAdapter(config);
}
