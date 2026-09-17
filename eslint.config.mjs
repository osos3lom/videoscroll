import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
    {
        ignores: ['dist/**', 'dist-local/**', '.sim/**', '.sim-e2e/**', 'test-results/**', 'playwright-report/**', 'dist-server/**', 'media/**', 'server/**', 'node_modules/**'],
    },
    js.configs.recommended,
    tseslint.configs.recommended,

    // Browser bundle.
    {
        files: ['src/**/*.{ts,tsx}'],
        languageOptions: {
            globals: globals.browser,
        },
        plugins: {
            'react-hooks': reactHooks,
            'react-refresh': reactRefresh,
        },
        rules: {
            ...reactHooks.configs.recommended.rules,
            'react-refresh/only-export-components': 'warn',
        },
    },

    // Node side: build config and scripts. The API server is Go (server/).
    {
        files: ['scripts/**/*.mjs', 'vite.config.mts', 'playwright.config.ts', 'e2e/**/*.ts'],
        languageOptions: {
            globals: globals.node,
        },
    },

    prettier,
    {
        rules: {
            // console.error is the app's logger on the server side.
            'no-console': ['warn', { allow: ['error'] }],
            '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
        },
    },

    // Maintenance CLIs print to stdout; that is their whole purpose.
    {
        files: ['scripts/**/*.mjs'],
        rules: {
            'no-console': 'off',
        },
    },
)
