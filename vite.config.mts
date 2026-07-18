import react from '@vitejs/plugin-react-swc';
import browserslistToEsbuild from 'browserslist-to-esbuild';
import {defineConfig} from 'vite';
import checker from 'vite-plugin-checker';
import {nodePolyfills} from 'vite-plugin-node-polyfills';
import {VitePWA} from 'vite-plugin-pwa';
import packageJson from './package.json';
import {notionSync} from './vite-plugin-notion-sync';

export default defineConfig({
	base: './',
	build: {
		outDir: 'dist/web',
		target: browserslistToEsbuild(['>0.2%', 'not dead', 'not op_mini all'])
	},
	define: {
		// Make app name and version available to code.
		// https://stackoverflow.com/a/74860417/7569568
		'process.env.VITE_APP_NAME': JSON.stringify(packageJson.name),
		'process.env.VITE_APP_VERSION': JSON.stringify(packageJson.version)
	},
	plugins: [
		checker({
			eslint: {lintCommand: 'eslint src'},
			overlay: {
				initialIsOpen: false
			},
			typescript: true
		}),
		nodePolyfills(
			// We only need a `global` injected, for CodeMirror.
			{include: [], globals: {global: true}}
		),
		react(),
		notionSync(),
		VitePWA({
			manifest: {
				icons: [
					{
						src: './icons/pwa.png',
						sizes: '1024x1024',
						type: 'image/png'
					},
					{
						src: './icons/pwa-maskable.png',
						purpose: 'maskable',
						sizes: '1024x1024',
						type: 'image/png'
					}
				]
			},
			registerType: 'autoUpdate',
			includeAssets: ['locales/**', 'pwa/**', 'story-formats/**'],
			workbox: {
				globPatterns: ['**/*.{js,css,html,svg,woff,woff2}'],
				// /api/* (OAuth 리다이렉트·서버리스)는 SW가 SPA 껍데기로 가로채지 않고
				// 네트워크(서버리스 함수)로 그대로 보낸다. 안 그러면 /api/notion/login이
				// index.html을 받아 흰 화면이 된다.
				navigateFallbackDenylist: [/^\/api\//]
			}
		})
	],
	server: {
		open: true
	}
});
