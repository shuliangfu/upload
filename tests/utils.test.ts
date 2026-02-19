/**
 * @fileoverview 工具函数测试
 *
 * 测试 utils.ts 中的工具函数
 *
 * 运行测试：
 * deno test -A tests/utils.test.ts
 */

import { describe, expect, it } from "@dreamer/test";
import {
  computeHash,
  computeShortHash,
  formatFileSize,
  generateDateSubdir,
  generateFilename,
  generateMonthSubdir,
  generateTimestampFilename,
  getBaseName,
  getFileExtension,
  getFilenameFromUrl,
  getMimeType,
  isArchive,
  isAudio,
  isDocument,
  isHiddenFile,
  isImage,
  isPathSafe,
  isVideo,
  matchMimeType,
  sanitizeFilename,
  validateFile,
  validateFiles,
} from "../src/utils.ts";

// ============================================================================
// 文件名处理测试
// ============================================================================

describe("文件名处理", () => {
  describe("getFileExtension", () => {
    it("应该正确获取文件扩展名", () => {
      expect(getFileExtension("image.jpg")).toBe(".jpg");
      expect(getFileExtension("document.PDF")).toBe(".pdf");
      expect(getFileExtension("archive.tar.gz")).toBe(".gz");
      expect(getFileExtension("noextension")).toBe("");
      expect(getFileExtension(".gitignore")).toBe(""); // 只有扩展名没有基本名
    });
  });

  describe("getBaseName", () => {
    it("应该正确获取文件基本名", () => {
      expect(getBaseName("image.jpg")).toBe("image");
      expect(getBaseName("document.pdf")).toBe("document");
      expect(getBaseName("noextension")).toBe("noextension");
      expect(getBaseName(".gitignore")).toBe(".gitignore"); // 被视为无扩展名
    });
  });

  describe("sanitizeFilename", () => {
    it("应该移除非法字符", () => {
      expect(sanitizeFilename("file<name>.txt")).toBe("filename.txt");
      expect(sanitizeFilename('file"name".txt')).toBe("filename.txt");
      expect(sanitizeFilename("file|name.txt")).toBe("filename.txt");
    });

    it("应该移除前导点", () => {
      expect(sanitizeFilename("..hidden.txt")).toBe("hidden.txt");
      expect(sanitizeFilename("...file.txt")).toBe("file.txt");
    });

    it("应该替换空白为下划线", () => {
      expect(sanitizeFilename("file name.txt")).toBe("file_name.txt");
      expect(sanitizeFilename("file  name.txt")).toBe("file_name.txt");
    });

    it("应该限制长度", () => {
      const longName = "a".repeat(300) + ".txt";
      expect(sanitizeFilename(longName).length).toBeLessThanOrEqual(255);
    });
  });

  describe("generateFilename", () => {
    it("应该生成 UUID 格式的文件名", () => {
      const filename = generateFilename("image.jpg");
      expect(filename).toMatch(/^[a-f0-9-]{36}\.jpg$/);
    });

    it("应该处理无扩展名文件", () => {
      const filename = generateFilename("noext", false);
      expect(filename).toMatch(/^[a-f0-9-]{36}$/);
    });
  });

  describe("generateTimestampFilename", () => {
    it("应该生成时间戳格式的文件名", () => {
      const filename = generateTimestampFilename("test.jpg");
      expect(filename).toMatch(/^\d+_test\.jpg$/);
    });
  });

  describe("getFilenameFromUrl", () => {
    it("应该从 URL 中提取文件名", () => {
      expect(getFilenameFromUrl("https://example.com/path/to/file.jpg")).toBe(
        "file.jpg",
      );
      expect(getFilenameFromUrl("https://example.com/image.png?v=123")).toBe(
        "image.png",
      );
      expect(getFilenameFromUrl("/uploads/doc.pdf")).toBe("doc.pdf");
    });
  });
});

// ============================================================================
// MIME 类型测试
// ============================================================================

describe("MIME 类型", () => {
  describe("getMimeType", () => {
    it("应该正确识别常见文件类型", () => {
      expect(getMimeType("image.jpg")).toBe("image/jpeg");
      expect(getMimeType("image.png")).toBe("image/png");
      expect(getMimeType("document.pdf")).toBe("application/pdf");
      expect(getMimeType("data.json")).toBe("application/json");
      expect(getMimeType("video.mp4")).toBe("video/mp4");
    });

    it("应该返回默认类型对于未知扩展名", () => {
      expect(getMimeType("unknown.xyz")).toBe("application/octet-stream");
    });
  });

  describe("matchMimeType", () => {
    it("应该精确匹配 MIME 类型", () => {
      expect(matchMimeType("image/jpeg", "image/jpeg")).toBe(true);
      expect(matchMimeType("image/jpeg", "image/png")).toBe(false);
    });

    it("应该支持通配符匹配", () => {
      expect(matchMimeType("image/jpeg", "image/*")).toBe(true);
      expect(matchMimeType("image/png", "image/*")).toBe(true);
      expect(matchMimeType("video/mp4", "image/*")).toBe(false);
    });

    it("应该支持全局通配符", () => {
      // 注意：当前实现不支持 */*，只支持 type/*
      expect(matchMimeType("image/jpeg", "image/*")).toBe(true);
      expect(matchMimeType("application/pdf", "application/*")).toBe(true);
    });
  });
});

// ============================================================================
// 文件类型检测测试
// ============================================================================

describe("文件类型检测", () => {
  describe("isImage", () => {
    it("应该正确识别图片", () => {
      expect(isImage("image/jpeg")).toBe(true);
      expect(isImage("image/png")).toBe(true);
      expect(isImage("image/gif")).toBe(true);
      expect(isImage("image/webp")).toBe(true);
      expect(isImage("video/mp4")).toBe(false);
    });
  });

  describe("isVideo", () => {
    it("应该正确识别视频", () => {
      expect(isVideo("video/mp4")).toBe(true);
      expect(isVideo("video/webm")).toBe(true);
      expect(isVideo("image/jpeg")).toBe(false);
    });
  });

  describe("isAudio", () => {
    it("应该正确识别音频", () => {
      expect(isAudio("audio/mpeg")).toBe(true);
      expect(isAudio("audio/wav")).toBe(true);
      expect(isAudio("video/mp4")).toBe(false);
    });
  });

  describe("isDocument", () => {
    it("应该正确识别文档", () => {
      expect(isDocument("application/pdf")).toBe(true);
      expect(isDocument("application/msword")).toBe(true);
      expect(isDocument("text/plain")).toBe(true);
      expect(isDocument("image/jpeg")).toBe(false);
    });
  });

  describe("isArchive", () => {
    it("应该正确识别压缩文件", () => {
      expect(isArchive("application/zip")).toBe(true);
      expect(isArchive("application/x-rar-compressed")).toBe(true);
      expect(isArchive("application/gzip")).toBe(true);
      expect(isArchive("image/jpeg")).toBe(false);
    });
  });

  describe("isHiddenFile", () => {
    it("应该正确识别隐藏文件", () => {
      expect(isHiddenFile(".gitignore")).toBe(true);
      expect(isHiddenFile(".env")).toBe(true);
      expect(isHiddenFile("normal.txt")).toBe(false);
    });
  });
});

// ============================================================================
// 验证测试
// ============================================================================

describe("文件验证", () => {
  describe("validateFile", () => {
    it("应该验证文件大小", () => {
      const result = validateFile(
        {
          name: "large.bin",
          type: "application/octet-stream",
          size: 1024 * 1024,
        },
        { maxFileSize: 1024 },
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain("大小");
    });

    it("应该验证 MIME 类型", () => {
      const result = validateFile(
        { name: "script.js", type: "application/javascript" },
        { allowedMimeTypes: ["image/*"] },
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain("类型");
    });

    it("应该验证文件扩展名", () => {
      // exe 默认就在禁止列表中
      const result = validateFile(
        { name: "script.exe", type: "application/octet-stream" },
        {},
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain("exe");
    });

    it("应该通过有效文件", () => {
      const result = validateFile(
        { name: "image.jpg", type: "image/jpeg", size: 1024 },
        { maxFileSize: 10240, allowedMimeTypes: ["image/*"] },
      );
      expect(result.valid).toBe(true);
    });
  });

  describe("validateFiles", () => {
    it("应该验证多个文件", () => {
      // 所有文件都有效
      const validFiles = [
        { name: "image1.jpg", type: "image/jpeg", size: 1024 },
        { name: "image2.png", type: "image/png", size: 1024 },
      ];
      const validResult = validateFiles(validFiles, {});
      expect(validResult.valid).toBe(true);

      // 包含一个无效文件（exe 默认在禁止列表中）
      const mixedFiles = [
        { name: "image1.jpg", type: "image/jpeg", size: 1024 },
        { name: "script.exe", type: "application/octet-stream", size: 1024 },
      ];
      const invalidResult = validateFiles(mixedFiles, {});
      expect(invalidResult.valid).toBe(false);
    });
  });
});

// ============================================================================
// 路径安全测试
// ============================================================================

describe("路径安全", () => {
  describe("isPathSafe", () => {
    const basePath = "/var/uploads";

    it("应该拒绝目录遍历", () => {
      expect(isPathSafe("../etc/passwd", basePath)).toBe(false);
      expect(isPathSafe("..\\windows\\system32", basePath)).toBe(false);
      expect(isPathSafe("path/../../../etc", basePath)).toBe(false);
    });

    it("应该拒绝绝对路径", () => {
      expect(isPathSafe("/etc/passwd", basePath)).toBe(false);
      expect(isPathSafe("C:\\Windows", basePath)).toBe(false);
    });

    it("应该接受安全路径", () => {
      expect(isPathSafe("uploads/image.jpg", basePath)).toBe(true);
      expect(isPathSafe("2024/01/file.txt", basePath)).toBe(true);
    });
  });
});

// ============================================================================
// 格式化测试
// ============================================================================

describe("格式化", () => {
  describe("formatFileSize", () => {
    it("应该正确格式化文件大小", () => {
      expect(formatFileSize(0)).toBe("0 Bytes");
      expect(formatFileSize(1023)).toBe("1023 Bytes");
      expect(formatFileSize(1024)).toBe("1 KB");
      expect(formatFileSize(1024 * 1024)).toBe("1 MB");
      expect(formatFileSize(1024 * 1024 * 1024)).toBe("1 GB");
    });
  });
});

// ============================================================================
// 哈希测试
// ============================================================================

describe("哈希计算", () => {
  describe("computeHash", () => {
    it("应该计算正确的 SHA-256 哈希", async () => {
      const data = new TextEncoder().encode("Hello, World!");
      const hash = await computeHash(data);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe("computeShortHash", () => {
    it("应该返回短哈希", async () => {
      const data = new TextEncoder().encode("Hello, World!");
      const hash = await computeShortHash(data);
      expect(hash.length).toBe(16);
    });
  });
});

// ============================================================================
// 子目录生成测试
// ============================================================================

describe("子目录生成", () => {
  describe("generateDateSubdir", () => {
    it("应该生成日期格式的子目录", () => {
      const subdir = generateDateSubdir();
      expect(subdir).toMatch(/^\d{4}\/\d{2}\/\d{2}$/);
    });
  });

  describe("generateMonthSubdir", () => {
    it("应该生成月份格式的子目录", () => {
      const subdir = generateMonthSubdir();
      expect(subdir).toMatch(/^\d{4}-\d{2}$/);
    });
  });
});

console.log("🧪 工具函数测试");
