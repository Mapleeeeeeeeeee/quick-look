import { describe, it, expect } from "vitest";
import { detectFileType } from "./renderer";

describe("detectFileType", () => {
  it.each([
    ["markdown", "README.md"],
    ["markdown", "doc.mdx"],
    ["code", "main.ts"],
    ["code", "script.py"],
    ["code", "lib.rs"],
    ["image", "image.png"],
    ["image", "photo.jpg"],
    ["image", "photo.jpeg"],
    ["image", "icon.svg"],
    ["image", "pic.gif"],
    ["image", "pic.webp"],
    ["image", "pic.ico"],
    ["image", "pic.bmp"],
    ["code", "Makefile"],
    ["code", "data.xyz"],
    ["code", "INDEX.HTML"],
  ])("returns %s type when given %s", (expected, filename) => {
    expect(detectFileType(`/path/to/${filename}`)).toBe(expected);
  });
});
