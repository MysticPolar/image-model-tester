// Shared by the browser export and the server archive. No credentials belong here.
export const safeName = value => String(value || 'untitled').normalize('NFKC').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
const ext = data => String(data).startsWith('data:image/jpeg') ? 'jpg' : String(data).startsWith('data:image/webp') ? 'webp' : 'png';
const pad = n => String(n + 1).padStart(3, '0');
export function runFolder(run) { return `tests/${safeName(run.date)}_${safeName(run.id)}`; }
export function referencePaths(run) { return (run.refs || []).map((ref, i) => `${runFolder(run)}/references/${pad(i)}_${safeName(String(ref.name || 'reference').replace(/\.[^.]+$/, ''))}.${ext(ref.data)}`); }
export function resultFolder(run, item, index) { return `${runFolder(run)}/models/${pad(index)}_${safeName(item.name)}`; }
export function outputPaths(run, item, index) { return (item.images || []).map((data, i) => `${resultFolder(run, item, index)}/outputs/${pad(i)}.${ext(data)}`); }
export function recordRows(runs) {
  return (runs || []).flatMap(run => (run.results || []).map((item, index) => {
    const review = item.review || {}, config = item.config || {};
    let endpoint = ''; try { const u = new URL(config.endpoint, 'https://tester.local'); endpoint = (u.origin === 'https://tester.local' ? '' : u.origin) + u.pathname; } catch {}
    return {
      record_id: `${run.id}:${index + 1}`, run_id: run.id, created_at: run.date,
      started_at: item.startedAt || '', completed_at: item.completedAt || '',
      tester: run.tester || '', tester_account: run.testerAccount || '',
      model_name: item.name, model_id: config.model || '', provider: config.provider || 'custom',
      model_source: review.modelSource || config.source || 'unknown', endpoint,
      status: item.status || 'unknown', error: item.error || '', duration_seconds: item.duration || '',
      prompt: run.prompt || '', prompt_path: `${runFolder(run)}/prompt.txt`,
      reference_original_names: JSON.stringify((run.refs || []).map(ref => ref.name || '')),
      reference_paths: JSON.stringify(referencePaths(run)), output_paths: JSON.stringify(outputPaths(run, item, index)),
      reference_count: (run.refs || []).length, requested_images: run.count, output_count: (item.images || []).length,
      run_mode: run.mode, resolution: config.resolution || '', aspect_ratio: config.aspect_ratio || '', size: config.size || '',
      response_settings: JSON.stringify(item.requests || []),
      judge_type: review.type || '', judge_name: review.name || '', judge_model: review.model || '',
      judgment: review.verdict || 'unreviewed', judge_score: review.score ?? '', judge_notes: review.notes || '', judged_at: review.updatedAt || '',
      metadata_path: `${resultFolder(run, item, index)}/record.json`
    };
  }));
}
export const CSV_COLUMNS = Object.keys(recordRows([{id:'',date:'',results:[{}]}])[0]);
export function recordsCSV(runs) {
  // Quoting protects commas/newlines; apostrophe protects spreadsheet formula execution.
  const cell = value => { let s = String(value ?? ''); if (/^[\s]*[=+@-]/.test(s) || /^[\t\r\n]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
  return '\uFEFF' + [CSV_COLUMNS, ...recordRows(runs).map(row => CSV_COLUMNS.map(key => row[key]))].map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}
export function recordFiles(runs) {
  const files = [], encoder = new TextEncoder();
  const text = (name, value, type) => files.push({name, data:encoder.encode(value), type});
  const image = (name, value) => {
    if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=\r\n]+$/.test(value)) throw Error('Invalid archived image.');
    files.push({name, data:Uint8Array.from(atob(value.split(',')[1]), c => c.charCodeAt(0)), type:value.slice(5, value.indexOf(';'))});
  };
  text('test-records.csv', recordsCSV(runs), 'text/csv; charset=utf-8');
  for (const run of runs || []) {
    text(`${runFolder(run)}/prompt.txt`, run.prompt || '', 'text/plain; charset=utf-8');
    const paths = referencePaths(run);
    (run.refs || []).forEach((ref, i) => image(paths[i], ref.data));
    const rows = recordRows([run]);
    (run.results || []).forEach((item, i) => {
      text(rows[i].metadata_path, JSON.stringify(rows[i], null, 2), 'application/json');
      const outputs = outputPaths(run, item, i);
      (item.images || []).forEach((value, j) => image(outputs[j], value));
    });
  }
  return files;
}
