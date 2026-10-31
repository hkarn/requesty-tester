/* Requesty Tester – front-end. Talks to the local proxy at /api/* (see server.js). */
'use strict';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null) node.append(c instanceof Node ? c : String(c));
  return node;
};

// Category keys match the `api` field Requesty returns from GET /v1/models/all.
const CATEGORY_LABEL = {
  chat: 'Chat', decision: 'Decision', embedding: 'Embeddings', image: 'Image', speech: 'Speech', transcription: 'Transcription',
};
const ENDPOINT = {
  chat: '/chat/completions', decision: '/decisions', embeddings: '/embeddings',
  image: '/images/generations', speech: '/audio/speech', transcription: '/audio/transcriptions',
};

const state = {
  models: [],         // raw model objects from /models
  upstream: 'https://router.requesty.ai/v1',
  apiBase: null,      // 'api' through server.js, or the upstream URL when calling Requesty directly
};

// Use the server.js proxy when it serves the page. On a static host (e.g. GitHub Pages)
// there is no `config`, so call Requesty directly, which allows CORS from any origin.
// Paths are relative so the app also works from a subfolder.
const serverConfig = fetch('config')
  .then((r) => (r.ok ? r.json() : null))
  .catch(() => null)
  .then((cfg) => {
    if (cfg?.upstream) { state.upstream = cfg.upstream; state.apiBase = 'api'; } else state.apiBase = state.upstream;
    return cfg;
  });

/* ------------------------------------------------------------------ */
/* Storage helpers (localStorage may be unavailable)                   */
/* ------------------------------------------------------------------ */
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

/* ------------------------------------------------------------------ */
/* Model categorisation                                                */
/* ------------------------------------------------------------------ */
// GET /v1/models/all tags every model with its modality in `api`. The name-based
// fallback only kicks in for entries without that field.
function categorize(model) {
  if (model.api && CATEGORY_LABEL[model.api]) return model.api;
  const id = String(model.id || '').toLowerCase();
  if (/embed/.test(id)) return 'embedding';
  if (/whisper|transcribe/.test(id)) return 'transcription';
  if (/tts/.test(id)) return 'speech';
  if (/gpt-image|dall-e|imagen|flux/.test(id)) return 'image';
  return 'chat';
}

const modelsIn = (category) => state.models.filter((m) => m._category === category);

/* ------------------------------------------------------------------ */
/* HTTP                                                                */
/* ------------------------------------------------------------------ */
function apiKey() { return $('#api-key').value.trim(); }

async function callApi(path, { method = 'POST', json, formData } = {}) {
  await serverConfig;
  const headers = {};
  const key = apiKey();
  if (key) headers.Authorization = `Bearer ${key}`;
  // server.js adds these itself; direct calls send them so Requesty can attribute the app.
  if (state.apiBase !== 'api') Object.assign(headers, { 'HTTP-Referer': location.origin + location.pathname, 'X-Title': 'Requesty Tester' });
  let body;
  if (json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  if (formData) body = formData;

  const t0 = performance.now();
  const res = await fetch(`${state.apiBase}${path}`, { method, headers, body });
  const ms = Math.round(performance.now() - t0);
  const contentType = res.headers.get('content-type') || '';
  const respHeaders = Object.fromEntries(res.headers.entries());

  let data; let blob;
  if (contentType.includes('application/json')) {
    const text = await res.text();
    try { data = JSON.parse(text); } catch { data = text; }
  } else if (/^(text\/|application\/(x-)?subrip)/.test(contentType) || !contentType) {
    data = await res.text();
    if (!contentType) { try { data = JSON.parse(data); } catch { /* keep text */ } }
  } else {
    blob = await res.blob();
  }
  return { ok: res.ok, status: res.status, statusText: res.statusText, ms, contentType, headers: respHeaders, data, blob };
}

function errorMessage(resp) {
  const d = resp.data;
  if (d?.error?.message) return `${d.error.origin ? `[${d.error.origin}] ` : ''}${d.error.message}`;
  if (d && typeof d === 'object') return d.error?.message || d.message || d.detail || JSON.stringify(d.error || d);
  return typeof d === 'string' && d ? d : `${resp.status} ${resp.statusText}`;
}

/* ------------------------------------------------------------------ */
/* cURL rendering                                                      */
/* ------------------------------------------------------------------ */
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
function curlFor(path, { json, formFields }) {
  const lines = [`curl ${state.upstream}${path}`, `  -H "Authorization: Bearer $REQUESTY_API_KEY"`];
  if (json !== undefined) {
    lines.push(`  -H "Content-Type: application/json"`, `  -d ${shq(JSON.stringify(json, null, 2))}`);
  }
  for (const [k, v] of formFields || []) lines.push(`  -F ${shq(`${k}=${v}`)}`);
  return lines.join(' \\\n');
}

/* ------------------------------------------------------------------ */
/* Result panel                                                        */
/* ------------------------------------------------------------------ */
function pre(obj) {
  return el('pre', { class: 'mono' }, typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2));
}

function renderResult(container, { resp, request, curl, rendered }) {
  container.replaceChildren();
  container.append(el('div', { class: 'status-line' },
    el('span', { class: `badge ${resp.ok ? 'ok' : 'err'}`, text: `${resp.status} ${resp.statusText || ''}`.trim() }),
    el('span', { class: 'muted', text: `${resp.ms} ms round-trip` }),
    resp.headers['x-tester-upstream-ms'] ? el('span', { class: 'muted', text: `(${resp.headers['x-tester-upstream-ms']} ms upstream)` }) : null,
    resp.contentType ? el('span', { class: 'muted', text: resp.contentType }) : null,
  ));

  if (!resp.ok) {
    container.append(el('div', { class: 'output error', text: errorMessage(resp) }));
  } else if (rendered) {
    container.append(rendered);
  }

  const rawResponse = resp.blob ? `<binary ${resp.blob.type || 'data'}, ${resp.blob.size.toLocaleString()} bytes>` : resp.data;
  container.append(
    el('details', { open: !resp.ok || undefined }, el('summary', { text: 'Raw response' }), pre(rawResponse ?? '')),
    el('details', {}, el('summary', { text: 'Request body' }), pre(request)),
    el('details', {}, el('summary', { text: 'Response headers' }), pre(resp.headers)),
    el('details', {}, el('summary', { text: 'cURL' }), pre(curl)),
  );
}

function renderException(container, err) {
  container.replaceChildren(el('div', { class: 'output error', text: `Request failed: ${err.message}` }));
}

/* ------------------------------------------------------------------ */
/* Model pickers                                                       */
/* ------------------------------------------------------------------ */
function setupPicker(picker) {
  const category = picker.dataset.category;
  const select = el('select', { name: 'model' });
  const custom = el('input', { name: 'model_custom', placeholder: 'or type a model id, e.g. openai/gpt-4o-mini', spellcheck: 'false' });
  const showAll = el('input', { type: 'checkbox' });
  const info = el('div', { class: 'model-info' });

  picker.replaceChildren(
    el('label', { text: `Model (${CATEGORY_LABEL[category]})` }),
    el('div', { class: 'row' }, select, el('label', { class: 'inline small' }, showAll, 'show all')),
    custom,
    info,
  );

  const fill = () => {
    const prev = select.value;
    const list = showAll.checked ? state.models : modelsIn(category);
    select.replaceChildren(
      ...(list.length ? [] : [el('option', { value: '', text: state.models.length ? `No ${category} models detected – tick "show all"` : 'Load models first' })]),
      ...list.map((m) => el('option', { value: m.id, text: showAll.checked ? `${m.id}  [${m._category}]` : m.id })),
    );
    // Keep the current choice; otherwise the first model in the list stays selected.
    if (list.some((m) => m.id === prev)) select.value = prev;
    showInfo();
  };
  const showInfo = () => {
    const m = state.models.find((x) => x.id === select.value);
    info.replaceChildren();
    if (!m) return;
    const bits = [];
    const ctx = m.context_window ?? m.context_length ?? m.max_context_length;
    if (ctx) bits.push(`context ${Number(ctx).toLocaleString()}`);
    const perM = (x) => `$${+(Number(x) * 1e6).toPrecision(4)}/M`;
    const inP = m.input_price ?? m.pricing?.input;
    const outP = m.output_price ?? m.pricing?.output;
    if (inP != null) bits.push(`in ${perM(inP)}`);
    if (outP != null) bits.push(`out ${perM(outP)}`);
    // Non-chat models only have per-unit keys in `pricing`, e.g. input_character, input_second, output_image.
    if (inP == null && outP == null && m.pricing && !Array.isArray(m.pricing)) {
      for (const [k, v] of Object.entries(m.pricing)) {
        if (typeof v !== 'number') continue;
        bits.push(k === 'input_second' ? `${k} $${+(v * 60).toPrecision(4)}/min` : `${k} ${perM(v)}`);
      }
    }
    if (m.geolocation) bits.push(m.geolocation);
    if (m.owned_by) bits.push(`by ${m.owned_by}`);
    if (m.description) bits.push(String(m.description).slice(0, 140));
    info.append(bits.join(' · '), ' ', el('details', {}, el('summary', { class: 'small', text: 'model metadata' }), pre(stripPrivate(m))));
  };
  select.addEventListener('change', showInfo);
  showAll.addEventListener('change', fill);
  picker._fill = fill;
  fill();
}

function stripPrivate(m) {
  const { _category, ...rest } = m;
  return rest;
}

function chosenModel(form) {
  return form.elements.model_custom.value.trim() || form.elements.model.value;
}

function refreshPickers() { $$('.model-picker').forEach((p) => p._fill && p._fill()); }

/* ------------------------------------------------------------------ */
/* Loading models                                                      */
/* ------------------------------------------------------------------ */
async function loadModels() {
  const status = $('#models-status');
  const btn = $('#key-form button');
  btn.disabled = true;
  status.textContent = 'Loading models…';
  try {
    const resp = await callApi('/models/all', { method: 'GET' });
    $('#models-raw').textContent = JSON.stringify(resp.data, null, 2);
    if (!resp.ok) throw new Error(errorMessage(resp));
    const list = Array.isArray(resp.data) ? resp.data : (resp.data?.data || resp.data?.models || []);
    state.models = list
      .map((m) => (typeof m === 'string' ? { id: m } : m))
      .map((m) => ({ ...m, _category: categorize(m) }))
      .sort((a, b) => a.id.localeCompare(b.id));
    const counts = Object.keys(CATEGORY_LABEL).map((c) => `${modelsIn(c).length} ${c}`).join(', ');
    status.textContent = `${state.models.length} models (${counts})`;
    refreshPickers();
    renderModelsTable();
  } catch (err) {
    status.textContent = `Could not load models: ${err.message}`;
  } finally {
    btn.disabled = false;
  }
}

function renderModelsTable() {
  const table = $('#models-table');
  const filter = $('#model-filter').value.trim().toLowerCase();
  const rows = state.models.filter((m) => !filter || JSON.stringify(m).toLowerCase().includes(filter));
  // Show a handful of common scalar columns that actually exist in the data.
  const candidates = ['context_window', 'max_output_tokens', 'input_price', 'output_price', 'cached_price',
    'supports_vision', 'supports_tool_calling', 'supports_reasoning', 'supports_caching', 'supports_output_json_schema'];
  const cols = candidates.filter((c) => state.models.some((m) => m[c] != null && typeof m[c] !== 'object'));
  cols.splice(0, 0, ...['geolocation'].filter((c) => state.models.some((m) => m[c] != null)));
  table.tHead.replaceChildren(el('tr', {}, el('th', { text: 'id' }), el('th', { text: 'category' }), ...cols.map((c) => el('th', { text: c }))));
  table.tBodies[0].replaceChildren(...rows.map((m) => el('tr', {},
    el('td', { class: 'mono', text: m.id }),
    el('td', {}, el('span', { class: 'cat', text: m._category })),
    ...cols.map((c) => el('td', { text: m[c] == null ? '' : String(m[c]) })),
  )));
  $('#model-count').textContent = `${rows.length} of ${state.models.length}`;
}

/* ------------------------------------------------------------------ */
/* Form helpers                                                        */
/* ------------------------------------------------------------------ */
function num(form, name) {
  const v = form.elements[name]?.value;
  return v === '' || v == null ? undefined : Number(v);
}
function str(form, name) {
  const v = form.elements[name]?.value?.trim();
  return v ? v : undefined;
}
function compact(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== ''));
}
function lines(text) { return text.split('\n').map((s) => s.trim()).filter(Boolean); }

/* ------------------------------------------------------------------ */
/* Handlers per category                                               */
/* ------------------------------------------------------------------ */
const handlers = {
  async chat(form, out) {
    const messages = [];
    const system = str(form, 'system');
    if (system) messages.push({ role: 'system', content: system });
    for (const row of $$('.message', form)) {
      const content = $('.content', row).value.trim();
      if (content) messages.push({ role: $('.role', row).value, content });
    }
    if (!messages.some((m) => m.role !== 'system')) throw new Error('Add at least one message.');
    let extra = {};
    if (str(form, 'extra')) {
      try { extra = JSON.parse(form.elements.extra.value); } catch (e) { throw new Error(`Extra JSON is invalid: ${e.message}`); }
    }
    const body = compact({
      model: chosenModel(form), messages,
      temperature: num(form, 'temperature'), max_tokens: num(form, 'max_tokens'), top_p: num(form, 'top_p'), ...extra,
    });
    const resp = await callApi(ENDPOINT.chat, { json: body });
    let rendered;
    if (resp.ok && resp.data?.choices) {
      const choice = resp.data.choices[0] || {};
      const msg = choice.message || {};
      rendered = el('div', {},
        el('div', { class: 'output', text: messageText(msg) || '(empty content)' }),
        msg.tool_calls ? el('details', { open: true }, el('summary', { text: 'Tool calls' }), pre(msg.tool_calls)) : null,
        el('div', { class: 'muted small', text: usageLine(resp.data, choice) }),
        el('div', { class: 'row' }, el('button', {
          type: 'button', class: 'secondary', text: 'Append reply & continue',
          onclick: () => { addMessage(form, 'assistant', messageText(msg)); addMessage(form, 'user', ''); },
        })),
      );
    }
    renderResult(out, { resp, request: body, curl: curlFor(ENDPOINT.chat, { json: body }), rendered });
  },

  async decision(form, out) {
    const raw = form.elements.state.value.trim();
    let stateValue = raw;
    if (/^[[{]/.test(raw)) { try { stateValue = JSON.parse(raw); } catch { /* send as text */ } }
    const image = form.elements.image.files[0];
    if (image) stateValue = [stateValue, { type: 'image_url', image_url: { url: await fileToDataUrl(image) } }];

    const questions = {};
    for (const row of $$('.question', form)) {
      const id = $('.qid', row).value.trim();
      if (!id) continue;
      const type = $('.qtype', row).value;
      const q = { type };
      const instr = $('.qinstr', row).value.trim();
      if (instr) q.instructions = instr;
      const crit = lines($('.qcriteria', row).value);
      if (type === 'choice') {
        q.criteria = Object.fromEntries(crit.map((l) => {
          const i = l.indexOf(':');
          return i < 0 ? [l, null] : [l.slice(0, i).trim(), l.slice(i + 1).trim() || null];
        }));
      } else if (type === 'score') q.criteria = crit;
      questions[id] = q;
    }
    if (!Object.keys(questions).length) throw new Error('Add at least one question with an id.');

    const body = { model: chosenModel(form), state: stateValue, questions };
    const resp = await callApi(ENDPOINT.decision, { json: body });
    let rendered;
    if (resp.ok && resp.data?.answers) {
      rendered = el('div', {},
        ...Object.entries(resp.data.answers).map(([id, a]) => renderAnswer(id, a, questions[id])),
        el('div', { class: 'muted small', text: usageLine(resp.data) }));
    }
    const shownReq = image ? { ...body, state: [body.state[0], { type: 'image_url', image_url: { url: `<${image.name} as base64 data URL>` } }] } : body;
    renderResult(out, { resp, request: shownReq, curl: curlFor(ENDPOINT.decision, { json: shownReq }), rendered });
  },

  async embeddings(form, out) {
    const inputs = lines(form.elements.input.value);
    if (!inputs.length) throw new Error('Enter at least one input line.');
    const body = compact({
      model: chosenModel(form),
      input: inputs.length === 1 ? inputs[0] : inputs,
      dimensions: num(form, 'dimensions'),
      encoding_format: str(form, 'encoding_format'),
    });
    const resp = await callApi(ENDPOINT.embeddings, { json: body });
    let rendered;
    if (resp.ok && Array.isArray(resp.data?.data)) {
      const vectors = resp.data.data.map((d) => (Array.isArray(d.embedding) ? d.embedding : decodeB64Floats(d.embedding)));
      const dims = vectors[0]?.length ?? 0;
      rendered = el('div', {},
        el('div', { class: 'output' },
          `${vectors.length} vector(s) × ${dims} dimensions\n\n`,
          ...vectors.map((v, i) => `#${i} "${truncate(inputs[i], 50)}"\n  [${v.slice(0, 8).map((x) => x.toFixed(5)).join(', ')}${v.length > 8 ? ', …' : ''}]  ‖v‖=${norm(v).toFixed(4)}\n`)),
        vectors.length > 1 ? similarityTable(vectors, inputs) : null,
        el('div', { class: 'muted small', text: usageLine(resp.data) }),
      );
    }
    // Avoid dumping thousands of floats in the raw view
    const shown = resp.ok && Array.isArray(resp.data?.data)
      ? { ...resp, data: { ...resp.data, data: resp.data.data.map((d) => ({ ...d, embedding: Array.isArray(d.embedding) ? [...d.embedding.slice(0, 16), `… ${d.embedding.length - 16} more`] : d.embedding })) } }
      : resp;
    renderResult(out, { resp: shown, request: body, curl: curlFor(ENDPOINT.embeddings, { json: body }), rendered });
  },

  async image(form, out) {
    const body = compact({
      model: chosenModel(form), prompt: form.elements.prompt.value.trim(),
      size: str(form, 'size'), n: num(form, 'n'), quality: str(form, 'quality'),
      background: str(form, 'background'), output_format: str(form, 'output_format'),
    });
    const resp = await callApi(ENDPOINT.image, { json: body });
    let rendered;
    if (resp.ok && Array.isArray(resp.data?.data)) {
      rendered = el('div', { class: 'output' }, ...resp.data.data.map((img, i) => {
        const src = img.b64_json ? `data:image/${body.output_format || 'png'};base64,${img.b64_json}` : img.url;
        return el('div', {},
          src ? el('img', { src, alt: `Generated image ${i + 1}` }) : el('div', { text: '(no image data)' }),
          img.revised_prompt ? el('div', { class: 'muted small', text: `Revised prompt: ${img.revised_prompt}` }) : null,
          src ? el('a', { href: src, download: `image-${i + 1}.${body.output_format || 'png'}`, target: '_blank', text: 'Download / open' }) : null);
      }), resp.data.usage ? el('div', { class: 'muted small', text: `usage: ${JSON.stringify(resp.data.usage)}` }) : null);
    }
    const shown = resp.ok && Array.isArray(resp.data?.data)
      ? { ...resp, data: { ...resp.data, data: resp.data.data.map((d) => (d.b64_json ? { ...d, b64_json: `<${d.b64_json.length.toLocaleString()} base64 chars>` } : d)) } }
      : resp;
    renderResult(out, { resp: shown, request: body, curl: curlFor(ENDPOINT.image, { json: body }), rendered });
  },

  async speech(form, out) {
    const body = compact({
      model: chosenModel(form), input: form.elements.input.value.trim(), voice: str(form, 'voice'),
      response_format: str(form, 'response_format'), speed: num(form, 'speed'), instructions: str(form, 'instructions'),
    });
    const resp = await callApi(ENDPOINT.speech, { json: body });
    let rendered;
    if (resp.ok && resp.blob) {
      const url = URL.createObjectURL(resp.blob);
      rendered = el('div', { class: 'output' },
        el('audio', { controls: '', src: url, autoplay: '' }),
        el('div', {}, el('a', { href: url, download: `speech.${body.response_format || 'mp3'}`, text: `Download (${(resp.blob.size / 1024).toFixed(1)} KB)` })));
    } else if (resp.ok) {
      rendered = el('div', { class: 'output error', text: 'Expected audio but got a non-binary response – see raw response.' });
    }
    renderResult(out, { resp, request: body, curl: curlFor(ENDPOINT.speech, { json: body }) + ' \\\n  --output speech.' + (body.response_format || 'mp3'), rendered });
  },

  async transcription(form, out) {
    const file = form.elements.file.files[0] || form._recording;
    if (!file) throw new Error('Choose an audio file or record one.');
    const fields = compact({ model: chosenModel(form), language: str(form, 'language') });
    const fd = new FormData();
    fd.append('file', file, file.name || 'recording.webm');
    for (const [k, v] of Object.entries(fields)) fd.append(k, String(v));
    const resp = await callApi(ENDPOINT.transcription, { formData: fd });
    let rendered;
    if (resp.ok) {
      const text = typeof resp.data === 'string' ? resp.data : resp.data?.text;
      rendered = el('div', {},
        el('div', { class: 'output', text: text ?? '(no text field – see raw response)' }),
        resp.data?.usage ? el('div', { class: 'muted small', text: `usage: ${JSON.stringify(resp.data.usage)}` }) : null,
      );
    }
    const request = { file: `${file.name || 'recording.webm'} (${file.type || 'unknown type'}, ${(file.size / 1024).toFixed(1)} KB)`, ...fields };
    const curl = curlFor(ENDPOINT.transcription, { formFields: [['file', `@${file.name || 'recording.webm'}`], ...Object.entries(fields)] });
    renderResult(out, { resp, request, curl, rendered });
  },
};

/* ------------------------------------------------------------------ */
/* Small utilities                                                     */
/* ------------------------------------------------------------------ */
function messageText(msg) {
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg.content)) return msg.content.map((p) => p.text ?? '').join('');
  return '';
}
function usageLine(data, choice) {
  const parts = [];
  if (data?.model) parts.push(`model: ${data.provider ? `${data.provider}/` : ''}${data.model}`);
  if (choice?.finish_reason) parts.push(`finish: ${choice.finish_reason}`);
  const u = data?.usage;
  if (u) {
    if (u.prompt_tokens != null) parts.push(`prompt ${u.prompt_tokens}`);
    if (u.input_tokens != null) parts.push(`input ${u.input_tokens}`);
    if (u.output_tokens != null) parts.push(`output ${u.output_tokens}`);
    if (u.completion_tokens != null) parts.push(`completion ${u.completion_tokens}`);
    if (u.total_tokens != null) parts.push(`total ${u.total_tokens} tokens`);
    if (u.cost != null) parts.push(`cost $${u.cost}`);
  }
  return parts.join(' · ');
}
function parseJsonLoose(text) {
  try { return JSON.parse(text); } catch { /* try harder */ }
  const m = text.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* give up */ } }
  return null;
}
function decodeB64Floats(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return Array.from(new Float32Array(bytes.buffer));
}
const norm = (v) => Math.sqrt(v.reduce((s, x) => s + x * x, 0));
function cosine(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot / (norm(a) * norm(b) || 1);
}
function similarityTable(vectors, inputs) {
  const label = (i) => `#${i}`;
  return el('div', {},
    el('h3', { text: 'Cosine similarity' }),
    el('div', { class: 'table-wrap' }, el('table', {},
      el('thead', {}, el('tr', {}, el('th'), ...vectors.map((_, i) => el('th', { title: inputs[i], text: label(i) })))),
      el('tbody', {}, ...vectors.map((a, i) => el('tr', {},
        el('th', { title: inputs[i], text: `${label(i)} ${truncate(inputs[i], 24)}` }),
        ...vectors.map((b, j) => {
          const s = cosine(a, b);
          return el('td', { class: 'sim', style: `background: color-mix(in srgb, var(--accent) ${Math.round(Math.max(0, s) * 55)}%, transparent)`, text: s.toFixed(3) });
        })))))));
}
const truncate = (s = '', n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

const pct = (x) => `${(Number(x) * 100).toFixed(0)}%`;
const meter = (x) => el('span', { class: 'meter' }, el('div', { style: `width:${Math.max(0, Math.min(1, Number(x))) * 100}%` }));

function renderAnswer(id, a, q) {
  const head = el('div', {}, el('strong', { text: id }), el('span', { class: 'cat', text: a.type }));
  const box = el('div', { class: 'output answer' }, head);
  if (a.type === 'refusal') {
    box.classList.add('error');
    box.append(el('div', { text: a.refusal || a.reason || a.message || 'The model refused to answer.' }));
  } else if (a.type === 'noul') {
    box.append(el('div', {}, `P(true) = ${pct(a.noul)} `, meter(a.noul)));
  } else if (a.type === 'choice') {
    const probs = a.probabilities || {};
    const opts = Object.keys(probs).length ? Object.keys(probs) : Object.keys(q?.criteria || {});
    box.append(el('div', { class: 'decision-options' }, ...opts.map((o) => el('span', { class: o === a.choice ? 'chosen' : '', text: probs[o] != null ? `${o} · ${pct(probs[o])}` : o }))));
    if (a.confidence != null) box.append(el('div', {}, `confidence ${pct(a.confidence)} `, meter(a.confidence)));
  } else if (a.type === 'score') {
    const labels = Array.isArray(q?.criteria) ? q.criteria : [];
    const max = Math.max(labels.length - 1, 1);
    const nearest = labels[Math.round(Number(a.score))];
    box.append(el('div', {}, `score ${Number(a.score).toFixed(2)} / ${max}${nearest ? ` (≈ ${nearest})` : ''} `, meter(Number(a.score) / max)));
    if (a.confidence != null) box.append(el('div', {}, `confidence ${pct(a.confidence)} `, meter(a.confidence)));
    // The spec documents [{value, probability}]; the live API returns {"0": p, …} plus a legend {"0": label, …}.
    const dist = Array.isArray(a.probabilities) ? a.probabilities
      : Object.entries(a.probabilities || {}).map(([value, probability]) => ({ value, probability }));
    const labelOf = (v) => a.legend?.[v] ?? labels[v];
    if (dist.length) {
      box.append(el('div', { class: 'score-dist' }, ...dist.map((p) => el('div', {},
        el('span', { class: 'small', text: `${p.value}${labelOf(p.value) != null ? ` ${labelOf(p.value)}` : ''}` }), meter(p.probability), el('span', { class: 'small muted', text: ` ${pct(p.probability)}` })))));
    }
  } else {
    box.append(pre(a));
  }
  return box;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

const CRITERIA_HINT = {
  noul: 'Not used for noul questions',
  choice: 'One option per line, optionally "option: description"',
  score: 'Scale labels, one per line, lowest first',
};
function addQuestion(form, { id = '', type = 'noul', instructions = '', criteria = '' } = {}) {
  const node = $('#question-row').content.firstElementChild.cloneNode(true);
  const typeSel = $('.qtype', node);
  const crit = $('.qcriteria', node);
  $('.qid', node).value = id;
  typeSel.value = type;
  $('.qinstr', node).value = instructions;
  crit.value = criteria;
  const sync = () => { crit.placeholder = CRITERIA_HINT[typeSel.value]; crit.hidden = typeSel.value === 'noul'; };
  typeSel.addEventListener('change', sync);
  sync();
  $('.remove', node).addEventListener('click', () => node.remove());
  $('.questions', form).append(node);
}

function addMessage(form, role = 'user', content = '') {
  const node = $('#message-row').content.firstElementChild.cloneNode(true);
  $('.role', node).value = role;
  $('.content', node).value = content;
  $('.remove', node).addEventListener('click', () => node.remove());
  $('.messages', form).append(node);
  if (!content) $('.content', node).focus();
}

/* ------------------------------------------------------------------ */
/* Mic recording for transcriptions                                    */
/* ------------------------------------------------------------------ */
function setupRecorder(form) {
  const btn = $('.record-btn', form);
  const status = $('.record-status', form);
  let recorder; let chunks = [];
  // A recording or the sample clip is kept on the form and used when no file is chosen.
  const useAudio = (file, label) => {
    form._recording = file;
    form.elements.file.value = '';
    status.replaceChildren(`${label} ${(file.size / 1024).toFixed(1)} KB `, el('audio', { controls: '', src: URL.createObjectURL(file) }));
  };
  $('.sample-btn', form).addEventListener('click', async () => {
    try {
      const res = await fetch('sample.ogg');
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      useAudio(new File([await res.blob()], 'sample.ogg', { type: 'audio/ogg' }), 'Sample clip');
    } catch (err) {
      status.textContent = `Could not load the sample: ${err.message}`;
    }
  });
  btn.addEventListener('click', async () => {
    if (recorder?.state === 'recording') { recorder.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recorder = new MediaRecorder(stream);
      chunks = [];
      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const type = recorder.mimeType || 'audio/webm';
        const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
        btn.textContent = '● Record from mic';
        useAudio(new File(chunks, `recording.${ext}`, { type }), 'Recorded');
      };
      recorder.start();
      btn.textContent = '■ Stop recording';
      status.textContent = 'Recording…';
    } catch (err) {
      status.textContent = `Mic unavailable: ${err.message}`;
    }
  });
  form.elements.file.addEventListener('change', () => { form._recording = null; status.textContent = ''; });
}

/* ------------------------------------------------------------------ */
/* Wiring                                                              */
/* ------------------------------------------------------------------ */
function init() {
  // Tabs
  $$('.tabs button').forEach((btn) => btn.addEventListener('click', () => {
    $$('.tabs button').forEach((b) => b.classList.toggle('active', b === btn));
    $$('.panel').forEach((p) => p.classList.toggle('active', p.dataset.panel === btn.dataset.tab));
    store.set('tab', btn.dataset.tab);
  }));
  const savedTab = store.get('tab');
  if (savedTab) $(`.tabs button[data-tab="${savedTab}"]`)?.click();

  // Key
  const savedKey = store.get('requesty_key');
  if (savedKey) { $('#api-key').value = savedKey; $('#remember-key').checked = true; }
  $('#key-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if ($('#remember-key').checked && apiKey()) store.set('requesty_key', apiKey()); else store.del('requesty_key');
    loadModels();
  });
  $('#remember-key').addEventListener('change', (e) => { if (!e.target.checked) store.del('requesty_key'); });

  // Pickers & forms
  $$('.model-picker').forEach(setupPicker);
  const chatForm = $('form[data-kind=chat]');
  addMessage(chatForm, 'user', 'Say hello and tell me which model you are.');
  $('.add-message', chatForm).addEventListener('click', () => addMessage(chatForm));
  setupRecorder($('form[data-kind=transcription]'));
  const decisionForm = $('form[data-kind=decision]');
  addQuestion(decisionForm, { id: 'positive', type: 'noul', instructions: 'The review is positive.' });
  addQuestion(decisionForm, { id: 'genre', type: 'choice', instructions: 'Which genre is the book?', criteria: 'fantasy: Magic, myth or invented worlds\nmystery: A crime or puzzle to solve\nromance: A love story' });
  addQuestion(decisionForm, { id: 'rating', type: 'score', instructions: 'How much did the reviewer enjoy the book?', criteria: 'Hated it\nDisliked it\nNeutral\nLiked it\nLoved it' });
  $('.add-question', decisionForm).addEventListener('click', () => addQuestion(decisionForm));

  $$('form.request-form').forEach((form) => form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const out = $('.result', form.closest('.panel'));
    const btn = $('button[type=submit]', form);
    if (!chosenModel(form)) { renderException(out, new Error('Pick or type a model first.')); return; }
    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = 'Sending…';
    // Show elapsed time, since cold-starting provider models can take a minute.
    const waiting = el('div', { class: 'muted', text: 'Waiting for response…' });
    out.replaceChildren(waiting);
    const t0 = Date.now();
    const timer = setInterval(() => { waiting.textContent = `Waiting for response… ${Math.round((Date.now() - t0) / 1000)} s`; }, 1000);
    try {
      await handlers[form.dataset.kind](form, out);
    } catch (err) {
      renderException(out, err);
    } finally {
      clearInterval(timer);
      btn.disabled = false;
      btn.textContent = label;
    }
  }));

  $('#model-filter').addEventListener('input', renderModelsTable);

  serverConfig.then((cfg) => {
    if (!cfg) $('#models-status').textContent = 'No models loaded. Calling Requesty directly from the browser.';
    if (cfg?.hasEnvKey && !apiKey()) $('#api-key').placeholder = 'Using REQUESTY_API_KEY from server (optional override)';
    if (apiKey() || cfg?.hasEnvKey) loadModels();
  });
}

init();
