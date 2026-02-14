import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import Logo from "../Logo.vue";

describe("Logo", () => {
  it("应渲染为指向 GitHub 的外链按钮", () => {
    const wrapper = mount(Logo);
    const link = wrapper.get("a");

    expect(link.attributes("href")).toBe("https://github.com/antfu/vitesse-webext");
    expect(link.attributes("target")).toBe("_blank");
    expect(link.attributes("rel")).toBe("noreferrer");
    expect(link.attributes("title")).toBe("GitHub");
  });
});
