import {TOOL_DEFINITIONS} from './config.js';
import {localRows, parseSelect, resultTypes, validateTables} from './sql.js';
import type {Artifact, Options, QueryResult, Row} from './types.js';
import {isObject} from './types.js';

const SITE = 'https://datamule.xyz';
const API = 'https://api.datamule.xyz/v3/athena/query/preview';

export class ApiError extends Error {
  constructor(message: string, public metadata: Record<string, any> = {}) { super(message); }
}

export class Tools {
  results: Record<string, QueryResult> = Object.create(null);
  artifacts: Artifact[] = [];
  private catalog?: Set<string>;
  private allowedTables: Set<string> | null;
  constructor(public apiKey: string, private options: Options = {}) {
    this.allowedTables = options.allowedTables == null ? null : new Set(options.allowedTables.map(name => name.toLowerCase()));
  }

  private async request(url: string, payload?: unknown): Promise<any> {
    const headers: Record<string, string> = {'User-Agent': 'mulebot/0.1'};
    if (payload !== undefined) { headers.Authorization = `Bearer ${this.apiKey}`; headers['Content-Type'] = 'application/json'; }
    const response = await (this.options.fetch ?? globalThis.fetch)(url, {
      method: payload === undefined ? 'GET' : 'POST', headers,
      body: payload === undefined ? undefined : JSON.stringify(payload),
      signal: this.options.signal ? AbortSignal.any([this.options.signal, AbortSignal.timeout(150000)]) : AbortSignal.timeout(150000),
    });
    const text = await response.text();
    let data: any;
    try { data = JSON.parse(text); } catch { if (response.ok) throw new Error('Datamule returned invalid JSON.'); }
    if (!response.ok) throw new ApiError(`Datamule request failed (${response.status}): ${String(data?.error ?? text).slice(0, 2000)}`, data?.metadata);
    return data;
  }

  async query({sql, result_id = ''}: {sql: string; result_id?: string}) {
    if (result_id) {
      if (!Object.hasOwn(this.results, result_id)) throw new Error('Unknown saved result_id.');
      const {columns, rows} = await localRows(this.results[result_id], sql);
      const source_result_id = result_id;
      result_id = `view_${Object.keys(this.results).length + 1}`;
      this.results[result_id] = {sql, columns, rows, source_result_id, metadata: {}};
      return {result_id, source_result_id, local: true, sql, columns, rows, row_count: rows.length, metadata: {}};
    }
    const tree = parseSelect(sql);
    if (!this.catalog) {
      const entries = await this.request(`${SITE}/static/jsons/athena_tables_catalog.json`);
      if (!Array.isArray(entries)) throw new Error('Invalid Datamule table catalog.');
      this.catalog = new Set(entries.map(entry => String(entry.table).toLowerCase()).filter(name => this.allowedTables === null || this.allowedTables.has(name)));
    }
    validateTables(tree, this.catalog);
    const payload = await this.request(API, {sql, wait_seconds: 120});
    if (!payload.success) throw new ApiError(payload.error || 'Datamule query failed.', payload.metadata);
    const {columns, rows: values} = payload.data;
    const rows: Row[] = values.map((row: unknown[]) => Object.fromEntries(columns.map((column: string, index: number) => [column, row[index]])));
    const local_types = resultTypes(tree, columns);
    result_id = `query_${Object.keys(this.results).length + 1}`;
    const result = {sql, columns, rows, local_types, metadata: payload.metadata ?? {}};
    this.results[result_id] = result;
    return {result_id, row_count: rows.length, ...result};
  }

  writeMarkdown({title, markdown}: {title: string; markdown: string}) {
    if (typeof title !== 'string' || typeof markdown !== 'string') throw new Error('Title and Markdown must be strings.');
    this.artifacts.push({kind: 'markdown', title, markdown});
    return {artifact_id: this.artifacts.length, title};
  }

  async plot({title, result_id, kind, x, y, group = '', sql = '', x_label = '', y_label = ''}: {
    title: string; result_id: string; kind: 'line' | 'bar' | 'scatter'; x: string; y: string | string[];
    group?: string; sql?: string; x_label?: string; y_label?: string;
  }) {
    if (typeof title !== 'string') throw new Error('Title must be a string.');
    if (!['line', 'bar', 'scatter'].includes(kind)) throw new Error('Choose line, bar, or scatter.');
    if (!Object.hasOwn(this.results, result_id) || !this.results[result_id].rows.length) throw new Error('Choose a non-empty query result.');
    if (group === x) group = '';
    const result = this.results[result_id];
    const {columns, rows} = sql ? await localRows(result, sql) : result;
    if (!rows.length) throw new Error('The local chart selection returned no rows. Adjust the selection using the saved data.');
    const series = typeof y === 'string' ? [y] : y;
    if (!Array.isArray(series) || !series.length || !series.every(column => typeof column === 'string')) throw new Error('y must be a column name or list of column names.');
    const seen = new Map<string, number>();
    let numeric = false;
    for (const row of rows) {
      for (const column of [x, ...series, ...(group ? [group] : [])]) if (!Object.hasOwn(row, column)) throw new Error(`Unknown column: ${column}`);
      for (const column of series) {
        if (row[column] === null || row[x] === null) continue;
        if (kind === 'scatter' && !Number.isFinite(Number(row[x]))) throw new Error('Scatter charts require finite numeric x values.');
        if (row[column] === '' || !Number.isFinite(Number(row[column]))) throw new Error('Chart values must be finite numbers or null.');
        numeric = true;
        const key = JSON.stringify([String(row[x]), group ? String(row[group]) : '', column]);
        const value = Number(row[column]);
        if (seen.has(key) && seen.get(key) !== value && kind !== 'scatter') throw new Error('Multiple values share the same x and series. Use local sql to select comparable rows or add a categorical group.');
        seen.set(key, value);
      }
    }
    if (!numeric) throw new Error('The selected chart columns contain no numeric values.');
    if (sql) {
      const source_result_id = result_id;
      result_id = `view_${Object.keys(this.results).length + 1}`;
      this.results[result_id] = {sql, columns, rows, source_result_id, metadata: {}};
    }
    this.artifacts.push({kind, title, result_id, x, y, group, x_label, y_label});
    return {artifact_id: this.artifacts.length, title, result_id, ...(sql ? {columns, rows, row_count: rows.length} : {})};
  }

  async call(name: string, arguments_: unknown): Promise<Record<string, any>> {
    const tool = TOOL_DEFINITIONS.find(tool => tool.function.name === name)?.function;
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    if (!isObject(arguments_)) throw new Error('Tool arguments must be an object.');
    const properties = tool.parameters.properties as Record<string, unknown>;
    if (Object.keys(arguments_).some(key => !Object.hasOwn(properties, key)) || tool.parameters.required.some(key => !Object.hasOwn(arguments_, key))) throw new Error('Invalid tool arguments.');
    switch (name) {
      case 'query': return this.query(arguments_ as Parameters<Tools['query']>[0]);
      case 'plot': return this.plot(arguments_ as Parameters<Tools['plot']>[0]);
      case 'write_markdown': return this.writeMarkdown(arguments_ as Parameters<Tools['writeMarkdown']>[0]);
      default: throw new Error(`Unknown tool: ${name}`);
    }
  }
}
