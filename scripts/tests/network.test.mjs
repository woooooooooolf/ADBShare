import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasNonLocalSources } from '../../src/source-warning.ts';
import { commandHost, groupMode, endpointAvailable } from '../../src/network.ts';

test('IPv6 source warnings normalize the complete CIDR interval', () => {
  for (const source of [
    '::1',
    'fc00::/7',
    'fd12:3456::1234/64',
    'fe80::1/10',
    '127.0.0.1',
    '192.168.1.0/24',
  ])
    assert.equal(hasNonLocalSources([source]), false, source);
  for (const source of ['2001:db8::1', '::/0', 'fc00::/6', 'fe80::/9', '::1/127', '10.0.0.1/7'])
    assert.equal(hasNonLocalSources([source]), true, source);
  for (const source of [
    '::/129',
    '1::2::3',
    '1:::2',
    '[::1]',
    'fe80::1%7',
    '::/-1',
    '::ffff:c000:201',
    '203.0.113.999',
  ])
    assert.equal(hasNonLocalSources([source]), false, source);
  assert.equal(hasNonLocalSources(['fd00::/64', '2001:db8::1']), true);
});

test('adb IPv6 hosts are bracketed and never reuse the server scope', () => {
  assert.equal(commandHost('192.168.1.10'), '192.168.1.10');
  assert.equal(commandHost('fd12:3456::10'), '"[fd12:3456::10]"');
  assert.equal(commandHost('fe80::10'), '"[fe80::10%INTERFACE]"');
  assert.equal(commandHost('fe80::10', 9), '"[fe80::10%9]"');
});

test('unavailable, missing or wrong-adapter addresses cannot start sharing', () => {
  const g = { address: '192.0.2.10', interfaceName: 'a' };
  const rows = [
    { id: 'a', address: g.address, available: true },
    { id: 'a', address: 'fd00::10', available: true },
  ];
  assert.equal(groupMode(g), 'ipv4');
  assert.equal(endpointAvailable(g, rows, 'ipv4'), true);
  assert.equal(endpointAvailable(g, rows, 'dual'), false);
  const dual = { ...g, ipv6Address: 'fd00::10' };
  assert.equal(groupMode(dual), 'dual');
  assert.equal(endpointAvailable(dual, rows, 'dual'), true);
  assert.equal(endpointAvailable(dual, [rows[0], { ...rows[1], id: 'b' }], 'dual'), false);
  assert.equal(endpointAvailable(dual, [rows[0], { ...rows[1], available: false }], 'dual'), false);
  assert.equal(endpointAvailable(dual, [rows[0]], 'dual'), false);
  assert.equal(endpointAvailable({ ...g, address: '' }, rows, 'ipv4'), false);
  const v6 = { address: 'fd00::10', interfaceName: 'a' };
  assert.equal(groupMode(v6), 'ipv6');
  assert.equal(endpointAvailable(v6, rows, 'ipv6'), true);
  assert.equal(endpointAvailable(v6, rows, 'ipv4'), false);
});
