import assert from 'node:assert/strict';
import test from 'node:test';
import {Agent, Tools} from '../dist/index.js';

function savedTools() {
  const tools = new Tools('test-key', {fetch() { throw new Error('Unexpected network request'); }});
  tools.results.query_5 = {
    sql: 'SELECT company, filingdate, rpo_b FROM simple_xbrl',
    columns: ['company', 'filingdate', 'rpo_b'],
    rows: ['Oracle', 'Microsoft', 'Alphabet'].flatMap((company, index) => [
      {company, filingdate: '2025-06-01', rpo_b: 100 + index},
      {company, filingdate: '2025-09-01', rpo_b: 400 + index},
    ]),
    local_types: {company: 'TEXT', filingdate: 'TEXT', rpo_b: 'REAL'}, metadata: {},
  };
  return tools;
}

const plot = {title: 'RPO', kind: 'line', x: 'filingdate', y: 'rpo_b'};

test('the reported malformed plot identifies its missing result and leaves state intact', async () => {
  const tools = savedTools();
  await assert.rejects(tools.call('plot', {...plot,
    sql: 'SELECT filingdate, MAX(TRY_CAST(value AS DOUBLE)) FROM simple_xbrl GROUP BY filingdate',
  }), error => {
    assert.match(error.message, /missing required field\(s\): result_id/);
    assert.match(error.message, /query_5/);
    assert.match(error.message, /filingdate, rpo_b/);
    assert.match(error.message, /SQLite SELECT FROM data/);
    return true;
  });
  assert.equal(tools.artifacts.length, 0);
  assert.deepEqual(Object.keys(tools.results), ['query_5']);
});

test('three separate plots reuse the saved result and preserve their own company rows', async () => {
  const tools = savedTools();
  for (const company of ['Oracle', 'Microsoft', 'Alphabet']) {
    const result = await tools.call('plot', {...plot, title: company, result_id: 'query_5',
      sql: `SELECT * FROM data WHERE company = '${company}' ORDER BY filingdate`,
    });
    assert.equal(result.artifact_id, tools.artifacts.length);
    assert.equal(result.row_count, 2);
    assert.deepEqual(tools.results[result.result_id].rows.map(row => row.company), [company, company]);
    assert.equal(tools.results[result.result_id].source_result_id, 'query_5');
  }
  assert.deepEqual(tools.artifacts.map(artifact => artifact.title), ['Oracle', 'Microsoft', 'Alphabet']);
  assert.ok(tools.artifacts.every(artifact => artifact.kind === 'line'));
  assert.equal(tools.results.query_5.rows.length, 6);
});

test('local SQL errors explain the saved-data boundary and can be corrected', async () => {
  const tools = savedTools();
  for (const name of ['plot', 'query']) {
    const args = name === 'plot' ? plot : {};
    await assert.rejects(tools.call(name, {...args, result_id: 'query_5', sql: 'SELECT * FROM simple_xbrl'}), error => {
      assert.match(error.message, /Local SQLite query failed/);
      assert.match(error.message, /no such table: simple_xbrl/);
      assert.match(error.message, /columns: company, filingdate, rpo_b/);
      return true;
    });
  }
  const filtered = await tools.call('query', {result_id: 'query_5', sql: "SELECT * FROM data WHERE company = 'Oracle'"});
  assert.equal(filtered.row_count, 2);
  const result = await tools.call('plot', {...plot, result_id: filtered.result_id});
  assert.equal(result.artifact_id, 1);
});

test('unknown results, wrong columns, and invalid arguments provide specific errors', async () => {
  const tools = savedTools();
  await assert.rejects(tools.call('plot', {...plot, result_id: 'query_99'}), /existing saved result_id.*query_5/);
  await assert.rejects(tools.call('plot', {...plot, result_id: 'query_5', y: 'missing'}), /Available columns: company, filingdate, rpo_b/);
  await assert.rejects(tools.call('plot', {...plot, result_id: 'query_5', extra: true}), /unknown field\(s\): extra/);
  await assert.rejects(tools.call('plot', {...plot, result_id: null}), /plot.result_id must be a string/);
  const empty = new Tools('test-key');
  await assert.rejects(empty.call('plot', plot), /No results are saved yet/);
  assert.equal(tools.artifacts.length, 0);
});

test('Markdown rejects an SVG chart fallback while retaining ordinary reports and code examples', async () => {
  const tools = savedTools();
  await assert.rejects(tools.call('write_markdown', {title: 'Chart', markdown: '# RPO\n<svg viewBox="0 0 100 100"><path/></svg>'}), /cannot render SVG charts.*plot/);
  assert.equal(tools.artifacts.length, 0);
  await tools.call('write_markdown', {title: 'Report', markdown: '# RPO\nA text report.'});
  await tools.call('write_markdown', {title: 'Example', markdown: '```html\n<svg></svg>\n```'});
  assert.equal(tools.artifacts.length, 2);
});

test('the agent passes a rejected plot error back to the model and emits corrected chart artifacts', async () => {
  const companies = ['Oracle', 'Microsoft', 'Alphabet'];
  let completions = 0;
  const agent = new Agent({apiKey: 'test-data-key', modelApiKey: 'test-model-key',
    fetch: async (url, init) => {
      assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
      const request = JSON.parse(init.body);
      const step = completions++;
      if (step === 1) {
        const rejection = JSON.parse(request.messages.find(message => message.role === 'tool').content);
        assert.match(rejection.error, /missing required field\(s\): result_id/);
        assert.match(rejection.error, /query_5/);
      }
      if (step === 4) return Response.json({choices: [{message: {content: 'Created three charts.'}}]});
      const args = step === 0 ? {...plot, sql: 'SELECT * FROM simple_xbrl'} : {
        ...plot, title: companies[step - 1], result_id: 'query_5',
        sql: `SELECT * FROM data WHERE company = '${companies[step - 1]}'`,
      };
      return Response.json({choices: [{message: {tool_calls: [{id: `call_${step}`, type: 'function',
        function: {name: 'plot', arguments: JSON.stringify(args)}}]}}]});
    },
  });
  agent.tools.results = savedTools().results;
  const events = [];
  for await (const event of agent.run('Plot each company separately.')) events.push(event);
  const outcomes = events.filter(event => event.type === 'tool_result');
  assert.equal(outcomes.length, 4);
  assert.match(outcomes[0].result.error, /result_id/);
  assert.ok(outcomes.slice(1).every(event => event.result.artifact_id));
  assert.deepEqual(events.filter(event => event.type === 'artifact').map(event => event.artifact.title), companies);
  assert.equal(events.filter(event => event.type === 'error').length, 0);
  assert.equal(completions, 5);
});
