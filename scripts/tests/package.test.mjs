import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { packagePair } from '../package.mjs';

test('EXE and AppImage packages contain exactly a binary and a verifiable full-name checksum', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'adbshare-package-'));
  try {
    const source = path.join(directory, 'input');
    const bytes = Buffer.from([0, 255, 4, 128]);
    fs.writeFileSync(source, bytes);
    for (const extension of ['exe', 'AppImage']) {
      const name = `ADBShare-0.8.1-${extension === 'exe' ? 'windows' : 'linux'}-x64.${extension}`;
      const output = path.join(directory, extension);
      packagePair(source, output, name);
      assert.deepEqual(fs.readdirSync(output).sort(), [name, `${name}.sha256`].sort());
      assert.deepEqual(fs.readFileSync(path.join(output, name)), bytes);
      assert.equal(
        fs.readFileSync(path.join(output, `${name}.sha256`), 'utf8'),
        `${createHash('sha256').update(bytes).digest('hex')}  ${name}\n`,
      );
      fs.writeFileSync(path.join(output, 'SHA256SUMS'), `${'a'.repeat(64)}  ${name}\n`);
      packagePair(source, output, name);
      assert(!fs.existsSync(path.join(output, 'SHA256SUMS')));
      fs.writeFileSync(path.join(output, 'SHA256SUMS'), 'unknown manifest');
      assert.throws(() => packagePair(source, output, name));
      assert.equal(fs.readFileSync(path.join(output, 'SHA256SUMS'), 'utf8'), 'unknown manifest');
      fs.unlinkSync(path.join(output, 'SHA256SUMS'));
      fs.writeFileSync(path.join(output, 'keep.txt'), 'unrelated');
      assert.throws(() => packagePair(source, output, name));
      assert.equal(fs.readFileSync(path.join(output, 'keep.txt'), 'utf8'), 'unrelated');
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
