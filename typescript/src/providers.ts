import {environment} from './types.js';
import {DEFAULT_MODEL} from './config.js';
import type {Message, Provider} from './types.js';

export const DEFAULT_MODELS: Record<Provider, string> = {
  openrouter: DEFAULT_MODEL,
  openai: 'gpt-5.4-mini',
  gemini: 'gemini-3.8-flash',
  anthropic: 'claude-sonnet-5-5',
};
const KEY_VARIABLES: Record<Provider, string> = {
  openrouter: 'OPENROUTER_API_KEY', openai: 'OPENAI_API_KEY',
  gemini: 'GEMINI_API_KEY', anthropic: 'ANTHROPIC_API_KEY',
};

export function validateProvider(provider: unknown): asserts provider is Provider {
  if (typeof provider !== 'string' || !Object.hasOwn(DEFAULT_MODELS, provider)) {
    throw new Error(`Choose a provider: ${Object.keys(DEFAULT_MODELS).join(', ')}.`);
  }
}

export function resolveModel(provider: Provider, model?: string): string {
  validateProvider(provider);
  const value = model ?? (environment('MULEBOT_MODEL') || DEFAULT_MODELS[provider]);
  if (typeof value !== 'string' || !value.trim() || value.length > 200 || /\s/.test(value.trim())) {
    throw new Error('Enter a model ID of at most 200 characters.');
  }
  return value.trim();
}

export function credentials(provider: Provider): string {
  validateProvider(provider);
  const missing = ['DATAMULE_API_KEY', KEY_VARIABLES[provider]].filter(name => !environment(name)?.trim());
  if (missing.length) throw new Error(`Set ${missing.join(' and ')}.`);
  return environment(KEY_VARIABLES[provider])!;
}

// Keep provider-specific fields out of requests to other providers.
export function buildRequest(provider: Provider, model: string, key: string, messages: Message[],
  tools: Record<string, any>[], toolChoice: 'auto' | 'none', reasoningEffort?: string) {
  const headers: Record<string, string> = {'Content-Type': 'application/json'};
  if (provider === 'openrouter' || provider === 'openai') {
    const history = messages.map(message => Object.fromEntries(Object.entries(message).filter(([name]) =>
      ['role', 'content', 'tool_calls', 'tool_call_id', ...(provider === 'openrouter' ? ['reasoning', 'reasoning_details'] : [])].includes(name))));
    const payload: Record<string, any> = {model, messages: history};
    if (tools.length) Object.assign(payload, {tools, tool_choice: toolChoice, parallel_tool_calls: false});
    let url: string;
    if (provider === 'openrouter') {
      Object.assign(payload, {max_tokens: 8192, reasoning: {effort: reasoningEffort || 'medium', exclude: false}});
      url = 'https://openrouter.ai/api/v1/chat/completions';
    } else {
      payload.max_completion_tokens = 8192;
      if (reasoningEffort) payload.reasoning_effort = reasoningEffort;
      url = 'https://api.openai.com/v1/chat/completions';
    }
    headers.Authorization = `Bearer ${key}`;
    return {url, headers, payload};
  }

  const system = messages.filter(message => message.role === 'system').map(message => message.content).join('\n\n');
  const history: Record<string, any>[] = [];
  const calls = new Map<string, NonNullable<Message['tool_calls']>[number]>();
  for (const message of messages) {
    const role = message.role;
    if (role === 'system') continue;
    for (const call of message.tool_calls ?? []) calls.set(call.id, call);
    const native = role === 'assistant' && message.provider_data?.provider === provider ? message.provider_data.content : undefined;
    let targetRole: string;
    let content: Record<string, any>[];
    if (provider === 'anthropic') {
      targetRole = role === 'assistant' ? 'assistant' : 'user';
      if (role === 'tool') content = [{type: 'tool_result', tool_use_id: message.tool_call_id, content: message.content}];
      else if (native) content = native;
      else content = [
        ...(message.content ? [{type: 'text', text: message.content}] : []),
        ...(message.tool_calls ?? []).map(call => ({type: 'tool_use', id: call.id, name: call.function.name, input: JSON.parse(call.function.arguments)})),
      ];
    } else {
      targetRole = role === 'assistant' ? 'model' : 'user';
      if (role === 'tool') {
        const call = calls.get(message.tool_call_id!)!;
        const value = JSON.parse(message.content);
        const result: Record<string, any> = {name: call.function.name,
          response: value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {result: value}};
        if (!call.id.startsWith('mulebot_')) result.id = call.id;
        content = [{functionResponse: result}];
      } else if (native) content = native;
      else content = [
        ...(message.content ? [{text: message.content}] : []),
        ...(message.tool_calls ?? []).map(call => ({functionCall: {name: call.function.name, args: JSON.parse(call.function.arguments)}})),
      ];
    }
    const field = provider === 'anthropic' ? 'content' : 'parts';
    if (content.length) {
      if (history.at(-1)?.role === targetRole) history.at(-1)![field].push(...content);
      else history.push({role: targetRole, [field]: [...content]});
    }
  }

  if (provider === 'anthropic') {
    Object.assign(headers, {'x-api-key': key, 'anthropic-version': '2023-06-01'});
    const payload: Record<string, any> = {model, system, messages: history, max_tokens: 8192};
    if (tools.length) {
      payload.tools = tools.map(tool => ({name: tool.function.name, description: tool.function.description, input_schema: tool.function.parameters}));
      payload.tool_choice = {type: toolChoice, ...(toolChoice === 'auto' ? {disable_parallel_tool_use: true} : {})};
    }
    return {url: 'https://api.anthropic.com/v1/messages', headers, payload};
  }

  headers['x-goog-api-key'] = key;
  const payload: Record<string, any> = {systemInstruction: {parts: [{text: system}]}, contents: history,
    generationConfig: {maxOutputTokens: 8192}};
  if (tools.length) {
    payload.tools = [{functionDeclarations: tools.map(tool => ({name: tool.function.name,
      description: tool.function.description, parametersJsonSchema: tool.function.parameters}))}];
    payload.toolConfig = {functionCallingConfig: {mode: toolChoice.toUpperCase()}};
  }
  return {url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, headers, payload};
}

export function normalizeResponse(provider: Provider, response: Record<string, any>): Record<string, any> {
  if (provider === 'openrouter' || provider === 'openai' || response.error) return response;
  const calls: NonNullable<Message['tool_calls']> = [], text: string[] = [], reasoning: string[] = [];
  let content: Record<string, any>[], usage: Record<string, any>, model: string | undefined, id: string | undefined;
  if (provider === 'anthropic') {
    content = response.content ?? [];
    for (const block of content) {
      if (block.type === 'text') text.push(block.text);
      else if (block.type === 'thinking') reasoning.push(block.thinking);
      else if (block.type === 'tool_use') calls.push({id: block.id, type: 'function', function: {name: block.name, arguments: JSON.stringify(block.input)}});
    }
    usage = {...response.usage};
    usage.prompt_tokens = (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
    usage.completion_tokens = usage.output_tokens ?? 0;
    model = response.model; id = response.id;
  } else {
    content = response.candidates?.[0]?.content?.parts ?? [];
    for (const part of content) {
      if ('text' in part) (part.thought ? reasoning : text).push(part.text);
      if (part.functionCall) calls.push({id: part.functionCall.id || `mulebot_${globalThis.crypto.randomUUID()}`, type: 'function',
        function: {name: part.functionCall.name, arguments: JSON.stringify(part.functionCall.args ?? {})}});
    }
    usage = {...response.usageMetadata};
    usage.prompt_tokens = usage.promptTokenCount ?? 0;
    usage.completion_tokens = (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0);
    model = response.modelVersion; id = response.responseId;
  }
  usage.total_tokens = usage.prompt_tokens + usage.completion_tokens;
  return {id, model, usage, choices: [{message: {content: text.join('\n\n'), tool_calls: calls, reasoning: reasoning.join('\n\n'),
    provider_data: {provider, content}}}]};
}
