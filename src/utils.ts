/**
 * @fileoverview 辅助函数
 *
 * 文件名处理、验证、哈希计算等工具函数
 */

import { DEFAULT_FORBIDDEN_EXTENSIONS, MIME_TYPES } from "./constants.ts";
import type {
  FileValidationInput,
  FileValidationOptions,
  FileValidationResult,
} from "./types.ts";

// ============================================================================
// 文件名处理
// ============================================================================

/**
 * 获取文件扩展名
 *
 * @param filename - 文件名
 * @returns 扩展名（包含点号，小写）
 */
export function getFileExtension(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot > 0) {
    return filename.slice(lastDot).toLowerCase();
  }
  return "";
}

/**
 * 获取文件基本名（不含扩展名）
 *
 * @param filename - 文件名
 * @returns 基本名
 */
export function getBaseName(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot > 0) {
    return filename.slice(0, lastDot);
  }
  return filename;
}

/**
 * 获取 MIME 类型
 *
 * @param filename - 文件名或扩展名
 * @returns MIME 类型
 */
export function getMimeType(filename: string): string {
  const ext = filename.startsWith(".")
    ? filename.toLowerCase()
    : getFileExtension(filename);
  return MIME_TYPES[ext] || "application/octet-stream";
}

/**
 * 检查 MIME 类型是否匹配模式
 *
 * @param mimeType - MIME 类型
 * @param pattern - 匹配模式（支持通配符，如 "image/*"）
 * @returns 是否匹配
 */
export function matchMimeType(mimeType: string, pattern: string): boolean {
  if (pattern.endsWith("/*")) {
    const prefix = pattern.slice(0, -1);
    return mimeType.startsWith(prefix);
  }
  return mimeType === pattern;
}

/**
 * 生成唯一文件名
 *
 * @param originalName - 原始文件名
 * @param preserveExtension - 是否保留扩展名（默认 true）
 * @returns 唯一文件名
 */
export function generateFilename(
  originalName: string,
  preserveExtension = true,
): string {
  const uuid = crypto.randomUUID();
  if (preserveExtension) {
    const ext = getFileExtension(originalName);
    return uuid + ext;
  }
  return uuid;
}

/**
 * 生成带时间戳的文件名
 *
 * @param originalName - 原始文件名
 * @param preserveExtension - 是否保留扩展名（默认 true）
 * @returns 时间戳文件名
 */
export function generateTimestampFilename(
  originalName: string,
  preserveExtension = true,
): string {
  const timestamp = Date.now();
  if (preserveExtension) {
    return `${timestamp}_${originalName}`;
  }
  return `${timestamp}_${getBaseName(originalName)}`;
}

/**
 * 清理文件名（移除不安全字符）
 *
 * @param filename - 原始文件名
 * @returns 清理后的文件名
 */
export function sanitizeFilename(filename: string): string {
  return filename
    // deno-lint-ignore no-control-regex
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
    .replace(/^\.+/, "")
    .replace(/\s+/g, "_")
    .slice(0, 255);
}

// ============================================================================
// 文件验证
// ============================================================================

/**
 * 验证文件是否允许上传
 *
 * @param file - 文件信息
 * @param options - 验证选项
 * @returns 验证结果
 */
export function validateFile(
  file: FileValidationInput,
  options: FileValidationOptions = {},
): FileValidationResult {
  const { name: filename, type: mimeType, size: fileSize } = file;

  // 检查文件大小
  if (fileSize !== undefined && options.maxFileSize !== undefined) {
    if (fileSize > options.maxFileSize) {
      const maxSizeMB = (options.maxFileSize / (1024 * 1024)).toFixed(2);
      return {
        valid: false,
        error: `文件大小超过限制，最大允许 ${maxSizeMB} MB`,
      };
    }
  }

  const ext = getFileExtension(filename);

  // 检查禁止的扩展名
  const forbiddenExts = options.forbiddenExtensions ||
    DEFAULT_FORBIDDEN_EXTENSIONS;
  if (forbiddenExts.includes(ext)) {
    return { valid: false, error: `禁止上传 ${ext} 类型的文件` };
  }

  // 检查允许的扩展名
  if (options.allowedExtensions && options.allowedExtensions.length > 0) {
    if (!options.allowedExtensions.includes(ext)) {
      return {
        valid: false,
        error: `只允许上传 ${options.allowedExtensions.join(", ")} 类型的文件`,
      };
    }
  }

  // 检查禁止的 MIME 类型
  if (options.forbiddenMimeTypes && options.forbiddenMimeTypes.length > 0) {
    for (const forbidden of options.forbiddenMimeTypes) {
      if (matchMimeType(mimeType, forbidden)) {
        return { valid: false, error: `禁止上传 ${mimeType} 类型的文件` };
      }
    }
  }

  // 检查允许的 MIME 类型
  if (options.allowedMimeTypes && options.allowedMimeTypes.length > 0) {
    let allowed = false;
    for (const allowedType of options.allowedMimeTypes) {
      if (matchMimeType(mimeType, allowedType)) {
        allowed = true;
        break;
      }
    }
    if (!allowed) {
      return {
        valid: false,
        error: `只允许上传 ${options.allowedMimeTypes.join(", ")} 类型的文件`,
      };
    }
  }

  return { valid: true };
}

/**
 * 批量验证文件
 *
 * @param files - 文件列表
 * @param options - 验证选项
 * @param maxTotalSize - 总大小限制（可选）
 * @returns 验证结果
 */
export function validateFiles(
  files: FileValidationInput[],
  options: FileValidationOptions = {},
  maxTotalSize?: number,
): FileValidationResult {
  let totalSize = 0;

  for (const file of files) {
    const result = validateFile(file, options);
    if (!result.valid) {
      return result;
    }
    if (file.size !== undefined) {
      totalSize += file.size;
    }
  }

  if (maxTotalSize !== undefined && totalSize > maxTotalSize) {
    const maxSizeMB = (maxTotalSize / (1024 * 1024)).toFixed(2);
    return {
      valid: false,
      error: `总文件大小超过限制，最大允许 ${maxSizeMB} MB`,
    };
  }

  return { valid: true };
}

// ============================================================================
// 文件类型检测（Magic Bytes）
// ============================================================================

/**
 * 常见文件类型的 Magic Bytes 签名
 */
const MAGIC_BYTES: Array<{
  mimeType: string;
  extensions: string[];
  signature: number[];
  offset?: number;
}> = [
  // 图片
  {
    mimeType: "image/jpeg",
    extensions: [".jpg", ".jpeg"],
    signature: [0xFF, 0xD8, 0xFF],
  },
  {
    mimeType: "image/png",
    extensions: [".png"],
    signature: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A],
  },
  {
    mimeType: "image/gif",
    extensions: [".gif"],
    signature: [0x47, 0x49, 0x46, 0x38],
  },
  {
    mimeType: "image/webp",
    extensions: [".webp"],
    signature: [0x52, 0x49, 0x46, 0x46],
  }, // RIFF
  { mimeType: "image/bmp", extensions: [".bmp"], signature: [0x42, 0x4D] },
  {
    mimeType: "image/tiff",
    extensions: [".tiff", ".tif"],
    signature: [0x49, 0x49, 0x2A, 0x00],
  },
  {
    mimeType: "image/svg+xml",
    extensions: [".svg"],
    signature: [0x3C, 0x3F, 0x78, 0x6D, 0x6C],
  }, // <?xml
  {
    mimeType: "image/x-icon",
    extensions: [".ico"],
    signature: [0x00, 0x00, 0x01, 0x00],
  },
  // 压缩文件
  {
    mimeType: "application/zip",
    extensions: [".zip"],
    signature: [0x50, 0x4B, 0x03, 0x04],
  },
  {
    mimeType: "application/gzip",
    extensions: [".gz"],
    signature: [0x1F, 0x8B],
  },
  {
    mimeType: "application/x-rar-compressed",
    extensions: [".rar"],
    signature: [0x52, 0x61, 0x72, 0x21],
  },
  {
    mimeType: "application/x-7z-compressed",
    extensions: [".7z"],
    signature: [0x37, 0x7A, 0xBC, 0xAF],
  },
  {
    mimeType: "application/x-tar",
    extensions: [".tar"],
    signature: [0x75, 0x73, 0x74, 0x61, 0x72],
    offset: 257,
  },
  // 文档
  {
    mimeType: "application/pdf",
    extensions: [".pdf"],
    signature: [0x25, 0x50, 0x44, 0x46],
  }, // %PDF
  // 可执行文件（危险）
  {
    mimeType: "application/x-executable",
    extensions: [".exe"],
    signature: [0x4D, 0x5A],
  }, // MZ
  {
    mimeType: "application/x-mach-binary",
    extensions: [".macho"],
    signature: [0xCF, 0xFA, 0xED, 0xFE],
  },
  // 视频
  {
    mimeType: "video/mp4",
    extensions: [".mp4"],
    signature: [0x00, 0x00, 0x00],
    offset: 4,
  }, // ftyp at offset 4
  {
    mimeType: "video/webm",
    extensions: [".webm"],
    signature: [0x1A, 0x45, 0xDF, 0xA3],
  },
  // 音频
  { mimeType: "audio/mpeg", extensions: [".mp3"], signature: [0xFF, 0xFB] },
  {
    mimeType: "audio/wav",
    extensions: [".wav"],
    signature: [0x52, 0x49, 0x46, 0x46],
  }, // RIFF
  {
    mimeType: "audio/ogg",
    extensions: [".ogg"],
    signature: [0x4F, 0x67, 0x67, 0x53],
  },
];

/**
 * 通过 Magic Bytes 检测文件真实类型
 *
 * @param content - 文件内容（至少前 300 字节）
 * @returns 检测到的 MIME 类型，未知返回 null
 *
 * @example
 * ```typescript
 * const buffer = await file.arrayBuffer();
 * const realType = detectMimeType(new Uint8Array(buffer));
 * if (realType !== file.type) {
 *   console.warn("文件类型与扩展名不匹配！");
 * }
 * ```
 */
export function detectMimeType(content: Uint8Array): string | null {
  for (const entry of MAGIC_BYTES) {
    const offset = entry.offset ?? 0;
    if (content.length < offset + entry.signature.length) continue;

    let match = true;
    for (let i = 0; i < entry.signature.length; i++) {
      if (content[offset + i] !== entry.signature[i]) {
        match = false;
        break;
      }
    }
    if (match) {
      return entry.mimeType;
    }
  }
  return null;
}

/**
 * 验证文件内容是否与声明的 MIME 类型匹配
 *
 * @param content - 文件内容
 * @param declaredMimeType - 声明的 MIME 类型
 * @returns 是否匹配
 */
export function validateMimeType(
  content: Uint8Array,
  declaredMimeType: string,
): { valid: boolean; detected?: string; error?: string } {
  const detected = detectMimeType(content);

  // 如果无法检测，允许通过（可能是文本文件或未知格式）
  if (detected === null) {
    return { valid: true };
  }

  // 检查是否是危险类型
  if (
    detected === "application/x-executable" ||
    detected === "application/x-mach-binary"
  ) {
    return {
      valid: false,
      detected,
      error: "检测到可执行文件，禁止上传",
    };
  }

  // 检查类型前缀是否匹配（如 image/jpeg vs image/png 都是图片）
  const declaredPrefix = declaredMimeType.split("/")[0];
  const detectedPrefix = detected.split("/")[0];

  if (declaredPrefix !== detectedPrefix) {
    return {
      valid: false,
      detected,
      error: `文件类型不匹配：声明 ${declaredMimeType}，实际检测 ${detected}`,
    };
  }

  return { valid: true, detected };
}

// ============================================================================
// 文件大小格式化
// ============================================================================

/**
 * 格式化文件大小
 *
 * @param bytes - 字节数
 * @param decimals - 小数位数（默认 2）
 * @returns 格式化后的大小字符串
 */
export function formatFileSize(bytes: number, decimals = 2): string {
  if (bytes === 0) return "0 Bytes";

  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + " " +
    sizes[i];
}

/**
 * 检查是否是图片文件
 */
export function isImage(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}

/**
 * 检查是否是视频文件
 */
export function isVideo(mimeType: string): boolean {
  return mimeType.startsWith("video/");
}

/**
 * 检查是否是音频文件
 */
export function isAudio(mimeType: string): boolean {
  return mimeType.startsWith("audio/");
}

/**
 * 检查是否是文档文件
 */
export function isDocument(mimeType: string): boolean {
  const docTypes = [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument",
    "application/vnd.ms-excel",
    "application/vnd.ms-powerpoint",
    "text/plain",
    "text/csv",
    "text/markdown",
  ];
  return docTypes.some((type) => mimeType.startsWith(type));
}

/**
 * 检查是否是压缩文件
 */
export function isArchive(mimeType: string): boolean {
  const archiveTypes = [
    "application/zip",
    "application/x-rar-compressed",
    "application/vnd.rar",
    "application/x-7z-compressed",
    "application/x-tar",
    "application/gzip",
  ];
  return archiveTypes.includes(mimeType);
}

/**
 * 检查是否是隐藏文件
 */
export function isHiddenFile(filename: string): boolean {
  return filename.startsWith(".");
}

/**
 * 安全检查文件路径（防止目录遍历攻击）
 *
 * @param path - 要检查的路径
 * @param basePath - 基础目录
 * @returns 路径是否安全
 */
export function isPathSafe(path: string, basePath: string): boolean {
  // 1. 检查空路径
  if (!path || path.trim() === "") return false;

  // 2. 检查显式的目录遍历
  if (path.includes("..")) return false;

  // 3. 检查绝对路径
  if (path.startsWith("/") || path.match(/^[A-Za-z]:/)) return false;

  // 4. 检查空字节和反斜杠
  if (path.includes("\0") || path.includes("\\")) return false;

  // 5. 检查 URL 编码的遍历尝试
  const decoded = decodeURIComponent(path);
  if (
    decoded.includes("..") || decoded !== path.replace(/%[0-9A-Fa-f]{2}/g, "X")
  ) {
    // 如果解码后包含 .. 或解码后与原始不同（可能是编码攻击）
    if (decoded.includes("..")) return false;
  }

  // 6. 检查隐藏文件（可选，根据需求）
  // if (path.split("/").some(segment => segment.startsWith("."))) return false;

  // 7. 规范化路径并验证
  const normalizedPath = path.replace(/\/+/g, "/").replace(/^\.\//, "");
  const normalizedBase = basePath.replace(/\/+$/, "");
  const fullPath = `${normalizedBase}/${normalizedPath}`;

  // 8. 确保最终路径仍在基础目录内
  if (!fullPath.startsWith(normalizedBase + "/")) return false;

  return true;
}

// ============================================================================
// 文件哈希
// ============================================================================

/**
 * 计算文件内容的 SHA-256 哈希
 *
 * @param content - 文件内容
 * @returns 哈希值（十六进制字符串）
 */
export async function computeHash(content: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", content.slice());
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * 计算文件的短哈希（用于 ETag 等）
 *
 * @param content - 文件内容
 * @returns 短哈希值
 */
export async function computeShortHash(content: Uint8Array): Promise<string> {
  const hash = await computeHash(content);
  return hash.slice(0, 16);
}

// ============================================================================
// 便捷函数
// ============================================================================

/**
 * 生成按日期分类的子目录
 *
 * @returns 日期格式的目录名（YYYY/MM/DD）
 */
export function generateDateSubdir(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}/${month}/${day}`;
}

/**
 * 生成按月份分类的子目录
 *
 * @returns 月份格式的目录名（YYYY-MM）
 */
export function generateMonthSubdir(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

/**
 * 从 URL 获取文件名
 */
export function getFilenameFromUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const segments = pathname.split("/");
    return segments[segments.length - 1] || "";
  } catch {
    const segments = url.split("/");
    return segments[segments.length - 1] || "";
  }
}

/**
 * 创建文件下载响应
 *
 * @param content - 文件内容
 * @param filename - 文件名
 * @param options - 响应选项
 * @returns Response 对象
 */
export function createFileResponse(
  content: Uint8Array,
  filename: string,
  options: {
    download?: boolean;
    mimeType?: string;
    maxAge?: number;
  } = {},
): Response {
  const mimeType = options.mimeType || getMimeType(filename);
  const disposition = options.download
    ? `attachment; filename="${encodeURIComponent(filename)}"`
    : `inline; filename="${encodeURIComponent(filename)}"`;

  const headers: Record<string, string> = {
    "Content-Type": mimeType,
    "Content-Disposition": disposition,
    "Content-Length": String(content.length),
  };

  if (options.maxAge !== undefined) {
    headers["Cache-Control"] = `public, max-age=${options.maxAge}`;
  }

  // 使用 slice() 确保类型兼容
  return new Response(new Blob([content.slice()]), { headers });
}
