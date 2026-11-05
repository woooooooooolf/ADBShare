import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { checkVersion, formatReleaseNotes, root } from '../version.mjs';

const entry = `## [0.8.1] - 2026-11-05

### Changed
- 精简 Windows x64 成果物。

### Fixed
* 修正 ADB 状态。

### Docs
+ 保存 Release 约束。
`;

test('release body drops the version heading and preserves Chinese lists and English names', () => {
  assert.equal(
    formatReleaseNotes(entry),
    `### Changed

- 精简 Windows x64 成果物。

### Fixed

- 修正 ADB 状态。

### Docs

- 保存 Release 约束。
`,
  );
});

test('release body rejects extra prose, missing, duplicate and unordered headings', () => {
  for (const invalid of [
    '# Release\n' + entry,
    entry.replace('### Changed', '介绍段落\n\n### Changed'),
    entry.replace('### Fixed', '### Added'),
    entry.replace('### Fixed', '### Changed'),
    entry.replace('### Fixed', '### Docs').replace(/### Docs\n\+/, '### Fixed\n+'),
    entry.replace('* 修正 ADB 状态。', ''),
  ])
    assert.throws(() => formatReleaseNotes(invalid));
});

test('current and unreleased changelog entries obey the documented structure', () => {
  const entries = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8').split(/^## /m).slice(1);
  for (const source of entries) {
    const notes = formatReleaseNotes('## ' + source);
    assert.deepEqual(
      [...notes.matchAll(/^### (.+)$/gm)].map((match) => match[1]),
      ['Changed', 'Fixed', 'Docs'],
    );
    assert(!/^#{1,2} /m.test(notes));
  }
  assert(checkVersion().notes.startsWith('### Changed\n'));
});
