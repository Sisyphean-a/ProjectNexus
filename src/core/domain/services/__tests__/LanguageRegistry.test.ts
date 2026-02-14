import { describe, expect, it } from "vitest";
import { LanguageRegistry } from "../LanguageRegistry";

describe("LanguageRegistry", () => {
  it("getExtension 返回预定义扩展名", () => {
    expect(LanguageRegistry.getExtension("typescript")).toBe("ts");
    expect(LanguageRegistry.getExtension("markdown")).toBe("md");
  });

  it("getExtension 对未知语言回退为 txt", () => {
    expect(LanguageRegistry.getExtension("unknown-lang")).toBe("txt");
  });

  it("getLanguage 支持扩展名反查", () => {
    expect(LanguageRegistry.getLanguage("yaml")).toBe("yaml");
    expect(LanguageRegistry.getLanguage("ts")).toBe("typescript");
  });

  it("getLanguage 对未知扩展回退为 plaintext", () => {
    expect(LanguageRegistry.getLanguage("abc")).toBe("plaintext");
  });
});
