
const fs = require('fs');
const P = 'C:/Users/Maaz/Desktop/open-models figures/open-models-results-dashboard.html';
const html = fs.readFileSync(P, 'utf8');
const out = [];
const ok = (n, c, ev) => out.push((c ? 'PASS  ' : 'FAIL  ') + n + (ev !== undefined ? '  [' + ev + ']' : ''));

const pm = html.match(/<script id="payload" type="application\/json">([\s\S]*?)<\/script>/);
ok('payload block present', !!pm);
ok('no placeholder left', html.indexOf('__DATA__') < 0);
ok('self-contained (no external script/link)', !/<script[^>]+src=/.test(html) && !/<link[^>]+href=/.test(html));
ok('single grading rule: no metric switch in UI', html.indexOf('data-metric') < 0);
ok('no second headline for each model', html.indexOf('Independent re-grade') < 0 && html.indexOf('Strict re-score') < 0);
let D = null;
try { D = JSON.parse(pm[1]); ok('payload parses', true, pm[1].length + ' bytes'); } catch (e) { ok('payload parses', false, e.message); }

const els = {}; const sortListeners = {};
class El {
  constructor(id){ this.id=id; this.innerHTML=''; this.textContent=''; this.value=''; this._kids=[]; this._l={}; this._attr={}; }
  addEventListener(t,f){ (this._l[t]=this._l[t]||[]).push(f); }
  setAttribute(k,v){ this._attr[k]=v; } getAttribute(k){ return this._attr[k]; }
  appendChild(c){ this._kids.push(c); } querySelectorAll(){ return this._kids; }
}
const get = id => els[id] || (els[id] = new El(id));
global.document = {
  getElementById: get,
  createElement: () => new El(),
  querySelectorAll: sel => {
    if (sel.indexOf('data-sort') < 0) return [];
    const ids = [...get('tbl').innerHTML.matchAll(/data-sort="([^"]+)"/g)].map(m => m[1]);
    return ids.map(id => { const e = new El(id); e.setAttribute('data-sort', id);
      e.addEventListener = (t,f) => { (sortListeners[id]=sortListeners[id]||[]).push(f); }; return e; });
  },
};
get('payload').textContent = pm[1];
const main = html.match(/<script>([\s\S]*?)<\/script>/)[1];
try { new Function(main)(); ok('main script executes', true); } catch (e) { ok('main script executes', false, e.message); }

const tbl = () => get('tbl').innerHTML, kpi = () => get('kpis').innerHTML, mx = () => get('matrix').innerHTML;
const rows = () => [...(tbl().match(/<tbody>([\s\S]*?)<\/tbody>/) || ['',''])[1].matchAll(/<td class="first"><span class="nm">([A-Za-z0-9_]+)/g)].map(m => m[1]);
const firstRow = () => (tbl().match(/<td class="first"><span class="nm">([A-Za-z0-9_]+)/) || [])[1];
const plainRows = id => ((get(id).innerHTML.match(/<tr>/g) || []).length) - 1;
const num2 = v => v.toLocaleString('en-US');
const everything = () => [tbl(), kpi(), mx(), get('famChart').innerHTML, get('lvlChart').innerHTML, get('divChart').innerHTML,
  get('classTbl').innerHTML, get('zeroTbl').innerHTML, get('moveTbl').innerHTML, get('dropTbl').innerHTML, get('constTbl').innerHTML].join('');

ok('no NaN / undefined anywhere', !/NaN|undefined/.test(everything()));
ok('KPI headline = 36.9% and 29.6% (one figure each)', kpi().indexOf('36.9%') > 0 && kpi().indexOf('29.6%') > 0,
   (kpi().match(/class="big">[^<]+/g) || []).join(' '));
ok('KPI oracle + agreement cards', kpi().indexOf('13.8%') > 0 && kpi().indexOf('Pipeline grader agreement') > 0);
ok('prose states the single figures', html.indexOf('36.9%</span> vs DeepSeek-VL2-Small <span class="num">29.6%') > 0);
ok('prose carries verified grader agreement', html.indexOf('agrees on 98.0% / 97.4%') > 0);
ok('no stale claims from earlier revisions', ['3,088', 'four domain-levels', '32.7%', '26.6%', 'flips'].every(s => html.indexOf(s) < 0));
ok('domain view = 34 rows', rows().length === 34, 'rows=' + rows().length);
ok('marker count = 6 single-answer domains', (tbl().match(/class="mk"/g) || []).length === 6, 'marks=' + (tbl().match(/class="mk"/g) || []).length);
ok('table columns: oracle + 12 model + 3 diagnostics + label', Object.keys(sortListeners).length === 17, 'cols=' + Object.keys(sortListeners).length);
ok('footer oracle cell is em dash', tbl().indexOf('\u2014</td>') > 0);
ok('unparsed column numeric', /I 0\.6% D 15\.5%/.test(tbl()), (tbl().match(/I [\d.]+% D [\d.]+%/) || [])[0]);

/* matrix */
const panels = (mx().match(/class="panel"/g) || []).length;
const cells = (mx().match(/class="h"/g) || []).length;
ok('matrix has two model panels', panels === 2, 'panels=' + panels);
ok('matrix has 34 domains x 5 levels x 2 panels = 340 cells', cells === 340, 'cells=' + cells);
ok('matrix groups by family (9 group rows per panel)', (mx().match(/class="grp"/g) || []).length === 18, 'grp=' + (mx().match(/class="grp"/g) || []).length);
const proj = D.domains.find(d => d.k === 'projectile_motion');
const projCell = (mx().match(new RegExp('projectile_motion<\\/td>.*?class="all"[^>]*>(\\d+)')) || [])[1];
ok('matrix All column matches payload for projectile_motion', projCell === (proj.per[0].acc/proj.per[0].n*100).toFixed(0), 'shown=' + projCell);

/* audit tables */
ok('class table lists 7 disagreement classes', plainRows('classTbl') === 7, 'rows=' + plainRows('classTbl'));
ok('zero-level table has 11 rows', plainRows('zeroTbl') === 11, 'rows=' + plainRows('zeroTbl'));
ok('constant-level table has 6 rows', plainRows('constTbl') === 6, 'rows=' + plainRows('constTbl'));
ok('mover + dropper tables populated', plainRows('moveTbl') === 5 && plainRows('dropTbl') === 5);
ok('zero table shows recovered structured levels', get('zeroTbl').innerHTML.indexOf('depth_height L3') > 0 && get('zeroTbl').innerHTML.indexOf('projectile_motion L4') > 0);
ok('class table carries examples', /gt .+ → answer/.test(get('classTbl').innerHTML));

/* sorting */
for (const [key, getter, label] of [
  ['m0-all', d => d.per[0].acc/d.per[0].n, 'InternVL overall'],
  ['m1-all', d => d.per[1].acc/d.per[1].n, 'DeepSeek overall'],
  ['m0-l5', d => d.per[0].levels[4].acc/d.per[0].levels[4].n, 'InternVL L5'],
  ['base', d => d.base.o, 'oracle'],
  ['part', d => Math.max(d.per[0].partial/d.per[0].n, d.per[1].partial/d.per[1].n), 'partial credit'],
]) {
  const exp = [...D.domains].sort((a,b) => getter(b)-getter(a))[0].k;
  sortListeners[key][0]();
  ok('sort desc by ' + label, firstRow() === exp, 'first=' + firstRow() + ' exp=' + exp);
}
sortListeners['m0-all'][0](); sortListeners['m0-all'][0]();
const expMin = [...D.domains].sort((a,b) => (a.per[0].acc/a.per[0].n)-(b.per[0].acc/b.per[0].n))[0].k;
ok('repeat click reverses', firstRow() === expMin, 'first=' + firstRow() + ' exp=' + expMin);

/* views + filters */
const viewEl = get('viewSeg');
function clickView(v){ const b = new El('b'); b.setAttribute('data-view', v); viewEl._l.click[0].call(viewEl, { target: { closest: () => b } }); }
clickView('family');
ok('family view = 9 rows', rows().length === 9, 'rows=' + rows().length);
clickView('level');
const head = tbl().match(/<tr class="cols">[\s\S]*?<\/tr>/)[0];
ok('level view shows L1-L5 twice, no Overall', (head.match(/>L[1-5]</g) || []).length === 10 && head.indexOf('Overall') < 0);
clickView('domain');
const q = get('q'); q.value = 'helix'; q._l.input[0].call(q);
ok('nonsense filter yields empty state', rows().length === 0 && tbl().indexOf('No domains match') > 0);
q.value = 'fbd'; q._l.input[0].call(q);
ok('text filter finds fbd', rows().length === 1 && rows()[0] === 'fbd', rows().join(','));
q.value = ''; q._l.input[0].call(q);
const famBtn = get('fams')._kids.find(k => k.textContent === 'Topological');
famBtn._l.click[0].call(famBtn);
const topo = D.domains.filter(d => D.families[d.f] === 'Topological').map(d => d.k);
ok('family chip removes that family', topo.every(k => !rows().includes(k)) && rows().length === 31, 'rows=' + rows().length);
const expectedN = D.models[0].n - topo.reduce((s,k) => s + D.domains.find(d => d.k === k).per[0].n, 0);
ok('footer total tracks filter', tbl().indexOf(num2(expectedN) + ' questions') > 0, (tbl().match(/famtag">([\d,]+) questions/) || [])[1]);
get('reset')._l.click[0].call(get('reset'));
ok('reset restores 34 rows', rows().length === 34, 'rows=' + rows().length);

/* table cell equals payload for one domain */
const fbdCell = (tbl().match(/<td class="first"><span class="nm">fbd[\s\S]*?<\/tr>/) || [''])[0];
const shown = (fbdCell.match(/class="acc"[^>]*>([\d.]+)%/) || [])[1];
const fbdP = D.domains.find(d => d.k === 'fbd').per[0];
ok('fbd accuracy cell matches payload', shown === (fbdP.acc/fbdP.n*100).toFixed(1), 'shown=' + shown + ' exp=' + (fbdP.acc/fbdP.n*100).toFixed(1));

console.log(out.join('\n'));
console.log('\n' + out.filter(x => x.startsWith('PASS')).length + '/' + out.length + ' checks passed');
