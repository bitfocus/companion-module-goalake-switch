import { generateEslintConfig } from '@companion-module/tools/eslint/config.mjs'

const baseConfig = await generateEslintConfig({ enableTypescript: true })

export default [
	...baseConfig,
	{
		files: ['**/*.test.ts'],
		rules: { '@typescript-eslint/no-floating-promises': 'off' },
	},
]
