import { generateEslintConfig } from '@companion-module/tools/eslint/config.mjs'

export default [
	{ ignores: ['dist/', 'dist-test/'] },
	...(await generateEslintConfig({
		enableTypescript: true,
	})),
	{
		// describe()/it() from node:test return promises that are not meant to be awaited
		files: ['**/*.test.ts'],
		rules: { '@typescript-eslint/no-floating-promises': 'off' },
	},
]
