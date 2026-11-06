// Advisory only. Rust remains the authority for validation and access checks.
function addressValue(text: string): { value: bigint; bits: number } | null {
  if (!text.includes(':')) {
    if (!/^(0|[1-9]\d{0,2})(\.(0|[1-9]\d{0,2})){3}$/.test(text)) return null;
    const bytes = text.split('.').map(Number);
    if (bytes.some((n) => n > 255)) return null;
    return { value: bytes.reduce((v, b) => v * 256n + BigInt(b), 0n), bits: 32 };
  }
  if (!/^[\da-f:]+$/i.test(text) || text.includes(':::')) return null;
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const count = left.length + right.length;
  if (halves.length === 1 ? count !== 8 : count >= 8) return null;
  const words = [...left, ...Array<string>(8 - count).fill('0'), ...right];
  if (words.some((w) => !/^[\da-f]{1,4}$/i.test(w))) return null;
  const value = words.reduce((v, w) => v * 65536n + BigInt(`0x${w}`), 0n);
  if (value >> 32n === 0xffffn) return null;
  return { value, bits: 128 };
}
export function hasNonLocalSources(sources: readonly string[]): boolean {
  const blocks = [
    ['10.0.0.0', 8],
    ['172.16.0.0', 12],
    ['192.168.0.0', 16],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['::1', 128],
    ['fc00::', 7],
    ['fe80::', 10],
  ] as const;
  return sources.some((source) => {
    const parts = source.split('/');
    if (parts.length > 2) return false;
    const ip = addressValue(parts[0]);
    if (!ip || (parts.length === 2 && !/^\+?\d+$/.test(parts[1]))) return false;
    const prefix = parts.length === 2 ? Number(parts[1]) : ip.bits;
    if (prefix > ip.bits) return false;
    const size = 1n << BigInt(ip.bits - prefix);
    const base = (ip.value / size) * size;
    const end = base + size - 1n;
    return !blocks.some(([address, blockPrefix]) => {
      const block = addressValue(address)!;
      return (
        ip.bits === block.bits &&
        base >= block.value &&
        end < block.value + (1n << BigInt(block.bits - blockPrefix))
      );
    });
  });
}
