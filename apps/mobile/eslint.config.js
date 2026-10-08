import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        ...globals.browser,
        ...globals.es2021,
        ...globals.node,
        React: 'readonly',
        __DEV__: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      // Unused catch bindings are idiomatic (`catch (error) { ...log... }` where
      // the binding is only logged, or intentionally ignored). typescript-eslint
      // upstream's recommended preset uses caughtErrors:'none'; match that so we
      // don't flag intentional error handling.
      // varsIgnorePattern covers the destructuring-to-omit idiom
      // (`const { password: _dropped, ...rest } = data`), which is how this
      // codebase strips a field without a `delete`.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'none',
        },
      ],
      // `any` is used deliberately at the native/optional-dependency bridges
      // (react-native-permissions, AdMob, RevenueCat, VLC, ffmpeg) whose
      // modules ship no usable types or are absent in Expo Go / tests, and for
      // the common `style?: any` React Native prop. Forcing `unknown` there
      // would mean inventing types for modules we do not control. This stays a
      // warning (never an error) so it informs refactors without blocking the
      // build; new `any` in first-party domain code should still be avoided.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      // The app logs subsystem state (alarms, detection, streaming, ads) on
      // purpose. console.warn/error are diagnostics, not leftovers.
      'no-console': 'off',
      // React Native optional native modules (RevenueCat, AdMob, cert pinning,
      // RTSP) must be loaded through a guarded `require()` so the JS bundle
      // still loads in Expo Go and in unit tests where the native side is
      // absent. A static import would throw at module-evaluation time.
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  // Overrides that disable the base ESLint rules which misfire on TypeScript
  // syntax (function overloads, ambient RN types, declare fields, enums).
  // Without this, valid overload declarations are reported as no-redeclare
  // and every runtime global as no-undef.
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: Object.fromEntries(
      Object.entries(
        tseslint.configs['eslint-recommended'].overrides[0].rules,
      ).map(([rule]) => [rule, 'off']),
    ),
  },
  {
    // Tests intentionally use require() in jest.mock factories, and lean on
    // loose types when stubbing partially-mocked native modules.
    files: ['**/__tests__/**/*', '**/*.test.ts', '**/*.test.tsx'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'no-empty': 'off',
    },
  },
  {
    ignores: [
      'node_modules/**',
      '.expo/**',
      'dist/**',
      'build/**',
      'android/**',
      'ios/**',
      'coverage/**',
    ],
  },
];
