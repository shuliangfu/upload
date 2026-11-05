/**
 * @fileoverview 本地磁盘版 {@link CloudStorageAdapter}
 *
 * 用于在无 S3/OSS/COS 时仍可使用 {@link MultipartUploadHandler}（分片 init / chunk / complete）。
 * 分片暂存于 `baseDir/.staging/<uploadId>/`，合并后写入 `baseDir/<key>`。
 *
 * **大文件**：`completeMultipartUpload` 按分片 **顺序 append** 写目标（峰值≈单分片，
 * 不再整包 `merged` 双倍内存）。单分片仍整段读入以校验 etag；二次校验可 Range 只拉头。
 * 可选 `uploadStream`／`downloadStream` 用于整对象流式读写。
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
  ObjectMetadata,
  PartInfo,
  PresignedUrlOptions,
  UploadPartResult,
} from "./types.ts";
import {
  type FileInfo,
  mkdir,
  open,
  readdir,
  readFile,
  remove,
  stat,
  writeFile,
} from "@dreamer/runtime-adapter";
import { dirname, join } from "@dreamer/runtime-adapter";
import {
  assertPathSafe,
  isPathSafe,
  isUuid,
  sanitizeObjectKey,
} from "../utils.ts";

/** {@link createLocalCloudStorageAdapter} 的配置 */
export interface LocalCloudStorageConfig {
  /** 对象键对应的根目录（最终文件路径为 resolveSafePath(baseDir, key)） */
  baseDir: string;
  /**
   * 供 {@link getPresignedUrl} 生成的公开下载路径前缀（不含 query），
   * 例如 `/api/upload/file`，完整 URL 为 `${publicFileBasePath}?key=<encodeURIComponent(key)>`
   */
  publicFileBasePath?: string;
  /**
   * 分片暂存 TTL（毫秒）。超过则在下次 init／显式 cleanup 时删除。
   * 默认 24h；设 0 关闭自动清理。
   */
  stagingTtlMs?: number;
}

/** 暂存目录内 `_meta.json` 内容 */
interface StagingMeta {
  key: string;
  contentType?: string;
  /** 创建时间（epoch ms），用于 TTL 清理 */
  createdAt: number;
}

/**
 * 计算二进制内容的十六进制 SHA-256，用作分片 ETag（与常见对象存储形态一致，便于校验）
 */
async function sha256Hex(data: Uint8Array): Promise<string> {
  // Deno 严格 BufferSource 需独立 ArrayBuffer view；.slice() 仅用于 digest。
  const digest = await crypto.subtle.digest("SHA-256", data.slice());
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** 分片旁路 etag 文件名（与 part-N 同目录） */
function partEtagPath(stage: string, partNumber: number): string {
  return join(stage, `part-${partNumber}.etag`);
}

/**
 * 本地磁盘 + 分片合并实现的云适配器（满足 {@link CloudStorageAdapter}）
 */
export class LocalCloudStorageAdapter implements CloudStorageAdapter {
  private readonly baseDir: string;
  private readonly publicFileBasePath: string;
  private readonly stagingTtlMs: number;
  private initialized = false;

  /**
   * @param config - 根目录与对外 URL 前缀
   */
  constructor(config: LocalCloudStorageConfig) {
    this.baseDir = config.baseDir;
    this.publicFileBasePath = config.publicFileBasePath ?? "/uploads/file";
    this.stagingTtlMs = config.stagingTtlMs ?? 24 * 60 * 60 * 1000;
  }

  /**
   * 确保根目录存在
   */
  private async ensureInit(): Promise<void> {
    if (this.initialized) return;
    await mkdir(this.baseDir, { recursive: true });
    this.initialized = true;
  }

  /**
   * 对象键对应的绝对路径（牢笼：sanitize + resolveSafePath）。
   *
   * 为何不直接 join：未校验的 key 可 `../` 逃出 baseDir（Critical）。
   */
  private fullPath(key: string): string {
    // 先拒原始穿越／绝对路径（sanitize 会吞掉 `..` 段，不能只靠它）
    if (!isPathSafe(key, this.baseDir)) {
      throw new Error("Unsafe path rejected");
    }
    const safeKey = sanitizeObjectKey(key);
    if (!safeKey) {
      throw new Error("Empty object key after sanitize");
    }
    return assertPathSafe(this.baseDir, safeKey);
  }

  /**
   * 分片会话目录。
   *
   * 不变量：uploadId 必须是 UUID，防止 `uploadId=../../` 穿越。
   * staging 根目录本身用固定相对段 `.staging/<uuid>`，再 resolve 校验。
   */
  private stagingDir(uploadId: string): string {
    if (!isUuid(uploadId)) {
      throw new Error("Invalid uploadId: expected UUID");
    }
    // `.staging` 以隐藏段落在 baseDir 下；对 isPathSafe 而言以相对键校验 uuid 段即可，
    // 完整路径用 resolveSafePath(baseDir, `.staging/${uploadId}`) —— 但 isPathSafe
    // 默认不禁隐藏段。这里直接 assertPathSafe。
    return assertPathSafe(this.baseDir, `.staging/${uploadId}`);
  }

  /**
   * 清理过期 staging 目录（按 `_meta.json.createdAt` + stagingTtlMs）。
   *
   * 边界：TTL=0 跳过；meta 缺失的目录按 mtime 无法可靠判断时保留（避免误删进行中的上传）。
   */
  async cleanupExpiredStaging(now: number = Date.now()): Promise<number> {
    if (!this.stagingTtlMs || this.stagingTtlMs <= 0) return 0;
    await this.ensureInit();
    const stagingRoot = join(this.baseDir, ".staging");
    let removed = 0;
    let entries: Array<{ name: string; isDirectory: boolean }>;
    try {
      entries = await readdir(stagingRoot);
    } catch {
      return 0;
    }
    for (const e of entries) {
      if (!e.isDirectory || !isUuid(e.name)) continue;
      const stage = join(stagingRoot, e.name);
      try {
        const metaRaw = await readFile(join(stage, "_meta.json"));
        const meta = JSON.parse(
          new TextDecoder().decode(metaRaw),
        ) as StagingMeta;
        const created = meta.createdAt ?? 0;
        if (created > 0 && now - created > this.stagingTtlMs) {
          await remove(stage, { recursive: true });
          removed++;
        }
      } catch {
        // meta 不可读则跳过，避免误删
      }
    }
    return removed;
  }

  /** @inheritdoc */
  getBucket(): string {
    return "local";
  }

  /** @inheritdoc */
  getRegion(): string {
    return "local";
  }

  /** @inheritdoc */
  async save(path: string, content: Uint8Array): Promise<void> {
    await this.upload(path, content);
  }

  /** @inheritdoc */
  async read(path: string): Promise<Uint8Array> {
    return await readFile(this.fullPath(path));
  }

  /** @inheritdoc */
  async delete(path: string): Promise<void> {
    try {
      await remove(this.fullPath(path));
    } catch {
      // 与 LocalStorageAdapter 一致：不存在则忽略
    }
  }

  /** @inheritdoc */
  async exists(path: string): Promise<boolean> {
    try {
      await stat(this.fullPath(path));
      return true;
    } catch {
      return false;
    }
  }

  /** @inheritdoc */
  async mkdir(path: string): Promise<void> {
    await this.ensureInit();
    await mkdir(this.fullPath(path), { recursive: true });
  }

  /** @inheritdoc */
  async upload(
    path: string,
    content: Uint8Array,
    _options?: CloudUploadOptions,
  ): Promise<void> {
    await this.ensureInit();
    const fp = this.fullPath(path);
    const dir = dirname(fp);
    if (dir && dir !== ".") {
      await mkdir(dir, { recursive: true });
    }
    await writeFile(fp, content);
  }

  /** @inheritdoc */
  async download(
    path: string,
    options?: DownloadOptions,
  ): Promise<Uint8Array> {
    if (options?.signal?.aborted) {
      throw new DOMException("Download aborted", "AbortError");
    }
    const start = options?.rangeStart;
    const end = options?.rangeEnd;
    if (start === undefined && end === undefined) {
      return await this.read(path);
    }
    const s = start ?? 0;
    // 头范围（start=0）：流式只读前 N 字节，避免大文件全量进内存
    if (s === 0 && end !== undefined && end >= 0) {
      const need = end + 1;
      const fp = this.fullPath(path);
      // 小文件／头校验：全量 read 再裁切更稳（避免 readable 读完后 close 抢资源）
      // 大文件头：流式读满 need 即停。
      const info = await stat(fp);
      if (info.size <= need || info.size <= 256 * 1024) {
        const data = await readFile(fp);
        return data.subarray(0, Math.min(need, data.length));
      }
      const handle = await open(fp, { read: true });
      try {
        const out = new Uint8Array(need);
        let offset = 0;
        const reader = handle.readable.getReader();
        try {
          while (offset < need) {
            const { done, value } = await reader.read();
            if (done || !value) break;
            const take = Math.min(value.length, need - offset);
            out.set(value.subarray(0, take), offset);
            offset += take;
          }
        } finally {
          try {
            reader.cancel();
          } catch {
            // ignore
          }
          try {
            reader.releaseLock();
          } catch {
            // ignore
          }
        }
        return offset === need ? out : out.subarray(0, offset);
      } finally {
        try {
          handle.close();
        } catch {
          // Deno：readable 耗尽后 fd 可能已释放
        }
      }
    }
    // 中段 Range：本地无 seek API 时退回全量再裁（complete 头校验不走此支）
    const data = await this.read(path);
    const e = end !== undefined ? end + 1 : data.length;
    return data.subarray(s, Math.min(e, data.length));
  }

  /** @inheritdoc */
  async getMetadata(path: string): Promise<ObjectMetadata | null> {
    try {
      const info: FileInfo = await stat(this.fullPath(path));
      return {
        contentLength: info.size,
        lastModified: info.mtime || new Date(),
      };
    } catch {
      return null;
    }
  }

  /** @inheritdoc */
  async listObjects(_options?: ListOptions): Promise<ListResult> {
    await this.ensureInit();
    // 分片场景不依赖列举；完整目录树列举可后续按需扩展
    return { objects: [], isTruncated: false };
  }

  /** @inheritdoc */
  async copy(
    sourcePath: string,
    destPath: string,
    _options?: CopyOptions,
  ): Promise<void> {
    const data = await this.read(sourcePath);
    await this.upload(destPath, data);
  }

  /** @inheritdoc */
  getPresignedUrl(
    path: string,
    _options?: PresignedUrlOptions,
  ): Promise<string> {
    const sep = this.publicFileBasePath.includes("?") ? "&" : "?";
    return Promise.resolve(
      `${this.publicFileBasePath}${sep}key=${encodeURIComponent(path)}`,
    );
  }

  /** @inheritdoc */
  async initiateMultipartUpload(
    key: string,
    options?: CloudUploadOptions,
  ): Promise<MultipartUploadInit> {
    await this.ensureInit();
    // 顺带清理过期暂存，避免磁盘堆积
    try {
      await this.cleanupExpiredStaging();
    } catch {
      // 清理失败不阻塞新上传
    }
    if (!isPathSafe(key, this.baseDir)) {
      throw new Error("Unsafe path rejected");
    }
    const safeKey = sanitizeObjectKey(key);
    if (!safeKey) {
      throw new Error("Empty object key after sanitize");
    }
    assertPathSafe(this.baseDir, safeKey);

    const uploadId = crypto.randomUUID();
    const stage = this.stagingDir(uploadId);
    await mkdir(stage, { recursive: true });
    const meta: StagingMeta = {
      key: safeKey,
      contentType: options?.contentType,
      createdAt: Date.now(),
    };
    await writeFile(
      join(stage, "_meta.json"),
      new TextEncoder().encode(JSON.stringify(meta)),
    );
    return { uploadId, key: safeKey };
  }

  /** @inheritdoc */
  async uploadPart(
    key: string,
    uploadId: string,
    partNumber: number,
    data: Uint8Array,
    options?: { signal?: AbortSignal },
  ): Promise<UploadPartResult> {
    if (options?.signal?.aborted) {
      throw new DOMException("Upload aborted", "AbortError");
    }
    // S3 兼容：partNumber 1..10000
    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000) {
      throw new Error(`Invalid partNumber: ${partNumber}`);
    }
    const stage = this.stagingDir(uploadId);
    const metaRaw = await readFile(join(stage, "_meta.json"));
    const meta = JSON.parse(new TextDecoder().decode(metaRaw)) as StagingMeta;
    const safeKey = sanitizeObjectKey(key);
    if (meta.key !== safeKey) {
      throw new Error("upload part key mismatch");
    }
    const partPath = join(stage, `part-${partNumber}`);
    // 写盘一次、哈希同一缓冲；旁路 .etag 供 listParts／complete 复用，免双重 SHA。
    await writeFile(partPath, data);
    const etag = await sha256Hex(data);
    await writeFile(
      partEtagPath(stage, partNumber),
      new TextEncoder().encode(etag),
    );
    return { partNumber, etag };
  }

  /** @inheritdoc */
  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: PartInfo[],
  ): Promise<void> {
    const stage = this.stagingDir(uploadId);
    const metaRaw = await readFile(join(stage, "_meta.json"));
    const meta = JSON.parse(new TextDecoder().decode(metaRaw)) as StagingMeta;
    const safeKey = sanitizeObjectKey(key);
    if (meta.key !== safeKey) {
      throw new Error("complete key mismatch");
    }
    if (!parts.length) {
      throw new Error("complete requires at least one part");
    }

    const sorted = [...parts].sort((a, b) => a.partNumber - b.partNumber);
    // 完整性：分片号连续从 1..N（允许调用方只传已上传集合，但必须无空洞）
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i]!.partNumber !== i + 1) {
        throw new Error(
          `incomplete parts: expected part ${i + 1}, got ${
            sorted[i]!.partNumber
          }`,
        );
      }
    }
    const fp = this.fullPath(safeKey);
    const dir = dirname(fp);
    if (dir && dir !== ".") {
      await mkdir(dir, { recursive: true });
    }

    // 顺序 append：打开一次目标文件，逐片校验后写入再丢弃缓冲。
    // 意图：峰值内存≈最大单分片，避免「全部分片 + merged」双倍占用。
    // 不变量：etag 仍须与旁路／重算一致；分片号连续 1..N。
    const handle = await open(fp, {
      write: true,
      create: true,
      truncate: true,
    });
    try {
      const writer = handle.writable.getWriter();
      try {
        for (const p of sorted) {
          const partPath = join(stage, `part-${p.partNumber}`);
          const buf = await readFile(partPath);
          let etag: string | undefined;
          try {
            const side = await readFile(partEtagPath(stage, p.partNumber));
            etag = new TextDecoder().decode(side);
          } catch {
            etag = undefined;
          }
          if (etag !== p.etag) {
            etag = await sha256Hex(buf);
            if (etag !== p.etag) {
              throw new Error(
                `part ${p.partNumber} etag mismatch`,
              );
            }
          }
          await writer.write(buf);
        }
        await writer.close();
      } catch (err) {
        try {
          writer.releaseLock();
        } catch {
          // ignore
        }
        throw err;
      }
    } finally {
      try {
        handle.close();
      } catch {
        // ignore
      }
    }

    try {
      await remove(stage, { recursive: true });
    } catch {
      // 清理失败不阻塞完成
    }
  }

  /** @inheritdoc */
  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    const stage = this.stagingDir(uploadId);
    try {
      const metaRaw = await readFile(join(stage, "_meta.json"));
      const meta = JSON.parse(new TextDecoder().decode(metaRaw)) as StagingMeta;
      if (meta.key !== sanitizeObjectKey(key)) {
        return;
      }
    } catch {
      return;
    }
    try {
      await remove(stage, { recursive: true });
    } catch {
      // ignore
    }
  }

  /** @inheritdoc */
  async listParts(
    key: string,
    uploadId: string,
  ): Promise<ListPartsResult> {
    const stage = this.stagingDir(uploadId);
    let meta: StagingMeta;
    try {
      const metaRaw = await readFile(join(stage, "_meta.json"));
      meta = JSON.parse(new TextDecoder().decode(metaRaw)) as StagingMeta;
    } catch {
      return { parts: [], isTruncated: false };
    }
    if (meta.key !== sanitizeObjectKey(key)) {
      return { parts: [], isTruncated: false };
    }

    const parts: PartInfo[] = [];
    try {
      const entries = await readdir(stage);
      for (const e of entries) {
        const m = /^part-(\d+)$/.exec(e.name);
        if (!m || !e.isFile) continue;
        const partNumber = parseInt(m[1]!, 10);
        const partPath = join(stage, e.name);
        const info = await stat(partPath);
        let etag: string | undefined;
        try {
          etag = new TextDecoder().decode(
            await readFile(partEtagPath(stage, partNumber)),
          );
        } catch {
          // 旁路缺失：回退读盘哈希（兼容旧 staging）
          etag = await sha256Hex(await readFile(partPath));
        }
        parts.push({
          partNumber,
          etag,
          size: info.size,
        });
      }
    } catch {
      // ignore
    }
    parts.sort((a, b) => a.partNumber - b.partNumber);
    return { parts, isTruncated: false };
  }

  /**
   * 流式上传整对象（加法）。
   * 边界：不走分片；大文件仍建议 multipart。signal 可取消可读流。
   */
  async uploadStream(
    path: string,
    stream: ReadableStream<Uint8Array>,
    options?: CloudUploadOptions,
  ): Promise<void> {
    if (options?.signal?.aborted) {
      throw new DOMException("Upload aborted", "AbortError");
    }
    await this.ensureInit();
    const fp = this.fullPath(path);
    const dir = dirname(fp);
    if (dir && dir !== ".") {
      await mkdir(dir, { recursive: true });
    }
    const handle = await open(fp, {
      write: true,
      create: true,
      truncate: true,
    });
    try {
      // pipeTo 会关闭 writable；signal 取消时中止写入
      await stream.pipeTo(handle.writable, { signal: options?.signal });
    } catch (err) {
      try {
        handle.close();
      } catch {
        // ignore
      }
      throw err;
    }
  }

  /**
   * 流式下载整对象（加法）。Range 时仍先缓冲头／中段再包成单 chunk 流。
   */
  async downloadStream(
    path: string,
    options?: DownloadOptions,
  ): Promise<ReadableStream<Uint8Array>> {
    if (options?.signal?.aborted) {
      throw new DOMException("Download aborted", "AbortError");
    }
    if (
      options?.rangeStart !== undefined || options?.rangeEnd !== undefined
    ) {
      const buf = await this.download(path, options);
      return new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(buf);
          controller.close();
        },
      });
    }
    const fp = this.fullPath(path);
    // 全量读后包装为单/多 chunk 流：跨 Deno/Bun/Node 最稳；超大文件请用云适配器 downloadStream
    const data = await readFile(fp);
    return new ReadableStream<Uint8Array>({
      start(controller) {
        if (data.length) controller.enqueue(data);
        controller.close();
      },
    });
  }
}

/**
 * 创建本地磁盘 {@link CloudStorageAdapter}，供 {@link MultipartUploadHandler} 使用
 *
 * @param config - 根目录与下载 URL 前缀
 */
export function createLocalCloudStorageAdapter(
  config: LocalCloudStorageConfig,
): CloudStorageAdapter {
  return new LocalCloudStorageAdapter(config);
}
