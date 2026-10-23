import {isObject} from './types.js';
import type {Artifact, QueryResult} from './types.js';

export interface ToolContext {
  results: Record<string, QueryResult>;
  artifacts: Artifact[];
  signal?: AbortSignal;
}

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, any>;
  execute: (arguments_: any, context: ToolContext) => unknown | Promise<unknown>;
}

export function validateTools(tools: readonly Tool[]): Tool[] {
  if (!Array.isArray(tools)) throw new Error('Tools must be an array.');
  const names = new Set<string>();
  for (const tool of tools) {
    if (!tool || typeof tool.name !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(tool.name) || typeof tool.description !== 'string' ||
        !isObject(tool.parameters) || tool.parameters.type !== 'object' ||
        !isObject(tool.parameters.properties) || typeof tool.execute !== 'function') {
      throw new Error('Each tool needs a name, description, object parameter schema, and execute function.');
    }
    if (names.has(tool.name)) throw new Error(`Duplicate tool name: ${tool.name}`);
    names.add(tool.name);
  }
  return tools.map(tool => ({...tool, parameters: structuredClone(tool.parameters)}));
}

export function toolDefinition(tool: Tool) {
  return {type: 'function', function: {name: tool.name, description: tool.description, parameters: tool.parameters}};
}

export function validateArguments(value: unknown, schema: Record<string, any>, path: string): void {
  if (schema.anyOf) {
    if (!schema.anyOf.some((option: Record<string, any>) => {
      try { validateArguments(value, option, path); return true; } catch { return false; }
    })) throw new Error(`${path} does not match any allowed type.`);
    return;
  }
  const matches: Record<string, () => boolean> = {
    string: () => typeof value === 'string',
    number: () => typeof value === 'number' && Number.isFinite(value),
    integer: () => typeof value === 'number' && Number.isInteger(value),
    boolean: () => typeof value === 'boolean',
    null: () => value === null,
    object: () => isObject(value),
    array: () => Array.isArray(value),
  };
  if (schema.type && matches[schema.type] && !matches[schema.type]()) throw new Error(`${path} must be a ${schema.type}.`);
  if (schema.enum && !schema.enum.some((entry: unknown) => JSON.stringify(entry) === JSON.stringify(value))) {
    throw new Error(`${path} must be one of: ${schema.enum.join(', ')}.`);
  }
  if (isObject(value)) {
    const properties = schema.properties ?? {};
    const missing = (schema.required ?? []).filter((key: string) => !Object.hasOwn(value, key));
    if (missing.length) throw new Error(`${path} is missing required field(s): ${missing.join(', ')}.`);
    const unexpected = Object.keys(value).filter(key => !Object.hasOwn(properties, key));
    if (schema.additionalProperties === false && unexpected.length) {
      throw new Error(`${path} has unknown field(s): ${unexpected.join(', ')}. Allowed fields: ${Object.keys(properties).join(', ')}.`);
    }
    for (const [key, entry] of Object.entries(value)) {
      const child = properties[key] ?? (isObject(schema.additionalProperties) ? schema.additionalProperties : undefined);
      if (child) validateArguments(entry, child, `${path}.${key}`);
    }
  }
  if (Array.isArray(value)) {
    if (schema.minItems != null && value.length < schema.minItems) throw new Error(`${path} needs at least ${schema.minItems} item(s).`);
    if (schema.items) value.forEach((entry, index) => validateArguments(entry, schema.items, `${path}[${index}]`));
  }
}
