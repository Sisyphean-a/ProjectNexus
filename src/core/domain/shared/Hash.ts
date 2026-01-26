/**
 * 简单的字符串哈希函数 (DJB2 算法)
 * 用于在不引入复杂依赖的情况下生成内容校验和
 */
export function calculateChecksum(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) + hash + str.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
}
