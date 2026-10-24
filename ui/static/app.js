'use strict';

const messages = document.getElementById('messages');
const artifacts = document.getElementById('artifacts');
const artifactPanel = document.getElementById('artifact-panel');
const artifactTitle = document.getElementById('artifact-title');
const closeArtifactButton = document.getElementById('close-artifact');
const layout = document.querySelector('main');
const artifactItems = new Map();
let activeArtifactButton = null;
const status = document.getElementById('status');
const prompt = document.getElementById('prompt');
const send = document.getElementById('send');
const reset = document.getElementById('reset');
const model = document.getElementById('model');
const customModelForm = document.getElementById('custom-model-form');
const customModel = document.getElementById('custom-model');
const useCustomModel = document.getElementById('use-custom-model');
const cancelCustomModel = document.getElementById('cancel-custom-model');
const CUSTOM_MODEL = '__custom__';
const settingsStatus = document.getElementById('settings-status');
const chatHistory = [];
const queryResults = new Map();
const toolCalls = new Map();
const runningTools = new Set();
let busy = false;
let selectedModel = '';
let selectedProvider = '';
let agentState = null;
const CHAT_STORAGE = 'mulebot.chat';
let currentTools = null;
let toolsTimer = null;
let currentThinking = null;
let currentArtifactLinks = [];
function amount(value) {
  if (value === undefined || value === null || value === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function charge(metadata) {
  return amount(metadata?.billing?.total_charge);
}

function money(amount) {
  return new Intl.NumberFormat('en-US', {style: 'currency', currency: 'USD', minimumFractionDigits: 3, maximumFractionDigits: 8}).format(amount);
}

function costLabel(value) {
  const cost = amount(value);
  return cost === null ? 'Unavailable' : money(cost);
}

function debugHistory() {
  return JSON.stringify({selected_model: selectedModel, events: chatHistory}, null, 2);
}

function saveChat() {
  try {
    sessionStorage.setItem(CHAT_STORAGE, JSON.stringify({provider: selectedProvider, model: selectedModel, state: agentState, events: chatHistory}));
  } catch {
    settingsStatus.textContent = 'Chat is available in this tab but could not be saved for refresh.';
  }
}

function historyIcon(label, path) {
  const button = node('button', undefined, 'tool-history-button');
  button.type = 'button'; button.title = label; button.setAttribute('aria-label', label);
  const icon = svgNode('svg', {viewBox: '0 0 24 24', 'aria-hidden': 'true', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round'});
  icon.append(svgNode('path', {d: path})); button.append(icon);
  return button;
}

function historyActions() {
  const actions = node('span', undefined, 'tool-history-actions');
  const feedback = node('span', '', 'tool-history-status'); feedback.setAttribute('role', 'status');
  const copy = historyIcon('Copy chat history', 'M9 9h11v12H9z M15 9V3H3v12h6');
  const save = historyIcon('Download chat history', 'M12 3v12 m-5-5 5 5 5-5 M4 17v4h16v-4');
  copy.addEventListener('click', async event => {
    event.preventDefault(); event.stopPropagation();
    try { await navigator.clipboard.writeText(debugHistory()); feedback.textContent = 'Copied'; }
    catch { feedback.textContent = 'Copy failed; use download.'; }
  });
  save.addEventListener('click', event => {
    event.preventDefault(); event.stopPropagation();
    const url = URL.createObjectURL(new Blob([debugHistory()], {type: 'application/json'}));
    const anchor = node('a'); anchor.href = url; anchor.download = 'mulebot-history.json'; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    feedback.textContent = 'Downloaded';
  });
  actions.append(feedback, copy, save);
  return actions;
}

function toolGroup() {
  if (!currentTools) {
    const element = node('details', undefined, 'tools');
    const summary = node('summary');
    const label = node('span', 'Activity');
    summary.append(label, historyActions());
    const list = node('div', undefined, 'tool-list');
    element.append(summary, list); messages.append(element);
    currentTools = {summary: label, list, count: 0, thinkingCount: 0, startedAt: Date.now(), elapsedMs: null,
      costs: {llm: {total: 0, known: 0, unknown: 0}, datamule: {total: 0, known: 0, unknown: 0}}};
  }
  return currentTools;
}

function summarizeTools(group) {
  const elapsed = Math.max(0, group.elapsedMs ?? Date.now() - group.startedAt);
  const {llm, datamule} = group.costs;
  const label = cost => !cost.known && cost.unknown ? 'Unavailable' : money(cost.total);
  const total = label({total: llm.total + datamule.total, known: llm.known + datamule.known, unknown: llm.unknown + datamule.unknown});
  group.summary.textContent = `Activity \u00b7 ${group.thinkingCount} thinking ${group.thinkingCount === 1 ? 'step' : 'steps'} \u00b7 ${group.count} tool ${group.count === 1 ? 'call' : 'calls'} \u00b7 LLM: ${label(llm)} \u00b7 Datamule: ${label(datamule)} \u00b7 Total: ${total} \u00b7 ${(elapsed / 1000).toFixed(1)}s`;
}

function recordToolCost(provider, value) {
  const group = toolGroup();
  const cost = group.costs[provider];
  if (value === null) cost.unknown++;
  else { cost.total += value; cost.known++; }
  summarizeTools(group);
}

function summarizeRunningTool(call, interrupted = false) {
  const elapsed = Math.max(0, Date.now() - call.startedAt);
  call.details.querySelector('summary').textContent = `${call.name}: ${interrupted ? 'interrupted' : 'running'} \u00b7 ${elapsed}ms`;
}

function summarizeThinking(state = 'running', elapsedMs) {
  if (!currentThinking) return;
  const elapsed = Math.max(0, elapsedMs ?? Date.now() - currentThinking.startedAt);
  currentThinking.summary.textContent = `Model thinking: ${state} \u00b7 ${(elapsed / 1000).toFixed(1)}s`;
}

function finishTools(elapsedMs) {
  clearInterval(toolsTimer); toolsTimer = null;
  summarizeThinking('interrupted'); currentThinking = null;
  for (const call of runningTools) summarizeRunningTool(call, true);
  runningTools.clear();
  if (currentTools) {
    currentTools.elapsedMs = Number.isFinite(elapsedMs) ? elapsedMs : currentTools.elapsedMs ?? Date.now() - currentTools.startedAt;
    summarizeTools(currentTools);
  }
}

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}

// A small Markdown renderer: text is always inserted through textContent.
function inline(element, text) {
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g;
  let start = 0;
  for (const match of text.matchAll(pattern)) {
    element.append(document.createTextNode(text.slice(start, match.index)));
    const token = match[0];
    if (token.startsWith('`')) element.append(node('code', token.slice(1, -1)));
    else if (token.startsWith('**')) element.append(node('strong', token.slice(2, -2)));
    else {
      const link = token.match(/^\[([^\]]+)\]\((.+)\)$/);
      const anchor = node('a', link[1]);
      anchor.href = link[2]; anchor.target = '_blank'; anchor.rel = 'noopener noreferrer';
      element.append(anchor);
    }
    start = match.index + token.length;
  }
  element.append(document.createTextNode(text.slice(start)));
}

function markdown(text) {
  const container = node('div');
  let code = null;
  let list = null;
  let table = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('```')) {
      if (code) code = null;
      else { const pre = node('pre'); code = node('code', ''); pre.append(code); container.append(pre); }
      list = null; table = null;
    } else if (code) code.textContent += line + '\n';
    else if (/^\s*\|.*\|\s*$/.test(line)) {
      if (/^\s*\|[\s:|-]+\|\s*$/.test(line)) continue;
      if (!table) { table = node('table'); const wrap = node('div', undefined, 'table-wrap'); wrap.append(table); container.append(wrap); }
      const row = node('tr');
      for (const cell of line.trim().slice(1, -1).split('|')) { const td = node('td'); inline(td, cell.trim()); row.append(td); }
      table.append(row); list = null;
    } else {
      table = null;
      const heading = line.match(/^(#{1,6})\s+(.+)/);
      const item = line.match(/^\s*(?:[-*]|\d+\.)\s+(.+)/);
      if (item) {
        if (!list) { list = node('ul'); container.append(list); }
        const li = node('li'); inline(li, item[1]); list.append(li);
      } else {
        list = null;
        if (line.trim()) { const block = node(heading ? `h${heading[1].length}` : 'p'); inline(block, heading ? heading[2] : line); container.append(block); }
      }
    }
  }
  return container;
}

function message(role, text) {
  document.getElementById('welcome')?.remove();
  const card = node('div', undefined, `message ${role}`);
  card.append(node('strong', role === 'user' ? 'You' : role === 'error' ? 'Error' : 'Mulebot'));
  card.append(markdown(text)); messages.append(card);
  if (role !== 'user') for (const button of currentArtifactLinks) messages.append(button);
}

async function chartImage(text) {
  const svg = new DOMParser().parseFromString(text, 'image/svg+xml').documentElement;
  const [, , width, height] = svg.getAttribute('viewBox').split(/\s+/).map(Number);
  svg.setAttribute('width', width); svg.setAttribute('height', height);
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], {type: 'image/svg+xml'}));
  try {
    const image = new Image(); image.src = url; await image.decode();
    const canvas = node('canvas'); canvas.width = Math.ceil(width * 2); canvas.height = Math.ceil(height * 2);
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not copy chart.')), 'image/png'));
  } finally { URL.revokeObjectURL(url); }
}

function artifactActions(parent, text, filename, type) {
  const actions = node('div', undefined, 'artifact-actions');
  const feedback = node('span', '', 'tool-history-status'); feedback.setAttribute('role', 'status');
  const copy = historyIcon(type === 'image/svg+xml' ? 'Copy chart image' : 'Copy Markdown', 'M9 9h11v12H9z M15 9V3H3v12h6');
  const save = historyIcon('Download artifact', 'M12 3v12 m-5-5 5 5 5-5 M4 17v4h16v-4');
  copy.addEventListener('click', async () => {
    try {
      if (type === 'image/svg+xml') await navigator.clipboard.write([new ClipboardItem({'image/png': chartImage(text)})]);
      else await navigator.clipboard.writeText(text);
      feedback.textContent = 'Copied';
    } catch { feedback.textContent = 'Copy failed; use download.'; }
  });
  save.addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([text], {type}));
    const anchor = node('a'); anchor.href = url; anchor.download = filename; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    feedback.textContent = 'Downloaded';
  });
  actions.append(copy, save, feedback); parent.append(actions);
}

function svgNode(tag, attributes = {}, text) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  if (text !== undefined) element.textContent = text;
  return element;
}

function chart(artifact) {
  const rows = (queryResults.get(artifact.result_id)?.rows || []).filter(row => row[artifact.x] !== null && row[artifact.x] !== undefined);
  const columns = Array.isArray(artifact.y) ? artifact.y : [artifact.y];
  const human = value => String(value).replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
  const numeric = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
  const dates = rows.length && rows.every(row => /^\d{4}-\d{2}-\d{2}(?:[T ].*)?$/.test(String(row[artifact.x])) && Number.isFinite(Date.parse(row[artifact.x])));
  const numbers = rows.length && rows.every(row => numeric(row[artifact.x]));
  const continuous = artifact.kind === 'scatter' || artifact.kind === 'line' && (dates || numbers);
  if (artifact.kind === 'scatter' && !numbers) return node('p', 'Scatter charts require numeric x values.');
  const xNumber = value => dates ? Date.parse(value) : Number(value);
  const labels = [...new Set(rows.map(row => String(row[artifact.x])))];
  if (dates || numbers) labels.sort((a, b) => xNumber(a) - xNumber(b));
  const series = [];
  const categories = artifact.group ? [...new Set(rows.map(row => String(row[artifact.group])))] : [''];
  for (const category of categories) for (const column of columns) {
    const values = new Map();
    const points = [];
    for (const row of rows) {
      if (artifact.group && String(row[artifact.group]) !== category) continue;
      values.set(String(row[artifact.x]), numeric(row[column]) ? Number(row[column]) : null);
      if (numeric(row[column])) points.push([String(row[artifact.x]), Number(row[column])]);
    }
    if ([...values.values()].some(value => value !== null)) {
      series.push({label: [category, columns.length > 1 || !category ? human(column) : ''].filter(Boolean).join(' · '), values, points});
    }
  }
  const values = series.flatMap(entry => [...entry.values.values()].filter(value => value !== null));
  if (!values.length) return node('p', 'No numeric chart data.');
  const colors = ['#2563eb', '#d97706', '#059669', '#9333ea', '#dc2626', '#0891b2'];
  const width = Math.max(300, Math.min(800, artifacts.clientWidth - 36 || 640));
  const titleContext = node('canvas').getContext('2d');
  titleContext.font = '600 16px system-ui, sans-serif';
  const titleLines = [''];
  for (const word of artifact.title.split(/\s+/)) {
    const last = titleLines.length - 1;
    const line = titleLines[last] ? `${titleLines[last]} ${word}` : word;
    if (titleContext.measureText(line).width <= width - 32) titleLines[last] = line;
    else {
      if (titleLines[last]) titleLines.push('');
      for (const character of word) {
        const index = titleLines.length - 1;
        if (titleContext.measureText(titleLines[index] + character).width > width - 32) titleLines.push(character);
        else titleLines[index] += character;
      }
    }
  }
  const titleHeight = titleLines.length * 22 + 12;
  const legendColumns = width < 460 ? 1 : 2;
  const legendRows = Math.ceil(series.length / legendColumns);
  const height = 340 + legendRows * 24 + titleHeight;
  const left = 78, right = 18, top = 20 + titleHeight, bottom = 64 + legendRows * 24;
  const plotWidth = width - left - right, plotHeight = height - top - bottom;
  const minimum = Math.min(0, ...values), maximum = Math.max(0, ...values);
  const roughStep = (maximum - minimum || 1) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const step = [1, 2, 5, 10].find(value => value * magnitude >= roughStep) * magnitude;
  const low = Math.floor(minimum / step) * step;
  const high = maximum === minimum ? low + step : Math.ceil(maximum / step) * step;
  const minX = continuous ? xNumber(labels[0]) : 0;
  const maxX = continuous ? xNumber(labels.at(-1)) : labels.length - 1;
  const px = label => continuous
    ? left + (maxX === minX ? .5 : (xNumber(label) - minX) / (maxX - minX)) * plotWidth
    : left + (labels.indexOf(label) + .5) / labels.length * plotWidth;
  const py = value => top + (high - value) / (high - low) * plotHeight;
  const xLabel = artifact.x_label || human(artifact.x);
  const yLabel = artifact.y_label || (columns.length === 1 ? human(columns[0]) : 'Value');
  const fullNumber = value => new Intl.NumberFormat('en-US', {maximumFractionDigits: 6}).format(value);
  const tickNumber = value => new Intl.NumberFormat('en-US', {
    notation: Math.abs(value) >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 3,
  }).format(value);
  const svg = svgNode('svg', {viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': artifact.title, 'font-family': 'system-ui, sans-serif'});
  svg.append(svgNode('rect', {width, height, fill: '#fff'}));
  svg.append(svgNode('title', {}, artifact.title));
  titleLines.forEach((line, index) => svg.append(svgNode('text', {
    x: width / 2, y: 26 + index * 22, 'text-anchor': 'middle', 'font-size': 16,
    'font-weight': 600, fill: '#1d2935',
  }, line)));
  for (let value = low; value <= high + step / 100; value += step) {
    const y = py(value);
    svg.append(svgNode('line', {x1: left, x2: width - right, y1: y, y2: y, stroke: '#e0e5e9'}));
    svg.append(svgNode('text', {x: left - 9, y: y + 4, 'text-anchor': 'end', 'font-size': 12, fill: '#687683'}, tickNumber(value)));
  }
  const tickCount = Math.max(2, Math.min(6, Math.floor(plotWidth / 85)));
  const proposedTicks = artifact.kind === 'scatter'
    ? Array.from({length: tickCount}, (_, i) => minX + (maxX - minX) * i / (tickCount - 1))
    : [...new Set(Array.from({length: Math.min(tickCount, labels.length)}, (_, i, all) => labels[Math.round(i * (labels.length - 1) / (Math.min(tickCount, labels.length) - 1 || 1))]))];
  const candidates = [...new Set(proposedTicks)];
  const ticks = candidates.filter((tick, index) => {
    if (!continuous || index === 0 || index === candidates.length - 1) return true;
    const position = px(String(tick));
    return position - px(String(candidates[index - 1])) >= 85 && px(String(candidates.at(-1))) - position >= 85;
  });
  const yearly = dates && new Set(labels.map(label => label.slice(5))).size === 1;
  for (const tick of ticks) {
    let text = dates ? yearly ? String(tick).slice(0, 4) : new Intl.DateTimeFormat('en-US', {month: 'short', year: 'numeric', timeZone: 'UTC'}).format(new Date(tick)) : String(tick);
    if (text.length > 20) text = text.slice(0, 17) + '…';
    const tickX = px(String(tick));
    const anchor = tickX <= left + 1 ? 'start' : tickX >= width - right - 1 ? 'end' : 'middle';
    const label = svgNode('text', {x: tickX, y: top + plotHeight + 23, 'text-anchor': anchor, 'font-size': 12, fill: '#687683'}, text);
    label.append(svgNode('title', {}, String(tick))); svg.append(label);
  }
  svg.append(svgNode('text', {x: left + plotWidth / 2, y: top + plotHeight + 48, 'text-anchor': 'middle', 'font-size': 13, fill: '#334155'}, xLabel));
  svg.append(svgNode('text', {transform: `translate(16 ${top + plotHeight / 2}) rotate(-90)`, 'text-anchor': 'middle', 'font-size': 13, fill: '#334155'}, yLabel));
  series.forEach((entry, index) => {
    const color = colors[index % colors.length];
    let path = '', connected = false;
    const points = artifact.kind === 'scatter' ? entry.points : labels.map(label => [label, entry.values.get(label)]);
    for (const [label, value] of points) {
      if (value === null || value === undefined) { connected = false; continue; }
      const x = px(label), y = py(value);
      if (artifact.kind === 'line') { path += `${connected ? 'L' : 'M'}${x},${y}`; connected = true; }
      let mark;
      if (artifact.kind === 'bar') {
        const barWidth = plotWidth / labels.length / series.length * .8;
        mark = svgNode('rect', {x: x - plotWidth / labels.length * .4 + index * barWidth,
          y: Math.min(y, py(0)), width: barWidth, height: Math.abs(y - py(0)), fill: color, rx: 2});
      } else mark = svgNode('circle', {cx: x, cy: y, r: 3.5, fill: color});
      mark.append(svgNode('title', {}, `${entry.label}\n${xLabel}: ${label}\n${yLabel}: ${fullNumber(value)}`));
      svg.append(mark);
    }
    if (artifact.kind === 'line') svg.append(svgNode('path', {d: path, fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linejoin': 'round'}));
    const legendX = left + index % legendColumns * plotWidth / legendColumns;
    const legendY = height - legendRows * 24 + Math.floor(index / legendColumns) * 24 + 8;
    svg.append(svgNode('line', {x1: legendX, x2: legendX + 16, y1: legendY - 4, y2: legendY - 4, stroke: color, 'stroke-width': 3}));
    const maximumLabel = Math.max(12, Math.floor((plotWidth / legendColumns - 30) / 7));
    const text = entry.label.length > maximumLabel ? entry.label.slice(0, maximumLabel - 1) + '…' : entry.label;
    const legend = svgNode('text', {x: legendX + 23, y: legendY, 'font-size': 12, fill: '#334155'}, text);
    legend.append(svgNode('title', {}, entry.label)); svg.append(legend);
  });
  const container = node('div'); container.append(svg);
  artifactActions(container, new XMLSerializer().serializeToString(svg), 'chart.svg', 'image/svg+xml');
  return container;
}


function openArtifact(id) {
  const item = artifactItems.get(id);
  if (!item) return;
  const {artifact, button} = item;
  artifactPanel.hidden = false;
  layout.classList.add('artifact-open');
  const card = node('section', undefined, 'artifact');
  if (artifact.kind === 'markdown') {
    card.append(markdown(artifact.markdown));
    artifactActions(card, artifact.markdown, `report-${id}.md`, 'text/markdown');
  } else card.append(chart(artifact));
  artifacts.replaceChildren(card);
  artifactTitle.textContent = artifact.title;
  for (const item of artifactItems.values()) item.button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-expanded', 'true');
  activeArtifactButton = button;
  closeArtifactButton.focus({preventScroll: true});
}

function closeArtifact(focus = true) {
  artifactPanel.hidden = true;
  layout.classList.remove('artifact-open');
  activeArtifactButton?.setAttribute('aria-expanded', 'false');
  if (focus) activeArtifactButton?.focus({preventScroll: true});
  activeArtifactButton = null;
}

closeArtifactButton.addEventListener('click', () => closeArtifact());
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !artifactPanel.hidden) closeArtifact();
});

function apply(event) {
  if (event.type === 'state') {
    agentState = event.state; saveChat(); return;
  }
  chatHistory.push(event);
  if (event.type === 'user') {
    finishTools(); currentTools = null; currentArtifactLinks = []; message('user', event.content);
    const group = toolGroup();
    if (Number.isFinite(event.started_at)) group.startedAt = event.started_at * 1000;
    summarizeTools(group);
    toolsTimer = setInterval(() => {
      summarizeTools(group);
      summarizeThinking();
      for (const call of runningTools) summarizeRunningTool(call);
    }, 100);
  }
  else if (event.type === 'message') message('assistant', event.content);
  else if (event.type === 'error') { finishTools(); message('error', event.message); status.textContent = 'Request failed'; }
  else if (event.type === 'done') { finishTools(event.elapsed_ms); saveChat(); }
  else if (event.type === 'llm_usage') recordToolCost('llm', amount(event.usage?.cost));
  else if (event.type === 'model_start') {
    const group = toolGroup(); group.thinkingCount++;
    const details = node('details', undefined, 'tool reasoning');
    const summary = node('summary');
    const text = node('pre', 'Waiting for the model\u2019s thinking\u2026');
    details.append(summary, text); group.list.append(details);
    currentThinking = {summary, text, startedAt: Number.isFinite(event.started_at) ? event.started_at * 1000 : Date.now()};
    summarizeThinking(); summarizeTools(group); status.textContent = 'Thinking\u2026';
  }
  else if (event.type === 'model_result') {
    if (currentThinking) {
      summarizeThinking(event.error ? 'failed' : 'done', event.duration_ms);
      currentThinking.text.textContent = event.reasoning || 'No thinking text returned by this model.';
      currentThinking = null;
    }
  }
  else if (event.type === 'tool_call') {
    const group = toolGroup(); group.count++;
    const details = node('details', undefined, 'tool'); const summary = node('summary', `Running ${event.name}…`);
    details.append(summary);
    if (event.reasoning && !group.thinkingCount) {
      const reasoning = node('details', undefined, 'reasoning');
      reasoning.append(node('summary', 'Reasoning'), node('pre', event.reasoning));
      details.append(reasoning);
    }
    details.append(node('pre', event.arguments));
    const call = {details, name: event.name, startedAt: Date.now(), llmCost: event.llm_cost, shared: event.llm_cost_shared};
    toolCalls.set(event.id, call); runningTools.add(call); group.list.append(details);
    summarizeRunningTool(call);
    summarizeTools(group); status.textContent = event.name;
  } else if (event.type === 'tool_result') {
    if (event.name === 'query') recordToolCost('datamule', charge(event.result.metadata));
    const call = toolCalls.get(event.id);
    if (call) {
      runningTools.delete(call);
      const datamuleCost = event.name === 'query' ? charge(event.result.metadata) : 0;
      const timing = Number.isFinite(event.duration_ms) ? ` · ${Math.round(event.duration_ms)}ms` : '';
      call.details.querySelector('summary').textContent = `${event.name}: ${event.result.error ? 'failed' : 'done'} · LLM Cost: ${costLabel(call.llmCost)}${call.shared ? ' (shared)' : ''} · Datamule Cost: ${costLabel(datamuleCost)}${timing}`;
      call.details.append(node('pre', JSON.stringify(event.result, null, 2)));
    }
  } else if (event.type === 'query_result') {
    queryResults.set(event.result_id, event);
  } else if (event.type === 'artifact') {
    const artifact = event.artifact;
    const button = node('button', undefined, 'artifact-link');
    button.type = 'button';
    button.setAttribute('aria-controls', 'artifact-panel');
    button.setAttribute('aria-expanded', 'false');
    button.append(node('strong', artifact.title), node('span', `${artifact.kind === 'markdown' ? 'Markdown' : 'Chart'} \u00b7 Open artifact`));
    button.addEventListener('click', () => openArtifact(event.artifact_id));
    artifactItems.set(event.artifact_id, {artifact, button});
    currentArtifactLinks.push(button);
    messages.append(button);
  }
}

function setBusy(value) {
  busy = value;
  send.disabled = value || model.value === CUSTOM_MODEL;
  reset.disabled = model.disabled = prompt.disabled = customModel.disabled = useCustomModel.disabled = cancelCustomModel.disabled = value;
}

function addModelOption(id, label = id) {
  if ([...model.options].some(option => option.value === id)) return;
  const option = node('option', label); option.value = id;
  model.insertBefore(option, [...model.options].find(entry => entry.value === CUSTOM_MODEL));
}

function showSelectedModel() {
  addModelOption(selectedModel); model.value = selectedModel;
  customModelForm.hidden = true;
}

function clearChat() {
  finishTools(); closeArtifact(false); artifactItems.clear(); currentArtifactLinks = []; chatHistory.length = 0;
  messages.replaceChildren(); artifacts.replaceChildren(); queryResults.clear(); toolCalls.clear(); currentTools = null;
  agentState = null; saveChat(); status.textContent = 'Ready'; prompt.focus();
}

function saveModel(choice) {
  if (!choice || choice === CUSTOM_MODEL) return;
  if (choice === selectedModel) { showSelectedModel(); setBusy(false); return; }
  if (choice.length > 200 || /\s/.test(choice)) {
    settingsStatus.textContent = 'Enter a model ID of at most 200 characters.';
    return;
  }
  selectedModel = choice; showSelectedModel(); clearChat(); settingsStatus.textContent = 'New chat started';
  setBusy(false); prompt.focus();
}

model.addEventListener('change', async () => {
  if (busy) return;
  if (model.value === CUSTOM_MODEL) {
    customModelForm.hidden = false; settingsStatus.textContent = ''; setBusy(false); customModel.focus();
    return;
  }
  customModelForm.hidden = true;
  await saveModel(model.value);
});

customModelForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!busy) await saveModel(customModel.value.trim());
});

cancelCustomModel.addEventListener('click', () => {
  if (!busy) { showSelectedModel(); setBusy(false); }
});

prompt.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    if (!busy && !send.disabled) document.getElementById('chat-form').requestSubmit();
  }
});

document.getElementById('chat-form').addEventListener('submit', async event => {
  event.preventDefault();
  const text = prompt.value.trim();
  if (!text || busy || model.value === CUSTOM_MODEL) return;
  setBusy(true); status.textContent = 'Working…';
  let failed = false;
  try {
    const response = await fetch('/api/chat', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({message: text, model: selectedModel, state: agentState})});
    if (!response.ok) throw new Error((await response.json()).error || 'Request failed');
    prompt.value = '';
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ''; let done = false; let turnDone = false;
    while (!done) {
      const chunk = await reader.read(); done = chunk.done; buffer += decoder.decode(chunk.value, {stream: !done});
      const lines = buffer.split('\n'); buffer = lines.pop();
      for (const line of lines) if (line.trim()) { const item = JSON.parse(line); failed ||= item.type === 'error'; turnDone ||= item.type === 'done'; apply(item); }
    }
    if (buffer.trim()) { const item = JSON.parse(buffer); failed ||= item.type === 'error'; turnDone ||= item.type === 'done'; apply(item); }
    if (!turnDone) throw new Error('Connection interrupted. Send continue to resume from the last saved state.');
  } catch (error) { failed = true; apply({type: 'error', message: error.message}); }
  finally { finishTools(); saveChat(); setBusy(false); status.textContent = failed ? 'Request failed' : 'Ready'; prompt.focus(); }
});

reset.addEventListener('click', () => {
  if (busy) return;
  clearChat();
});

setBusy(true);
fetch('/api/config').then(async response => {
  if (!response.ok) throw new Error('Could not load chat.');
  const config = await response.json(); selectedModel = config.model;
  selectedProvider = config.provider;
  if (selectedProvider !== 'openrouter') model.querySelector('optgroup')?.remove();
  settingsStatus.textContent = `Provider: ${selectedProvider}`;
  let saved = null;
  try { saved = JSON.parse(sessionStorage.getItem(CHAT_STORAGE) || 'null'); }
  catch { settingsStatus.textContent = 'Could not restore the saved chat.'; }
  if (saved && saved.provider === selectedProvider && typeof saved.model === 'string' && Array.isArray(saved.events)) {
    selectedModel = saved.model; agentState = saved.state;
    for (const event of saved.events) apply(event);
    finishTools();
    if (saved.events.length) document.getElementById('welcome')?.remove();
  }
  showSelectedModel();
}).catch(error => message('error', error.message)).finally(() => { setBusy(false); prompt.focus(); });

