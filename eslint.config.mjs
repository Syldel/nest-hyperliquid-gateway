// @ts-check
import eslint from '@eslint/js';
import prettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default [
  {
    ignores: ['dist', 'node_modules', 'eslint.config.mjs', '.idea', 'scripts/**/*.mjs'],
  },

  // Recommandations de base ESLint
  eslint.configs.recommended,

  // Recommandations strictes TypeScript avec type-check
  ...tseslint.configs.recommendedTypeChecked,

  // Intégration propre de Prettier
  prettierRecommended,

  {
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'module'
    },
  },

  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',

      // `endOfLine` vient de `.prettierrc` (lf) : une surcharge `auto` ici
      // laissait passer un CRLF que la config disait refuser.
      'prettier/prettier': 'error',
    },
  },
];
