// Shared by the browser export and the server archive. No credentials belong here.
export const safeName = value => String(value || 'untitled').normalize('NFKC').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
const ext = data => String(data).startsWith('data:image/jpeg') ? 'jpg' : String(data).startsWith('data:image/webp') ? 'webp' : 'png';
const pad = n => String(n + 1).padStart(3, '0');
export function runFolder(run) { return `tests/${safeName(run.date)}_${safeName(run.id)}`; }
export function referencePaths(run) { return (run.refs || []).map((ref, i) => `${runFolder(run)}/references/${pad(i)}_${safeName(String(ref.name || 'reference').replace(/\.[^.]+$/, ''))}.${ext(ref.data)}`); }
export function resultFolder(run, item, index) { return `${runFolder(run)}/models/${pad(index)}_${safeName(item.name)}`; }
export function outputPaths(run, item, index) { return (item.images || []).map((data, i) => `${resultFolder(run, item, index)}/outputs/${pad(i)}.${ext(data)}`); }
export const AI_JUDGE_PLACEHOLDER = 'To be implemented';
export function humanReview(item) { return item.humanReview || (item.review?.type !== 'model' ? item.review || {} : {}); }
export function classification(value) { return ['open-source','closed-source'].includes(value) ? value : ''; }
export function ensureRecordPaths(runs) {
  const reserved = new Set((runs || []).flatMap(run => (run.results || []).map(item => item.path).filter(Boolean)));
  (runs || []).forEach((run, runIndex) => {
    let base = run.path || String(runIndex + 1);
    const candidate = index => run.results.length > 1 ? `${base}.${index + 1}` : base;
    while ((run.results || []).some((item, index) => !item.path && reserved.has(candidate(index)))) base = String(Number(base.split('.')[0]) + 1);
    run.path = base;
    (run.results || []).forEach((item, index) => { if (!item.path) { item.path = candidate(index); reserved.add(item.path); } });
  });
}
export function humanReviewText(item) {
  const review = humanReview(item);
  return [review.verdict && review.verdict !== 'unreviewed' ? review.verdict : '', review.name ? `Reviewer: ${review.name}` : '', review.score !== '' && review.score != null ? `Score: ${review.score}/5` : '', review.notes || ''].filter(Boolean).join('\n') || 'Unreviewed';
}
export function recordRows(runs) {
  return (runs || []).flatMap((run, runIndex) => (run.results || []).map((item, index) => {
    const review = humanReview(item), config = item.config || {};
    let endpoint = ''; try { const u = new URL(config.endpoint, 'https://tester.local'); endpoint = (u.origin === 'https://tester.local' ? '' : u.origin) + u.pathname; } catch {}
    return {
      record_id: `${run.id}:${index + 1}`, path: item.path || (run.results.length > 1 ? `${run.path || runIndex + 1}.${index + 1}` : String(run.path || runIndex + 1)), run_id: run.id, created_at: run.date,
      started_at: item.startedAt || '', completed_at: item.completedAt || '',
      tester: run.tester || '', tester_account: run.testerAccount || '',
      model_name: item.name, model_id: config.model || '', provider: config.provider || 'custom',
      model_source: classification(item.modelSource || review.modelSource || item.review?.modelSource || config.source), endpoint,
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
export const CSV_COLUMNS = ['paths','input','prompt','outputs','model used','judge','review','开源/闭源','tester','status','test date'];
export function reportRows(runs) {
  const details = recordRows(runs); let position = 0;
  return (runs || []).flatMap(run => (run.results || []).map(item => {
    const row = details[position++];
    return {
      paths: row.path, input: row.reference_paths, prompt: row.prompt, outputs: row.output_paths,
      'model used': row.model_name + (row.model_id ? ` (${row.model_id})` : ''),
      judge: AI_JUDGE_PLACEHOLDER, review: humanReviewText(item),
      '开源/闭源': row.model_source === 'open-source' ? '开源' : row.model_source === 'closed-source' ? '闭源' : '',
      tester: row.tester, status: row.status, 'test date': row.created_at
    };
  }));
}
export function recordsCSV(runs) {
  // Quoting protects commas/newlines; apostrophe protects spreadsheet formula execution.
  const cell = value => { let s = String(value ?? ''); if (/^[\s]*[=+@-]/.test(s) || /^[\t\r\n]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
  return '\uFEFF' + [CSV_COLUMNS, ...reportRows(runs).map(row => CSV_COLUMNS.map(key => row[key]))].map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}
export function recordFiles(runs) {
  ensureRecordPaths(runs);
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
