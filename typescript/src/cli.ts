#!/usr/bin/env node
import {createInterface} from 'node:readline';
import {once} from 'node:events';
import {Agent} from './index.js';
import {serve} from './server.js';
import type {ServerOptions} from './server.js';

const usage = 'Usage: mulebot [--model MODEL] [--tables TABLES] serve [--port 8000]\n       mulebot [--model MODEL] chat ["your question"]';
async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) { console.log(usage); return; }
  const settings: ServerOptions = {};
  const positional: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (['--model', '--tables', '--port'].includes(arg)) {
      const value = args[++index];
      if (!value) throw new Error(`Missing value for ${arg}.`);
      if (arg === '--model') settings.model = value;
      else if (arg === '--tables') settings.allowedTables = value.split(',').map(name => name.trim()).filter(Boolean);
      else {
        settings.port = Number(value);
        if (!Number.isInteger(settings.port) || settings.port < 0 || settings.port > 65535) throw new Error('Invalid port.');
      }
    } else if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
    else positional.push(arg);
  }
  const [command, ...message] = positional;
  if (command === 'serve') {
    if (message.length) throw new Error(usage);
    await serve(settings); return;
  }
  if (command !== 'chat') throw new Error(usage);
  const bot = new Agent(settings);
  async function chat(text: string) {
    for await (const event of bot.run(text)) {
      if (!process.stdout.write(JSON.stringify(event) + '\n')) await once(process.stdout, 'drain');
      if (event.type === 'error') process.exitCode = 1;
    }
  }
  if (message.length) { await chat(message.join(' ')); return; }
  const lines = createInterface({input: process.stdin, crlfDelay: Infinity});
  if (process.stdin.isTTY) process.stderr.write('> ');
  for await (const line of lines) {
    if (line.trim()) await chat(line.trim());
    if (process.stdin.isTTY) process.stderr.write('> ');
  }
}
main().catch(error => { console.error(JSON.stringify({type: 'error', message: String(error.message ?? error)})); process.exitCode = 1; });
