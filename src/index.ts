#!/usr/bin/env node
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createApplication } from './app.js';
import { createServer } from './mcp/server.js';
import { safeError } from './services/validation.js';
try {
  const app = createApplication(process.argv.includes('--demo'));
  serveStdio(() => createServer(app.service), {
    onerror: () => console.error('[WorkSync] MCP 전송 오류'),
  });
  process.once('exit', () => app.store.close());
} catch (error) {
  console.error(JSON.stringify(safeError(error)));
  process.exitCode = 1;
}
