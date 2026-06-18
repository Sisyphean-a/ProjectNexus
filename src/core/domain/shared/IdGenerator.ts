/**
 * 生成不透明的唯一标识符。
 *
 * 优先使用 crypto.randomUUID()（122 bit 随机，碰撞概率可忽略）。
 * 在缺少该 API 的旧环境降级到 crypto.getRandomValues 拼接，
 * 仍保证足够的随机位宽，避免同毫秒批量创建时的主键碰撞。
 */
export class IdGenerator {
  static generate(): string {
    const cryptoObj: Crypto | undefined =
      typeof globalThis !== 'undefined' ? (globalThis.crypto as Crypto | undefined) : undefined;

    if (cryptoObj?.randomUUID) {
      return cryptoObj.randomUUID();
    }

    if (cryptoObj?.getRandomValues) {
      const bytes = cryptoObj.getRandomValues(new Uint8Array(16));
      let hex = '';
      for (let i = 0; i < bytes.length; i++) {
        hex += bytes[i].toString(16).padStart(2, '0');
      }
      return hex;
    }

    // 最终降级：时间戳 + 多段随机，仍优于单段 5 字符
    return (
      Date.now().toString(36)
      + Math.random().toString(36).slice(2, 10)
      + Math.random().toString(36).slice(2, 10)
    );
  }
}
