import antfu from '@antfu/eslint-config'

const PRESENTATION_LAYER = [
  'src/components/**/*.{ts,vue}',
  'src/presentation/**/*.{ts,vue}',
  'src/stores/**/*.{ts,vue}',
]

const PRESENTATION_RESTRICTIONS = [
  {
    group: ['../../infrastructure', '../infrastructure', '**/src/infrastructure/**'],
    message: '表现层不能直接依赖 infrastructure，请通过 facade / store / composable 访问。',
  },
]

export default antfu(
  {
    vue: true,
    typescript: true,
    stylistic: false,
    formatters: false,
  },
  {
    ignores: [
      '.agent/**',
      'coverage/**',
      'dist/**',
      'scripts/**',
      'tests/**',
      'src/**/__tests__/**',
      'src/test/**',
      'src/auto-imports.d.ts',
      'src/components.d.ts',
    ],
  },
  {
    files: ['src/**/*.{ts,vue}'],
    rules: {
      'complexity': 'off',
      'import/no-duplicates': 'off',
      'import/order': 'off',
      'jsonc/sort-keys': 'off',
      'max-depth': 'off',
      'max-lines': 'off',
      'max-params': 'off',
      'no-console': 'off',
      'no-magic-numbers': 'off',
      'node/prefer-global/process': 'off',
      'object-shorthand': 'off',
      'regexp/prefer-w': 'off',
      'regexp/use-ignore-case': 'off',
      'sort-imports': 'off',
      'test/prefer-lowercase-title': 'off',
      'ts/consistent-type-definitions': 'off',
      'ts/consistent-type-imports': 'off',
      'ts/method-signature-style': 'off',
      'unicorn/no-new-array': 'off',
      'unicorn/prefer-number-properties': 'off',
      'vue/attributes-order': 'off',
      'vue/custom-event-name-casing': 'off',
      'vue/define-macros-order': 'off',
      'vue/html-self-closing': 'off',
      'vue/no-mutating-props': 'off',
      'vue/prefer-separate-static-class': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/v-on-event-hyphenation': 'off',
    },
  },
  {
    files: PRESENTATION_LAYER,
    rules: {
      'no-restricted-imports': ['error', { patterns: PRESENTATION_RESTRICTIONS }],
    },
  },
)
