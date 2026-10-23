import {DEFAULT_MODEL, INSTRUCTIONS, TOOL_LIMIT} from './config.js';
import {documentationContext} from './context.js';
import {Tools} from './tools.js';
import {validateTools} from './tool.js';
import type {Tool} from './tool.js';
import {environment, isObject} from './types.js';
import type {ChatState, Event, Message, Options} from './types.js';

export function reasoningText(response: Record<string, any>): string {
  const parts = (response.reasoning_details ?? []).map((detail: Record<string, any>) =>
    detail.type === 'reasoning.summary' ? detail.summary : detail.type === 'reasoning.text' ? detail.text : '').filter(Boolean);
  return parts.join('\n\n') || response.reasoning || '';
}

export class Agent {
  private readonly toolState: Tools;
  instructions = INSTRUCTIONS;
  doc = documentationContext;
  readonly model: string;
  messages: Message[];
  private readonly modelApiKey: string;

  constructor(private options: Options = {}) {
    this.model = options.model || environment('MULEBOT_MODEL') || DEFAULT_MODEL;
    this.modelApiKey = options.modelApiKey || environment('OPENROUTER_API_KEY') || '';
    const apiKey = options.apiKey || environment('DATAMULE_API_KEY') || '';
    if (!apiKey || !this.modelApiKey) throw new Error('Set DATAMULE_API_KEY and OPENROUTER_API_KEY.');
    this.toolState = new Tools(apiKey, options);
    this.messages = [];
    this.updateSystemMessage();
  }

  get tools(): readonly Tool[] { return this.toolState.registry.map(tool => ({...tool, parameters: structuredClone(tool.parameters)})); }
  get results() { return this.toolState.results; }
  get artifacts() { return this.toolState.artifacts; }

  setInstructions(text: string): this {
    if (typeof text !== 'string') throw new Error('Instructions must be a string.');
    this.instructions = text;
    this.updateSystemMessage();
    return this;
  }

  appendInstructions(text: string): this {
    if (typeof text !== 'string') throw new Error('Instructions must be a string.');
    return this.setInstructions([this.instructions, text].filter(Boolean).join('\n\n'));
  }

  setDoc(text: string): this {
    if (typeof text !== 'string') throw new Error('Documentation must be a string.');
    this.doc = text;
    this.updateSystemMessage();
    return this;
  }

  appendDoc(text: string): this {
    if (typeof text !== 'string') throw new Error('Documentation must be a string.');
    return this.setDoc([this.doc, text].filter(Boolean).join('\n\n'));
  }

  setTools(tools: readonly Tool[]): this {
    this.toolState.registry = validateTools(tools);
    return this;
  }

  appendTools(tools: readonly Tool[]): this {
    if (!Array.isArray(tools)) throw new Error('Tools must be an array.');
    return this.setTools([...this.tools, ...tools]);
  }

  private updateSystemMessage(): void {
    this.messages[0] = {role: 'system', content: `Today is ${new Date().toISOString().slice(0, 10)}.\n\n<documentation>\n${this.doc}\n</documentation>\n\n${this.instructions}`};
  }

  redact(text: string): string {
    for (const key of [this.modelApiKey, this.toolState.apiKey]) text = text.replaceAll(key, '[redacted]');
    return text;
  }

  exportState(): ChatState {
    return JSON.parse(this.redact(JSON.stringify({messages: this.messages.slice(1), results: this.toolState.results, artifacts: this.toolState.artifacts})));
  }

  loadState(state: unknown): void {
    if (state == null) return;
    if (!isObject(state)) throw new Error('Chat state must be an object.');
    const {messages = [], results = {}, artifacts = []} = state;
    if (!Array.isArray(messages) || !isObject(results) || !Array.isArray(artifacts)) throw new Error('Invalid chat state.');
    const restored: Message[] = messages.map(message => {
      if (!isObject(message) || !['user', 'assistant', 'tool'].includes(message.role) || typeof message.content !== 'string') throw new Error('Invalid chat message.');
      const entry: Message = {role: message.role, content: message.content};
      if (entry.role === 'tool') {
        if (typeof message.tool_call_id !== 'string') throw new Error('Invalid saved tool message.');
        entry.tool_call_id = message.tool_call_id;
      }
      if (entry.role === 'assistant') {
        const calls = message.tool_calls ?? [];
        if (!Array.isArray(calls) || calls.some(call => !isObject(call) || typeof call.id !== 'string' || !isObject(call.function) || typeof call.function.name !== 'string' || typeof call.function.arguments !== 'string')) throw new Error('Invalid saved tool calls.');
        if (calls.length) entry.tool_calls = calls;
        if (Array.isArray(message.reasoning_details)) entry.reasoning_details = message.reasoning_details;
        else if (typeof message.reasoning === 'string') entry.reasoning = message.reasoning;
      }
      return entry;
    });
    for (const result of Object.values(results)) {
      if (!isObject(result) || typeof result.sql !== 'string' || !Array.isArray(result.columns) || !result.columns.every((column: unknown) => typeof column === 'string') || !Array.isArray(result.rows) || !result.rows.every(isObject) || !isObject(result.local_types ?? {}) || Object.values(result.local_types ?? {}).some(type => !['INTEGER', 'REAL', 'NUMERIC', 'TEXT', 'DATE'].includes(type as string))) throw new Error('Invalid saved query result.');
    }
    if (!artifacts.every(isObject)) throw new Error('Invalid saved artifacts.');
    this.messages = [this.messages[0], ...structuredClone(restored)];
    this.toolState.results = structuredClone(results) as ChatState['results'];
    this.toolState.artifacts = structuredClone(artifacts) as ChatState['artifacts'];
  }

  async complete(toolChoice: 'auto' | 'none'): Promise<Record<string, any>> {
    const messages = [...this.messages];
    if (Object.keys(this.toolState.results).length) {
      const saved = Object.fromEntries(Object.entries(this.toolState.results).map(([id, result]) => [id, {columns: result.columns, row_count: result.rows.length, sql: result.sql}]));
      messages.push({role: 'system', content: 'These results are already saved and remain available even if older chat was trimmed. Use query(result_id=...) or plot.sql to read them locally instead of paying to fetch the same data again. Local SQL reads the table data using SQLite.\n' + JSON.stringify(saved)});
    }
    const response = await (this.options.fetch ?? globalThis.fetch)('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST', headers: {Authorization: `Bearer ${this.modelApiKey}`, 'Content-Type': 'application/json'},
      body: JSON.stringify({model: this.model, messages, ...(this.toolState.registry.length ? {tools: this.toolState.definitions, tool_choice: toolChoice, parallel_tool_calls: false} : {}),
        max_tokens: 8192,
        reasoning: {effort: this.options.reasoningEffort || environment('MULEBOT_REASONING_EFFORT') || 'medium', exclude: false}}),
      signal: this.options.signal ? AbortSignal.any([this.options.signal, AbortSignal.timeout(180000)]) : AbortSignal.timeout(180000),
    });
    if (!response.ok) throw new Error(this.redact(`Model request failed (${response.status}): ${(await response.text()).slice(0, 2000)}`));
    return await response.json();
  }

  async *run(message: string): AsyncGenerator<Event> {
    const turnStarted = performance.now();
    let start: number | undefined;
    let finished = false;
    let interruption = 'Turn interrupted before completion.';
    try {
      if (typeof message !== 'string' || !message.trim()) throw new Error('Enter a message.');
      if (message.length > 16000) throw new Error('Keep each message under 16,000 characters.');
      while (JSON.stringify(this.messages.slice(1)).length > 60000) {
        const next = this.messages.findIndex((entry, index) => index >= 2 && entry.role === 'user');
        if (next < 0) break;
        this.messages.splice(1, next - 1);
      }
      start = this.messages.length;
      this.messages.push({role: 'user', content: message});
      yield {type: 'user', content: message, started_at: Date.now() / 1000};
      let remaining = TOOL_LIMIT;
      while (true) {
        const choice = remaining > 0 ? 'auto' : 'none';
        const modelStarted = performance.now();
        yield {type: 'model_start', model: this.model, started_at: Date.now() / 1000};
        let completion: Record<string, any>;
        try { completion = await this.complete(choice); }
        catch (error) {
          yield {type: 'model_result', duration_ms: Math.round(performance.now() - modelStarted), error: true, reasoning: ''};
          yield {type: 'llm_usage', model: this.model, usage: {}};
          throw error;
        }
        let response = completion.choices?.[0]?.message ?? {};
        yield {type: 'model_result', duration_ms: Math.round(performance.now() - modelStarted), error: !!completion.error, reasoning: this.redact(reasoningText(response))};
        yield {type: 'llm_usage', id: completion.id, model: completion.model || this.model, usage: completion.usage || {}};
        if (completion.error) throw new Error(this.redact(JSON.stringify(completion.error)));
        let calls = response.tool_calls ?? [];
        if (calls.length && choice === 'none') {
          response = {content: `Reached the ${TOOL_LIMIT}-tool-call limit for this turn. Completed results are saved. Send 'continue' to resume.`}; calls = [];
        }
        const assistant: Message = {role: 'assistant', content: response.content || ''};
        if (calls.length) assistant.tool_calls = calls;
        if (response.reasoning_details) assistant.reasoning_details = response.reasoning_details;
        else if (response.reasoning) assistant.reasoning = response.reasoning;
        if (!calls.length && !assistant.content) throw new Error('The model returned no answer. Try again or choose another model.');
        this.messages.push(assistant);
        finished = !calls.length;
        if (assistant.content) yield {type: 'message', content: assistant.content};
        if (!calls.length) break;
        for (const call of calls) {
          const name = call.function.name;
          yield {type: 'tool_call', id: call.id, name, arguments: call.function.arguments,
            llm_cost: completion.usage?.cost, llm_cost_shared: calls.length > 1, reasoning: this.redact(reasoningText(response))};
          const previousResults = new Set(Object.keys(this.toolState.results));
          const firstArtifact = this.toolState.artifacts.length;
          const started = performance.now();
          let result: unknown;
          try {
            if (remaining <= 0) throw new Error('Tool budget reached. Answer using existing results.');
            remaining--;
            result = await this.toolState.call(name, JSON.parse(call.function.arguments));
            if (result === undefined) result = null;
            const serialized = JSON.stringify(result);
            if (serialized === undefined) throw new Error('Tool results must be JSON-serializable.');
            result = JSON.parse(serialized);
          } catch (error) {
            result = {error: this.redact(String(error instanceof Error ? error.message : error)).slice(0, 2000)};
            if (isObject(error) && error.metadata && isObject(result)) result.metadata = error.metadata;
          }
          this.messages.push({role: 'tool', tool_call_id: call.id, content: JSON.stringify(result)});
          yield {type: 'tool_result', id: call.id, name, result, duration_ms: Math.round(performance.now() - started)};
          for (const [id, saved] of Object.entries(this.toolState.results)) if (!previousResults.has(id)) yield {type: 'query_result', result_id: id, ...saved};
          for (let index = firstArtifact; index < this.toolState.artifacts.length; index++) yield {type: 'artifact', artifact_id: index + 1, artifact: this.toolState.artifacts[index]};
        }
      }
    } catch (error) {
      const detail = this.redact(String(error instanceof Error ? error.message : error)).slice(0, 2000);
      interruption = `Turn interrupted: ${detail}`;
      yield {type: 'error', message: detail};
    } finally {
      if (start !== undefined && !finished) {
        const pending = new Set<string>();
        for (const entry of this.messages.slice(start)) {
          for (const call of entry.tool_calls ?? []) pending.add(call.id);
          if (entry.role === 'tool') pending.delete(entry.tool_call_id!);
        }
        for (const id of pending) this.messages.push({role: 'tool', tool_call_id: id, content: JSON.stringify({error: 'Tool call interrupted; no result recorded. Check existing results before retrying.'})});
        this.messages.push({role: 'assistant', content: interruption + ' Completed tool results are retained. Resume the original request from those results if the user asks to continue.'});
      }
    }
    yield {type: 'done', elapsed_ms: Math.round(performance.now() - turnStarted)};
  }

  async *stream(message: string): AsyncGenerator<Event> {
    for await (const event of this.run(message)) {
      if (event.type === 'model_start' || event.type === 'done') yield {type: 'state', state: this.exportState()};
      yield event;
    }
  }

  async chat(message: string) {
    const response = {content: '', artifacts: [] as ChatState['artifacts']};
    for await (const event of this.run(message)) {
      if (event.type === 'message') response.content += event.content;
      else if (event.type === 'artifact') response.artifacts.push(event.artifact);
      else if (event.type === 'error') throw new Error(event.message);
    }
    return response;
  }
}
