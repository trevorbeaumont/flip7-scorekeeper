'use strict';
/* Flip 7 Score Keeper
 * State model: a game is a list of players (seat order) and a list of rounds.
 * Each round maps playerId -> entry {score, nums?, mods?, bust?, flip7?, manual?}.
 * Totals are always derived from rounds, so editing any past round just works. */

/* ───────────────────────── Constants ───────────────────────── */
const NUMS = [0,1,2,3,4,5,6,7,8,9,10,11,12];
const MODS = [{id:'+2',v:2},{id:'+4',v:4},{id:'+6',v:6},{id:'+8',v:8},{id:'+10',v:10},{id:'x2',label:'×2'}];
const PRESETS = [100,200,300,500];
const MAX_PLAYERS = 8;
const FLIP7_BONUS = 15;
const K = {state:'flip7.state.v2', undo:'flip7.undo.v2', log:'flip7.games.v1', prefs:'flip7.prefs.v1', legacy:'f7'};

const ICONS = {
  undo:'<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  menu:'<circle cx="12" cy="5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="19" r="1.4"/>',
  close:'<path d="M18 6 6 18M6 6l12 12"/>',
  up:'<path d="m18 15-6-6-6 6"/>',
  down:'<path d="m6 9 6 6 6-6"/>',
  trash:'<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
  crown:'<path d="m3 8 4.5 4L12 5l4.5 7L21 8l-2 11H5z"/>',
  share:'<path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v13"/>',
  install:'<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  board:'<rect x="3" y="4" width="18" height="4" rx="1.5"/><rect x="3" y="10" width="18" height="4" rx="1.5"/><rect x="3" y="16" width="18" height="4" rx="1.5"/>',
  history:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/>',
  stats:'<path d="M3 20h18M5 16l4-5 4 3 6-8"/>',
  play:'<path d="M5 12a7 7 0 1 0 2-5M5 3v4h4"/>',
  users:'<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>',
  target:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  book:'<path d="M4 4h6a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4zM20 4h-6a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h7z"/>',
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  flag:'<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
};
const ic = (n, s = 20) => `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n]}</svg>`;

/* ───────────────────────── Storage ───────────────────────── */
const store = {
  get(k, d){ try{ const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); }catch{ return d; } },
  set(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch{} },
  del(k){ try{ localStorage.removeItem(k); }catch{} },
};
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const newState = (players = [], target = 200, firstDealer = 0) =>
  ({phase:'setup', gameId:uid(), target, players, firstDealer, rounds:[], startedAt:null});

function validState(s){
  return s && typeof s === 'object' && Array.isArray(s.players) && Array.isArray(s.rounds) &&
    (s.phase === 'setup' || s.phase === 'game') && Number.isFinite(s.target);
}

/** Convert a save from the original single-file version so in-progress games survive the upgrade. */
function migrateLegacy(){
  const d = store.get(K.legacy, null);
  if (!d || !Array.isArray(d.players) || d.players.length < 2) return null;
  const players = d.players.slice(0, MAX_PLAYERS).map((p, i) => ({id:uid(), name:String(p.name || `Player ${i+1}`).slice(0, 16), c:i}));
  const roundNos = d.players.flatMap(p => (p.rounds || []).map(r => r.round || 0));
  const last = Math.max(d.currentRound || 1, ...roundNos, 1);
  const rounds = [];
  for (let r = 1; r <= last; r++){
    const entries = {};
    d.players.slice(0, MAX_PLAYERS).forEach((op, i) => {
      const e = (op.rounds || []).find(x => x.round === r);
      if (!e) return;
      if (e.busted) entries[players[i].id] = {score:0, bust:true};
      else {
        const mods = (e.mods || []).map(m => m === '×2' ? 'x2' : m).filter(m => MODS.some(x => x.id === m));
        entries[players[i].id] = {score:Math.max(0, +e.score || 0), nums:(e.cards || []).filter(n => NUMS.includes(n)), mods, flip7:(e.cards || []).length === 7};
      }
    });
    rounds.push({entries});
  }
  store.del(K.legacy);
  return {phase:'game', gameId:uid(), target:d.WIN || 200, players, firstDealer:0, rounds, startedAt:Date.now()};
}

let S = store.get(K.state, null);
if (!validState(S)) S = migrateLegacy() || newState();
let undoStack = store.get(K.undo, []);
if (!Array.isArray(undoStack)) undoStack = [];
let gameLog = store.get(K.log, []);
if (!Array.isArray(gameLog)) gameLog = [];
const prefs = Object.assign({theme:'system', order:'seat', entry:'cards', recent:[]}, store.get(K.prefs, {}));
const ui = {tab:'board', sheet:null};

/* ───────────────────────── Derived game data ───────────────────────── */
const player = id => S.players.find(p => p.id === id);
const entryOf = (round, id) => round && round.entries[id];
const total = (id, uptoRound = S.rounds.length) =>
  S.rounds.slice(0, uptoRound).reduce((a, r) => a + (r.entries[id] ? r.entries[id].score : 0), 0);
const curRound = () => S.rounds[S.rounds.length - 1];
const dealerIdx = ri => S.players.length ? (S.firstDealer + ri) % S.players.length : 0;
const isComplete = r => !!r && S.players.every(p => r.entries[p.id]);

function calc(nums, mods){
  const sum = nums.reduce((a, b) => a + b, 0);
  let score = mods.includes('x2') ? sum * 2 : sum;          // ×2 doubles number cards only
  for (const m of mods) if (m[0] === '+') score += +m.slice(1); // then flat modifiers
  const flip7 = nums.length === 7;
  if (flip7) score += FLIP7_BONUS;                          // Flip 7 bonus is never doubled
  return {score, sum, flip7};
}

/** Where the game stands, evaluated at the latest round. */
function outcome(){
  const r = curRound();
  const totals = S.players.map(p => ({p, t:total(p.id)}));
  const max = totals.length ? Math.max(...totals.map(x => x.t)) : 0;
  const top = totals.filter(x => x.t === max).map(x => x.p);
  const complete = isComplete(r);
  const reached = max >= S.target || !!S.ended;  // `ended`: players chose to stop early
  return {
    complete, max, top, totals,
    finished: complete && reached && top.length === 1,
    tie: complete && reached && top.length > 1,
    finalRound: !complete && reached,
  };
}

/** Standard competition ranking (1,2,2,4). */
function ranks(){
  const t = S.players.map(p => total(p.id));
  return S.players.map((p, i) => 1 + t.filter(x => x > t[i]).length);
}

function playerStats(p){
  const es = S.rounds.map(r => r.entries[p.id]).filter(Boolean);
  const banked = es.filter(e => !e.bust);
  const busts = es.length - banked.length;
  const best = banked.length ? Math.max(...banked.map(e => e.score)) : 0;
  const avg = banked.length ? Math.round(banked.reduce((a, e) => a + e.score, 0) / banked.length) : 0;
  const perRound = es.length ? Math.round(es.reduce((a, e) => a + e.score, 0) / es.length) : 0;
  return {played:es.length, busts, bustPct:es.length ? Math.round(busts / es.length * 100) : 0, best, avg, perRound,
    flip7s:es.filter(e => e.flip7).length, total:total(p.id)};
}

/* ───────────────────────── Persistence & undo ───────────────────────── */
function persist(){
  store.set(K.state, S);
  store.set(K.undo, undoStack);
  syncLog();
}
function savePrefs(){ store.set(K.prefs, prefs); }

/** Keep the finished-games log consistent with the current game (handles undo after a win). */
function syncLog(){
  const i = gameLog.findIndex(g => g.id === S.gameId);
  const o = S.phase === 'game' ? outcome() : null;
  if (o && o.finished){
    const rec = {
      id:S.gameId, date:Date.now(), rounds:S.rounds.length, target:S.target,
      winner:o.top[0].name, players:S.players.map(p => ({name:p.name, total:total(p.id)})).sort((a, b) => b.total - a.total),
    };
    if (i >= 0) gameLog[i] = {...rec, date:gameLog[i].date}; else gameLog.unshift(rec);
  } else if (i >= 0) gameLog.splice(i, 1);
  gameLog = gameLog.slice(0, 50);
  store.set(K.log, gameLog);
}

function commit(desc, mutate){
  undoStack.push({desc, s:JSON.stringify(S)});
  if (undoStack.length > 50) undoStack.shift();
  mutate();
  persist();
  render();
}

function undo(){
  const u = undoStack.pop();
  if (!u) return;
  S = JSON.parse(u.s);
  persist();
  closeDialog('sheet');
  render();
  toast(`Undid: ${u.desc}`);
}

/* ───────────────────────── Helpers ───────────────────────── */
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const initial = name => esc((name.trim()[0] || '?').toUpperCase());
const avatar = (p, cls = '') => `<span class="avatar ${cls}" style="--pc:var(--p${p.c})" aria-hidden="true">${initial(p.name)}</span>`;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const haptic = p => { try{ navigator.vibrate && navigator.vibrate(p); }catch{} };

let toastTimer;
function toast(msg, ms = 2400){
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

function openDialog(id){ const d = document.getElementById(id); if (!d.open) d.showModal(); }
function closeDialog(id){ const d = document.getElementById(id); if (d.open) d.close(); }

function confirmBox({title, body, ok = 'OK', danger = false}){
  return new Promise(resolve => {
    const d = $('#confirm');
    d.innerHTML = `<form method="dialog" class="confirm">
      <h2>${esc(title)}</h2>${body ? `<p>${esc(body)}</p>` : ''}
      <div class="confirm-btns">
        <button class="btn btn-ghost" value="cancel">Cancel</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" value="ok">${esc(ok)}</button>
      </div></form>`;
    d.returnValue = '';
    d.addEventListener('close', () => resolve(d.returnValue === 'ok'), {once:true});
    d.showModal();
  });
}

/* ───────────────────────── Theme ───────────────────────── */
function applyTheme(){
  const root = document.documentElement;
  if (prefs.theme === 'light' || prefs.theme === 'dark') root.dataset.theme = prefs.theme;
  else delete root.dataset.theme;
}

/* ───────────────────────── Render: shell ───────────────────────── */
function render(){
  const inGame = S.phase === 'game';
  document.body.classList.toggle('no-tabbar', !inGame);
  $('#tabbar').hidden = !inGame;
  const ub = $('#undo-btn');
  ub.hidden = !undoStack.length;
  ub.title = undoStack.length ? `Undo: ${undoStack[undoStack.length - 1].desc}` : '';
  if (!inGame) ui.tab = 'board';
  document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-current', t.dataset.tab === ui.tab ? 'page' : 'false'));

  const view = $('#view');
  if (!inGame) view.innerHTML = viewSetup();
  else if (ui.tab === 'history') view.innerHTML = viewHistory();
  else if (ui.tab === 'stats') view.innerHTML = viewStats();
  else view.innerHTML = viewBoard();

  if (inGame && ui.tab === 'stats') drawChart();
  if ($('#sheet').open && ui.sheet) renderSheet();
  keepAwake();
}

/* ───────────────────────── Render: setup ───────────────────────── */
function viewSetup(){
  const n = S.players.length;
  const taken = new Set(S.players.map(p => p.name.toLowerCase()));
  const recent = prefs.recent.filter(r => !taken.has(r.toLowerCase())).slice(0, 10);
  const custom = !PRESETS.includes(S.target);
  return `
  <section class="hero">
    <h1>Who's playing?</h1>
    <p>Add players in seating order. The dealer moves one seat to the left each round.</p>
  </section>
  ${installCard()}
  <div class="card">
    <form class="add-row" data-form="add-player" autocomplete="off">
      <label class="sr-only" for="name-input">Player name</label>
      <input id="name-input" class="text-input" placeholder="Add a player…" maxlength="16" enterkeyhint="done" autocapitalize="words" ${n >= MAX_PLAYERS ? 'disabled' : ''}>
      <button class="btn btn-primary" type="submit" ${n >= MAX_PLAYERS ? 'disabled' : ''}>Add</button>
    </form>
    ${recent.length && n < MAX_PLAYERS ? `<div class="chips"><span class="chips-label">Recent</span>${recent.map(r =>
      `<button class="chip" data-action="add-recent" data-name="${esc(r)}">+ ${esc(r)}</button>`).join('')}</div>` : ''}
    ${n ? `<ol class="seat-list">${S.players.map((p, i) => `
      <li class="seat">
        ${avatar(p)}
        <span class="seat-name">${esc(p.name)}</span>
        <button class="dealer-toggle ${S.firstDealer === i ? 'on' : ''}" data-action="set-dealer" data-i="${i}" aria-pressed="${S.firstDealer === i}" aria-label="${esc(p.name)} deals first">${S.firstDealer === i ? 'Dealer' : 'Deal'}</button>
        <span class="seat-tools">
          <button class="icon-btn sm ghost" data-action="move" data-i="${i}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="Move ${esc(p.name)} up">${ic('up', 18)}</button>
          <button class="icon-btn sm ghost" data-action="move" data-i="${i}" data-dir="1" ${i === n - 1 ? 'disabled' : ''} aria-label="Move ${esc(p.name)} down">${ic('down', 18)}</button>
          <button class="icon-btn sm ghost" data-action="remove" data-i="${i}" aria-label="Remove ${esc(p.name)}">${ic('close', 18)}</button>
        </span>
      </li>`).join('')}</ol>` : ''}
    ${n < 2 ? `<p class="hint">Add at least ${2 - n} more player${n === 1 ? '' : 's'} to start.</p>` : n >= MAX_PLAYERS ? '<p class="hint">That\'s the maximum of 8 players.</p>' : ''}
  </div>

  <div class="card">
    <div class="card-title">Play to</div>
    <div class="target-row">
      <div class="segmented" role="group" aria-label="Target score">
        ${PRESETS.map(v => `<button data-action="target" data-v="${v}" aria-pressed="${S.target === v}">${v}</button>`).join('')}
      </div>
      <label class="sr-only" for="target-input">Custom target</label>
      <input id="target-input" class="num-input" type="number" inputmode="numeric" min="25" max="9999" value="${custom ? S.target : ''}" placeholder="Other" data-input="target">
    </div>
  </div>

  ${rulesCard()}
  ${gameLog.length ? `<div class="card"><div class="card-title">Past games</div>${recordsHtml(3)}</div>` : ''}

  <div class="sticky-cta"><div class="inner">
    <button class="btn btn-primary btn-lg btn-block" data-action="start" ${n < 2 ? 'disabled' : ''}>
      ${n < 2 ? 'Add players to start' : `Start game · ${n} players · to ${S.target}`}
    </button>
  </div></div>`;
}

function rulesCard(open = false){
  return `<details class="card rules" ${open ? 'open' : ''}>
    <summary>How scoring works</summary>
    <div class="rules-body">
      <div class="rule"><span class="rule-ic">0–12</span><div><b>Add up your number cards.</b> Flip a duplicate number and you <b>bust</b> — 0 points this round.</div></div>
      <div class="rule"><span class="rule-ic" style="color:var(--mod)">×2</span><div><b>×2 doubles your number cards</b> only, not your modifiers.</div></div>
      <div class="rule"><span class="rule-ic" style="color:var(--mod)">+</span><div><b>+2 to +10</b> are added after doubling.</div></div>
      <div class="rule"><span class="rule-ic" style="color:var(--gold)">7</span><div><b>Flip 7:</b> seven different numbers scores +15 and ends the round for everyone. Everyone else banks what they have.</div></div>
      <div class="rule"><span class="rule-ic">❄</span><div><b>Freeze, Flip Three and Second Chance</b> score nothing. A frozen player just banks their points, so enter them like anyone else.</div></div>
      <div class="rule"><span class="rule-ic">🏆</span><div>The game ends after the round where someone reaches the target. Highest total wins. If the top score is tied, everyone plays another round.</div></div>
    </div>
  </details>`;
}

/* ───────────────────────── Render: board ───────────────────────── */
function viewBoard(){
  const o = outcome();
  if (o.finished) return viewGameOver(o);
  const ri = S.rounds.length - 1;
  const r = curRound();
  const dealer = S.players[dealerIdx(ri)];
  const scored = S.players.filter(p => r.entries[p.id]).length;
  const rk = ranks();
  const leaderUnique = o.top.length === 1 && o.max > 0;
  const anyScored = S.rounds.some(x => Object.keys(x.entries).length);

  let order = S.players.map((p, i) => i);
  if (prefs.order === 'rank') order.sort((a, b) => rk[a] - rk[b] || a - b);

  let banner = '';
  if (o.tie) banner = `<div class="banner tie"><span class="emoji">🤝</span><div>Tie at ${o.max} between ${o.top.map(p => esc(p.name)).join(' & ')}. Everyone plays another round.</div></div>`;
  else if (o.finalRound && S.ended) banner = `<div class="banner final"><span class="emoji">🔥</span><div>Tiebreaker round. Highest total after this round wins.</div></div>`;
  else if (o.finalRound){
    const over = o.totals.filter(x => x.t >= S.target).map(x => esc(x.p.name));
    banner = `<div class="banner final"><span class="emoji">🔥</span><div>Final round! ${over.join(' & ')} reached ${S.target}. Finish the round. Highest total wins.</div></div>`;
  }

  const rows = order.map(i => {
    const p = S.players[i];
    const e = r.entries[p.id];
    const t = total(p.id);
    const before = t - (e ? e.score : 0);
    const pct = v => Math.max(0, Math.min(100, v / S.target * 100));
    const need = S.target - t;
    const sub = need <= 0 ? `<span class="prow-sub over">${t - S.target === 0 ? 'At' : `${t - S.target} over`} target</span>`
      : `<span class="prow-sub ${need <= 30 ? 'close' : ''}">${need} to go</span>`;
    let status = `<span class="status todo">Score</span>`;
    if (e && e.bust) status = `<span class="status bust">Bust</span>`;
    else if (e && e.flip7) status = `<span class="status f7">+${e.score} · Flip 7</span>`;
    else if (e) status = `<span class="status gain">+${e.score}</span>`;
    const isLeader = leaderUnique && t === o.max;
    return `<button class="prow ${e ? 'done' : 'pending'}" style="--pc:var(--p${p.c})" data-action="score" data-pid="${p.id}"
        aria-label="${esc(p.name)}, ${t} points${e ? (e.bust ? ', busted this round' : `, scored ${e.score} this round`) : ', not scored yet'}">
      <span class="prow-lead">
        <span class="rank ${isLeader ? 'first' : ''}">${isLeader ? ic('crown', 13) : ''}${anyScored ? '#' + rk[i] : ''}</span>
        ${avatar(p, 'lg')}
      </span>
      <span class="prow-main">
        <span class="prow-name"><span class="nm">${esc(p.name)}</span>${dealer === p ? '<span class="tag">Dealer</span>' : ''}</span>
        <span class="bar"><span class="bar-fill" style="width:${pct(before)}%"></span>${e && e.score ? `<span class="bar-gain" style="left:${pct(before)}%;width:${pct(t) - pct(before)}%"></span>` : ''}</span>
        ${sub}
      </span>
      <span class="prow-right">
        <span class="prow-total">${t}</span>
        ${status}
      </span>
    </button>`;
  }).join('');

  let footer;
  if (o.complete){
    const best = S.players.map(p => ({p, e:r.entries[p.id]})).sort((a, b) => b.e.score - a.e.score)[0];
    const busts = S.players.filter(p => r.entries[p.id].bust).length;
    footer = `<div class="round-done">
      <h3>Round ${ri + 1} complete</h3>
      <p>${best.e.score > 0 ? `Top round: ${esc(best.p.name)} with ${best.e.score}.` : 'Nobody scored this round.'} ${busts ? `${plural(busts, 'bust')}.` : 'No busts!'}
      ${S.players[dealerIdx(ri + 1)] ? ` ${esc(S.players[dealerIdx(ri + 1)].name)} deals next.` : ''}</p>
      <button class="btn btn-primary btn-lg btn-block" data-action="next-round">Start round ${ri + 2}</button>
    </div>`;
  } else {
    footer = `<p class="board-hint">${scored === 0 ? 'Tap a player when they bank or bust.' : `${S.players.length - scored} player${S.players.length - scored === 1 ? '' : 's'} left to score.`}</p>`;
  }

  return `
  <section class="round-head">
    <div>
      <div class="round-title">Round ${ri + 1}</div>
      <div class="round-meta">
        <span class="pill gold">Dealer · ${esc(dealer.name)}</span>
        <span class="pill">${ic('target', 13)} ${S.target}</span>
      </div>
    </div>
    <div class="round-progress"><b>${scored}/${S.players.length}</b><span>scored</span></div>
  </section>
  ${banner}
  <div class="list-tools">
    <span class="label">${prefs.order === 'rank' ? 'Standings' : 'Seat order'}</span>
    <div class="segmented sm" role="group" aria-label="Sort players">
      <button data-action="order" data-v="seat" aria-pressed="${prefs.order === 'seat'}">Seat</button>
      <button data-action="order" data-v="rank" aria-pressed="${prefs.order === 'rank'}">Rank</button>
    </div>
  </div>
  <div class="players">${rows}</div>
  ${footer}`;
}

/* ───────────────────────── Render: game over ───────────────────────── */
function viewGameOver(o){
  const w = o.top[0];
  const sorted = S.players.map(p => ({p, t:total(p.id)})).sort((a, b) => b.t - a.t);
  const rk = sorted.map((x, i) => 1 + sorted.filter(y => y.t > x.t).length);
  const medals = ['🥇','🥈','🥉'];
  const hl = highlights();
  const colors = ['--p0','--p1','--p2','--p3','--p4','--accent','--gold'];
  const confetti = Array.from({length:36}, (_, i) =>
    `<i style="left:${(i * 37) % 100}%;background:var(${colors[i % colors.length]});animation-delay:${(i % 12) * 0.09}s;transform:rotate(${i * 23}deg)"></i>`).join('');
  return `
  <section class="card winner">
    <div class="confetti" aria-hidden="true">${confetti}</div>
    <div class="trophy" aria-hidden="true">🏆</div>
    <div class="kicker">Winner</div>
    <div class="who">${esc(w.name)}</div>
    <div class="meta">${total(w.id)} points · ${plural(S.rounds.length, 'round')}</div>
    <div class="standings">
      ${sorted.map((x, i) => `<div class="stand ${rk[i] === 1 ? 'first' : ''}">
        <span class="pos">${medals[rk[i] - 1] || rk[i]}</span>${avatar(x.p, 'sm')}
        <span class="nm">${esc(x.p.name)}</span><span class="pts">${x.t}</span></div>`).join('')}
    </div>
    <div class="highlights">${hl}</div>
    <div class="go-actions">
      <button class="btn btn-primary btn-lg" data-action="play-again">${ic('play')} Play again</button>
      <button class="btn btn-ghost" data-action="new-players">${ic('users')} New players</button>
      <button class="btn btn-ghost" data-action="share">${ic('share')} Share</button>
    </div>
  </section>
  <p class="board-hint">Wrong score? Fix it in History, or tap Undo.</p>`;
}

function highlights(){
  let best = null, mostBusts = null, f7 = null;
  S.players.forEach(p => {
    S.rounds.forEach((r, ri) => { const e = r.entries[p.id]; if (e && !e.bust && (!best || e.score > best.score)) best = {p, score:e.score, ri}; });
    const st = playerStats(p);
    if (st.busts && (!mostBusts || st.busts > mostBusts.n)) mostBusts = {p, n:st.busts};
    if (st.flip7s && (!f7 || st.flip7s > f7.n)) f7 = {p, n:st.flip7s};
  });
  const box = (k, v, s) => `<div class="hl"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s}</div></div>`;
  return [
    best && box('Best round', `${best.score} pts`, `${esc(best.p.name)}, round ${best.ri + 1}`),
    f7 && box('Flip 7s', esc(f7.p.name), plural(f7.n, 'time')),
    mostBusts && box('Most busts', esc(mostBusts.p.name), plural(mostBusts.n, 'bust')),
  ].filter(Boolean).join('');
}

/* ───────────────────────── Render: history ───────────────────────── */
function viewHistory(){
  const rs = S.rounds;
  if (!rs.length || (rs.length === 1 && !Object.keys(rs[0].entries).length))
    return `<div class="card"><div class="empty"><span class="big">🃏</span>No scores yet. Rounds will show up here.</div></div>`;
  const body = rs.map((r, ri) => {
    const vals = S.players.map(p => r.entries[p.id] ? r.entries[p.id].score : -1);
    const top = Math.max(...vals);
    const dealer = S.players[dealerIdx(ri)];
    return `<tr><td class="rd">R${ri + 1}</td>${S.players.map(p => {
      const e = r.entries[p.id];
      const dealt = dealer === p ? ' dealt' : '';
      const lbl = `${esc(p.name)}, round ${ri + 1}`;
      if (!e) return `<td><button class="cell empty${dealt}" data-action="edit-cell" data-pid="${p.id}" data-ri="${ri}" aria-label="${lbl}: not scored">–</button></td>`;
      if (e.bust) return `<td><button class="cell bust${dealt}" data-action="edit-cell" data-pid="${p.id}" data-ri="${ri}" aria-label="${lbl}: bust">BUST</button></td>`;
      const best = e.score === top && top > 0 ? ' best' : '';
      return `<td><button class="cell${best}${dealt}" data-action="edit-cell" data-pid="${p.id}" data-ri="${ri}" aria-label="${lbl}: ${e.score}">${e.score}${e.flip7 ? '<span class="f7">F7</span>' : ''}</button></td>`;
    }).join('')}</tr>`;
  }).join('');
  return `<div class="card">
    <div class="card-title">Round by round <span class="muted" style="text-transform:none;letter-spacing:0;font-weight:600">Tap a score to fix it</span></div>
    <div class="table-wrap"><table class="htable">
      <thead><tr><th class="rd"></th>${S.players.map(p => `<th>${avatar(p, 'sm')}${esc(p.name)}</th>`).join('')}</tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr><td class="rd">Total</td>${S.players.map(p => `<td>${total(p.id)}</td>`).join('')}</tr></tfoot>
    </table></div>
    <div class="legend-note"><span><b style="color:var(--gold)">Gold</b>: round high</span><span><b>D</b>: dealer</span><span><b style="color:var(--gold)">F7</b>: Flip 7</span></div>
  </div>`;
}

/* ───────────────────────── Render: stats ───────────────────────── */
function viewStats(){
  const any = S.rounds.some(r => Object.keys(r.entries).length);
  const rows = S.players.map(p => ({p, s:playerStats(p)})).sort((a, b) => b.s.total - a.s.total);
  return `
  <div class="card">
    <div class="card-title">Race to ${S.target}</div>
    ${any ? `<div class="legend">${S.players.map(p => `<span style="--pc:var(--p${p.c})"><i></i>${esc(p.name)}</span>`).join('')}</div>
      <div class="chart" id="chart"></div>` : `<div class="empty"><span class="big">📈</span>Score a round to see the race.</div>`}
  </div>
  ${any ? `<div class="card">
    <div class="card-title">This game</div>
    <table class="stable">
      <thead><tr><th>Player</th><th>Avg</th><th>Best</th><th>Busts</th><th>F7</th></tr></thead>
      <tbody>${rows.map(({p, s}) => `<tr>
        <td><span class="who">${avatar(p, 'sm')}<span>${esc(p.name)}</span></span></td>
        <td title="Average when banking">${s.avg}</td>
        <td>${s.best}</td>
        <td class="${s.busts ? 'bad' : ''}">${s.busts}${s.played ? ` <span class="muted" style="font-weight:600">(${s.bustPct}%)</span>` : ''}</td>
        <td class="${s.flip7s ? 'gold' : ''}">${s.flip7s}</td></tr>`).join('')}</tbody>
    </table>
    <p class="legend-note">Avg counts only rounds where the player banked points.</p>
  </div>` : ''}
  <div class="card">
    <div class="card-title">All-time ${gameLog.length ? `<button class="btn-link" data-action="clear-log">Clear</button>` : ''}</div>
    ${gameLog.length ? recordsHtml(10) : '<div class="empty">Finished games will be saved here.</div>'}
  </div>`;
}

function recordsHtml(limit){
  const wins = {};
  gameLog.forEach(g => { wins[g.winner] = (wins[g.winner] || 0) + 1; });
  const winList = Object.entries(wins).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const fmt = d => new Date(d).toLocaleDateString(undefined, {month:'short', day:'numeric'});
  return `<div class="wins">${winList.map(([n, w]) => `<span class="chip">🏆 ${esc(n)} <b>${w}</b></span>`).join('')}</div>
    <div class="records">${gameLog.slice(0, limit).map(g => `<div class="rec">
      <div class="main"><b>${esc(g.winner)} won</b><span>${fmt(g.date)} · ${plural(g.rounds, 'round')} · ${g.players.map(p => esc(p.name)).join(', ')}</span></div>
      <span class="score">${g.players[0].total}</span></div>`).join('')}</div>`;
}

/* ───────────────────────── Chart ───────────────────────── */
function drawChart(){
  const host = $('#chart');
  if (!host) return;
  const W = Math.max(260, host.clientWidth);
  const H = 240;
  const rounds = S.rounds.filter(r => Object.keys(r.entries).length).length;
  const series = S.players.map(p => {
    const pts = [0];
    for (let i = 0; i < rounds; i++) pts.push(total(p.id, i + 1));
    return {p, pts};
  });
  const maxV = Math.max(S.target, ...series.flatMap(s => s.pts));
  const step = niceStep(maxV / 4);
  const yMax = Math.ceil(maxV / step) * step;
  const direct = S.players.length <= 4;
  const m = {l:34, r:direct ? 64 : 14, t:12, b:26};
  const x = i => m.l + (rounds ? i / rounds : 0) * (W - m.l - m.r);
  const y = v => m.t + (1 - v / yMax) * (H - m.t - m.b);

  let g = '<g class="grid">';
  let ax = '<g class="axis">';
  for (let v = 0; v <= yMax; v += step){
    g += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/>`;
    ax += `<text x="${m.l - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
  }
  const every = Math.ceil(rounds / 8);
  for (let i = 0; i <= rounds; i += every) ax += `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${i === 0 ? 'Start' : 'R' + i}</text>`;
  g += '</g>'; ax += '</g>';
  const tgt = `<g class="target"><line x1="${m.l}" x2="${W - m.r}" y1="${y(S.target)}" y2="${y(S.target)}"/><text x="${m.l + 4}" y="${y(S.target) - 5}">Target ${S.target}</text></g>`;

  const lines = series.map(s => `<path d="M${s.pts.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('L')}" stroke="var(--p${s.p.c})"/>`).join('');
  const ends = series.map(s => `<circle cx="${x(rounds)}" cy="${y(s.pts[rounds])}" r="4.5" fill="var(--p${s.p.c})" stroke="var(--surface)" stroke-width="2"/>`).join('');

  let labels = '';
  if (direct){
    // Spread end labels so they don't collide.
    const ls = series.map(s => ({s, y:y(s.pts[rounds]) + 4})).sort((a, b) => a.y - b.y);
    for (let i = 1; i < ls.length; i++) if (ls[i].y - ls[i - 1].y < 14) ls[i].y = ls[i - 1].y + 14;
    labels = ls.map(l => `<text class="dl" x="${x(rounds) + 9}" y="${l.y}">${esc(truncate(l.s.p.name, 8))}</text>`).join('');
  }

  host.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Cumulative score by round for each player">
    ${g}${tgt}${ax}<g class="series">${lines}</g>
    <line class="xhair" x1="0" x2="0" y1="${m.t}" y2="${H - m.b}" visibility="hidden"/>
    ${ends}${labels}
    <rect x="${m.l}" y="0" width="${W - m.l - m.r}" height="${H}" fill="transparent" class="hit"/>
  </svg><div class="tip" hidden></div>`;

  const svg = host.querySelector('svg'), tip = host.querySelector('.tip'), xh = host.querySelector('.xhair');
  const show = ev => {
    if (!rounds) return;
    const rect = svg.getBoundingClientRect();
    const px = (ev.clientX - rect.left) * (W / rect.width);
    const i = Math.max(0, Math.min(rounds, Math.round((px - m.l) / ((W - m.l - m.r) / rounds))));
    xh.setAttribute('x1', x(i)); xh.setAttribute('x2', x(i)); xh.setAttribute('visibility', 'visible');
    const rowsHtml = series.map(s => ({s, v:s.pts[i]})).sort((a, b) => b.v - a.v)
      .map(o => `<div class="r" style="--pc:var(--p${o.s.p.c})"><span><i></i>${esc(o.s.p.name)}</span><b>${o.v}</b></div>`).join('');
    tip.innerHTML = `<div class="t">${i === 0 ? 'Start' : `After round ${i}`}</div>${rowsHtml}`;
    tip.hidden = false;
    const tw = tip.offsetWidth;
    const left = x(i) / W * rect.width;
    tip.style.left = `${Math.max(0, Math.min(rect.width - tw, left + (left > rect.width / 2 ? -tw - 12 : 12)))}px`;
  };
  const hide = () => { tip.hidden = true; xh.setAttribute('visibility', 'hidden'); };
  svg.addEventListener('pointermove', show);
  svg.addEventListener('pointerdown', show);
  svg.addEventListener('pointerleave', hide);
}
function niceStep(raw){
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}
const truncate = (s, n) => s.length > n ? s.slice(0, n - 1) + '…' : s;

/* ───────────────────────── Score sheet ───────────────────────── */
function openSheet(pid, ri = S.rounds.length - 1){
  const e = entryOf(S.rounds[ri], pid);
  ui.sheet = {
    pid, ri,
    mode: e && e.manual ? 'total' : prefs.entry,
    nums: new Set(e && e.nums ? e.nums : []),
    mods: new Set(e && e.mods ? e.mods : []),
    manual: e && e.manual ? String(e.score) : '',
  };
  renderSheet();
  openDialog('sheet');
  $('#sheet .sheet-body').scrollTop = 0;
}

function sheetScore(){
  const sh = ui.sheet;
  if (sh.mode === 'total'){
    const v = parseInt(sh.manual, 10);
    return {score:Number.isFinite(v) ? v : 0, valid:sh.manual !== '' && Number.isFinite(v), flip7:false, manual:true};
  }
  const nums = [...sh.nums].sort((a, b) => a - b), mods = MODS.map(m => m.id).filter(id => sh.mods.has(id));
  const c = calc(nums, mods);
  return {...c, nums, mods, valid:nums.length > 0 || mods.length > 0};
}

function mathText(c){
  const sh = ui.sheet;
  if (sh.mode === 'total') return 'Typed total';
  if (!c.valid) return 'Tap the cards in front of them';
  const parts = [];
  parts.push(c.nums.length ? c.nums.join(' + ') + (c.nums.length > 1 ? ` = ${c.sum}` : '') : '0');
  if (c.mods.includes('x2')) parts.push(`×2 = ${c.sum * 2}`);
  c.mods.filter(m => m[0] === '+').forEach(m => parts.push(m));
  if (c.flip7) parts.push('+15 Flip 7');
  return parts.join('  ·  ');
}

function renderSheet(){
  const sh = ui.sheet;
  const p = player(sh.pid);
  const round = S.rounds[sh.ri];
  if (!p || !round){ closeDialog('sheet'); return; }
  const existing = round.entries[p.id];
  const isCurrent = sh.ri === S.rounds.length - 1;
  const c = sheetScore();
  const base = total(p.id) - (existing ? existing.score : 0);
  const body = document.querySelector('#sheet .sheet-body');
  const keepScroll = body ? body.scrollTop : 0;

  const switcher = isCurrent && S.players.length > 1 ? `<div class="switcher" role="tablist" aria-label="Player">${S.players.map(q => {
    const done = !!round.entries[q.id];
    return `<button class="sw ${q.id === p.id ? 'on' : ''}" style="--pc:var(--p${q.c})" data-action="sheet-player" data-pid="${q.id}" role="tab" aria-selected="${q.id === p.id}">
      ${avatar(q)}${esc(truncate(q.name, 10))}${done ? `<span class="ok" aria-label="scored">✓</span>` : ''}</button>`;
  }).join('')}</div>` : '';

  const cards = `
    <div class="sec-label">Number cards <span class="count">${sh.nums.size}/7${sh.nums.size === 7 ? ' 🎉' : ''}</span></div>
    <div class="num-grid">${NUMS.map(n => {
      const on = sh.nums.has(n);
      return `<button class="ncard ${!on && sh.nums.size >= 7 ? 'dim' : ''}" data-action="num" data-n="${n}" aria-pressed="${on}">${n}</button>`;
    }).join('')}</div>
    <div class="sec-label">Modifiers</div>
    <div class="mod-grid">${MODS.map(m => `<button class="mcard" data-action="mod" data-m="${m.id}" aria-pressed="${sh.mods.has(m.id)}">${m.label || m.id}</button>`).join('')}</div>`;

  const manual = `<div class="manual">
      <label class="sr-only" for="manual-input">Points this round</label>
      <input id="manual-input" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="3" placeholder="0" value="${esc(sh.manual)}" data-input="manual" autocomplete="off">
      <small>Type the points they banked this round</small>
    </div>`;

  $('#sheet').innerHTML = `<div class="sheet-panel" style="--pc:var(--p${p.c})">
    <div class="sheet-grab" aria-hidden="true"></div>
    <div class="sheet-head">
      ${avatar(p, 'lg')}
      <div class="ttl"><b>${esc(p.name)}</b><span>Round ${sh.ri + 1}${existing ? ' · editing' : ''}${S.players[dealerIdx(sh.ri)] === p ? ' · dealer' : ''}</span></div>
      <button class="icon-btn" data-action="close-sheet" aria-label="Close">${ic('close')}</button>
    </div>
    ${switcher}
    <div class="sheet-body">
      <div class="segmented sm" role="group" aria-label="Entry mode">
        <button data-action="mode" data-v="cards" aria-pressed="${sh.mode === 'cards'}">Tap cards</button>
        <button data-action="mode" data-v="total" aria-pressed="${sh.mode === 'total'}">Type total</button>
      </div>
      ${sh.mode === 'cards' ? cards : manual}
    </div>
    <div class="sheet-foot">
      <div class="preview" aria-live="polite">
        <div>
          <div class="pts ${c.score ? '' : 'zero'}" id="pv-pts">+${c.score}${c.flip7 ? '<span class="f7-flash">Flip 7!</span>' : ''}</div>
          <div class="math" id="pv-math">${esc(mathText(c))}</div>
        </div>
        <div class="tot">Total<b id="pv-tot">${base} → ${base + c.score}</b></div>
      </div>
      <div class="foot-btns">
        <button class="btn btn-danger-soft btn-lg" data-action="bust">Bust</button>
        <button class="btn btn-good btn-lg" data-action="bank" id="bank-btn">Bank +${c.score}</button>
      </div>
      ${existing ? `<div class="foot-extra"><button class="btn-link" data-action="clear-entry">Clear this entry</button></div>` : ''}
    </div>
  </div>`;
  const nb = document.querySelector('#sheet .sheet-body');
  if (nb) nb.scrollTop = keepScroll;
}

/** Lightweight update while typing so the input keeps focus. */
function updateSheetPreview(){
  const c = sheetScore();
  const p = player(ui.sheet.pid);
  const ex = S.rounds[ui.sheet.ri].entries[p.id];
  const base = total(p.id) - (ex ? ex.score : 0);
  const pts = $('#pv-pts');
  pts.textContent = `+${c.score}`;
  pts.classList.toggle('zero', !c.score);
  $('#pv-math').textContent = mathText(c);
  $('#pv-tot').textContent = `${base} → ${base + c.score}`;
  $('#bank-btn').textContent = `Bank +${c.score}`;
}

function saveEntry(entry, desc){
  const sh = ui.sheet;
  const p = player(sh.pid);
  const isCurrent = sh.ri === S.rounds.length - 1;
  commit(desc, () => { S.rounds[sh.ri].entries[p.id] = entry; });
  haptic(entry.bust ? [60, 40, 60] : 25);
  if (entry.flip7 && isCurrent && !isComplete(curRound())) toast(`Flip 7! The round is over. Enter everyone else's points.`, 3600);
  else toast(entry.bust ? `${p.name} busted` : `${p.name} +${entry.score} → ${total(p.id)}`);
  advanceSheet();
}

/** After saving, jump to the next unscored player in seat order, or close. */
function advanceSheet(){
  const sh = ui.sheet;
  const r = S.rounds[sh.ri];
  if (sh.ri !== S.rounds.length - 1 || isComplete(r)){ closeDialog('sheet'); render(); return; }
  const n = S.players.length;
  const from = S.players.findIndex(p => p.id === sh.pid);
  for (let k = 1; k < n; k++){
    const q = S.players[(from + k) % n];
    if (!r.entries[q.id]){ openSheet(q.id, sh.ri); return; }
  }
  closeDialog('sheet');
}

/* ───────────────────────── Game lifecycle ───────────────────────── */
function addPlayer(name){
  name = (name || '').trim().replace(/\s+/g, ' ').slice(0, 16);
  if (!name) return false;
  if (S.players.length >= MAX_PLAYERS){ toast('Max 8 players'); return false; }
  if (S.players.some(p => p.name.toLowerCase() === name.toLowerCase())){ toast(`${name} is already playing`); return false; }
  const used = new Set(S.players.map(p => p.c));
  const c = [0,1,2,3,4,5,6,7].find(i => !used.has(i));
  S.players.push({id:uid(), name, c});
  persist();
  return true;
}

function startGame(){
  if (S.players.length < 2) return;
  S.firstDealer = Math.min(S.firstDealer, S.players.length - 1);
  const names = S.players.map(p => p.name);
  prefs.recent = [...names, ...prefs.recent.filter(r => !names.some(n => n.toLowerCase() === r.toLowerCase()))].slice(0, 20);
  savePrefs();
  undoStack = [];
  S.phase = 'game'; S.rounds = [{entries:{}}]; S.startedAt = Date.now(); S.gameId = uid();
  ui.tab = 'board';
  persist(); render();
  window.scrollTo(0, 0);
}

function playAgain(){
  // Same players; the next player round the table deals first.
  const fd = (S.firstDealer + 1) % S.players.length;
  S = {...newState(S.players, S.target, fd), phase:'game', rounds:[{entries:{}}], startedAt:Date.now()};
  undoStack = [];
  ui.tab = 'board';
  persist(); render();
  window.scrollTo(0, 0);
  toast('New game. Good luck!');
}

function toSetup(){
  S = newState(S.players, S.target, S.firstDealer);
  undoStack = [];
  persist(); render();
  window.scrollTo(0, 0);
}

function shareText(){
  const sorted = S.players.map(p => ({p, t:total(p.id)})).sort((a, b) => b.t - a.t);
  const o = outcome();
  const head = o.finished ? `🏆 ${o.top[0].name} wins Flip 7 with ${o.max}!` : `Flip 7, round ${S.rounds.length}`;
  return `${head}\n${sorted.map((x, i) => `${i + 1}. ${x.p.name}: ${x.t}`).join('\n')}\n(${plural(S.rounds.length, 'round')}, to ${S.target})`;
}
async function share(){
  const text = shareText();
  try{
    if (navigator.share){ await navigator.share({title:'Flip 7 results', text}); return; }
    await navigator.clipboard.writeText(text);
    toast('Results copied');
  }catch(err){
    if (err && err.name === 'AbortError') return;
    toast('Could not share');
  }
}

/* ───────────────────────── Menu ───────────────────────── */
function renderMenu(){
  const inGame = S.phase === 'game';
  const last = undoStack[undoStack.length - 1];
  const canInstall = !isStandalone() && (deferredInstall || isIOS());
  $('#menu').innerHTML = `<div class="sheet-panel">
    <div class="sheet-grab" aria-hidden="true"></div>
    <div class="sheet-head"><div class="ttl"><b>Menu</b></div><button class="icon-btn" data-action="close-menu" aria-label="Close">${ic('close')}</button></div>
    <div class="sheet-body">
      ${inGame ? `<div class="menu-group menu-list">
        <button class="menu-item" data-action="undo" ${last ? '' : 'disabled'}>${ic('undo')} Undo <small>${last ? esc(last.desc) : 'Nothing to undo'}</small></button>
        <button class="menu-item" data-action="share">${ic('share')} Share scores</button>
      </div>
      <div class="menu-group">
        <div class="sec-label">Play to</div>
        <div class="target-row">
          <div class="segmented sm" role="group">${PRESETS.map(v => `<button data-action="target" data-v="${v}" aria-pressed="${S.target === v}">${v}</button>`).join('')}</div>
          <input class="num-input" style="height:44px" type="number" inputmode="numeric" min="25" max="9999" value="${PRESETS.includes(S.target) ? '' : S.target}" placeholder="Other" data-input="target">
        </div>
      </div>` : ''}
      <div class="menu-group">
        <div class="sec-label">Theme</div>
        <div class="segmented sm" role="group" aria-label="Theme">
          ${['system','light','dark'].map(t => `<button data-action="theme" data-v="${t}" aria-pressed="${prefs.theme === t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}
        </div>
      </div>
      ${canInstall ? `<div class="menu-group menu-list">
        <button class="menu-item" data-action="install">${ic('install')} Install app <small>${deferredInstall ? 'Works offline' : 'Share → Add to Home Screen'}</small></button>
      </div>` : ''}
      ${inGame ? `<div class="menu-group menu-list">
        <button class="menu-item" data-action="restart">${ic('play')} Restart with same players</button>
        <button class="menu-item" data-action="new-players">${ic('users')} Change players</button>
        <button class="menu-item danger" data-action="end-game">${ic('flag')} End game now</button>
      </div>` : ''}
      <div class="menu-group menu-list">
        <button class="menu-item danger" data-action="clear-all">${ic('trash')} Clear everything <small>Players, scores and records</small></button>
      </div>
      ${rulesCard()}
    </div>
  </div>`;
}

/* ───────────────────────── Actions ───────────────────────── */
const actions = {
  undo(){ closeDialog('menu'); undo(); },
  menu(){ renderMenu(); openDialog('menu'); },
  'close-menu'(){ closeDialog('menu'); },
  tab(el){ ui.tab = el.dataset.tab; render(); window.scrollTo(0, 0); },

  'add-recent'(el){ if (addPlayer(el.dataset.name)) render(); },
  'set-dealer'(el){ S.firstDealer = +el.dataset.i; persist(); render(); },
  move(el){
    const i = +el.dataset.i, j = i + +el.dataset.dir;
    if (j < 0 || j >= S.players.length) return;
    const dealerId = S.players[S.firstDealer] && S.players[S.firstDealer].id;
    [S.players[i], S.players[j]] = [S.players[j], S.players[i]];
    S.firstDealer = Math.max(0, S.players.findIndex(p => p.id === dealerId));
    persist(); render();
  },
  remove(el){
    const i = +el.dataset.i;
    const dealerId = S.players[S.firstDealer] && S.players[S.firstDealer].id;
    S.players.splice(i, 1);
    S.firstDealer = Math.max(0, S.players.findIndex(p => p.id === dealerId));
    persist(); render();
  },
  target(el){ setTarget(+el.dataset.v); },
  start: startGame,

  score(el){ openSheet(el.dataset.pid); },
  'edit-cell'(el){ openSheet(el.dataset.pid, +el.dataset.ri); },
  order(el){ prefs.order = el.dataset.v; savePrefs(); render(); },
  'next-round'(){
    commit(`Start round ${S.rounds.length + 1}`, () => S.rounds.push({entries:{}}));
    window.scrollTo(0, 0);
    toast(`Round ${S.rounds.length}: ${S.players[dealerIdx(S.rounds.length - 1)].name} deals`);
  },

  'sheet-player'(el){ openSheet(el.dataset.pid, ui.sheet.ri); },
  'close-sheet'(){ closeDialog('sheet'); },
  mode(el){
    const sh = ui.sheet;
    sh.mode = el.dataset.v;
    prefs.entry = sh.mode; savePrefs();
    if (sh.mode === 'total' && !sh.manual){ const c = calc([...sh.nums], [...sh.mods]); if (sh.nums.size || sh.mods.size) sh.manual = String(c.score); }
    renderSheet();
    if (sh.mode === 'total') setTimeout(() => { const i = $('#manual-input'); if (i){ i.focus(); i.select(); } }, 50);
  },
  num(el){
    const n = +el.dataset.n, s = ui.sheet.nums;
    if (s.has(n)) s.delete(n);
    else if (s.size >= 7){ toast('7 cards is the max. That\'s a Flip 7!'); return; }
    else { s.add(n); haptic(10); if (s.size === 7) haptic([20, 30, 20, 30, 60]); }
    renderSheet();
  },
  mod(el){
    const m = el.dataset.m, s = ui.sheet.mods;
    s.has(m) ? s.delete(m) : s.add(m);
    haptic(10);
    renderSheet();
  },
  bank(){
    const c = sheetScore();
    if (!c.valid){ toast(ui.sheet.mode === 'total' ? 'Type their points first' : 'Pick their cards, or tap Bust'); return; }
    if (c.score > 999){ toast('That score looks too high'); return; }
    const entry = c.manual ? {score:c.score, manual:true} : {score:c.score, nums:c.nums, mods:c.mods};
    if (c.flip7) entry.flip7 = true;
    saveEntry(entry, `${player(ui.sheet.pid).name} +${c.score}`);
  },
  bust(){ saveEntry({score:0, bust:true}, `${player(ui.sheet.pid).name} bust`); },
  'clear-entry'(){
    const sh = ui.sheet, p = player(sh.pid);
    commit(`Clear ${p.name}, round ${sh.ri + 1}`, () => { delete S.rounds[sh.ri].entries[p.id]; });
    closeDialog('sheet');
  },

  'play-again': playAgain,
  'new-players': async () => {
    closeDialog('menu');
    if (!outcome().finished && S.rounds.some(r => Object.keys(r.entries).length) &&
      !await confirmBox({title:'Leave this game?', body:'Scores from the current game will be discarded.', ok:'Change players', danger:true})) return;
    toSetup();
  },
  async restart(){
    closeDialog('menu');
    if (!outcome().finished && S.rounds.some(r => Object.keys(r.entries).length) &&
      !await confirmBox({title:'Restart the game?', body:'Everyone goes back to 0. This can\'t be undone.', ok:'Restart', danger:true})) return;
    playAgain();
  },
  async 'end-game'(){
    closeDialog('menu');
    const o = outcome();
    const lead = o.top.length === 1 && o.max > 0 ? `${o.top[0].name} leads with ${o.max}.` : 'Nobody is ahead.';
    if (!await confirmBox({title:'End the game now?', body:`${lead} The current round is dropped if it isn't finished, and the leader wins.`, ok:'End game', danger:true})) return;
    commit('End game', () => {
      const r = curRound();
      if (!isComplete(r) && S.rounds.length > 1) S.rounds.pop();
      else if (!isComplete(r)) S.players.forEach(p => { if (!r.entries[p.id]) r.entries[p.id] = {score:0, manual:true}; });
      S.ended = true;
    });
    ui.tab = 'board'; render();
    if (!outcome().finished) toast('It\'s a tie. Play one more round to settle it.', 3200);
  },
  share,
  async 'clear-all'(){
    closeDialog('menu');
    if (!await confirmBox({title:'Clear everything?', body:'Removes all players, scores, past games and saved names from this device.', ok:'Clear', danger:true})) return;
    [K.state, K.undo, K.log, K.legacy].forEach(k => store.del(k));
    gameLog = []; prefs.recent = []; savePrefs();
    S = newState(); undoStack = []; ui.tab = 'board';
    persist(); render();
    window.scrollTo(0, 0);
    toast('All cleared');
  },
  async 'clear-log'(){
    if (!await confirmBox({title:'Clear all-time records?', body:'This removes the saved results of finished games.', ok:'Clear', danger:true})) return;
    gameLog = [];
    persist(); render();
  },

  theme(el){ prefs.theme = el.dataset.v; savePrefs(); applyTheme(); renderMenu(); },
  async install(){
    if (deferredInstall){
      deferredInstall.prompt();
      const r = await deferredInstall.userChoice.catch(() => null);
      deferredInstall = null;
      if (r && r.outcome === 'accepted') toast('Installing…');
      closeDialog('menu'); render();
    } else {
      confirmBox({title:'Install on iPhone or iPad', body:'In Safari, tap the Share button, then "Add to Home Screen". The app then opens full screen and works offline.', ok:'Got it'});
    }
  },
  'apply-update'(){
    if (waitingWorker) waitingWorker.postMessage('skip-waiting');
    else location.reload();
  },
};

function setTarget(v){
  v = Math.round(v);
  if (!Number.isFinite(v) || v < 25 || v > 9999){ toast('Pick a target between 25 and 9999'); render(); if ($('#menu').open) renderMenu(); return; }
  if (S.phase === 'game' && v !== S.target) commit(`Target ${S.target} → ${v}`, () => { S.target = v; });
  else { S.target = v; persist(); render(); }
  if ($('#menu').open) renderMenu();
}

/* ───────────────────────── Events ───────────────────────── */
document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.action];
  if (fn) fn(el, e);
});

document.addEventListener('submit', e => {
  const f = e.target.closest('[data-form="add-player"]');
  if (!f) return;
  e.preventDefault();
  const input = $('#name-input');
  if (addPlayer(input.value)){
    render();
    const ni = $('#name-input');
    if (ni && !ni.disabled) ni.focus();
  }
});

document.addEventListener('change', e => {
  if (e.target.dataset.input === 'target' && e.target.value !== '') setTarget(+e.target.value);
});

document.addEventListener('input', e => {
  if (e.target.dataset.input === 'manual'){
    const v = e.target.value.replace(/\D/g, '').slice(0, 3);
    if (v !== e.target.value) e.target.value = v;
    ui.sheet.manual = v;
    updateSheetPreview();
  }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.dataset.input === 'manual'){ e.preventDefault(); actions.bank(); }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.target.matches('input')){ e.preventDefault(); undo(); }
});

// Tap on the dimmed backdrop closes sheets.
['sheet', 'menu'].forEach(id => {
  const d = document.getElementById(id);
  d.addEventListener('click', e => { if (e.target === d) d.close(); });
});
$('#sheet').addEventListener('close', () => { ui.sheet = null; });

let resizeTimer;
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (ui.tab === 'stats' && S.phase === 'game') drawChart(); }, 150); });

/* ───────────────────────── Screen wake lock ───────────────────────── */
let wakeLock = null;
async function keepAwake(){
  if (S.phase !== 'game' || !('wakeLock' in navigator) || document.visibilityState !== 'visible' || wakeLock) return;
  try{
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  }catch{ wakeLock = null; }
}
document.addEventListener('visibilitychange', keepAwake);

/* ───────────────────────── Install & offline ───────────────────────── */
let deferredInstall = null, waitingWorker = null;
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function installCard(){
  if (isStandalone() || (!deferredInstall && !isIOS()) || prefs.hideInstall) return '';
  return `<div class="card install-card">
    <span class="brand-mark" aria-hidden="true" style="width:44px;height:44px;font-size:1.4rem;border-radius:12px">7</span>
    <div class="txt"><b>Install the app</b>Full screen, works offline, one tap from your home screen.</div>
    <button class="btn btn-primary" data-action="install">Install</button>
  </div>`;
}

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredInstall = e;
  if (S.phase === 'setup') render();
});
window.addEventListener('appinstalled', () => { deferredInstall = null; toast('Installed! Find Flip 7 on your home screen.'); render(); });

if ('serviceWorker' in navigator && location.protocol !== 'file:'){
  window.addEventListener('load', async () => {
    try{
      const reg = await navigator.serviceWorker.register('sw.js');
      const track = w => {
        if (!w) return;
        w.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller){ waitingWorker = w; $('#update-bar').hidden = false; }
        });
      };
      if (reg.waiting && navigator.serviceWorker.controller){ waitingWorker = reg.waiting; $('#update-bar').hidden = false; }
      reg.addEventListener('updatefound', () => track(reg.installing));
      let reloading = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => { if (waitingWorker && !reloading){ reloading = true; location.reload(); } });
    }catch{}
  });
}

/* ───────────────────────── Boot ───────────────────────── */
(function boot(){
  document.querySelector('[data-action="menu"]').innerHTML = ic('menu', 22);
  $('#undo-btn').innerHTML = `${ic('undo')}<span>Undo</span>`;
  const tabs = {board:['board', 'Scores'], history:['history', 'History'], stats:['stats', 'Stats']};
  document.querySelectorAll('.tab').forEach(t => { const [i, l] = tabs[t.dataset.tab]; t.innerHTML = `${ic(i, 22)}<span>${l}</span>`; });
  applyTheme();
  if (S.phase === 'game' && !S.rounds.length) S.rounds.push({entries:{}});
  persist();
  render();
})();
