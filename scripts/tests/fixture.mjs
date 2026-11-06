// Deterministic fake ADB Server for protocol tests and UI walkthroughs only.
// It does not open devices or connect to the machine's real ADB Server.
import net from 'node:net';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { root } from '../version.mjs';

export const pack = (value) => {
  const b = Buffer.from(value);
  return Buffer.concat([Buffer.from(b.length.toString(16).padStart(4, '0')), b]);
};
export class Reader {
  buffer = Buffer.alloc(0);
  ended = false;
  error = null;
  pending = null;
  constructor(socket) {
    this.socket = socket;
    socket.on('data', (data) => {
      this.buffer = Buffer.concat([this.buffer, data]);
      this.wake();
    });
    socket.on('close', () => {
      this.ended = true;
      this.wake();
    });
    socket.on('error', (e) => {
      this.error = e;
      this.wake();
    });
  }
  wake() {
    this.pending?.();
    this.pending = null;
  }
  async bytes(n) {
    while (this.buffer.length < n) {
      if (this.error) throw this.error;
      if (this.ended) throw new Error('EOF');
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pending = null;
          reject(new Error('fixture read timeout'));
        }, 5000);
        this.pending = () => {
          clearTimeout(timer);
          resolve();
        };
      });
    }
    const data = this.buffer.subarray(0, n);
    this.buffer = this.buffer.subarray(n);
    return data;
  }
  async frame() {
    return (await this.frameBytes()).toString();
  }
  async frameBytes() {
    return this.bytes(Number.parseInt((await this.bytes(4)).toString(), 16));
  }
}
const shellPacket = (id, data) => {
  const header = Buffer.alloc(5);
  header[0] = id;
  header.writeUInt32LE(data.length, 1);
  return Buffer.concat([header, data]);
};
// Independent minimal AOSP protobuf encoder for the synthetic upstream fixture.
const varint = (value) => {
  let n = BigInt(value);
  const bytes = [];
  while (n >= 128n) {
    bytes.push(Number(n & 127n) | 128);
    n >>= 7n;
  }
  return Buffer.from([...bytes, Number(n)]);
};
const protoString = (tag, value) => {
  const bytes = Buffer.from(value);
  return Buffer.concat([varint((tag << 3) | 2), varint(bytes.length), bytes]);
};
const protoNumber = (tag, value) => Buffer.concat([varint(tag << 3), varint(value)]);
const deviceProto = (devices) =>
  Buffer.concat(
    devices.map((d) => {
      const message = Buffer.concat([
        protoString(1, d.serial),
        protoNumber(2, { device: 8, recovery: 10, bootloader: 7, offline: 6 }[d.state] || 6),
        protoString(5, d.model),
        protoNumber(7, d.serial.startsWith('emulator-') ? 2 : 1),
        protoNumber(10, d.id),
      ]);
      return Buffer.concat([Buffer.from([10]), varint(message.length), message]);
    }),
  );
export async function freePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
export async function fixture() {
  const state = {
    inventory: [
      { serial: 'SIM-PIXEL', model: 'Virtual_Pixel_9', state: 'device', id: 9001 },
      { serial: 'SIM-TABLET', model: 'Virtual_Tablet', state: 'offline', id: 9002 },
      { serial: 'emulator-5554', model: 'Virtual_Emulator', state: 'device', id: 9003 },
    ],
    deviceError: '',
    requests: [],
    files: new Map(),
    sockets: new Set(),
  };
  const server = net.createServer((socket) => {
    state.sockets.add(socket);
    socket.on('close', () => state.sockets.delete(socket));
    socket.on('error', () => {});
    const reader = new Reader(socket);
    const fail = (s) => socket.end(Buffer.concat([Buffer.from('FAIL'), pack(s)]));
    const okay = (s) => socket.end(Buffer.concat([Buffer.from('OKAY'), pack(s)]));
    void (async () => {
      const req = await reader.frame();
      state.requests.push(req);
      if (req === 'host:version') return okay('0029');
      if (req === 'host:host-features') return okay('shell_v2,cmd,devicetracker_proto_format');
      if (req === 'host:mdns:check') return okay('synthetic mdns available');
      if (req === 'host:server-status')
        return okay(
          Buffer.concat([
            protoNumber(1, 1),
            protoNumber(3, 2),
            protoString(5, '1.0.41'),
            protoString(6, 'synthetic'),
            protoString(7, '/synthetic/adb'),
          ]),
        );
      if (req === 'host:track-devices-proto-binary') {
        socket.write('OKAY');
        let previous;
        const send = () => {
          const payload = deviceProto(state.inventory);
          if (!previous?.equals(payload)) socket.write(pack(payload));
          previous = payload;
        };
        send();
        const timer = setInterval(send, 20);
        socket.once('close', () => clearInterval(timer));
        return;
      }
      if ((req === 'host:devices' || req === 'host:devices-l') && state.deviceError)
        return fail(state.deviceError);
      if (req === 'host:devices' || req === 'host:devices-l')
        return okay(
          state.inventory
            .map(
              (d) =>
                `${d.serial}\t${d.state}${req.endsWith('-l') ? ` product:virtual model:${d.model} transport_id:${d.id}` : ''}\n`,
            )
            .join(''),
        );
      let selected;
      for (const d of state.inventory) {
        const prefix = `host-serial:${d.serial}:`;
        if (req.startsWith(prefix)) {
          const cmd = req.slice(prefix.length);
          if (cmd === 'features') return okay('shell_v2,cmd,devicetracker_proto_format');
          if (cmd === 'get-state') return okay(d.state);
          if (cmd === 'get-serialno') return okay(d.serial);
          if (cmd === 'get-devpath') return okay('usb:synthetic');
          if (cmd === 'reconnect') return okay(`reconnecting ${d.serial}`);
          return fail('fake host command unsupported');
        }
        if (req === `host:transport:${d.serial}` || req === `host:tport:serial:${d.serial}`)
          selected = d;
      }
      if (!selected) return fail('fake request unsupported');
      if (selected.state !== 'device') return fail('device offline');
      socket.write('OKAY');
      if (req.startsWith('host:tport:')) {
        const id = Buffer.alloc(8);
        id.writeBigUInt64LE(BigInt(selected.id));
        socket.write(id);
      }
      const service = await reader.frame();
      state.requests.push(service);
      socket.write('OKAY');
      if (service.startsWith('shell') || service.startsWith('exec:')) {
        const command = service.slice(service.indexOf(':') + 1);
        if (command.includes('sleep')) return; // holds until gateway revokes this connection
        const text = Buffer.from(
          command.replace(/^echo\s+/, '').replace(/^['"]|['"]$/g, '') + '\n',
        );
        if (service.startsWith('shell,v2'))
          socket.end(Buffer.concat([shellPacket(1, text), shellPacket(3, Buffer.from([0]))]));
        else socket.end(text);
      } else if (service === 'sync:') {
        while (!socket.destroyed) {
          const op = (await reader.bytes(4)).toString();
          const length = (await reader.bytes(4)).readUInt32LE();
          if (op === 'QUIT') {
            socket.end();
            return;
          }
          const spec = (await reader.bytes(length)).toString();
          if (op === 'SEND') {
            const chunks = [];
            while (true) {
              const tag = (await reader.bytes(4)).toString();
              const n = (await reader.bytes(4)).readUInt32LE();
              if (tag === 'DONE') break;
              if (tag !== 'DATA') throw Error(`bad sync ${tag}`);
              chunks.push(await reader.bytes(n));
            }
            state.files.set(spec.slice(0, spec.lastIndexOf(',')), Buffer.concat(chunks));
            socket.write(Buffer.from([79, 75, 65, 89, 0, 0, 0, 0]));
          } else if (op === 'RECV') {
            const file = state.files.get(spec) || Buffer.alloc(0);
            const h = Buffer.alloc(8);
            h.write('DATA');
            h.writeUInt32LE(file.length, 4);
            socket.write(Buffer.concat([h, file, Buffer.from([68, 79, 78, 69, 0, 0, 0, 0])]));
          } else if (op === 'STAT') {
            const h = Buffer.alloc(16);
            h.write('STAT');
            h.writeUInt32LE(0o100644, 4);
            h.writeUInt32LE(state.files.get(spec)?.length || 0, 8);
            socket.write(h);
          } else throw Error(`bad sync operation ${op}`);
        }
      } else fail('fake device service unsupported');
    })().catch(() => socket.destroy());
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    port: server.address().port,
    state,
    close: async () => {
      for (const s of state.sockets) s.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const lab = await fixture();
  const directory = path.join(root, 'work/demo');
  await mkdir(directory, { recursive: true });
  const config = {
    version: 1,
    adbPath: 'adb',
    upstreamPort: lab.port,
    groups: [
      {
        id: randomUUID(),
        name: '示例 · Android 调试组',
        address: '127.0.0.1',
        port: await freePort(),
        sources: ['127.0.0.0/8'],
        members: ['SIM-PIXEL', 'SIM-TABLET', 'SIM-RETURN'],
      },
    ],
  };
  await writeFile(path.join(directory, 'config.json'), JSON.stringify(config, null, 2));
  console.log(`虚拟 ADB 上游已启动 127.0.0.1:${lab.port}；配置：${directory}。Ctrl+C 结束。`);
}
