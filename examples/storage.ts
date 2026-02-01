/**
 * @fileoverview 存储适配器示例
 *
 * 展示本地存储的使用
 */

import {
  LocalStorage,
  createLocalStorage,
  generateDateSubdir,
  generateMonthSubdir,
  computeHash,
  computeShortHash,
} from "../src/mod.ts";

// ============================================================================
// 本地存储
// ============================================================================

console.log("=== 本地存储 ===\n");

// 创建本地存储
const storage = new LocalStorage();

// 确保目录存在
await storage.mkdir("./test-uploads/test");

// 保存文件
const content = new TextEncoder().encode("Hello, World!");
await storage.save("./test-uploads/test/hello.txt", content);
console.log("文件已保存到本地存储");

// 读取文件
const retrieved = await storage.read("./test-uploads/test/hello.txt");
console.log("读取内容:", new TextDecoder().decode(retrieved));

// 检查是否存在
console.log("文件存在:", await storage.exists("./test-uploads/test/hello.txt"));
console.log("不存在的文件:", await storage.exists("./test-uploads/test/notfound.txt"));

// 删除文件
await storage.delete("./test-uploads/test/hello.txt");
console.log("文件已删除");

// ============================================================================
// 使用工厂函数
// ============================================================================

console.log("\n=== 使用工厂函数 ===\n");

const defaultStorage = createLocalStorage();
console.log("使用默认配置创建存储:", defaultStorage);

// ============================================================================
// 按日期分目录
// ============================================================================

console.log("\n=== 按日期分目录 ===\n");

const dateSubdir = generateDateSubdir();
console.log("日期子目录:", dateSubdir); // 如: 2024/01/15

const monthSubdir = generateMonthSubdir();
console.log("月份子目录:", monthSubdir); // 如: 2024-01

console.log(`
// 使用日期子目录存储
const subdir = generateDateSubdir();
const path = \`./uploads/\${subdir}/\${filename}\`;
await storage.save(path, content);
// 结果: ./uploads/2024/01/15/abc123.jpg
`);

// ============================================================================
// 文件哈希
// ============================================================================

console.log("=== 文件哈希 ===\n");

const fileContent = new TextEncoder().encode("Hello, World!");

const hash = await computeHash(fileContent);
console.log("SHA-256 哈希:", hash);

const shortHash = await computeShortHash(fileContent);
console.log("短哈希 (16字符):", shortHash);

console.log(`
// 使用哈希作为文件名（去重）
const hash = await computeHash(content);
const ext = getFileExtension(originalName);
const path = \`./uploads/\${hash}\${ext}\`;

// 检查是否已存在（秒传）
if (await storage.exists(path)) {
  console.log("文件已存在，无需重复上传");
  return { path, deduplicated: true };
}

await storage.save(path, content);
`);

// ============================================================================
// 自定义存储适配器
// ============================================================================

console.log("=== 自定义存储适配器（示例代码）===\n");

console.log(`
import type { FileStorage } from "@dreamer/upload";

// 实现内存存储适配器
class MemoryStorage implements FileStorage {
  private files = new Map<string, Uint8Array>();

  async save(path: string, content: Uint8Array): Promise<void> {
    this.files.set(path, content);
  }

  async read(path: string): Promise<Uint8Array> {
    const content = this.files.get(path);
    if (!content) throw new Error("File not found");
    return content;
  }

  async delete(path: string): Promise<void> {
    this.files.delete(path);
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  async mkdir(_path: string): Promise<void> {
    // 内存存储不需要创建目录
  }
}

// 使用
const storage = new MemoryStorage();
const uploader = new Uploader({ uploadDir: "uploads", storage });
`);

// ============================================================================
// 存储配置示例
// ============================================================================

console.log("=== 存储配置示例 ===\n");

console.log(`
// 本地文件存储
const storage = new LocalStorage();

const uploader = new Uploader({
  uploadDir: "./uploads",
  storage,
  validation: {
    maxFileSize: 10 * 1024 * 1024,
    allowedMimeTypes: ["image/*"],
  },
  // 按日期分目录
  generateSubdir: generateDateSubdir,
});
`);

// 清理测试目录
try {
  await Deno.remove("./test-uploads", { recursive: true });
  console.log("\n测试目录已清理");
} catch {
  // 忽略删除错误
}
