export type Group = {
  id: string;
  name: string;
  address: string;
  ipv6Address?: string;
  interfaceName?: string;
  port: number;
  sources: string[];
  members: string[];
  disabledMembers?: string[];
};
export type Config = { version: number; adbPath: string; upstreamPort: number; groups: Group[] };
export type Device = {
  serial: string;
  state: string;
  model: string;
  transportId: string;
  kind: string;
};
export type Session = { id: number; peer: string; serial: string; since: number };
export type Runtime = { id: string; status: string; sessions: Session[] };
export type Interface = {
  id: string;
  name: string;
  address: string;
  cidr: string;
  family: 'ipv4' | 'ipv6';
  scopeId: number;
  available: boolean;
  reason: string | null;
};
export type Snapshot = {
  config: Config;
  runtime: Runtime[];
  interfaces: Interface[];
  networkError: string | null;
  configPath: string;
  configError: string | null;
  automaticFirewall: boolean;
};
export type AppInfo = {
  name: string;
  version: string;
  buildTimestamp: number;
  author: string;
  license: string;
};
export type HistoryRecord = {
  id: number;
  time: number;
  groupId: string | null;
  serial: string | null;
  session: number | null;
  kind: string;
  message: string;
  bytes: number;
  hex: string;
  text: string;
};
export type HistoryView = {
  records: HistoryRecord[];
  dropped: number;
  states: Record<string, string>;
  perScopeLimit: number;
  payloadLimit: number;
};
export type ThirdPartyComponent = { name: string; version: string; license: string };
export type RunAction = (operation: () => Promise<void>) => Promise<void>;
export type ConfirmAction = (title: string, text: string) => Promise<boolean>;
