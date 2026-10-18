import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import react from '@eslint-react/eslint-plugin';
import hooks from 'eslint-plugin-react-hooks';

export default [
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.nasti/**',
      '**/.agents/**',
      '**/.cache/**',
      'test-results/**',
      '**/routeTree.gen.ts',
      '**/schema.d.ts',
    ],
  },
  {
    ...js.configs.recommended,
    files: ['**/*.{mjs,ts,tsx}'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      'no-undef': 'off', // TypeScript checks identifier resolution.
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@wuling/*/src/**', '**/packages/*/**', '**/apps/*/src/**'],
              message: 'Use workspace package exports, not another package’s internals.',
            },
          ],
        },
      ],
    },
  },
  { ...react.configs.recommended, files: ['apps/**/*.tsx'] },
  {
    files: ['apps/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': hooks },
    rules: {
      ...hooks.configs.flat.recommended.rules,
      'react-hooks/exhaustive-deps': 'error',
      'react-hooks/set-state-in-effect': 'error',
      'react-hooks/set-state-in-render': 'error',
      'react-hooks/static-components': 'error',
    },
  },
  {
    files: ['apps/**/*.tsx'],
    rules: {
      '@eslint-react/no-array-index-key': 'error',
      '@eslint-react/no-nested-component-definitions': 'error',
      '@eslint-react/no-unstable-default-props': 'error',
      '@eslint-react/no-direct-mutation-state': 'error',
    },
  },
];
