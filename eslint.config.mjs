import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'
import nextTypeScript from 'eslint-config-next/typescript'
import prettier from 'eslint-config-prettier'

const config = [
    {
        ignores: ['.next/**', 'node_modules/**', 'public/sw.js', 'public/workbox-*.js', 'next-env.d.ts'],
    },
    ...nextCoreWebVitals,
    ...nextTypeScript,
    prettier,
    {
        rules: {
            'react/react-in-jsx-scope': 'off',
            'no-console': ['warn', { allow: ['error'] }],
            '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
        },
    },
]

export default config
