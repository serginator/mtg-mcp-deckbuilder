#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'mtg-mcp', version: '0.1.0' });

// Wraps any value as MCP text content. Every tool returns through this.
const text = (value) => ({
  content: [{
    type: 'text',
    text: typeof value === 'string' ? value : JSON.stringify(value, null, 1),
  }],
});

server.registerTool('ping', {
  description: 'Health check. Returns "pong".',
  inputSchema: {},
}, async () => text('pong'));

const transport = new StdioServerTransport();
await server.connect(transport);
