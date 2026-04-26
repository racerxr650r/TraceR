// Bundles the extension into dist/extension.js plus the Phase 3 form
// webview into dist/formPanel.js. Run with `npm run build` (one-shot)
// or `npm run watch` (incremental).

const esbuild = require('esbuild');

const watch = process.argv.includes('--watch');

const extensionBuild = {
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.js',
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  sourcemap: true,
  external: ['vscode'],
  logLevel: 'info',
};

// Phase 3 form webview bundle: React + react-jsonschema-form running
// inside a VS Code Webview. Browser-target IIFE so the script tag in
// FormPanelProvider's HTML can load it directly.
const webviewBuild = {
  entryPoints: ['src/forms/webview/formMain.tsx'],
  outfile: 'dist/formPanel.js',
  bundle: true,
  platform: 'browser',
  target: 'es2020',
  format: 'iife',
  jsx: 'automatic',
  sourcemap: true,
  loader: { '.css': 'text' },
  logLevel: 'info',
  define: {
    'process.env.NODE_ENV': '"production"',
  },
};

(async () => {
  if (watch) {
    const ctxA = await esbuild.context(extensionBuild);
    const ctxB = await esbuild.context(webviewBuild);
    await Promise.all([ctxA.watch(), ctxB.watch()]);
    console.log('[vscode-project-xml] watching extension + webview...');
  } else {
    await Promise.all([
      esbuild.build(extensionBuild),
      esbuild.build(webviewBuild),
    ]);
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
