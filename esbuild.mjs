import * as esbuild from "esbuild";

const production = process.argv.includes("--production");

await esbuild.build({
  entryPoints: {"extension/extension": "src/extension.ts"},
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node18",
  external: ["vscode"],
  minify: production,
  sourcemap: !production,
  outdir: "dist"
});

await esbuild.build({
  entryPoints: {"webview/webview": "src/webview/main.ts"},
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  minify: production,
  sourcemap: !production,
  outdir: "dist"
});
