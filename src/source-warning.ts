// Advisory only. Rust remains the authority for IPv4 / CIDR validation and access checks.
// A range is local only when its entire normalized interval is inside one local block.
export function hasNonLocalSources(sources: readonly string[]): boolean {
  const localBlocks = [
    [0x0a000000, 0x0affffff],
    [0xac100000, 0xac1fffff],
    [0xc0a80000, 0xc0a8ffff],
    [0x7f000000, 0x7fffffff],
    [0xa9fe0000, 0xa9feffff],
  ];
  return sources.some((source) => {
    const parts = source.split('/');
    if (parts.length > 2 || !/^(0|[1-9]\d{0,2})(\.(0|[1-9]\d{0,2})){3}$/.test(parts[0]))
      return false;
    const octets = parts[0].split('.').map(Number);
    if (octets.some((n) => n > 255)) return false;
    if (parts.length === 2 && !/^\+?\d+$/.test(parts[1])) return false;
    const prefix = parts.length === 2 ? Number(parts[1]) : 32;
    if (prefix > 32) return false;
    const ip = octets.reduce((value, octet) => value * 256 + octet, 0);
    const size = 2 ** (32 - prefix);
    const base = Math.floor(ip / size) * size;
    const end = base + size - 1;
    return !localBlocks.some(([low, high]) => base >= low && end <= high);
  });
}
