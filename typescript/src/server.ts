import {createServer as nodeServer} from 'node:http';
import {readFile, access} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {handleChat, responseHeaders, DEFAULT_MODEL} from './index.js';
import type {HandlerOptions} from './http.js';

export interface ServerOptions extends HandlerOptions {port?: number}

async function asset(name: string): Promise<string> {
  const shared = new URL(`../../ui/${name}`, import.meta.url);
  try { await access(shared); return await readFile(shared, 'utf8'); }
  catch { return await readFile(new URL(`./ui/${name}`, import.meta.url), 'utf8'); }
}

export function createServer(options: ServerOptions = {}) {
  const model = options.model || process.env.MULEBOT_MODEL || DEFAULT_MODEL;
  const assets: Record<string, [string, string]> = {
    '/': ['templates/index.html', 'text/html; charset=utf-8'],
    '/static/app.js': ['static/app.js', 'text/javascript; charset=utf-8'],
    '/static/style.css': ['static/style.css', 'text/css; charset=utf-8'],
  };
  const server = nodeServer(async (incoming, outgoing) => {
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : options.port ?? 8000;
    const host = incoming.headers.host;
    const origin = incoming.headers.origin;
    const send = (status: number, value: unknown) => {
      outgoing.writeHead(status, {...responseHeaders, 'Content-Type': 'application/json; charset=utf-8'});
      outgoing.end(JSON.stringify(value));
    };
    if (![ `localhost:${port}`, `127.0.0.1:${port}` ].includes(host ?? '') || (origin && origin !== `http://${host}`)) {
      incoming.resume(); send(403, {error: 'Local requests only.'}); return;
    }
    const controller = new AbortController();
    outgoing.on('close', () => controller.abort());
    try {
      const path = incoming.url ?? '';
      if (incoming.method === 'GET') {
        if (path === '/api/config') { send(200, {model}); return; }
        if (!Object.hasOwn(assets, path)) { send(404, {error: 'Not found.'}); return; }
        const [name, type] = assets[path];
        outgoing.writeHead(200, {...responseHeaders, 'Content-Type': type});
        outgoing.end((await asset(name)).replaceAll('$title', 'Mulebot'));
        return;
      }
      if (incoming.method !== 'POST' || path !== '/api/chat') { incoming.resume(); send(404, {error: 'Not found.'}); return; }
      let size = 0;
      const chunks: Buffer[] = [];
      for await (const chunk of incoming) {
        size += chunk.length;
        if (size > 10000000) { send(413, {error: 'Request is too large.'}); return; }
        chunks.push(chunk);
      }
      const request = new Request(`http://${host}${path}`, {
        method: 'POST', headers: incoming.headers as Record<string, string>,
        body: Buffer.concat(chunks), signal: controller.signal,
      });
      const response = await handleChat(request, {...options, model});
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.flushHeaders();
      if (response.body) await pipeline(Readable.fromWeb(response.body as any), outgoing);
      else outgoing.end();
    } catch (cause) {
      if (controller.signal.aborted) return;
      if (!outgoing.headersSent) send(500, {error: 'Server request failed.'});
      else outgoing.destroy(cause instanceof Error ? cause : undefined);
    }
  });
  server.requestTimeout = 0;
  return server;
}

export async function serve(options: ServerOptions = {}) {
  const server = createServer(options);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject); server.listen(options.port ?? 8000, '127.0.0.1', resolve);
  });
  const address = server.address();
  console.error(`Mulebot: http://localhost:${typeof address === 'object' && address ? address.port : options.port}`);
  return server;
}
