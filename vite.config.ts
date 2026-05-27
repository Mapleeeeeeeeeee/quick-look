import { defineConfig } from "vite";
import monacoEditorPlugin from "vite-plugin-monaco-editor";

export default defineConfig({
  base: "./",
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
  },
  envPrefix: ["VITE_"],
  build: {
    target: ["es2021", "chrome100", "safari15"],
    outDir: "dist",
  },
  plugins: [
    (monacoEditorPlugin as any).default({
      languageWorkers: [
        "editorWorkerService",
        "typescript",
        "json",
        "css",
        "html",
      ],
    }),
  ],
});
