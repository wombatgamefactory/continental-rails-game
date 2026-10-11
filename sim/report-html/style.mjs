// style.mjs - the page's CSS (colours as custom properties on :root, light, dark and print)
// and the one tiny script (opens every <details> before printing). The page reads fully
// with JavaScript off.

const LIGHT = {
  bg: '#f4f5f7',
  card: '#ffffff',
  ink: '#1b1f24',
  muted: '#566170',
  line: '#d5dae1',
  grid: '#e3e6eb',
  axis: '#7d8794',
  accent: '#0b5cad',
  'arm0': '#0072B2',
  'arm1': '#E69F00',
  'arm0-ink': '#004f7c',
  'arm1-ink': '#8a5a00',
  ref: '#1b1f24',
  band: 'rgba(0, 114, 178, 0.10)',
  'warn-bg': '#fff3d6',
  'warn-line': '#b86e00',
  'pass-bg': '#e2f1ec',
  'pass-line': '#0b6b55',
  'na-bg': '#eceef1',
  'zero-bg': '#ffe9e4',
  'zero-line': '#b3321a',
  halo: '#ffffff',
  s0: '#4477AA', s1: '#EE6677', s2: '#228833', s3: '#CCBB44', s4: '#66CCEE', s5: '#AA3377', s6: '#E8871E',
  s7: '#332288', s8: '#44AA99', s9: '#997700', s10: '#999999', s11: '#882255', s12: '#FFAABB',
  s13: '#6C757D', s14: '#BB5566', s15: '#004488',
  e0: '#228833', e1: '#4477AA', e2: '#999999',
  t0: '#A0785A', t1: '#6C757D', t2: '#4477AA',
};

const DARK = {
  bg: '#14171b',
  card: '#1d2127',
  ink: '#e8ebef',
  muted: '#a3adba',
  line: '#3a414b',
  grid: '#2c323a',
  axis: '#7d8794',
  accent: '#6cb4f0',
  'arm0': '#56B4E9',
  'arm1': '#F5B73B',
  'arm0-ink': '#8fd0f5',
  'arm1-ink': '#f5c970',
  ref: '#e8ebef',
  band: 'rgba(86, 180, 233, 0.16)',
  'warn-bg': '#3d2f10',
  'warn-line': '#f0b04a',
  'pass-bg': '#16342d',
  'pass-line': '#5fcfae',
  'na-bg': '#2a2f36',
  'zero-bg': '#43201a',
  'zero-line': '#ff9a85',
  halo: '#1d2127',
  s0: '#6f9bd0', s1: '#f08b99', s2: '#4fb35f', s3: '#d9c95a', s4: '#7bd0ee', s5: '#c866a0', s6: '#f0a04a',
  s7: '#8a7be0', s8: '#5fc4b3', s9: '#c9a227', s10: '#b0b0b0', s11: '#d46ba0', s12: '#ffc4cf',
  s13: '#98a2ac', s14: '#d98090', s15: '#5b8fd0',
  e0: '#4fb35f', e1: '#6f9bd0', e2: '#b0b0b0',
  t0: '#c79c7a', t1: '#98a2ac', t2: '#6f9bd0',
};

const vars = (o) => Object.entries(o).map(([k, v]) => `--${k}:${v};`).join('');

export const CSS = `
:root{${vars(LIGHT)}color-scheme:light dark}
@media (prefers-color-scheme: dark){:root{${vars(DARK)}}}
@media print{:root{${vars(LIGHT)}}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 "Segoe UI",system-ui,-apple-system,Arial,sans-serif}
main{max-width:1120px;margin:0 auto;padding:20px 16px 60px}
h1{font-size:28px;margin:0 0 4px;line-height:1.2}
h2{font-size:22px;margin:0 0 6px;padding-top:6px;border-top:3px solid var(--line)}
h3{font-size:16px;margin:0 0 2px;line-height:1.3}
h4{font-size:14px;margin:14px 0 4px}
p{margin:6px 0}
a{color:var(--accent)}
code,pre{font-family:Consolas,"Cascadia Mono",monospace;font-size:12.5px}
pre{background:var(--card);border:1px solid var(--line);border-radius:6px;padding:8px 10px;white-space:pre-wrap;word-break:break-all;margin:6px 0}
.sub,.muted{color:var(--muted)}
.sub{margin:0;font-size:13.5px}
section{margin-top:34px}
.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px 16px}
.meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:6px 24px;margin:12px 0}
.meta div{padding:2px 0;border-bottom:1px solid var(--grid)}
.meta dt{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
.meta dd{margin:0;font-weight:600}
.rules li{margin:2px 0}
.verdict{border-left:6px solid var(--accent)}
.verdict ol{margin:6px 0 2px;padding-left:22px}
.verdict li{margin:7px 0}
.caution{background:var(--warn-bg);border:1px solid var(--warn-line);border-radius:8px;padding:10px 14px;margin-top:14px}
.notice{border:1px dashed var(--warn-line);background:var(--warn-bg);border-radius:6px;padding:8px 12px;margin:10px 0;font-size:14px}
.notice.big{border-style:solid;border-width:2px;font-size:15px}
.zero{background:var(--zero-bg);border:2px solid var(--zero-line);border-radius:8px;padding:10px 16px;margin:14px 0}
.zero h3{color:var(--zero-line);font-size:17px}
.zero ul{margin:4px 0;padding-left:20px}
.fig{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px 14px;margin:14px 0;break-inside:avoid;page-break-inside:avoid}
.fig svg{width:100%;height:auto;display:block;margin-top:6px}
.fig svg.swsvg,svg.swsvg{width:14px;height:14px;display:inline-block;margin:0;flex:none}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:0 14px}
.grid2>.fig{min-width:0}
.badges{display:flex;flex-wrap:wrap;gap:4px 14px;margin-top:6px;font-size:12.5px;color:var(--muted)}
.badge{display:inline-flex;flex-wrap:wrap;align-items:center;gap:6px}
.sw{display:inline-block;width:14px;height:14px;border-radius:3px;border:1px solid rgba(0,0,0,.25);flex:none}
.sw.hatch{background-image:repeating-linear-gradient(135deg,rgba(255,255,255,.7) 0 2px,transparent 2px 6px)}
.small-n{color:var(--warn-line);font-weight:700}
table{border-collapse:collapse;width:100%;font-size:13.5px;margin:6px 0}
th,td{padding:4px 8px;border-bottom:1px solid var(--grid);text-align:right;vertical-align:top}
th{font-size:12px;color:var(--muted);font-weight:600;text-transform:none;border-bottom:2px solid var(--line)}
th:first-child,td:first-child,td.l,th.l{text-align:left}
tr.flag td{background:var(--warn-bg);font-weight:600}
tr.sep td{border-top:2px solid var(--line)}
td.wrap{white-space:normal}
.pill{display:inline-block;padding:1px 8px;border-radius:10px;font-weight:700;font-size:12px;white-space:nowrap;border:1.5px solid}
.pill.pass{background:var(--pass-bg);border-color:var(--pass-line);color:var(--pass-line)}
.pill.warn{background:var(--warn-bg);border-color:var(--warn-line);color:var(--warn-line);border-style:dashed}
.pill.na{background:var(--na-bg);border-color:var(--line);color:var(--muted)}
details{margin-top:6px}
summary{cursor:pointer;color:var(--accent);font-size:13.5px}
.legend{display:flex;flex-wrap:wrap;gap:3px 14px;margin:6px 0 2px;font-size:12.5px}
.legend span{display:inline-flex;align-items:center;gap:5px}
/* svg text */
svg text{font-family:"Segoe UI",system-ui,Arial,sans-serif;font-size:11.5px;fill:var(--ink)}
svg .m{fill:var(--muted)}
svg .ax{font-size:11px;fill:var(--muted)}
svg .ttl{font-size:11.5px;fill:var(--muted)}
svg .val{font-size:11px;paint-order:stroke;stroke:var(--halo);stroke-width:3px;stroke-linejoin:round}
svg .seg{font-size:11px;font-weight:600;paint-order:stroke;stroke:rgba(0,0,0,.45);stroke-width:2.5px;fill:#fff}
svg .grid{stroke:var(--grid);stroke-width:1}
svg .axis{stroke:var(--axis);stroke-width:1}
svg .ref{stroke:var(--ref);stroke-width:1.5;stroke-dasharray:6 4}
svg .err{stroke:var(--ink);stroke-width:1.6}
svg .band{fill:var(--band)}
svg .faint{opacity:.45}
@media (max-width:760px){.grid2{grid-template-columns:1fr}.meta{grid-template-columns:1fr}}
@page{size:A4;margin:12mm}
@media print{
  body{background:#fff;font-size:11.5px}
  main{max-width:none;padding:0}
  .fig,.card,.zero,.caution{break-inside:avoid;page-break-inside:avoid}
  section{margin-top:18px}
  h2{break-after:avoid;page-break-after:avoid}
  summary{color:#000}
  details>summary::marker{content:""}
}
`;

export const SCRIPT = `
(function(){
  function openAll(){ var d=document.querySelectorAll('details'); for(var i=0;i<d.length;i++){ d[i].setAttribute('data-was', d[i].open ? '1':'0'); d[i].open=true; } }
  function restore(){ var d=document.querySelectorAll('details'); for(var i=0;i<d.length;i++){ d[i].open = d[i].getAttribute('data-was')==='1'; } }
  window.addEventListener('beforeprint', openAll);
  window.addEventListener('afterprint', restore);
})();
`;

/** Pattern definitions shared by every chart (one hidden svg at the top of the body). */
export const DEFS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>
<pattern id="p-hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="7" stroke="#fff" stroke-opacity=".6" stroke-width="2.6"/></pattern>
<pattern id="p-dots" width="6" height="6" patternUnits="userSpaceOnUse"><circle cx="3" cy="3" r="1.25" fill="#fff" fill-opacity=".7"/></pattern>
<pattern id="p-cross" width="7" height="7" patternUnits="userSpaceOnUse"><path d="M0 0L7 7M7 0L0 7" stroke="#fff" stroke-opacity=".6" stroke-width="1.3"/></pattern>
<pattern id="p-horiz" width="6" height="6" patternUnits="userSpaceOnUse"><line x1="0" y1="3" x2="6" y2="3" stroke="#fff" stroke-opacity=".65" stroke-width="2"/></pattern>
<pattern id="p-vert" width="6" height="6" patternUnits="userSpaceOnUse"><line x1="3" y1="0" x2="3" y2="6" stroke="#fff" stroke-opacity=".65" stroke-width="2"/></pattern>
</defs></svg>`;
