import { describeStep, type Run, type RunStep } from './runRecorder';

const AGENTS: Record<string, string> = {
  'claude-code': 'Claude Code',
  'claude-ai': 'Claude',
  'codex-mcp-client': 'Codex',
  'gemini-cli-mcp-client': 'Gemini CLI',
  'visual-studio-code': 'VS Code Copilot',
  cline: 'Cline',
};

/** Friendly name for an MCP client id such as `claude-code`. */
export function agentName(client?: string): string {
  if (!client) return 'Agent';
  return AGENTS[client] ?? client.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

export interface ReplayOptions {
  /** URL or data: URI for a step's screenshot file. */
  image: (file: string) => string;
  /** Webview mode: adds the Export button and clickable source links. */
  webview?: { cspSource: string; nonce: string };
}

const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
/** JSON that is safe inside a <script> tag. */
const scriptJson = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028|\u2029/g, '');

/** Replay page for one run. The same page is used in VS Code and as the standalone HTML export. */
export function renderReplay(run: Run, opts: ReplayOptions): string {
  const steps = run.stepList.map((s: RunStep) => ({ ...s, label: describeStep(s), img: s.screenshot ? opts.image(s.screenshot) : undefined }));
  const title = `${agentName(run.agent)} run`;
  const when = new Date(run.startedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  const meta = [`${run.steps} step${run.steps === 1 ? '' : 's'}`, formatDuration(run.endedAt - run.startedAt), when];
  if (run.errors) meta.push(`${run.errors} error${run.errors === 1 ? '' : 's'}`);
  const w = opts.webview;
  const csp = w
    ? `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${w.cspSource} data:; style-src 'unsafe-inline'; script-src 'nonce-${w.nonce}';">`
    : `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline';">`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">${csp}
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · H/Ai replay</title>
<style>${CSS}</style></head>
<body>
<header>
  <div class="brand"><span class="logo">H/Ai</span><div><h1>${esc(title)}</h1><p>${esc(meta.join(' · '))}</p></div></div>
  ${w ? '<button id="export" class="ghost" title="Save this run as one HTML file you can share">Export HTML</button>' : '<span class="tag">Recorded with H/Ai Browser</span>'}
</header>
<main>
  <aside><ol id="steps"></ol></aside>
  <section class="stage">
    <div class="frame">
      <div class="chrome"><span class="dots"><i></i><i></i><i></i></span><span id="url" class="url"></span></div>
      <div id="shot" class="shot"><img id="img" alt=""><svg id="overlay" preserveAspectRatio="none"></svg><div id="noshot" class="noshot">No screenshot for this step</div></div>
    </div>
    <div class="caption"><span id="badge" class="badge"></span><span id="label"></span></div>
    <div class="controls">
      <button id="prev" title="Previous (←)">‹</button>
      <button id="play" class="primary" title="Play / pause (Space)">▶</button>
      <button id="next" title="Next (→)">›</button>
      <input id="slider" type="range" min="0" value="0">
      <span id="count" class="count"></span>
      <div class="speed" id="speed"><button data-s="1" class="on">1×</button><button data-s="2">2×</button><button data-s="4">4×</button></div>
    </div>
    <div class="details" id="details"></div>
  </section>
</main>
<script${w ? ` nonce="${w.nonce}"` : ''}>
const STEPS = ${scriptJson(steps)};
const WEBVIEW = ${w ? 'true' : 'false'};
${SCRIPT}
</script>
</body></html>`;
}

const CSS = `
:root{--bg:#0b0c10;--panel:#13151b;--panel2:#1a1d25;--line:#262a35;--text:#e8eaf0;--mute:#8b90a0;--accent:#7c5cff;--accent2:#a28bff;--err:#ff6b6b;--ok:#3ddc97;--r:10px}
*{box-sizing:border-box}html,body{margin:0;height:100%}
body{background:var(--bg);color:var(--text);font:13px/1.5 Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;display:flex;flex-direction:column}
header{display:flex;align-items:center;justify-content:space-between;padding:14px 20px;border-bottom:1px solid var(--line);background:var(--panel)}
.brand{display:flex;gap:12px;align-items:center}.logo{font-weight:700;font-size:12px;letter-spacing:.02em;padding:6px 8px;border-radius:8px;background:linear-gradient(135deg,var(--accent),#4f8cff);color:#fff}
h1{font-size:15px;margin:0;font-weight:600}header p{margin:0;color:var(--mute);font-size:12px}
.tag{color:var(--mute);font-size:12px}
button{font:inherit;color:var(--text);background:var(--panel2);border:1px solid var(--line);border-radius:var(--r);height:32px;min-width:32px;padding:0 12px;cursor:pointer;transition:background .15s,border-color .15s}
button:hover{border-color:#3a4050;background:#20242e}button.primary{background:var(--accent);border-color:var(--accent);color:#fff}button.primary:hover{background:var(--accent2)}
button.ghost{background:transparent}
main{flex:1;display:grid;grid-template-columns:320px 1fr;min-height:0}
aside{border-right:1px solid var(--line);overflow:auto;background:var(--panel)}
ol{list-style:none;margin:0;padding:8px}
li{display:grid;grid-template-columns:26px 1fr auto;gap:10px;align-items:start;padding:9px 10px;border-radius:var(--r);cursor:pointer;color:var(--mute);border:1px solid transparent}
li:hover{background:var(--panel2)}li.on{background:var(--panel2);border-color:var(--line);color:var(--text)}
li .n{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:7px;background:#20242e;font-size:11px;color:var(--mute)}
li.on .n{background:var(--accent);color:#fff}li.err .n{background:rgba(255,107,107,.15);color:var(--err)}
li .t{color:inherit;word-break:break-word}li .tool{display:block;font:11px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--mute);opacity:.8}
li .d{font-size:11px;color:var(--mute)}
.stage{display:flex;flex-direction:column;gap:12px;padding:16px 20px;overflow:auto;min-width:0}
.frame{flex-shrink:0;align-self:center;width:100%;border:1px solid var(--line);border-radius:12px;overflow:hidden;background:var(--panel);box-shadow:0 20px 60px rgba(0,0,0,.35)}
.chrome{display:flex;align-items:center;gap:12px;padding:8px 12px;border-bottom:1px solid var(--line)}
.dots i{display:inline-block;width:9px;height:9px;border-radius:50%;background:#2c3140;margin-right:5px}
.url{flex:1;background:var(--panel2);border-radius:8px;padding:4px 10px;color:var(--mute);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.shot{position:relative;background:#fff;line-height:0;min-height:200px}.shot img{width:100%;display:block}
.shot svg{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible}
.noshot{display:none;position:absolute;inset:0;align-items:center;justify-content:center;color:var(--mute);background:var(--panel2);line-height:1.5}
.shot.empty{min-height:240px}.shot.empty .noshot{display:flex}.shot.empty img{display:none}
.caption{display:flex;gap:10px;align-items:center;font-size:14px}
.badge{font:11px ui-monospace,SFMono-Regular,Menlo,monospace;padding:3px 8px;border-radius:7px;background:rgba(124,92,255,.15);color:var(--accent2)}
.badge.err{background:rgba(255,107,107,.15);color:var(--err)}
.controls{display:flex;gap:8px;align-items:center}
input[type=range]{flex:1;accent-color:var(--accent)}
.count{color:var(--mute);font-variant-numeric:tabular-nums;min-width:56px;text-align:right}
.speed{display:flex;border:1px solid var(--line);border-radius:var(--r);overflow:hidden}.speed button{border:0;border-radius:0;height:30px;background:transparent;color:var(--mute);padding:0 10px}.speed button.on{background:var(--panel2);color:var(--text)}
.details{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:var(--r);padding:12px 14px;min-width:0}
.card h3{margin:0 0 6px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--mute)}
.card pre{margin:0;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;word-break:break-word;color:var(--text)}
.card .row{display:flex;gap:8px;margin:2px 0}.card .k{color:var(--mute);min-width:52px}.card .v{word-break:break-word}
.card a{color:var(--accent2);text-decoration:none;cursor:pointer}.card a:hover{text-decoration:underline}
.card.err{border-color:rgba(255,107,107,.4)}.card.err pre{color:var(--err)}
details.read{grid-column:1/-1}details.read summary{cursor:pointer;color:var(--mute)}details.read pre{max-height:320px;overflow:auto;margin-top:8px}
@keyframes ping{0%{r:6;opacity:.9}100%{r:26;opacity:0}}
.ping{animation:ping 1s ease-out 2}
@media (max-width:900px){main{grid-template-columns:1fr}aside{max-height:220px;border-right:0;border-bottom:1px solid var(--line)}}
`;

const SCRIPT = `
const vscode = WEBVIEW && typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : undefined;
const $ = id => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const dur = ms => ms < 1000 ? Math.round(ms) + 'ms' : (ms / 1000).toFixed(1) + 's';
const NS = 'http://www.w3.org/2000/svg';
let i = 0, timer = 0, speed = 1;
const list = $('steps');
STEPS.forEach((s, k) => {
  const li = el('li', s.error ? 'err' : '');
  li.append(el('span', 'n', String(s.seq)));
  const t = el('span', 't', s.label); t.append(el('span', 'tool', s.tool)); li.append(t);
  li.append(el('span', 'd', dur(s.durationMs)));
  li.onclick = () => { stop(); go(k); };
  list.append(li);
});
$('slider').max = String(Math.max(0, STEPS.length - 1));
function svg(tag, attrs) { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; }
function card(title, cls) { const c = el('div', 'card' + (cls ? ' ' + cls : '')); c.append(el('h3', '', title)); return c; }
function row(c, k, v, onClick) { const r = el('div', 'row'); r.append(el('span', 'k', k)); const val = onClick ? el('a', 'v', v) : el('span', 'v', v); if (onClick) val.onclick = onClick; r.append(val); c.append(r); }
function draw(s) {
  const o = $('overlay'); o.innerHTML = '';
  const vp = s.viewport; if (!vp) return;
  o.setAttribute('viewBox', '0 0 ' + vp.width + ' ' + vp.height);
  // The click was on the previous page, so its marks would point at the wrong thing here.
  if (s.from) return;
  if (s.box) o.append(svg('rect', { x: s.box.x - 3, y: s.box.y - 3, width: s.box.width + 6, height: s.box.height + 6, rx: 6, fill: 'rgba(124,92,255,.12)', stroke: '#7c5cff', 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke' }));
  const pts = s.points || [];
  if (pts.length > 1) o.append(svg('polyline', { points: pts.map(p => p.x + ',' + p.y).join(' '), fill: 'none', stroke: '#7c5cff', 'stroke-width': 2, 'stroke-dasharray': '6 5', 'vector-effect': 'non-scaling-stroke' }));
  const sx = vp.width / ($('shot').clientWidth || vp.width);
  pts.forEach((p, k) => {
    if (k === pts.length - 1) o.append(svg('circle', { class: 'ping', cx: p.x, cy: p.y, r: 6 * sx, fill: 'none', stroke: '#7c5cff', 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke' }));
    o.append(svg('circle', { cx: p.x, cy: p.y, r: 7 * sx, fill: '#7c5cff', stroke: '#fff', 'stroke-width': 2.5, 'vector-effect': 'non-scaling-stroke' }));
  });
}
// Fit the whole screenshot on screen: width follows the free height and the page's aspect ratio.
function fit(s) {
  const vp = s && s.viewport; const f = document.querySelector('.frame');
  if (!vp) { f.style.width = '100%'; return; }
  const free = window.innerHeight - 330;
  f.style.width = Math.max(320, Math.min(document.querySelector('.stage').clientWidth - 40, (free - 42) * vp.width / vp.height)) + 'px';
}
function go(k) {
  if (!STEPS.length) return;
  i = Math.max(0, Math.min(STEPS.length - 1, k));
  const s = STEPS[i];
  [...list.children].forEach((li, n) => li.classList.toggle('on', n === i));
  list.children[i].scrollIntoView({ block: 'nearest' });
  $('slider').value = String(i);
  $('count').textContent = (i + 1) + ' / ' + STEPS.length;
  $('url').textContent = s.url || '';
  const shot = $('shot');
  // Steps without their own screenshot keep showing the last page the agent saw.
  let img = s.img, shown = s;
  for (let k2 = i; !img && k2 >= 0; k2--) { img = STEPS[k2].img; shown = STEPS[k2]; }
  shot.classList.toggle('empty', !img);
  if (img) $('img').src = img;
  fit(shown);
  if (shown === s) draw(s); else $('overlay').innerHTML = '';
  $('badge').textContent = s.tool; $('badge').className = 'badge' + (s.error ? ' err' : '');
  $('label').textContent = s.label;
  const d = $('details'); d.innerHTML = '';
  const call = card('Tool call'); call.append(el('pre', '', s.tool + ' ' + JSON.stringify(s.params, null, 2))); d.append(call);
  if (s.target) {
    const t = card('Target');
    if (s.target.role || s.target.name) row(t, 'Element', [s.target.role, s.target.name && '"' + s.target.name + '"'].filter(Boolean).join(' '));
    if (s.target.ref) row(t, 'Ref', s.target.ref);
    if (s.target.src) row(t, 'Source', s.target.src, vscode ? () => vscode.postMessage({ type: 'openSource', src: s.target.src }) : undefined);
    const p = (s.points || [])[(s.points || []).length - 1]; if (p) row(t, 'At', '(' + p.x + ', ' + p.y + ')');
    d.append(t);
  }
  const r = card(s.error ? 'Error' : 'Result', s.error ? 'err' : '');
  if (s.error) r.append(el('pre', '', s.error));
  if (s.title) row(r, 'Page', s.title);
  if (s.url) row(r, 'URL', s.url);
  if (s.from) row(r, 'Left', s.from);
  if (s.shown) row(r, 'Showed', '"' + s.shown + '"');
  row(r, 'Took', dur(s.durationMs));
  d.append(r);
  if (s.read) { const x = el('details', 'card read'); x.append(el('summary', '', 'What the agent read (' + s.read.split('\\n').length + ' lines)')); x.append(el('pre', '', s.read)); d.append(x); }
}
function stop() { clearTimeout(timer); timer = 0; $('play').textContent = '▶'; }
function tick() { if (i >= STEPS.length - 1) return stop(); go(i + 1); timer = setTimeout(tick, 1600 / speed); }
function play() { if (timer) return stop(); if (i >= STEPS.length - 1) go(0); $('play').textContent = '❚❚'; timer = setTimeout(tick, 1200 / speed); }
$('play').onclick = play;
$('prev').onclick = () => { stop(); go(i - 1); };
$('next').onclick = () => { stop(); go(i + 1); };
$('slider').oninput = e => { stop(); go(Number(e.target.value)); };
document.querySelectorAll('#speed button').forEach(b => b.onclick = () => { speed = Number(b.dataset.s); document.querySelectorAll('#speed button').forEach(x => x.classList.toggle('on', x === b)); });
document.addEventListener('keydown', e => {
  if (e.target instanceof HTMLInputElement && e.key !== ' ') return;
  if (e.key === 'ArrowRight') { stop(); go(i + 1); e.preventDefault(); }
  else if (e.key === 'ArrowLeft') { stop(); go(i - 1); e.preventDefault(); }
  else if (e.key === ' ') { play(); e.preventDefault(); }
});
window.addEventListener('resize', () => { if (STEPS[i]) { fit(STEPS[i]); if (STEPS[i].img) draw(STEPS[i]); } });
const exp = $('export'); if (exp && vscode) exp.onclick = () => vscode.postMessage({ type: 'export' });
go(Math.max(0, (parseInt(location.hash.slice(1), 10) || 1) - 1));
`;
