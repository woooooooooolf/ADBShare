import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const thirdParty = path.join(root, 'third_party');
const source = JSON.parse(fs.readFileSync(path.join(thirdParty, 'glib-0.18.5.source.json')));
const directory = path.join(thirdParty, 'glib-0.18.5');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const actual = {};
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else {
      assert(entry.isFile(), `Unexpected entry: ${file}`);
      actual[path.relative(directory, file).split(path.sep).join('/')] = hash(
        fs.readFileSync(file),
      );
    }
  }
}
walk(directory);
assert.deepEqual(Object.keys(source.patch.patchedFiles), ['src/variant_iter.rs']);
assert.deepEqual(actual, { ...source.files, ...source.patch.patchedFiles });
assert.equal(hash(fs.readFileSync(path.join(thirdParty, source.patch.file))), source.patch.sha256);

// Reversing exactly the two upstream line changes must recover the original file.
const patched = fs.readFileSync(path.join(directory, 'src/variant_iter.rs'), 'utf8');
const original = patched
  .replace(
    'let mut p: *mut libc::c_char = std::ptr::null_mut();',
    'let p: *mut libc::c_char = std::ptr::null_mut();',
  )
  .replace('                &mut p,', '                &p,');
assert.notEqual(original, patched);
assert.equal(hash(original), source.files['src/variant_iter.rs']);

const metadata = JSON.parse(
  execFileSync(
    'cargo',
    [
      'metadata',
      '--locked',
      '--offline',
      '--format-version',
      '1',
      '--manifest-path',
      path.join(root, 'src-tauri/Cargo.toml'),
      '--filter-platform',
      'x86_64-unknown-linux-gnu',
    ],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  ),
);
const glib = metadata.packages.filter((pkg) => pkg.name === 'glib');
assert.equal(glib.length, 1, 'The resolved graph must contain exactly one glib');
assert.equal(glib[0].version, '0.18.5');
assert.equal(glib[0].source, null, 'glib must not resolve to the registry');
assert.equal(path.resolve(glib[0].manifest_path), path.join(directory, 'Cargo.toml'));
const consumers = metadata.resolve.nodes.filter((node) =>
  node.deps.some((dep) => dep.pkg === glib[0].id),
);
assert(consumers.length > 0, 'The patched crate must be used by the Linux dependency graph');
const lock = fs.readFileSync(path.join(root, 'src-tauri/Cargo.lock'), 'utf8');
const locked = lock.split('[[package]]').filter((block) => /^\s*name = "glib"$/m.test(block));
assert.equal(locked.length, 1);
assert.match(locked[0], /^version = "0\.18\.5"$/m);
assert.doesNotMatch(locked[0], /^(source|checksum) = /m);
console.log(
  `glib backport verified: ${Object.keys(actual).length} upstream files, only two changed lines; ${consumers.length} direct consumers use the local crate.`,
);
