import { describe, expect, it } from 'vitest';
import { IdGenerator } from '../IdGenerator';

describe('IdGenerator', () => {
  it('generates non-empty string ids', () => {
    const id = IdGenerator.generate();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('does not collide across a tight loop (same-tick batch)', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      ids.add(IdGenerator.generate());
    }
    expect(ids.size).toBe(10_000);
  });

  it('does not use the deprecated truncated 5-char suffix shape', () => {
    // 旧实现: Date.now().toString(36) (~8 chars) + 5 random => ~13 chars 且含可预测时间前缀
    // 新实现 (randomUUID) 为 36 字符；降级实现亦显著更长/更随机
    const id = IdGenerator.generate();
    expect(id.length).toBeGreaterThanOrEqual(16);
  });
});
