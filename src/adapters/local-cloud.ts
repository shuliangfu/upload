/**
 * @fileoverview 本地磁盘版 {@link CloudStorageAdapter}
 *
 * 用于在无 S3/OSS/COS 时仍可使用 {@link MultipartUploadHandler}（分片 init / chunk / complete）。
 * 分片暂存于 `baseDir/.staging/<uploadId>/`，合并后写入 `baseDir/<key>`。
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
  readdir,
  readFile,
  remove,
  stat,
  writeFile,
} from "@dreamer/runtime-adapter";
import { dirname, join } from "@dreamer/runtime-adapter";

/** {@link createLocalCloudStorageAdapter} 的配置 */
export interface LocalCloudStorageConfig {
  /** 对象键对应的根目录（最终文件路径为 `join(baseDir, key)`） */
  baseDir: string;
  /**
   * 供 {@link getPresignedUrl} 生成的公开下载路径前缀（不含 query），
   * 例如 `/api/upload/file`，完整 URL 为 `${publicFileBasePath}?key=<encodeURIComponent(key)>`
   */
  publicFileBasePath?: string;
}

/** 暂存目录内 `_meta.json` 内容 */
interface StagingMeta {
  key: string;
  contentType?: string;
}

/**
 * 计算二进制内容的十六进制 SHA-256，用作分片 ETag（与常见对象存储形态一致，便于校验）
 */
async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data.slice());
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * 本地磁盘 + 分片合并实现的云适配器（满足 {@link CloudStorageAdapter}）
 */
export class LocalCloudStorageAdapter implements CloudStorageAdapter {
  private readonly baseDir: string;
  private readonly publicFileBasePath: string;
  private initialized = false;

  /**
   * @param config - 根目录与对外 URL 前缀
   */
  constructor(config: LocalCloudStorageConfig) {
    this.baseDir = config.baseDir;
    this.publicFileBasePath = config.publicFileBasePath ?? "/uploads/file";
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
   * 对象键对应的绝对路径
   */
  private fullPath(key: string): string {
    return join(this.baseDir, key);
  }

  /**
   * 分片会话目录
   */
  private stagingDir(uploadId: string): string {
    return join(this.baseDir, ".staging", uploadId);
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
    await writeFile(fp, content.slice());
  }

  /** @inheritdoc */
  async download(
    path: string,
    _options?: DownloadOptions,
  ): Promise<Uint8Array> {
    return await this.read(path);
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
    const uploadId = crypto.randomUUID();
    const stage = this.stagingDir(uploadId);
    await mkdir(stage, { recursive: true });
    const meta: StagingMeta = {
      key,
      contentType: options?.contentType,
    };
    await writeFile(
      join(stage, "_meta.json"),
      new TextEncoder().encode(JSON.stringify(meta)),
    );
    return { uploadId, key };
  }

  /** @inheritdoc */
  async uploadPart(
    key: string,
    uploadId: string,
    partNumber: number,
    data: Uint8Array,
  ): Promise<UploadPartResult> {
    const stage = this.stagingDir(uploadId);
    const metaRaw = await readFile(join(stage, "_meta.json"));
    const meta = JSON.parse(new TextDecoder().decode(metaRaw)) as StagingMeta;
    if (meta.key !== key) {
      throw new Error("upload part key mismatch");
    }
    const slice = data.slice();
    const partPath = join(stage, `part-${partNumber}`);
    await writeFile(partPath, slice);
    const etag = await sha256Hex(slice);
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
    if (meta.key !== key) {
      throw new Error("complete key mismatch");
    }

    const sorted = [...parts].sort((a, b) => a.partNumber - b.partNumber);
    let total = 0;
    const buffers: Uint8Array[] = [];
    for (const p of sorted) {
      const partPath = join(stage, `part-${p.partNumber}`);
      const buf = await readFile(partPath);
      const etag = await sha256Hex(buf);
      if (etag !== p.etag) {
        throw new Error(
          `part ${p.partNumber} etag mismatch`,
        );
      }
      buffers.push(buf);
      total += buf.length;
    }

    const merged = new Uint8Array(total);
    let offset = 0;
    for (const b of buffers) {
      merged.set(b, offset);
      offset += b.length;
    }

    const fp = this.fullPath(key);
    const dir = dirname(fp);
    if (dir && dir !== ".") {
      await mkdir(dir, { recursive: true });
    }
    await writeFile(fp, merged);

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
      if (meta.key !== key) {
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
    if (meta.key !== key) {
      return { parts: [], isTruncated: false };
    }

    const parts: PartInfo[] = [];
    try {
      const entries = await readdir(stage);
      for (const e of entries) {
        const m = /^part-(\d+)$/.exec(e.name);
        if (!m || !e.isFile) continue;
        const partNumber = parseInt(m[1]!, 10);
        const buf = await readFile(join(stage, e.name));
        const etag = await sha256Hex(buf);
        parts.push({
          partNumber,
          etag,
          size: buf.length,
        });
      }
    } catch {
      // ignore
    }
    parts.sort((a, b) => a.partNumber - b.partNumber);
    return { parts, isTruncated: false };
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
