import type { Group, Interface } from './types';

export type NetworkMode = 'ipv4' | 'ipv6' | 'dual';
export const groupMode = (g: Group): NetworkMode =>
  g.ipv6Address ? 'dual' : g.address.includes(':') ? 'ipv6' : 'ipv4';
export const isLoopback = (address: string) => address === '::1' || address.startsWith('127.');
export const endpointAddresses = (g: Group) => [
  g.address,
  ...(g.ipv6Address ? [g.ipv6Address] : []),
];
export const displayAddress = (address: string) =>
  address.includes(':') ? `[${address}]` : address;
export function adapterId(g: Group, interfaces: readonly Interface[]) {
  return g.interfaceName ?? interfaces.find((i) => i.address === g.address)?.id ?? '';
}
export function endpointAvailable(g: Group, interfaces: readonly Interface[], mode: NetworkMode) {
  const id = adapterId(g, interfaces);
  const addresses = endpointAddresses(g);
  return (
    addresses.length === (mode === 'dual' ? 2 : 1) &&
    (mode === 'ipv6' ? g.address.includes(':') : !g.address.includes(':')) &&
    addresses.every(
      (address) =>
        !!address && interfaces.some((i) => i.id === id && i.address === address && i.available),
    )
  );
}
export function commandHost(address: string, scope?: number) {
  if (!address.includes(':')) return address;
  // A link-local zone is the CLIENT's interface index, never the server's.
  const scoped = /^fe[89ab]/i.test(address) ? `${address}%${scope ?? 'INTERFACE'}` : address;
  return `"[${scoped}]"`;
}
