import { describe, it, expect, vi } from "vitest";

vi.mock("monaco-editor", () => ({}));
vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(),
}));

import { detectLanguage } from "./code-renderer";

describe("detectLanguage", () => {
  it.each([
    ["typescript", "main.ts"],
    ["typescript", "app.tsx"],
    ["javascript", "index.js"],
    ["javascript", "app.jsx"],
    ["python", "script.py"],
    ["rust", "lib.rs"],
    ["go", "main.go"],
    ["java", "App.java"],
    ["c", "main.c"],
    ["cpp", "main.cpp"],
    ["css", "style.css"],
    ["html", "page.html"],
    ["json", "data.json"],
    ["yaml", "config.yaml"],
    ["yaml", "config.yml"],
    ["ini", "Cargo.toml"],
    ["sql", "query.sql"],
    ["shell", "script.sh"],
    ["shell", "run.bash"],
    ["graphql", "schema.graphql"],
    ["dockerfile", "Dockerfile.dockerfile"],
    ["swift", "main.swift"],
    ["kotlin", "App.kt"],
    ["html", "app.vue"],
    ["plaintext", "unknown.xyz"],
    ["plaintext", "Makefile"],
  ])("returns %s language when given %s", (expected, filename) => {
    expect(detectLanguage(`/path/to/${filename}`)).toBe(expected);
  });
});
