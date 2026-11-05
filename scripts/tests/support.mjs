import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { root } from '../version.mjs';

export { root };

/** Only replace directories explicitly owned by the synthetic test harness. */
export async function prepareWorkspace(name) {
  if (!['ui', 'integration', 'linux-ui', 'linux-fonts'].includes(name))
    throw Error(`Unknown test workspace: ${name}`);
  const base = path.join(root, 'work/tests');
  const directory = path.resolve(base, name);
  if (path.dirname(directory) !== base) throw Error('Unsafe test workspace path');
  const marker = path.join(directory, '.adbshare-test-workspace');
  const previous = await fs.lstat(directory).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (previous) {
    if (
      previous.isSymbolicLink() ||
      (await fs.readFile(marker, 'utf8').catch(() => '')) !== 'ADBShare synthetic test\n'
    ) {
      throw Error(`Refusing to replace an unrecognized test workspace: ${directory}`);
    }
    await fs.rm(directory, { recursive: true, force: true });
  }
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(marker, 'ADBShare synthetic test\n');
  return directory;
}

/** Execute only the child created here; never invoke a shell or terminate other processes. */
export function runCommand(program, args, { timeout = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(Error(`${program} timed out`));
    }, timeout);
    child.stdout.on('data', (data) => {
      stdout += data;
    });
    child.stderr.on('data', (data) => {
      stderr += data;
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(Error(`${program} failed (${code}): ${stderr || stdout}`));
    });
  });
}
