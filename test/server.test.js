import { test } from 'node:test';
import assert from 'node:assert';
import { spawn } from 'node:child_process';

// Sends JSON-RPC lines to server.js and collects the responses.
async function rpc(...requests) {
  const proc = spawn('node', ['server.js'], { stdio: ['pipe', 'pipe', 'pipe'] });
  const lines = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: {
      protocolVersion: '2025-06-18', capabilities: {},
      clientInfo: { name: 'test', version: '1.0.0' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    ...requests,
  ];
  proc.stdin.write(lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  proc.stdin.end();

  let out = '';
  for await (const chunk of proc.stdout) out += chunk;
  await new Promise((r) => proc.on('close', r));

  // Responses arrive out of order — index them by id.
  const byId = new Map();
  for (const line of out.split('\n').filter(Boolean)) {
    const msg = JSON.parse(line);
    if (msg.id !== undefined) byId.set(msg.id, msg);
  }
  return byId;
}

test('server initializes and advertises tools', async () => {
  const res = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });

  assert.equal(res.get(1).result.serverInfo.name, 'mtg-mcp');
  const names = res.get(2).result.tools.map((t) => t.name);
  assert.ok(names.includes('ping'), `expected ping in ${names}`);
});

test('ping tool returns pong', async () => {
  const res = await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call',
    params: { name: 'ping', arguments: {} } });

  assert.equal(res.get(3).result.content[0].text, 'pong');
});

export { rpc };
