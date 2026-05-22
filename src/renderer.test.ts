import { describe, it, expect } from 'vitest';
import { detectFileType } from './renderer';

describe('detectFileType', () => {
  it.each([
    ['README.md', 'markdown'],
    ['doc.mdx', 'markdown'],
    ['main.ts', 'code'],
    ['script.py', 'code'],
    ['lib.rs', 'code'],
    ['image.png', 'image'],
    ['photo.jpg', 'image'],
    ['photo.jpeg', 'image'],
    ['icon.svg', 'image'],
    ['pic.gif', 'image'],
    ['pic.webp', 'image'],
    ['pic.ico', 'image'],
    ['pic.bmp', 'image'],
    ['Makefile', 'code'],
    ['data.xyz', 'code'],
    ['INDEX.HTML', 'code'],
  ])('returns %s for %s', (filename, expected) => {
    expect(detectFileType(`/path/to/${filename}`)).toBe(expected);
  });
});
