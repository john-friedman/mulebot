import {Agent} from './agent.js';
import {resolveModel} from './providers.js';
import {isObject} from './types.js';
import type {Options} from './types.js';

export const responseHeaders = {
  'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'",
};
export interface HandlerOptions extends Options {agentFactory?: (options: Options) => Agent}

export async function handleChat(request: Request, options: HandlerOptions): Promise<Response> {
  const error = (status: number, message: string) => Response.json({error: message}, {status, headers: responseHeaders});
  if (request.method !== 'POST') return error(405, 'Send a POST request.');
  if (request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json') return error(415, 'Send application/json.');
  let bot: Agent;
  let message: string;
  try {
    const reader = request.body?.getReader();
    if (!reader) throw new Error('Send a JSON object.');
    const decoder = new TextDecoder('utf-8', {fatal: true});
    let text = '', size = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > 10000000) { await reader.cancel(); throw new Error('Request is too large.'); }
        text += decoder.decode(chunk.value, {stream: true});
      }
      text += decoder.decode();
    } finally { reader.releaseLock(); }
    const body = JSON.parse(text);
    if (!isObject(body)) throw new Error('Send a JSON object.');
    message = body.message;
    if (typeof message !== 'string' || !message.trim() || message.length > 16000) throw new Error('Enter a message of at most 16,000 characters.');
    const model = resolveModel(options?.provider, body.model ?? options?.model);
    const settings = {...options, model, signal: request.signal};
    bot = options.agentFactory ? options.agentFactory(settings) : new Agent(settings);
    bot.loadState(body.state);
  } catch (cause) { return error(400, String(cause instanceof Error ? cause.message : cause)); }
  const events = bot.stream(message);
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await events.next();
        if (next.done) controller.close();
        else controller.enqueue(encoder.encode(JSON.stringify(next.value) + '\n'));
      } catch (cause) { controller.error(cause); await events.return(undefined); }
    },
    async cancel() { await events.return(undefined); },
  });
  return new Response(body, {headers: {...responseHeaders, 'Content-Type': 'application/x-ndjson; charset=utf-8'}});
}
