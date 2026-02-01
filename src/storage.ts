/**
 * @fileoverview 本地文件存储
 *
 * 提供本地文件系统存储实现
 */

import type { FileStorage } from "./types.ts";

/**
 * 本地文件存储实现（Deno）
 *
 * @example
 * ```typescript
 * const storage = new LocalStorage();
 *
 * // 保存文件
 * await storage.save("./uploads/file.txt", data);
 *
 * // 读取文件
 * const content = await storage.read("./uploads/file.txt");
 *
 * // 检查是否存在
 * const exists = await storage.exists("./uploads/file.txt");
 *
 * // 删除文件
 * await storage.delete("./uploads/file.txt");
 * ```
 */
export class LocalStorage implements FileStorage {
  /**
   * 保存文件
   *
   * @param path - 文件路径
   * @param content - 文件内容
   */
  async save(path: string, content: Uint8Array): Promise<void> {
    await Deno.writeFile(path, content);
  }

  /**
   * 读取文件
   *
   * @param path - 文件路径
   * @returns 文件内容
   */
  async read(path: string): Promise<Uint8Array> {
    return await Deno.readFile(path);
  }

  /**
   * 删除文件
   *
   * @param path - 文件路径
   */
  async delete(path: string): Promise<void> {
    await Deno.remove(path);
  }

  /**
   * 检查文件是否存在
   *
   * @param path - 文件路径
   * @returns 是否存在
   */
  async exists(path: string): Promise<boolean> {
    try {
      await Deno.stat(path);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 创建目录
   *
   * @param path - 目录路径
   */
  async mkdir(path: string): Promise<void> {
    await Deno.mkdir(path, { recursive: true });
  }
}

/**
 * 创建本地存储实例
 *
 * @returns LocalStorage 实例
 */
export function createLocalStorage(): LocalStorage {
  return new LocalStorage();
}
