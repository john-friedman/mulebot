import {TrinoSQL} from 'dt-sql-parser/dist/parser/trino/index.js';
import initSqlJs from 'sql.js/dist/sql-asm.js';
import {schemaText} from './context.js';
import type {LocalType, QueryResult, Row} from './types.js';

interface Tree {
  constructor: {name: string};
  children?: Tree[];
  parent?: Tree;
  getText(): string;
}
const children = (node: Tree) => node.children ?? [];
function all(node: Tree, name: string): Tree[] {
  return [...(node.constructor.name === name ? [node] : []), ...children(node).flatMap(child => all(child, name))];
}
const identifier = (text: string) => text.replace(/^"|"$/g, '').replace(/""/g, '"').toLowerCase();

export function parseSelect(sql: string): Tree {
  if (typeof sql !== 'string' || !sql.trim()) throw new Error('Enter a SQL SELECT query.');
  const parser = new TrinoSQL();
  const errors = parser.validate(sql);
  if (errors.length) throw new Error(`Invalid Athena SQL: ${errors[0].message}`);
  const tree = parser.parse(sql) as unknown as Tree;
  const statements = all(tree, 'SingleStatementContext');
  if (statements.length !== 1 || !children(statements[0]).some(statement =>
    children(statement).some(child => child.constructor.name === 'RootQueryContext'))) {
    throw new Error('Only one read-only SELECT query is allowed.');
  }
  if (all(tree, 'TableFunctionInvocationContext').length) throw new Error('Table functions are not allowed.');
  return tree;
}

export function validateTables(tree: Tree, allowed: Set<string>): void {
  let referenced = false;
  function visit(node: Tree, visible: Set<string>) {
    if (node.constructor.name === 'QueryStatementContext') {
      const withClause = children(node).find(child => child.constructor.name === 'WithContext');
      if (withClause) {
        visible = new Set(visible);
        const recursive = children(withClause).some(child => child.getText().toUpperCase() === 'RECURSIVE');
        for (const query of children(withClause).filter(child => child.constructor.name === 'NamedQueryContext')) {
          const name = identifier(children(query)[0].getText());
          visit(query, recursive ? new Set([...visible, name]) : visible);
          visible.add(name);
        }
        for (const child of children(node)) if (child !== withClause) visit(child, visible);
        return;
      }
    }
    if (node.constructor.name === 'TableNameContext') {
      const name = children(node)[0];
      if (children(name).length !== 1) throw new Error('Use unqualified Datamule table names.');
      const table = identifier(name.getText());
      if (!visible.has(table)) {
        if (!allowed.has(table)) throw new Error(`Table is not available: ${table}`);
        referenced = true;
      }
    }
    for (const child of children(node)) visit(child, visible);
  }
  visit(tree, new Set());
  if (!referenced) throw new Error('Query must reference an available Datamule table.');
}

function localType(type: string): LocalType {
  type = type.toLowerCase();
  if (/^(tinyint|smallint|int|integer|bigint|boolean)$/.test(type)) return 'INTEGER';
  if (/^(float|double|real)$/.test(type)) return 'REAL';
  if (/^(decimal|numeric)/.test(type)) return 'NUMERIC';
  return type === 'date' ? 'DATE' : 'TEXT';
}

export function resultTypes(tree: Tree, columns: string[]): Record<string, LocalType> {
  const schema: Record<string, Record<string, LocalType>> = Object.create(null);
  let table = '';
  for (const line of schemaText.split('\n')) {
    if (line.startsWith('### ')) { table = line.slice(4).trim().toLowerCase(); schema[table] = {}; }
    else if (table && line.startsWith('| `')) {
      const [, column, type] = line.split('|');
      schema[table][column.trim().replaceAll('`', '')] = localType(type.trim().replaceAll('`', ''));
    }
  }
  const tables = all(tree, 'TableNameContext').map(node => identifier(children(node)[0].getText()));
  const inferred: Record<string, LocalType> = Object.create(null);
  function infer(node: Tree): LocalType | undefined {
    const text = node.getText();
    const cast = all(node, 'CastContext')[0];
    if (cast) {
      const type = children(cast).find(child => /TypeContext$/.test(child.constructor.name));
      if (type) return localType(type.getText());
    }
    if (/^COUNT\(/i.test(text) || /^EXTRACT\(/i.test(text) || /^YEAR\(/i.test(text)) return 'INTEGER';
    const reference = all(node, 'ColumnRefContext')[0] ?? all(node, 'ColumnReferenceContext')[0];
    if (reference) {
      const column = identifier(reference.getText().split('.').at(-1)!);
      if (inferred[column]) return inferred[column];
      const types = [...new Set(tables.flatMap(name => schema[name]?.[column] ? [schema[name][column]] : []))];
      if (types.length === 1) return /^AVG\(/i.test(text) ? 'REAL' : types[0];
    }
    return undefined;
  }
  const items = all(tree, 'SelectItemContext');
  for (let pass = 0; pass < 2; pass++) for (const item of items) {
    const alias = children(item).find(child => /IdentifierContext$/.test(child.constructor.name));
    const type = infer(item);
    if (alias && type) inferred[identifier(alias.getText())] = type;
  }
  const specs: {node: Tree; depth: number}[] = [];
  function visit(node: Tree, depth = 0) {
    if (node.constructor.name === 'QuerySpecificationContext') specs.push({node, depth});
    for (const child of children(node)) visit(child, depth + 1);
  }
  visit(tree);
  const outer = specs.sort((a, b) => a.depth - b.depth)[0]?.node;
  const list = outer && children(outer).find(child => child.constructor.name === 'SelectListContext');
  const selected = list ? children(list).filter(child => child.constructor.name === 'SelectItemContext') : [];
  const types: Record<string, LocalType> = {};
  columns.forEach((column, index) => {
    const type = selected.length === columns.length ? infer(selected[index]) : inferred[column];
    if (type) types[column] = type;
  });
  return types;
}

let sqlite: ReturnType<typeof initSqlJs> | undefined;
const quote = (value: string) => '"' + value.replaceAll('"', '""') + '"';

export async function localRows(result: QueryResult, sql: string): Promise<{columns: string[]; rows: Row[]}> {
  if (typeof sql !== 'string' || !/^\s*(?:SELECT|WITH)\b/i.test(sql.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, ' '))) {
    throw new Error('Local SQL must be one read-only SQLite SELECT FROM data over the saved result. Athena tables are not available; use the saved column names.');
  }
  const SQL = await (sqlite ??= initSqlJs());
  const database = new SQL.Database();
  try {
    const columns = result.columns;
    const types = columns.map(column => {
      const values = result.rows.map(row => row[column]).filter(value => value !== null && value !== undefined);
      if (values.some(value => typeof value === 'string' && /^[+-]?\d+$/.test(value) &&
        (BigInt(value) < -(2n ** 63n) || BigInt(value) >= 2n ** 63n))) return 'TEXT';
      const type = result.local_types?.[column];
      return (type === 'DATE' ? 'TEXT' : type) || (values.length && values.every(value => typeof value === 'number') ? 'NUMERIC' : 'TEXT');
    });
    database.run(`CREATE TABLE data (${columns.map((column, i) => `${quote(column)} ${types[i]}`).join(', ')})`);
    const insert = database.prepare(`INSERT INTO data VALUES (${columns.map(() => '?').join(',')})`);
    try {
      for (const row of result.rows) insert.run(columns.map(column => {
        const value = row[column];
        if (value === null || value === undefined) return null;
        if (result.local_types?.[column] === 'DATE' && typeof value === 'string') return value.slice(0, 10);
        if (typeof value === 'object') return JSON.stringify(value);
        return typeof value === 'boolean' ? Number(value) : value as string | number;
      }));
    } finally { insert.free(); }
    database.run('PRAGMA query_only = ON');
    // SQLite validates syntax and query_only prevents writes, including WITH ... DELETE.
    const statements = database.iterateStatements(sql);
    const first = statements.next();
    if (first.done) throw new Error('Enter a local SELECT query.');
    const statement = first.value;
    try {
      const plan = database.exec('EXPLAIN ' + statement.getSQL())[0]?.values ?? [];
      const reads = plan.filter(row => row[1] === 'OpenRead');
      // This fresh database has one table: data, at root page 2 in main (database 0).
      if (!reads.length || reads.some(row => row[3] !== 2 || row[4] !== 0) ||
          plan.some(row => row[1] === 'OpenWrite' || row[1] === 'VUpdate')) {
        throw new Error('Local SQL can only read the saved table data.');
      }
      const names = statement.getColumnNames();
      const rows: Row[] = [];
      while (statement.step()) {
        const row = (statement.getAsObject as (params: undefined, options: {useBigInt: boolean}) => Row)(undefined, {useBigInt: true});
        rows.push(Object.fromEntries(Object.entries(row).map(([name, value]) => [name,
          typeof value === 'bigint' ? value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER) ? String(value) : Number(value) : value])));
      }
      if (!statements.next().done) throw new Error('Only one local SELECT query is allowed.');
      return {columns: names, rows};
    } finally { statement.free(); }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Local SQLite query failed: ${detail} Only the saved table data is available (columns: ${result.columns.join(', ')}). Use SQLite syntax; Athena tables, TRY_CAST, and CARDINALITY are not available here.`);
  } finally { database.close(); }
}
