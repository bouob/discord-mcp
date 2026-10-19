import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveUploadPath } from '../src/upload-path.js';

let base: string;
let uploadDir: string;
let outsideFile: string;

before(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'discord-mcp-upload-')));
  uploadDir = path.join(base, 'uploads');
  fs.mkdirSync(path.join(uploadDir, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(uploadDir, 'report.txt'), 'ok');
  fs.writeFileSync(path.join(uploadDir, 'sub', 'image.png'), 'ok');
  fs.writeFileSync(path.join(uploadDir, '..notes.txt'), 'ok');
  outsideFile = path.join(base, 'secret.env');
  fs.writeFileSync(outsideFile, 'TOKEN=x');
});

after(() => fs.rmSync(base, { recursive: true, force: true }));

test('local uploads are disabled when no upload directory is set', () => {
  assert.throws(() => resolveUploadPath(outsideFile, undefined), /disabled/);
  assert.throws(() => resolveUploadPath('report.txt', ''), /disabled/);
});

test('http(s) URLs pass through unchanged', () => {
  assert.equal(resolveUploadPath('https://example.com/a.png', undefined), 'https://example.com/a.png');
  assert.equal(resolveUploadPath('HTTP://example.com/a.png', undefined), 'HTTP://example.com/a.png');
});

test('files inside the upload directory resolve to absolute paths', () => {
  assert.equal(resolveUploadPath('report.txt', uploadDir), path.join(uploadDir, 'report.txt'));
  assert.equal(resolveUploadPath(path.join('sub', 'image.png'), uploadDir), path.join(uploadDir, 'sub', 'image.png'));
  assert.equal(resolveUploadPath(path.join(uploadDir, 'report.txt'), uploadDir), path.join(uploadDir, 'report.txt'));
  assert.equal(resolveUploadPath('..notes.txt', uploadDir), path.join(uploadDir, '..notes.txt'));
});

test('paths outside the upload directory are rejected', () => {
  assert.throws(() => resolveUploadPath(outsideFile, uploadDir), /outside/);
  assert.throws(() => resolveUploadPath(path.join('..', 'secret.env'), uploadDir), /outside/);
  assert.throws(() => resolveUploadPath(path.join('sub', '..', '..', 'secret.env'), uploadDir), /outside/);
});

test('missing files and directories are rejected', () => {
  assert.throws(() => resolveUploadPath('nope.txt', uploadDir), /not found/);
  assert.throws(() => resolveUploadPath('sub', uploadDir), /Not a file/);
  assert.throws(() => resolveUploadPath('.', uploadDir), /outside/);
});

test('a symlink inside the upload directory cannot point outside it', (t) => {
  const link = path.join(uploadDir, 'link.env');
  try {
    fs.symlinkSync(outsideFile, link);
  } catch (error) {
    // Windows without Developer Mode cannot create symlinks.
    t.skip(`symlink not permitted: ${(error as NodeJS.ErrnoException).code}`);
    return;
  }
  assert.throws(() => resolveUploadPath('link.env', uploadDir), /outside/);
});

test('a directory link inside the upload directory cannot lead outside it', () => {
  // 'junction' needs no privilege on Windows and is ignored (plain dir symlink) elsewhere.
  const link = path.join(uploadDir, 'escape');
  fs.symlinkSync(base, link, 'junction');
  try {
    assert.throws(() => resolveUploadPath(path.join('escape', 'secret.env'), uploadDir), /outside/);
  } finally {
    fs.unlinkSync(link); // remove the link itself, never recurse through it
  }
});
