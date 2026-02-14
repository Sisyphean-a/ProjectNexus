/// <reference types="vitest" />

import { dirname, relative } from "node:path";
import type { UserConfig } from "vite";
import { defineConfig } from "vite";
import Vue from "@vitejs/plugin-vue";
import Icons from "unplugin-icons/vite";
import IconsResolver from "unplugin-icons/resolver";
import Components from "unplugin-vue-components/vite";
import { NaiveUiResolver } from "unplugin-vue-components/resolvers";
import AutoImport from "unplugin-auto-import/vite";
import UnoCSS from "unocss/vite";
import { crx } from "@crxjs/vite-plugin";
import { resolve } from "path";
import { readFileSync } from "fs";
import packageJson from "./package.json";


const manifest = JSON.parse(readFileSync("./src/manifest.json", "utf-8"));

const port = Number(process.env.PORT) || 3333;
export const r = (...args: string[]) => resolve(__dirname, ...args);
export const isDev = process.env.NODE_ENV !== "production";

export const sharedConfig: UserConfig = {
  root: r("src"),
  resolve: {
    alias: {
      "~/": `${r("src")}/`,
      "@/": `${r("src")}/`,
    },
  },
  define: {
    __DEV__: isDev,
    __NAME__: JSON.stringify(packageJson.name),
  },
  plugins: [
    Vue(),

    AutoImport({
      imports: [
        "vue",
        {
          "webextension-polyfill": [["=", "browser"]],
        },
        "pinia",
      ],
      dts: r("src/auto-imports.d.ts"),
    }),

    // https://github.com/antfu/unplugin-vue-components
    Components({
      dirs: [r("src/components")],
      // generate `components.d.ts` for ts support with Volar
      dts: r("src/components.d.ts"),
      resolvers: [
        // auto import icons
        IconsResolver({
          prefix: "",
        }),
        NaiveUiResolver(),
      ],
    }),

    // https://github.com/antfu/unplugin-icons
    Icons(),

    // https://github.com/unocss/unocss
    UnoCSS(),



    // CRXJS Vite Plugin - Only load if NOT web mode
    process.env.TARGET !== "web" && crx({ manifest }),

    // rewrite assets to use relative path
    {
      name: "assets-rewrite",
      enforce: "post",
      apply: "build",
      transformIndexHtml(html, { path }) {
        return html.replace(
          /"\/assets\//g,
          `"${relative(dirname(path), "/assets")}/`,
        );
      },
    },
  ],
  optimizeDeps: {
    include: [
      "vue",
      "@vueuse/core",
      "webextension-polyfill",
      "naive-ui",
      "pinia",
      "octokit",
      "dexie",
    ],
    exclude: ["vue-demi"],
  },
};

export default defineConfig(({ command }) => ({
  ...sharedConfig,
  base: command === "serve" ? `http://localhost:${port}/` : "/",
  server: {
    port,
    strictPort: true,
    headers: {
      "Access-Control-Allow-Origin": "*",
    },
    cors: true,
    hmr: {
      host: "localhost",
    },
    origin: `http://localhost:${port}`,
  },
  build: {
    watch: isDev ? {} : undefined,
    outDir: r("dist"),
    emptyOutDir: true,
    sourcemap: isDev ? "inline" : false,
    // https://developer.chrome.com/docs/webstore/program_policies/#:~:text=Code%20Readability%20Requirements
    terserOptions: {
      mangle: false,
    },
    rollupOptions: {
      input: {
        index: r("src/index.html"),
      },
      output: {
        manualChunks(id) {
          const normalizedId = id.replace(/\\/g, "/");

          if (!normalizedId.includes("/node_modules/")) {
            return;
          }

          if (
            normalizedId.includes("/node_modules/naive-ui/") ||
            normalizedId.includes("/node_modules/vueuc/") ||
            normalizedId.includes("/node_modules/vooks/") ||
            normalizedId.includes("/node_modules/seemly/") ||
            normalizedId.includes("/node_modules/treemate/")
          ) {
            return "ui";
          }

          if (
            normalizedId.includes("/node_modules/vue/") ||
            normalizedId.includes("/node_modules/@vue/") ||
            normalizedId.includes("/node_modules/pinia/") ||
            normalizedId.includes("/node_modules/@vueuse/")
          ) {
            return "framework";
          }

          if (
            normalizedId.includes("/node_modules/octokit/") ||
            normalizedId.includes("/node_modules/@octokit/") ||
            normalizedId.includes("/node_modules/bottleneck/")
          ) {
            return "github";
          }

          if (normalizedId.includes("/node_modules/dexie/")) {
            return "storage";
          }
        },
      },
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: [r("src/test/setup.ts")],
    include: [
      "**/*.test.ts",
      "**/__tests__/**/*.test.ts",
      "../tests/integration/**/*.test.ts",
    ],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.{idea,git,cache,output,temp}/**",
      "**/.DS_Store",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: r("coverage"),
      include: ["**/*.{ts,vue}", "../tests/integration/**/*.ts"],
      exclude: [
        "**/*.d.ts",
        "**/*.test.ts",
        "**/__tests__/**",
        "**/main.ts",
        "**/background.ts",
        "**/env.ts",
        "**/manifest.json",
        "**/index.html",
        "**/public/**",
        "**/assets/**",
        "../tests/fixtures/**",
        "../tests/factories/**",
      ],
      thresholds: {
        lines: 25,
        functions: 55,
        branches: 55,
        statements: 25,
      },
    },
  },
}));
