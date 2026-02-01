/**
 * @fileoverview 病毒扫描模块
 *
 * 提供文件病毒扫描功能，支持：
 * - ClamAV 集成
 * - VirusTotal API 集成
 * - 自定义扫描器
 * - 扫描结果缓存
 *
 * @example
 * ```typescript
 * import { VirusScanner, ClamAVScanner } from "@dreamer/upload/scanner";
 *
 * // 使用 ClamAV
 * const scanner = new ClamAVScanner({
 *   host: "localhost",
 *   port: 3310,
 * });
 *
 * const result = await scanner.scan(fileData);
 * if (!result.safe) {
 *   console.log("发现威胁:", result.threats);
 * }
 * ```
 */

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 扫描结果
 */
export interface ScanResult {
  /** 是否安全 */
  safe: boolean;
  /** 检测到的威胁列表 */
  threats: string[];
  /** 扫描引擎名称 */
  engine: string;
  /** 扫描耗时（毫秒） */
  duration: number;
  /** 文件哈希 */
  fileHash?: string;
  /** 扫描时间 */
  scannedAt: Date;
  /** 额外信息 */
  metadata?: Record<string, unknown>;
}

/**
 * 扫描器接口
 */
export interface VirusScannerInterface {
  /** 扫描器名称 */
  readonly name: string;

  /**
   * 扫描文件内容
   *
   * @param content - 文件内容
   * @param filename - 文件名（可选）
   * @returns 扫描结果
   */
  scan(content: Uint8Array, filename?: string): Promise<ScanResult>;

  /**
   * 检查扫描器是否可用
   *
   * @returns 是否可用
   */
  isAvailable(): Promise<boolean>;
}

/**
 * ClamAV 配置
 */
export interface ClamAVConfig {
  /** 主机地址 */
  host: string;
  /** 端口号 */
  port: number;
  /** 超时时间（毫秒） */
  timeout?: number;
  /** 是否使用 TLS */
  tls?: boolean;
}

/**
 * VirusTotal 配置
 */
export interface VirusTotalConfig {
  /** API 密钥 */
  apiKey: string;
  /** API 版本（默认 v3） */
  version?: "v2" | "v3";
  /** 超时时间（毫秒） */
  timeout?: number;
  /** 等待扫描完成的最大时间（毫秒） */
  maxWaitTime?: number;
  /** 轮询间隔（毫秒） */
  pollInterval?: number;
}

/**
 * 扫描缓存配置
 */
export interface ScanCacheConfig {
  /** 是否启用缓存 */
  enabled?: boolean;
  /** 缓存过期时间（毫秒） */
  ttl?: number;
  /** 最大缓存条数 */
  maxSize?: number;
}

/**
 * 多扫描器配置
 */
export interface MultiScannerConfig {
  /** 扫描器列表 */
  scanners: VirusScannerInterface[];
  /** 扫描模式 */
  mode?: "all" | "any" | "first";
  /** 是否并行扫描 */
  parallel?: boolean;
}

// ============================================================================
// ClamAV 扫描器
// ============================================================================

/**
 * ClamAV 扫描器
 *
 * 通过 TCP 连接与 ClamAV 守护进程通信
 *
 * @example
 * ```typescript
 * const scanner = new ClamAVScanner({
 *   host: "localhost",
 *   port: 3310,
 * });
 *
 * if (await scanner.isAvailable()) {
 *   const result = await scanner.scan(fileData);
 *   console.log(result.safe ? "安全" : "发现威胁");
 * }
 * ```
 */
export class ClamAVScanner implements VirusScannerInterface {
  readonly name = "ClamAV";
  private config: Required<ClamAVConfig>;

  /**
   * 创建 ClamAV 扫描器
   *
   * @param config - ClamAV 配置
   */
  constructor(config: ClamAVConfig) {
    this.config = {
      host: config.host,
      port: config.port,
      timeout: config.timeout || 30000,
      tls: config.tls || false,
    };
  }

  /**
   * 检查 ClamAV 是否可用
   */
  async isAvailable(): Promise<boolean> {
    try {
      const response = await this.sendCommand("PING");
      return response.trim() === "PONG";
    } catch {
      return false;
    }
  }

  /**
   * 扫描文件内容
   */
  async scan(content: Uint8Array, _filename?: string): Promise<ScanResult> {
    const startTime = Date.now();

    try {
      // 使用 INSTREAM 命令发送数据
      const response = await this.scanStream(content);
      const duration = Date.now() - startTime;

      // 解析响应
      const threats = this.parseResponse(response);

      // 计算文件哈希
      const hashBuffer = await crypto.subtle.digest("SHA-256", content.slice());
      const fileHash = Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      return {
        safe: threats.length === 0,
        threats,
        engine: this.name,
        duration,
        fileHash,
        scannedAt: new Date(),
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      return {
        safe: false,
        threats: [],
        engine: this.name,
        duration,
        scannedAt: new Date(),
        metadata: {
          error: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  /**
   * 发送命令到 ClamAV
   */
  private async sendCommand(command: string): Promise<string> {
    // 使用 Deno 的 TCP 连接
    const conn = await Deno.connect({
      hostname: this.config.host,
      port: this.config.port,
    });

    try {
      // 发送命令
      const encoder = new TextEncoder();
      await conn.write(encoder.encode(`z${command}\0`));

      // 读取响应
      const buffer = new Uint8Array(4096);
      const n = await conn.read(buffer);
      const decoder = new TextDecoder();
      return decoder.decode(buffer.subarray(0, n || 0));
    } finally {
      conn.close();
    }
  }

  /**
   * 使用 INSTREAM 命令扫描数据
   */
  private async scanStream(content: Uint8Array): Promise<string> {
    const conn = await Deno.connect({
      hostname: this.config.host,
      port: this.config.port,
    });

    try {
      const encoder = new TextEncoder();

      // 发送 INSTREAM 命令
      await conn.write(encoder.encode("zINSTREAM\0"));

      // 分块发送数据
      const chunkSize = 2048;
      for (let i = 0; i < content.length; i += chunkSize) {
        const chunk = content.slice(i, Math.min(i + chunkSize, content.length));

        // 发送长度（4 字节大端序）
        const lengthBuffer = new ArrayBuffer(4);
        const view = new DataView(lengthBuffer);
        view.setUint32(0, chunk.length, false);
        await conn.write(new Uint8Array(lengthBuffer));

        // 发送数据
        await conn.write(chunk);
      }

      // 发送结束标记（长度为 0）
      await conn.write(new Uint8Array([0, 0, 0, 0]));

      // 读取响应
      const buffer = new Uint8Array(4096);
      const n = await conn.read(buffer);
      const decoder = new TextDecoder();
      return decoder.decode(buffer.subarray(0, n || 0));
    } finally {
      conn.close();
    }
  }

  /**
   * 解析 ClamAV 响应
   */
  private parseResponse(response: string): string[] {
    const threats: string[] = [];

    // 响应格式: stream: <virus_name> FOUND 或 stream: OK
    const lines = response.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.endsWith("FOUND")) {
        // 提取病毒名称
        const match = trimmed.match(/:\s*(.+)\s+FOUND$/);
        if (match) {
          threats.push(match[1].trim());
        }
      }
    }

    return threats;
  }
}

// ============================================================================
// VirusTotal 扫描器
// ============================================================================

/**
 * VirusTotal 扫描器
 *
 * 使用 VirusTotal API 进行在线病毒扫描
 *
 * @example
 * ```typescript
 * const scanner = new VirusTotalScanner({
 *   apiKey: "your-api-key",
 * });
 *
 * const result = await scanner.scan(fileData);
 * console.log(`扫描结果: ${result.safe ? "安全" : "危险"}`);
 * ```
 */
export class VirusTotalScanner implements VirusScannerInterface {
  readonly name = "VirusTotal";
  private config: Required<VirusTotalConfig>;

  /**
   * 创建 VirusTotal 扫描器
   *
   * @param config - VirusTotal 配置
   */
  constructor(config: VirusTotalConfig) {
    this.config = {
      apiKey: config.apiKey,
      version: config.version || "v3",
      timeout: config.timeout || 60000,
      maxWaitTime: config.maxWaitTime || 300000, // 5 分钟
      pollInterval: config.pollInterval || 15000, // 15 秒
    };
  }

  /**
   * 检查 VirusTotal 是否可用
   */
  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch("https://www.virustotal.com/api/v3/users/current", {
        headers: {
          "x-apikey": this.config.apiKey,
        },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * 扫描文件内容
   */
  async scan(content: Uint8Array, filename?: string): Promise<ScanResult> {
    const startTime = Date.now();

    try {
      // 计算文件哈希
      const hashBuffer = await crypto.subtle.digest("SHA-256", content.slice());
      const fileHash = Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      // 先检查是否已有扫描结果
      const existingResult = await this.getReport(fileHash);
      if (existingResult) {
        return {
          ...existingResult,
          duration: Date.now() - startTime,
        };
      }

      // 上传文件进行扫描
      const analysisId = await this.uploadFile(content, filename);

      // 等待扫描完成
      const result = await this.waitForAnalysis(analysisId);

      return {
        ...result,
        fileHash,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        safe: false,
        threats: [],
        engine: this.name,
        duration: Date.now() - startTime,
        scannedAt: new Date(),
        metadata: {
          error: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  /**
   * 获取现有扫描报告
   */
  private async getReport(fileHash: string): Promise<ScanResult | null> {
    const response = await fetch(
      `https://www.virustotal.com/api/v3/files/${fileHash}`,
      {
        headers: {
          "x-apikey": this.config.apiKey,
        },
      },
    );

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new Error(`VirusTotal API 错误: ${response.status}`);
    }

    const data = await response.json();
    return this.parseAnalysisResult(data);
  }

  /**
   * 上传文件进行扫描
   */
  private async uploadFile(content: Uint8Array, filename?: string): Promise<string> {
    const formData = new FormData();
    const blob = new Blob([content.slice()]);
    formData.append("file", blob, filename || "file");

    const response = await fetch("https://www.virustotal.com/api/v3/files", {
      method: "POST",
      headers: {
        "x-apikey": this.config.apiKey,
      },
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`VirusTotal 上传失败: ${response.status}`);
    }

    const data = await response.json();
    return data.data.id;
  }

  /**
   * 等待分析完成
   */
  private async waitForAnalysis(analysisId: string): Promise<ScanResult> {
    const startTime = Date.now();

    while (Date.now() - startTime < this.config.maxWaitTime) {
      const response = await fetch(
        `https://www.virustotal.com/api/v3/analyses/${analysisId}`,
        {
          headers: {
            "x-apikey": this.config.apiKey,
          },
        },
      );

      if (!response.ok) {
        throw new Error(`VirusTotal API 错误: ${response.status}`);
      }

      const data = await response.json();
      const status = data.data.attributes.status;

      if (status === "completed") {
        return this.parseAnalysisResult(data);
      }

      // 等待后重试
      await new Promise((resolve) => setTimeout(resolve, this.config.pollInterval));
    }

    throw new Error("扫描超时");
  }

  /**
   * 解析分析结果
   */
  private parseAnalysisResult(data: Record<string, unknown>): ScanResult {
    const attributes = (data.data as Record<string, unknown>)?.attributes as Record<
      string,
      unknown
    >;
    const stats = attributes?.last_analysis_stats as Record<string, number>;
    const results = attributes?.last_analysis_results as Record<
      string,
      Record<string, unknown>
    >;

    const threats: string[] = [];

    // 收集检测到的威胁
    if (results) {
      for (const [engine, result] of Object.entries(results)) {
        if (result.category === "malicious" || result.category === "suspicious") {
          const threat = result.result as string;
          if (threat) {
            threats.push(`${engine}: ${threat}`);
          }
        }
      }
    }

    const malicious = stats?.malicious || 0;
    const suspicious = stats?.suspicious || 0;

    return {
      safe: malicious === 0 && suspicious === 0,
      threats,
      engine: this.name,
      duration: 0,
      scannedAt: new Date(),
      metadata: {
        stats,
        totalEngines: Object.keys(results || {}).length,
      },
    };
  }
}

// ============================================================================
// 多扫描器
// ============================================================================

/**
 * 多扫描器
 *
 * 组合多个扫描器进行综合扫描
 *
 * @example
 * ```typescript
 * const multiScanner = new MultiScanner({
 *   scanners: [clamAV, virusTotal],
 *   mode: "all",
 *   parallel: true,
 * });
 *
 * const result = await multiScanner.scan(fileData);
 * ```
 */
export class MultiScanner implements VirusScannerInterface {
  readonly name = "MultiScanner";
  private config: Required<MultiScannerConfig>;

  /**
   * 创建多扫描器
   *
   * @param config - 配置选项
   */
  constructor(config: MultiScannerConfig) {
    if (config.scanners.length === 0) {
      throw new Error("至少需要一个扫描器");
    }

    this.config = {
      scanners: config.scanners,
      mode: config.mode || "all",
      parallel: config.parallel ?? true,
    };
  }

  /**
   * 检查是否有可用的扫描器
   */
  async isAvailable(): Promise<boolean> {
    for (const scanner of this.config.scanners) {
      if (await scanner.isAvailable()) {
        return true;
      }
    }
    return false;
  }

  /**
   * 扫描文件
   */
  async scan(content: Uint8Array, filename?: string): Promise<ScanResult> {
    const startTime = Date.now();
    const allThreats: string[] = [];
    const metadata: Record<string, unknown> = {
      scanners: [],
    };

    // 获取可用的扫描器
    const availableScanners: VirusScannerInterface[] = [];
    for (const scanner of this.config.scanners) {
      if (await scanner.isAvailable()) {
        availableScanners.push(scanner);
      }
    }

    if (availableScanners.length === 0) {
      throw new Error("没有可用的扫描器");
    }

    let safe = true;

    if (this.config.parallel) {
      // 并行扫描
      const results = await Promise.all(
        availableScanners.map((s) => s.scan(content, filename)),
      );

      for (const result of results) {
        (metadata.scanners as unknown[]).push({
          name: result.engine,
          safe: result.safe,
          threats: result.threats,
          duration: result.duration,
        });

        if (!result.safe) {
          safe = false;
          allThreats.push(...result.threats);
        }

        // 根据模式决定是否继续
        if (this.config.mode === "any" && !result.safe) {
          break;
        }
      }
    } else {
      // 串行扫描
      for (const scanner of availableScanners) {
        const result = await scanner.scan(content, filename);

        (metadata.scanners as unknown[]).push({
          name: result.engine,
          safe: result.safe,
          threats: result.threats,
          duration: result.duration,
        });

        if (!result.safe) {
          safe = false;
          allThreats.push(...result.threats);
        }

        // first 模式：只使用第一个扫描器
        if (this.config.mode === "first") {
          break;
        }

        // any 模式：发现威胁就停止
        if (this.config.mode === "any" && !result.safe) {
          break;
        }
      }
    }

    return {
      safe,
      threats: [...new Set(allThreats)],
      engine: this.name,
      duration: Date.now() - startTime,
      scannedAt: new Date(),
      metadata,
    };
  }
}

// ============================================================================
// 缓存扫描器包装器
// ============================================================================

/**
 * 缓存条目
 */
interface CacheEntry {
  result: ScanResult;
  expiresAt: number;
}

/**
 * 缓存扫描器
 *
 * 包装其他扫描器，提供结果缓存功能
 *
 * @example
 * ```typescript
 * const cachedScanner = new CachedScanner(clamAV, {
 *   enabled: true,
 *   ttl: 3600000, // 1 小时
 *   maxSize: 1000,
 * });
 * ```
 */
export class CachedScanner implements VirusScannerInterface {
  readonly name: string;
  private scanner: VirusScannerInterface;
  private config: Required<ScanCacheConfig>;
  private cache: Map<string, CacheEntry> = new Map();

  /**
   * 创建缓存扫描器
   *
   * @param scanner - 被包装的扫描器
   * @param config - 缓存配置
   */
  constructor(scanner: VirusScannerInterface, config: ScanCacheConfig = {}) {
    this.scanner = scanner;
    this.name = `Cached(${scanner.name})`;
    this.config = {
      enabled: config.enabled ?? true,
      ttl: config.ttl || 3600000, // 默认 1 小时
      maxSize: config.maxSize || 10000,
    };
  }

  /**
   * 检查扫描器是否可用
   */
  isAvailable(): Promise<boolean> {
    return this.scanner.isAvailable();
  }

  /**
   * 扫描文件
   */
  async scan(content: Uint8Array, filename?: string): Promise<ScanResult> {
    if (!this.config.enabled) {
      return this.scanner.scan(content, filename);
    }

    // 计算文件哈希作为缓存键
    const hashBuffer = await crypto.subtle.digest("SHA-256", content.slice());
    const cacheKey = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    // 检查缓存
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return {
        ...cached.result,
        metadata: {
          ...cached.result.metadata,
          cached: true,
        },
      };
    }

    // 执行扫描
    const result = await this.scanner.scan(content, filename);

    // 存入缓存
    this.setCache(cacheKey, result);

    return result;
  }

  /**
   * 设置缓存
   */
  private setCache(key: string, result: ScanResult): void {
    // 清理过期缓存
    if (this.cache.size >= this.config.maxSize) {
      this.cleanupCache();
    }

    this.cache.set(key, {
      result,
      expiresAt: Date.now() + this.config.ttl,
    });
  }

  /**
   * 清理过期缓存
   */
  private cleanupCache(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt <= now) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.cache.delete(key);
    }

    // 如果还是太大，删除最旧的
    if (this.cache.size >= this.config.maxSize) {
      const entries = [...this.cache.entries()].sort(
        (a, b) => a[1].expiresAt - b[1].expiresAt,
      );

      const toDelete = entries.slice(0, Math.floor(this.config.maxSize / 4));
      for (const [key] of toDelete) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * 清空缓存
   */
  clearCache(): void {
    this.cache.clear();
  }
}

// ============================================================================
// 工厂函数
// ============================================================================

/**
 * 创建 ClamAV 扫描器
 *
 * @param config - ClamAV 配置
 * @returns ClamAV 扫描器实例
 */
export function createClamAVScanner(config: ClamAVConfig): ClamAVScanner {
  return new ClamAVScanner(config);
}

/**
 * 创建 VirusTotal 扫描器
 *
 * @param config - VirusTotal 配置
 * @returns VirusTotal 扫描器实例
 */
export function createVirusTotalScanner(config: VirusTotalConfig): VirusTotalScanner {
  return new VirusTotalScanner(config);
}

/**
 * 创建多扫描器
 *
 * @param config - 多扫描器配置
 * @returns 多扫描器实例
 */
export function createMultiScanner(config: MultiScannerConfig): MultiScanner {
  return new MultiScanner(config);
}

/**
 * 创建带缓存的扫描器
 *
 * @param scanner - 被包装的扫描器
 * @param config - 缓存配置
 * @returns 带缓存的扫描器实例
 */
export function createCachedScanner(
  scanner: VirusScannerInterface,
  config?: ScanCacheConfig,
): CachedScanner {
  return new CachedScanner(scanner, config);
}
