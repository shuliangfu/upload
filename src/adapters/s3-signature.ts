/**
 * @fileoverview AWS S3 签名 V4 工具模块
 *
 * 提供 AWS Signature Version 4 签名算法的实现
 * 可被 S3 兼容模式的适配器复用
 */

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 将字节数组转换为十六进制字符串
 *
 * @param bytes - 字节数组
 * @returns 十六进制字符串
 */
export function bytesToHex(bytes: Uint8Array): string {
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
export async function sha256(data: Uint8Array): Promise<Uint8Array> {
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
export async function hmacSha256(
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
export async function getSignatureKey(
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
export function awsUriEncode(str: string): string {
  return encodeURIComponent(str)
    .replace(/!/g, "%21")
    .replace(/'/g, "%27")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29")
    .replace(/\*/g, "%2A");
}

/**
 * 格式化日期为 ISO8601 格式（AWS 格式）
 *
 * @param date - 日期对象
 * @returns ISO8601 格式字符串（如 20231225T120000Z）
 */
export function formatAmzDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

/**
 * 格式化日期为日期戳
 *
 * @param date - 日期对象
 * @returns 日期戳（YYYYMMDD）
 */
export function formatDateStamp(date: Date): string {
  return formatAmzDate(date).substring(0, 8);
}

// ============================================================================
// S3 签名配置
// ============================================================================

/**
 * S3 签名配置
 */
export interface S3SignatureConfig {
  /** Access Key ID */
  accessKeyId: string;
  /** Secret Access Key */
  secretAccessKey: string;
  /** 区域 */
  region: string;
  /** 会话令牌（可选） */
  sessionToken?: string;
}

// ============================================================================
// S3 签名器
// ============================================================================

/**
 * AWS S3 Signature V4 签名器
 *
 * @example
 * ```typescript
 * const signer = new S3Signer({
 *   accessKeyId: "your-access-key-id",
 *   secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
 *   region: "us-east-1",
 * });
 *
 * const signedHeaders = await signer.sign("PUT", url, headers, body);
 * ```
 */
export class S3Signer {
  private config: S3SignatureConfig;

  /**
   * 创建签名器实例
   *
   * @param config - 签名配置
   */
  constructor(config: S3SignatureConfig) {
    this.config = config;
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
  async sign(
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
}
