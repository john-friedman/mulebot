export type Row = Record<string, unknown>;
export type LocalType = 'INTEGER' | 'REAL' | 'NUMERIC' | 'TEXT' | 'DATE';
export interface QueryResult {
  sql: string;
  columns: string[];
  rows: Row[];
  local_types?: Record<string, LocalType>;
  source_result_id?: string;
  metadata: Record<string, any>;
}
export interface Artifact {
  kind: 'markdown' | 'line' | 'bar' | 'scatter';
  title: string;
  markdown?: string;
  result_id?: string;
  x?: string;
  y?: string | string[];
  group?: string;
  x_label?: string;
  y_label?: string;
}
export interface ToolCall {
  id: string;
  type?: string;
  function: {name: string; arguments: string};
}
export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
  reasoning?: string;
  reasoning_details?: Record<string, any>[];
  provider_data?: {provider: 'gemini' | 'anthropic'; content: Record<string, any>[]};
}
export interface ChatState {
  messages: Message[];
  results: Record<string, QueryResult>;
  artifacts: Artifact[];
}
export interface Event {
  type: string;
  [key: string]: any;
}
export type Provider = 'openrouter' | 'openai' | 'gemini' | 'anthropic';
export interface ToolOptions {
  allowedTables?: string[] | null;
  fetch?: typeof globalThis.fetch;
  signal?: AbortSignal;
}
export interface Options extends ToolOptions {
  provider: Provider;
  model?: string;
  reasoningEffort?: string;
}

export const isObject = (value: unknown): value is Record<string, any> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export function environment(name: string): string | undefined {
  return (globalThis as {process?: {env?: Record<string, string | undefined>}}).process?.env?.[name];
}
