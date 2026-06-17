import { describe, expect, it, vi } from "vitest";
import { defineComponent } from "vue";
import { mount } from "@vue/test-utils";
import CodeMirrorEditor from "../CodeMirrorEditor.vue";

vi.mock("vue-codemirror", () => ({
  Codemirror: defineComponent({
    name: "CodemirrorStub",
    props: {
      modelValue: {
        type: String,
        default: "",
      },
    },
    emits: ["update:modelValue", "change"],
    template: `
      <textarea
        data-test="codemirror"
        :value="modelValue"
        @input="$emit('update:modelValue', $event.target.value)"
        @change="$emit('change', $event.target.value)"
      />
    `,
  }),
}));

describe("CodeMirrorEditor", () => {
  it("应将外部内容透传给编辑器并转发更新事件", async () => {
    const wrapper = mount(CodeMirrorEditor, {
      props: {
        modelValue: "hello world",
        language: "yaml",
      },
    });

    const textarea = wrapper.get('[data-test="codemirror"]');
    expect((textarea.element as HTMLTextAreaElement).value).toBe("hello world");

    await textarea.setValue("next content");
    const updates = wrapper.emitted("update:modelValue") || [];
    expect(updates.at(-1)).toEqual(["next content"]);
  });
});
