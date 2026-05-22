import { describe, it, expect, vi } from 'vitest';

vi.mock('monaco-editor', () => ({}));
vi.mock('@tauri-apps/plugin-fs', () => ({
  readTextFile: vi.fn(),
}));

import { detectLanguage } from './code-renderer';

describe('detectLanguage', () => {
  it.each([
    ['main.ts', 'typescript'],
    ['app.tsx', 'typescript'],
    ['index.js', 'javascript'],
    ['app.jsx', 'javascript'],
    ['script.py', 'python'],
    ['lib.rs', 'rust'],
    ['main.go', 'go'],
    ['App.java', 'java'],
    ['main.c', 'c'],
    ['main.cpp', 'cpp'],
    ['style.css', 'css'],
    ['page.html', 'html'],
    ['data.json', 'json'],
    ['config.yaml', 'yaml'],
    ['config.yml', 'yaml'],
    ['Cargo.toml', 'ini'],
    ['query.sql', 'sql'],
    ['script.sh', 'shell'],
    ['run.bash', 'shell'],
    ['schema.graphql', 'graphql'],
    ['Dockerfile.dockerfile', 'dockerfile'],
    ['main.swift', 'swift'],
    ['App.kt', 'kotlin'],
    ['app.vue', 'html'],
    ['unknown.xyz', 'plaintext'],
    ['Makefile', 'plaintext'],
  ])('returns %s language for %s', (filename, expected) => {
    expect(detectLanguage(`/path/to/${filename}`)).toBe(expected);
  });
});
