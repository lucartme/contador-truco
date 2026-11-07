/* Truco Paulista — marcador de pontos (PWA, JS puro) */
'use strict';

const STORE_KEY = 'truco.v1';
const MAX = 12;
const LADDER = [1, 3, 6, 9, 12];
const RAISE_NAME = { 3: 'Truco', 6: 'Seis', 9: 'Nove', 12: 'Doze' };
const TEAM_SUIT = { a: { s: '♠', red: false }, b: { s: '♥', red: true } };

/* ================= Armazenamento ================= */
function defaultDb() {
  return {
    version: 1,
    settings: { currency: 'R$', rotateTop: false, wakeLock: true },
    teams: [],
    history: [],
    current: null,
  };
}
function normalizeDb(d) {
  const base = defaultDb();
  if (!d || typeof d !== 'object') return base;
  return {
    version: 1,
    settings: { ...base.settings, ...(d.settings || {}) },
    teams: Array.isArray(d.teams) ? d.teams : [],
    history: Array.isArray(d.history) ? d.history : [],
    current: d.current && d.current.teams ? d.current : null,
  };
}
function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return normalizeDb(JSON.parse(raw));
  } catch (e) { /* ignora */ }
  return defaultDb();
}
let db = load();
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(db)); }
  catch (e) { toast('Não foi possível guardar os dados'); }
}

/* ================= Utilitários ================= */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const other = (t) => (t === 'a' ? 'b' : 'a');
const pad = (n) => String(n).padStart(2, '0');
const norm = (s) => String(s || '').trim().toLocaleLowerCase('pt-BR');
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtMoney(v) {
  const cur = db.settings.currency || 'R$';
  const n = Math.abs(Number(v) || 0);
  const s = Number.isInteger(n) ? String(n) : n.toFixed(2).replace('.', ',');
  return cur + s;
}
function fmtSigned(v) {
  if (!v) return fmtMoney(0);
  return (v > 0 ? '+' : '-') + fmtMoney(v);
}
function parseMoney(s) {
  const t = String(s || '').replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  const n = parseFloat(t);
  return isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
}
function fmtDate(ts, withYear) {
  const d = new Date(ts);
  const base = pad(d.getDate()) + '/' + pad(d.getMonth() + 1);
  return withYear ? `${base}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}` : base;
}
function haptic(ms = 12) { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) { /* */ } }

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
}

/* ================= Times ================= */
function teamById(id) { return db.teams.find((t) => t.id === id); }
function teamName(m, t) { return (m.teams[t] && m.teams[t].name) || (t === 'a' ? 'Nós' : 'Eles'); }
function nameOfSnap(snap) {
  const saved = snap && teamById(snap.id);
  return (saved && saved.name) || (snap && snap.name) || '?';
}
function upsertTeam(name, players) {
  const clean = name.trim();
  let t = db.teams.find((x) => norm(x.name) === norm(clean));
  if (!t) {
    t = { id: uid(), name: clean, players: [], createdAt: Date.now() };
    db.teams.push(t);
  }
  t.name = clean;
  if (players.some((p) => p)) t.players = players.slice();
  return t;
}

/* Nome automático: 3 primeiras letras de cada jogador (Luca, Heitor → luc-hei) */
function autoTeamName(players) {
  return (players || [])
    .map((p) => String(p || '').trim().split(/\s+/)[0])
    .filter(Boolean)
    .map((p) => Array.from(p).slice(0, 3).join('').toLocaleLowerCase('pt-BR'))
    .join('-');
}
function isAutoName(name, players) {
  const n = norm(name);
  return !n || n === 'nós' || n === 'nos' || n === 'eles' || n === norm(autoTeamName(players));
}

/* ================= Partida ================= */
function freshHand() { return { value: 1, raiser: null, ack: null }; }
function createMatch({ a, b, n, dealer, bet = 0, swapped = false }) {
  return {
    id: uid(), startedAt: Date.now(),
    teams: { a, b }, n,
    score: { a: 0, b: 0 },
    hand: freshHand(),
    dealer, bet, swapped,
    finished: false, winner: null, historyId: null,
    undo: [],
  };
}
function seats(m) {
  const s = [];
  for (let i = 0; i < m.n; i++) { s.push({ t: 'a', i }); s.push({ t: 'b', i }); }
  return s;
}
function playerName(m, seat) {
  const p = (m.teams[seat.t].players || [])[seat.i];
  return (p && p.trim()) || `${teamName(m, seat.t)} ${seat.i + 1}`;
}
function dealerSeat(m) { const s = seats(m); return s[((m.dealer % s.length) + s.length) % s.length]; }
function starterSeat(m) { const s = seats(m); return s[(m.dealer + 1) % s.length]; }

function special(m) {
  if (!m || m.finished) return null;
  const { a, b } = m.score;
  if (a === 11 && b === 11) return 'cega';
  if (a === 11 && b < 11) return 'onze-a';
  if (b === 11 && a < 11) return 'onze-b';
  return null;
}
function nextRaise(v) { const i = LADDER.indexOf(v); return i >= 0 && i < LADDER.length - 1 ? LADDER[i + 1] : null; }

function snapshot(m) { const { undo, ...rest } = m; return JSON.stringify(rest); }
function pushUndo() {
  const m = db.current;
  m.undo.push(snapshot(m));
  if (m.undo.length > 60) m.undo.shift();
}
function undo() {
  const m = db.current;
  if (!m || !m.undo.length) { toast('Nada para desfazer'); return; }
  const prev = JSON.parse(m.undo.pop());
  if (m.historyId && prev.historyId !== m.historyId) {
    db.history = db.history.filter((h) => h.id !== m.historyId);
  }
  // nomes, jogadores e posição dos times não fazem parte do desfazer
  prev.teams = m.teams;
  prev.swapped = m.swapped;
  prev.undo = m.undo;
  db.current = prev;
  save();
  closeModal(true);
  haptic();
  toast('Ação desfeita');
  render();
  checkSpecial();
}

function addPoints(t, pts) {
  const m = db.current;
  m.score[t] = Math.min(MAX, m.score[t] + pts);
  if (m.score[t] >= MAX && !m.finished) finish(t);
}
function nextHand() {
  const m = db.current;
  m.hand = freshHand();
  m.dealer = (m.dealer + 1) % (2 * m.n);
}
function finish(t) {
  const m = db.current;
  m.finished = true;
  m.winner = t;
  const entry = {
    id: uid(), date: Date.now(), matchId: m.id,
    teams: {
      a: { id: m.teams.a.id, name: m.teams.a.name, players: m.teams.a.players.slice(0, m.n) },
      b: { id: m.teams.b.id, name: m.teams.b.name, players: m.teams.b.players.slice(0, m.n) },
    },
    score: { ...m.score }, winner: t, bet: m.bet || 0,
  };
  db.history.push(entry);
  m.historyId = entry.id;
}

function afterChange(opts = {}) {
  save();
  render();
  updateWakeLock();
  const m = db.current;
  if (m && m.finished && opts.showEnd !== false) { setTimeout(showEnd, 350); return; }
  checkSpecial();
}

/* ---- Ações ---- */
function winHand(t) {
  const m = db.current;
  if (!m || m.finished) return;
  const sp = special(m);
  if (sp && m.hand.ack !== sp) { checkSpecial(); return; }
  pushUndo();
  haptic(20);
  addPoints(t, m.hand.value);
  nextHand();
  afterChange();
}
function adjust(t, d) {
  const m = db.current;
  if (!m || m.finished) return;
  const nv = Math.max(0, Math.min(MAX, m.score[t] + d));
  if (nv === m.score[t]) return;
  pushUndo();
  const before = special(m);
  m.score[t] = nv;
  if (nv >= MAX) finish(t);
  if (special(m) !== before) m.hand = freshHand();
  haptic();
  afterChange();
}

function onTruco() {
  const m = db.current;
  if (!m) return;
  if (m.finished) { showEnd(); return; }
  if (special(m)) return;
  const next = nextRaise(m.hand.value);
  if (!next) return;
  pushUndo();
  m.hand.value = next;
  haptic(25);
  afterChange();
}

/* ---- Mão de onze / mão cega ---- */
function checkSpecial() {
  const m = db.current;
  if (!m || m.finished || modalOpen()) return;
  const sp = special(m);
  if (!sp || m.hand.ack === sp) return;
  if (sp === 'cega') {
    openModal({
      suit: '♦', index: '11', dismiss: false,
      kicker: '11 × 11',
      title: 'Mão cega!',
      html: `<div class="m-text">Todos jogam <b>sem ver as cartas</b>.<br>A mão vale <b>1 ponto</b> e quem ganhar <b>leva a partida</b>.</div>
             <div class="m-stamp">Truco desativado</div>`,
      actions: [{ label: 'Jogar', cls: 'gold', onClick: () => {
        pushUndo();
        m.hand = { value: 1, raiser: null, ack: 'cega' };
        afterChange();
      } }],
    });
    return;
  }
  const t = sp === 'onze-a' ? 'a' : 'b';
  const o = other(t);
  openModal({
    suit: TEAM_SUIT[t].s, red: TEAM_SUIT[t].red, index: '11', dismiss: false,
    kicker: 'Mão de onze',
    title: teamName(m, t),
    html: `<div class="m-text"><b>${esc(teamName(m, t))}</b> chegou a 11 e decide (pode ver as cartas do parceiro):</div>
           <div class="m-text">Jogar: a mão vale <b>3 pontos</b>.<br>Correr: <b>${esc(teamName(m, o))}</b> ganha <b>1 ponto</b>.</div>
           <div class="m-stamp">Truco desativado</div>`,
    actions: [{ row: [
      { label: 'Jogar (3)', cls: 'gold', onClick: () => {
        pushUndo();
        m.hand = { value: 3, raiser: null, ack: sp };
        haptic(20);
        afterChange();
        bumpHandValue();
      } },
      { label: 'Correr', cls: 'petrol', onClick: () => {
        pushUndo();
        addPoints(o, 1);
        nextHand();
        afterChange();
      } },
    ] }],
  });
}

/* ---- Aposta ---- */
function openBet() {
  const m = db.current;
  if (!m) return;
  if (m.finished) { toast('A partida já terminou'); return; }
  const presets = [5, 10, 20, 50, 100];
  openModal({
    suit: '♦', red: true, index: '$',
    kicker: 'Aposta da partida',
    title: 'Apostar',
    html: `<div class="m-text">Valor em dinheiro que o vencedor da partida leva.</div>
      <div class="field"><label for="betInp">Valor (${esc(db.settings.currency)})</label>
      <input id="betInp" class="inp" inputmode="decimal" autocomplete="off" placeholder="0" value="${m.bet ? String(m.bet).replace('.', ',') : ''}"></div>
      <div class="chips" style="justify-content:center;flex-wrap:wrap">${presets.map((p) => `<button class="chip" data-bet="${p}">${esc(fmtMoney(p))}</button>`).join('')}</div>`,
    onOpen: (root) => {
      $$('[data-bet]', root).forEach((b) => b.addEventListener('click', () => { $('#betInp', root).value = b.dataset.bet; }));
    },
    actions: [
      { label: 'Guardar aposta', cls: 'gold', onClick: (root) => {
        const v = parseMoney($('#betInp', root).value);
        pushUndo();
        m.bet = v;
        afterChange();
        toast(v ? `Aposta: ${fmtMoney(v)}` : 'Sem aposta');
      } },
      ...(m.bet ? [{ label: 'Remover aposta', cls: 'petrol', onClick: () => { pushUndo(); m.bet = 0; afterChange(); toast('Aposta removida'); } }] : []),
      { label: 'Cancelar', cls: 'ghost' },
    ],
  });
}

/* ---- Editar time ---- */
function editTeamModal(teamRec, { onSave, n = 3, title = 'Editar time' }) {
  const players = teamRec.players || [];
  let inputs = '';
  for (let i = 0; i < n; i++) {
    inputs += `<div class="field"><label>Jogador ${i + 1}</label><input class="inp" data-p="${i}" value="${esc(players[i] || '')}" placeholder="Nome do jogador" autocomplete="off"></div>`;
  }
  openModal({
    suit: '♣', index: '✎',
    kicker: title,
    title: teamRec.name || 'Novo time',
    html: `<div class="field"><label>Nome do time</label><input class="inp" id="tmName" value="${esc(teamRec.name || '')}" autocomplete="off"></div>${inputs}`,
    onOpen: (root) => {
      let auto = isAutoName(teamRec.name, players.slice(0, n));
      const nameInp = $('#tmName', root);
      nameInp.addEventListener('input', () => { auto = !nameInp.value.trim(); });
      $$('[data-p]', root).forEach((inp) => inp.addEventListener('input', () => {
        if (!auto) return;
        const gen = autoTeamName($$('[data-p]', root).map((i) => i.value));
        if (gen) nameInp.value = gen;
      }));
    },
    actions: [
      { label: 'Guardar', cls: 'gold', onClick: (root) => {
        const name = $('#tmName', root).value.trim();
        if (!name) { toast('Escreve um nome'); return false; }
        const ps = $$('[data-p]', root).map((i) => i.value.trim());
        return onSave(name, ps);
      } },
      { label: 'Cancelar', cls: 'ghost' },
    ],
  });
}
function editCurrentTeam(t) {
  const m = db.current;
  if (!m) return;
  editTeamModal(m.teams[t], {
    n: m.n,
    onSave: (name, ps) => {
      if (norm(name) === norm(m.teams[other(t)].name)) { toast('Os times precisam de nomes diferentes'); return false; }
      const clash = db.teams.find((x) => norm(x.name) === norm(name) && x.id !== m.teams[t].id);
      if (clash) { toast('Já existe um time guardado com esse nome'); return false; }
      m.teams[t].name = name;
      m.teams[t].players = ps;
      const rec = teamById(m.teams[t].id);
      if (rec) { rec.name = name; rec.players = ps; }
      afterChange({ showEnd: false });
    },
  });
}

/* ---- Embaralhador ---- */
function pickDealer() {
  const m = db.current;
  if (!m || m.finished) return;
  const ss = seats(m);
  const btns = ss.map((s, i) => `<button class="btn ${i === m.dealer ? 'on' : ''}" data-seat="${i}">${TEAM_SUIT[s.t].s} ${esc(playerName(m, s))} <small style="opacity:.6">(${esc(teamName(m, s.t))})</small></button>`).join('');
  openModal({
    suit: '♠', index: '🂠',
    kicker: 'Quem embaralha?',
    title: 'Embaralhador',
    html: `<div class="m-text">Ordem à mesa, para a direita:</div><div class="m-pick">${btns}</div>`,
    onOpen: (root) => {
      $$('[data-seat]', root).forEach((b) => b.addEventListener('click', () => {
        pushUndo();
        m.dealer = Number(b.dataset.seat);
        closeModal();
        afterChange();
      }));
    },
    actions: [
      { label: '🎲 Sortear', cls: 'petrol', onClick: () => {
        pushUndo();
        m.dealer = Math.floor(Math.random() * ss.length);
        afterChange();
        toast(`Sorteado: ${playerName(m, dealerSeat(m))} embaralha`);
      } },
      { label: 'Cancelar', cls: 'ghost' },
    ],
  });
}

/* ================= Confronto direto & partilha ================= */
function h2h(idA, idB, uptoId) {
  let wa = 0, wb = 0, bal = 0; // bal > 0 → A à frente
  for (const h of db.history) {
    const ids = [h.teams.a.id, h.teams.b.id];
    if (ids.includes(idA) && ids.includes(idB)) {
      const winId = h.teams[h.winner].id;
      if (winId === idA) { wa++; bal += h.bet || 0; } else { wb++; bal -= h.bet || 0; }
    }
    if (uptoId && h.id === uptoId) break;
  }
  return { wa, wb, bal: Math.round(bal * 100) / 100 };
}
function shareText(h) {
  const A = nameOfSnap(h.teams.a), B = nameOfSnap(h.teams.b);
  const r = h2h(h.teams.a.id, h.teams.b.id, h.id);
  const line = h.winner === 'a'
    ? `✅ ${A} ${h.score.a} x ${h.score.b} ${B}`
    : `${A} ${h.score.a} x ${h.score.b} ${B} ✅`;
  const lines = [
    `🃏 Truco — ${fmtDate(h.date)}`,
    line,
    `Histórico: ${A} 🏆${r.wa} x 🏆${r.wb} ${B}`,
  ];
  if (h.bet) {
    const winName = h.winner === 'a' ? A : B;
    const balWinner = h.winner === 'a' ? r.bal : -r.bal;
    lines.push(`Aposta: ${fmtMoney(h.bet)} → ${winName} (saldo ${fmtSigned(balWinner)})`);
  }
  return lines.join('\n');
}
function shareWhatsApp(text) {
  const url = 'https://wa.me/?text=' + encodeURIComponent(text);
  const w = window.open(url, '_blank');
  if (!w) location.href = url;
}
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', '');
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select(); ta.setSelectionRange(0, text.length);
    try { document.execCommand('copy'); } catch (e2) { toast('Não foi possível copiar'); ta.remove(); return; }
    ta.remove();
  }
  toast('Mensagem copiada ✓');
}
function shareModal(h) {
  const text = shareText(h);
  openModal({
    suit: '♣', index: '↗',
    kicker: fmtDate(h.date, true),
    title: 'Partilhar',
    html: `<div class="m-msg">${esc(text)}</div>`,
    actions: [
      { label: 'Partilhar no WhatsApp', cls: 'wa', keepOpen: true, onClick: () => shareWhatsApp(text) },
      { label: 'Copiar mensagem', cls: '', keepOpen: true, onClick: () => copyText(text) },
      { label: 'Fechar', cls: 'ghost' },
    ],
  });
}

/* ---- Fim de partida ---- */
function showEnd() {
  const m = db.current;
  if (!m || !m.finished) return;
  const h = db.history.find((x) => x.id === m.historyId);
  const t = m.winner;
  const r = h2h(m.teams.a.id, m.teams.b.id, m.historyId);
  const text = h ? shareText(h) : '';
  const A = teamName(m, 'a'), B = teamName(m, 'b');
  let betHtml = '';
  if (m.bet) {
    const balWinner = t === 'a' ? r.bal : -r.bal;
    betHtml = `<div class="m-text">💰 Aposta: <b>${esc(fmtMoney(m.bet))}</b> → ${esc(teamName(m, t))}<br><span style="color:#6b6355">saldo acumulado ${esc(fmtSigned(balWinner))}</span></div>`;
  }
  openModal({
    suit: TEAM_SUIT[t].s, red: TEAM_SUIT[t].red, index: '12', dismiss: true,
    kicker: 'Fim de partida',
    title: `${teamName(m, t)} venceu!`,
    html: `<div class="m-crown">👑</div>
      <div class="m-big">${m.score.a} <span style="font-size:.5em;vertical-align:middle;color:#8a6a22">×</span> ${m.score.b}</div>
      <div class="m-text">${esc(A)} × ${esc(B)}</div>
      <div class="m-text">Histórico: ${esc(A)} 🏆${r.wa} × 🏆${r.wb} ${esc(B)}</div>
      ${betHtml}`,
    actions: [
      { label: 'Partilhar no WhatsApp', cls: 'wa', keepOpen: true, onClick: () => shareWhatsApp(text) },
      { label: 'Copiar mensagem', cls: '', keepOpen: true, onClick: () => copyText(text) },
      { row: [
        { label: 'Revanche', cls: 'gold', onClick: rematch },
        { label: 'Nova partida', cls: 'petrol', onClick: () => openScreen('new') },
      ] },
      { label: 'Ver placar / desfazer', cls: 'ghost' },
    ],
  });
}
function rematch() {
  const m = db.current;
  if (!m) return;
  const refresh = (snap) => {
    const rec = teamById(snap.id);
    return { id: snap.id, name: rec ? rec.name : snap.name, players: (rec && rec.players && rec.players.length ? rec.players : snap.players).slice() };
  };
  db.current = createMatch({ a: refresh(m.teams.a), b: refresh(m.teams.b), n: m.n, dealer: m.dealer % (2 * m.n), bet: m.bet, swapped: m.swapped });
  lastScores = null;
  afterChange();
  toast('Revanche! Boa sorte 🍀');
}

/* ================= Modal (carta) ================= */
let modalState = null;
function modalOpen() { return !$('#modal').hidden; }
function openModal(opts) {
  const modal = $('#modal');
  const front = $('#modalFront');
  const inner = $('#flipInner');
  const wasOpen = modalOpen();
  modalState = opts;
  const red = opts.red ? ' red' : '';
  const idx = esc(opts.index || '');
  const suit = opts.suit || '♠';
  let html = `<div class="m-idx tl${red}">${idx}<i>${suit}</i></div><div class="m-idx br${red}">${idx}<i>${suit}</i></div>
    <div class="m-body">
      ${opts.kicker ? `<div class="m-kicker">${esc(opts.kicker)}</div>` : ''}
      ${opts.title ? `<div class="m-title">${esc(opts.title)}</div>` : ''}
      ${opts.text ? `<div class="m-text">${esc(opts.text)}</div>` : ''}
      ${opts.html || ''}
    </div><div class="m-actions"></div>`;
  front.innerHTML = html;
  const actWrap = $('.m-actions', front);
  const mkBtn = (a) => {
    const b = document.createElement('button');
    b.className = 'btn block ' + (a.cls || '');
    b.textContent = a.label;
    b.addEventListener('click', () => {
      let res;
      if (a.onClick) res = a.onClick(front);
      if (res === false) return;
      if (!a.keepOpen && modalState === opts) closeModal();
    });
    return b;
  };
  (opts.actions || []).forEach((a) => {
    if (a.row) {
      const r = document.createElement('div');
      r.className = 'row';
      a.row.forEach((x) => r.appendChild(mkBtn(x)));
      actWrap.appendChild(r);
    } else actWrap.appendChild(mkBtn(a));
  });
  modal.hidden = false;
  front.scrollTop = 0;
  inner.classList.remove('flipping', 'reflip');
  void inner.offsetWidth;
  inner.classList.add(wasOpen ? 'reflip' : 'flipping');
  if (opts.onOpen) opts.onOpen(front);
}
function closeModal(silent) {
  const modal = $('#modal');
  if (modal.hidden) return;
  modal.hidden = true;
  modalState = null;
  $('#modalFront').innerHTML = '';
  if (!silent) setTimeout(checkSpecial, 50);
}
$('#modalBackdrop').addEventListener('click', () => {
  if (modalState && modalState.dismiss === false) return;
  closeModal();
});
function confirmModal({ title, text, ok = 'Confirmar', danger = false, onOk }) {
  openModal({
    suit: '♦', red: true, index: '?',
    kicker: 'Confirmar', title, text,
    actions: [
      { label: ok, cls: danger ? 'danger' : 'gold', onClick: onOk },
      { label: 'Cancelar', cls: 'ghost' },
    ],
  });
}

/* ================= Render do tabuleiro ================= */
function panelHTML() {
  return `<div class="tc-inner">
    <span class="idx idx-tl"><i class="suit"></i></span>
    <div class="tc-head"><h2 class="tc-name"></h2><button class="pencil" data-act="edit" aria-label="Editar nome">✎</button></div>
    <span class="idx idx-tr"><i class="suit"></i></span>
    <div class="tc-score-row">
      <button class="adj" data-act="minus" aria-label="Menos um">−1</button>
      <div class="tc-score">0</div>
      <button class="adj" data-act="plus" aria-label="Somar o valor da mão">+1</button>
    </div>
    <div class="trophy">🏆 <span class="tr-n">0</span></div>
    <button class="win-hand" data-act="win">Ganhou a mão <b>+1</b></button>
    <span class="idx idx-br"><i class="suit"></i></span>
  </div>`;
}
['#panelTop', '#panelBottom'].forEach((sel) => {
  const p = $(sel);
  p.innerHTML = panelHTML();
  p.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn || !db.current) return;
    const t = p.dataset.team;
    const act = btn.dataset.act;
    if (act === 'win') winHand(t);
    else if (act === 'plus') winHand(t);
    else if (act === 'minus') adjust(t, -1);
    else if (act === 'edit') editCurrentTeam(t);
  });
});

let lastScores = null;
let lastHandValue = 1;
function bumpHandValue() {
  const el = $('#handVal');
  el.classList.remove('rise'); void el.offsetWidth; el.classList.add('rise');
}
function render() {
  const m = db.current;
  $('#emptyState').hidden = !!m;
  $('#btnUndo').disabled = !m || !m.undo.length;
  $('#btnSwap').disabled = !m;
  if (!m) {
    ['#panelTop', '#panelBottom'].forEach((sel, i) => {
      const p = $(sel);
      p.dataset.team = i ? 'b' : 'a';
      $('.tc-name', p).textContent = i ? 'Eles' : 'Nós';
      $('.tc-score', p).textContent = '0';
      $('.trophy', p).classList.add('none');
    });
    $('#dealerName').textContent = '—';
    $('#starterName').textContent = '—';
    $('#btnTruco').disabled = true;
    $('#handValNum').textContent = '1';
    $('#handNote').textContent = '';
    $('#betLabel').textContent = 'Apostar';
    lastScores = null;
    return;
  }
  const top = m.swapped ? 'b' : 'a';
  const bottom = other(top);
  const rec = h2h(m.teams.a.id, m.teams.b.id);
  const wins = { a: rec.wa, b: rec.wb };
  const anyHist = rec.wa + rec.wb > 0;
  const sp = special(m);
  const blocked = m.finished || (sp && m.hand.ack !== sp);

  [['#panelTop', top], ['#panelBottom', bottom]].forEach(([sel, t]) => {
    const p = $(sel);
    p.dataset.team = t;
    p.classList.toggle('rotated', sel === '#panelTop' && !!db.settings.rotateTop);
    $('.tc-name', p).textContent = teamName(m, t);
    $$('.idx', p).forEach((el) => { el.classList.toggle('red', TEAM_SUIT[t].red); $('.suit', el).textContent = TEAM_SUIT[t].s; });
    const sc = $('.tc-score', p);
    sc.textContent = m.score[t];
    if (lastScores && lastScores[t] !== m.score[t]) {
      const cls = m.score[t] > lastScores[t] ? 'bump' : 'drop';
      sc.classList.remove('bump', 'drop'); void sc.offsetWidth; sc.classList.add(cls);
    }
    const tr = $('.trophy', p);
    tr.classList.toggle('none', !anyHist);
    $('.tr-n', tr).textContent = wins[t];
    const wb = $('.win-hand', p);
    wb.innerHTML = `Ganhou a mão <b>+${m.hand.value}</b>`;
    wb.disabled = !!blocked;
    $('[data-act="minus"]', p).disabled = m.finished || m.score[t] <= 0;
    const pb = $('[data-act="plus"]', p);
    pb.textContent = `+${m.hand.value}`;
    pb.disabled = !!blocked;
  });
  lastScores = { ...m.score };

  $('#dealerName').textContent = playerName(m, dealerSeat(m));
  $('#starterName').textContent = playerName(m, starterSeat(m));

  $('#handValNum').textContent = m.hand.value;
  if (m.hand.value > lastHandValue) bumpHandValue();
  lastHandValue = m.hand.value;

  const tb = $('#btnTruco');
  tb.classList.toggle('result', m.finished);
  const next = nextRaise(m.hand.value);
  if (m.finished) {
    tb.disabled = false;
    $('#trucoLabel').textContent = '🏁 Resultado';
    $('#trucoValue').textContent = '';
  } else if (sp) {
    tb.disabled = true;
    $('#trucoLabel').textContent = 'Truco desativado';
    $('#trucoValue').textContent = '';
  } else if (!next) {
    tb.disabled = true;
    $('#trucoLabel').textContent = 'Doze em jogo';
    $('#trucoValue').textContent = '';
  } else {
    tb.disabled = false;
    $('#trucoLabel').textContent = `${RAISE_NAME[next]}!`;
    $('#trucoValue').textContent = `(${next})`;
  }

  let note = '';
  if (m.finished) note = `Partida terminada — ${teamName(m, m.winner)} venceu`;
  else if (sp === 'cega') note = 'Mão cega (11×11) — quem ganhar leva a partida';
  else if (sp) note = `Mão de onze — ${teamName(m, sp === 'onze-a' ? 'a' : 'b')} ${m.hand.ack === sp ? 'joga valendo 3' : 'decide'}`;
  else if (m.hand.value > 1) note = `${RAISE_NAME[m.hand.value]}! — o “+” de quem ganhar a mão soma ${m.hand.value}`;
  $('#handNote').textContent = note;

  const bb = $('#btnBet');
  bb.classList.toggle('has-bet', !!m.bet);
  $('#betLabel').textContent = m.bet ? fmtMoney(m.bet) : 'Apostar';
}

/* ================= Ecrãs ================= */
let currentScreen = null;
let screenBack = null; // quando definido, o botão ‹ volta a um sub-ecrã em vez de fechar
function openScreen(name) {
  screenBack = null;
  closeDrawer();
  closeModal(true);
  currentScreen = name;
  const titles = { new: 'Nova partida', teams: 'Times guardados', history: 'Histórico', settings: 'Definições', data: 'Exportar / Importar' };
  $('#screenTitle').textContent = titles[name] || '';
  $('#screen').hidden = false;
  // novo elemento a cada ecrã para não acumular listeners
  const prevBody = $('#screenBody');
  const body = prevBody.cloneNode(false);
  prevBody.replaceWith(body);
  ({ new: screenNew, teams: screenTeams, history: screenHistory, settings: screenSettings, data: screenData })[name](body);
}
function closeScreen() {
  $('#screen').hidden = true;
  currentScreen = null;
  render();
  checkSpecial();
}
$('#screenBack').addEventListener('click', () => {
  if (screenBack) { const go = screenBack; screenBack = null; go(); return; }
  closeScreen();
});

/* ---- Nova partida ---- */
function screenNew(body) {
  const last = db.current || (db.history.length ? db.history[db.history.length - 1] : null);
  const fill = (t, fallback) => {
    if (last && last.teams && last.teams[t]) {
      const rec = teamById(last.teams[t].id);
      const src = rec || last.teams[t];
      const players = [0, 1, 2].map((i) => (src.players || [])[i] || '');
      return { name: src.name, players, auto: isAutoName(src.name, players), fallback };
    }
    return { name: fallback, players: ['', '', ''], auto: true, fallback };
  };
  const f = {
    a: fill('a', 'Nós'),
    b: fill('b', 'Eles'),
    n: (last && last.n) || (last && last.teams && last.teams.a.players ? Math.min(3, Math.max(1, last.teams.a.players.length)) : 2) || 2,
    dealer: 'random',
  };
  if (![1, 2, 3].includes(f.n)) f.n = 2;
  const refreshAutoName = (t) => {
    if (!f[t].auto) return;
    f[t].name = autoTeamName(f[t].players.slice(0, f.n)) || f[t].fallback;
    const inp = $(`[data-name="${t}"]`, body);
    if (inp) inp.value = f[t].name;
  };

  const teamBlock = (t) => `
    <div class="panel" data-team="${t}">
      <div class="team-label"><span class="${TEAM_SUIT[t].red ? 'suit-red' : ''}">${TEAM_SUIT[t].s}</span> ${t === 'a' ? 'Time de cima' : 'Time de baixo'}</div>
      <div class="field"><label>Nome do time</label><input class="inp" data-name="${t}" autocomplete="off" value="${esc(f[t].name)}"></div>
      ${db.teams.length ? `<div class="muted" style="margin:-2px 0 6px">Times guardados:</div><div class="chips">${db.teams.map((x) => `<button class="chip" data-pick="${t}" data-id="${x.id}">${esc(x.name)}</button>`).join('')}</div>` : ''}
      <div class="players" data-players="${t}"></div>
    </div>`;

  body.innerHTML = `
    <div class="sec">
      <div class="sec-title">Jogadores por time</div>
      <div class="seg" id="nSeg">${[1, 2, 3].map((n) => `<button data-n="${n}">${n}</button>`).join('')}</div>
    </div>
    <div class="sec"><div class="sec-title">Times</div>${teamBlock('a')}${teamBlock('b')}</div>
    <div class="sec">
      <div class="sec-title">Quem embaralha na primeira mão</div>
      <div class="panel">
        <div class="chips" id="dealerChips" style="flex-wrap:wrap"></div>
        <div class="table-order" id="tableOrder"></div>
      </div>
    </div>
    <button class="btn gold block" id="startBtn" style="min-height:56px;font-size:18px">🃏 Começar partida</button>
  `;

  const renderPlayers = () => {
    ['a', 'b'].forEach((t) => {
      const wrap = $(`[data-players="${t}"]`, body);
      let h = '';
      for (let i = 0; i < f.n; i++) {
        h += `<div class="field"><label>Jogador ${i + 1}</label><input class="inp" data-pl="${t}" data-i="${i}" autocomplete="off" placeholder="${esc((f[t].name || '?') + ' ' + (i + 1))}" value="${esc(f[t].players[i])}"></div>`;
      }
      wrap.innerHTML = h;
    });
    $$('#nSeg button', body).forEach((b) => b.classList.toggle('on', Number(b.dataset.n) === f.n));
    renderDealer();
  };
  const seatList = () => {
    const s = [];
    for (let i = 0; i < f.n; i++) { s.push({ t: 'a', i }); s.push({ t: 'b', i }); }
    return s;
  };
  const pName = (s) => (f[s.t].players[s.i] || '').trim() || `${f[s.t].name || '?'} ${s.i + 1}`;
  const renderDealer = () => {
    const ss = seatList();
    if (f.dealer !== 'random' && f.dealer >= ss.length) f.dealer = 'random';
    $('#dealerChips', body).innerHTML =
      `<button class="chip ${f.dealer === 'random' ? 'on' : ''}" data-dealer="random">🎲 Sortear</button>` +
      ss.map((s, i) => `<button class="chip ${f.dealer === i ? 'on' : ''}" data-dealer="${i}">${TEAM_SUIT[s.t].s} ${esc(pName(s))}</button>`).join('');
    $('#tableOrder', body).innerHTML = '<span class="muted">Ordem à mesa (jogo para a direita):</span><br>' +
      ss.map((s) => `<span class="${s.t}">${esc(pName(s))}</span>`).join(' → ') + ' ↺';
  };

  body.addEventListener('input', (e) => {
    const el = e.target;
    if (el.dataset.name) { const t = el.dataset.name; f[t].name = el.value; f[t].auto = !el.value.trim(); renderPlayersPlaceholders(); renderDealer(); }
    if (el.dataset.pl) { const t = el.dataset.pl; f[t].players[Number(el.dataset.i)] = el.value; refreshAutoName(t); renderPlayersPlaceholders(); renderDealer(); }
  });
  const renderPlayersPlaceholders = () => {
    $$('[data-pl]', body).forEach((inp) => { inp.placeholder = `${f[inp.dataset.pl].name || '?'} ${Number(inp.dataset.i) + 1}`; });
  };
  body.addEventListener('click', (e) => {
    const nb = e.target.closest('[data-n]');
    if (nb) { f.n = Number(nb.dataset.n); refreshAutoName('a'); refreshAutoName('b'); renderPlayers(); return; }
    const pk = e.target.closest('[data-pick]');
    if (pk) {
      const t = pk.dataset.pick;
      const rec = teamById(pk.dataset.id);
      if (!rec) return;
      f[t].name = rec.name;
      f[t].players = [0, 1, 2].map((i) => (rec.players || [])[i] || '');
      f[t].auto = isAutoName(rec.name, f[t].players);
      $(`[data-name="${t}"]`, body).value = rec.name;
      renderPlayers();
      return;
    }
    const dl = e.target.closest('[data-dealer]');
    if (dl) { f.dealer = dl.dataset.dealer === 'random' ? 'random' : Number(dl.dataset.dealer); renderDealer(); return; }
    if (e.target.closest('#startBtn')) start();
  });

  const start = () => {
    const na = f.a.name.trim(), nb = f.b.name.trim();
    if (!na || !nb) { toast('Escreve o nome dos dois times'); return; }
    if (norm(na) === norm(nb)) { toast('Os times precisam de nomes diferentes'); return; }
    const go = () => {
      const pa = f.a.players.slice(0, f.n).map((s) => s.trim());
      const pb = f.b.players.slice(0, f.n).map((s) => s.trim());
      const ta = upsertTeam(na, pa);
      const tb = upsertTeam(nb, pb);
      const ss = seatList();
      const random = f.dealer === 'random';
      const dealer = random ? Math.floor(Math.random() * ss.length) : f.dealer;
      db.current = createMatch({
        a: { id: ta.id, name: ta.name, players: pa },
        b: { id: tb.id, name: tb.name, players: pb },
        n: f.n, dealer,
      });
      lastScores = null; lastHandValue = 1;
      save();
      closeModal(true);
      closeScreen();
      updateWakeLock();
      if (random) toast(`🎲 Sorteado: ${playerName(db.current, dealerSeat(db.current))} embaralha`);
    };
    const cur = db.current;
    if (cur && !cur.finished && (cur.score.a || cur.score.b)) {
      confirmModal({ title: 'Descartar partida?', text: `A partida atual (${cur.score.a} × ${cur.score.b}) ainda não terminou e não será guardada.`, ok: 'Começar nova', danger: true, onOk: go });
    } else go();
  };

  renderPlayers();
}

/* ---- Times guardados ---- */
function teamRecord(id) {
  let w = 0, l = 0;
  for (const h of db.history) {
    if (h.teams.a.id === id || h.teams.b.id === id) {
      if (h.teams[h.winner].id === id) w++; else l++;
    }
  }
  return { w, l };
}
function screenTeams(body) {
  const list = db.teams.slice().sort((x, y) => x.name.localeCompare(y.name, 'pt-BR'));
  body.innerHTML = `
    <button class="btn gold block" id="addTeam" style="margin-bottom:14px">＋ Adicionar time</button>
    ${list.length ? '' : '<div class="empty-list">Ainda não há times guardados.<br>São guardados automaticamente ao criar uma partida.</div>'}
    <div class="panel" ${list.length ? '' : 'hidden'}>
      ${list.map((t) => {
        const r = teamRecord(t.id);
        const ps = (t.players || []).filter(Boolean).join(', ');
        return `<div class="team-item">
          <div><div class="tn">${esc(t.name)}</div><div class="tp">${ps ? esc(ps) + ' · ' : ''}${r.w}V ${r.l}D</div></div>
          <button class="icon-btn" data-edit="${t.id}" aria-label="Editar">✎</button>
          <button class="icon-btn" data-del="${t.id}" aria-label="Apagar">🗑</button>
        </div>`;
      }).join('')}
    </div>`;
  body.onclick = (e) => {
    if (e.target.closest('#addTeam')) {
      editTeamModal({ name: '', players: [] }, {
        title: 'Novo time',
        onSave: (name, ps) => {
          if (db.teams.some((x) => norm(x.name) === norm(name))) { toast('Já existe um time com esse nome'); return false; }
          db.teams.push({ id: uid(), name, players: ps, createdAt: Date.now() });
          save(); screenTeams(body);
        },
      });
      return;
    }
    const ed = e.target.closest('[data-edit]');
    if (ed) {
      const rec = teamById(ed.dataset.edit);
      editTeamModal(rec, {
        onSave: (name, ps) => {
          if (db.teams.some((x) => x.id !== rec.id && norm(x.name) === norm(name))) { toast('Já existe um time com esse nome'); return false; }
          rec.name = name; rec.players = ps;
          const m = db.current;
          if (m) ['a', 'b'].forEach((t) => { if (m.teams[t].id === rec.id) { m.teams[t].name = name; m.teams[t].players = ps.slice(0, Math.max(m.n, ps.length)); } });
          save(); screenTeams(body);
        },
      });
      return;
    }
    const dl = e.target.closest('[data-del]');
    if (dl) {
      const rec = teamById(dl.dataset.del);
      confirmModal({
        title: `Apagar ${rec.name}?`,
        text: 'O time sai da lista. As partidas do histórico mantêm-se.',
        ok: 'Apagar', danger: true,
        onOk: () => { db.teams = db.teams.filter((x) => x.id !== rec.id); save(); screenTeams(body); },
      });
    }
  };
}

/* ---- Histórico ---- */
const pairKey = (h) => [h.teams.a.id, h.teams.b.id].sort().join('|');
function balanceText(A, B, r, hasBets) {
  if (r.bal > 0) return `Saldo: ${esc(A)} ${esc(fmtSigned(r.bal))}`;
  if (r.bal < 0) return `Saldo: ${esc(B)} ${esc(fmtSigned(-r.bal))}`;
  return hasBets ? 'Saldo: empatado' : '';
}
function screenHistory(body) {
  screenBack = null;
  $('#screenTitle').textContent = 'Histórico';
  const pairs = new Map();
  for (const h of db.history) {
    const key = pairKey(h);
    if (!pairs.has(key)) pairs.set(key, { key, a: h.teams.a, b: h.teams.b, last: h.date, count: 0, bets: false });
    const p = pairs.get(key);
    p.last = h.date; p.count++; if (h.bet) p.bets = true;
  }
  const list = Array.from(pairs.values()).sort((x, y) => y.last - x.last);
  body.innerHTML = list.length ? `
    <div class="sec"><div class="sec-title">Confrontos (${list.length})</div>
    ${list.map((p) => {
      const r = h2h(p.a.id, p.b.id);
      const A = nameOfSnap(p.a), B = nameOfSnap(p.b);
      const bal = balanceText(A, B, r, p.bets);
      return `<button class="h2h-card link" data-pair="${esc(p.key)}">
        <div class="t">${esc(A)}</div><div class="vs">x</div><div class="t r">${esc(B)}</div>
        <div class="bal">🏆${r.wa} × 🏆${r.wb} · ${p.count} partida${p.count > 1 ? 's' : ''} · ${fmtDate(p.last)}${bal ? '<br>' + bal : ''}</div>
        <span class="chev">›</span>
      </button>`;
    }).join('')}
    </div>` : '<div class="empty-list">Ainda não há partidas terminadas.</div>';
  body.onclick = (e) => {
    const pr = e.target.closest('[data-pair]');
    if (pr) screenHistoryPair(body, pr.dataset.pair);
  };
}
function screenHistoryPair(body, key) {
  const items = db.history.filter((h) => pairKey(h) === key).reverse();
  if (!items.length) { screenHistory(body); return; }
  screenBack = () => screenHistory(body);
  const ref = items[0];
  const A = nameOfSnap(ref.teams.a), B = nameOfSnap(ref.teams.b);
  const idA = ref.teams.a.id, idB = ref.teams.b.id;
  const r = h2h(idA, idB);
  const bal = balanceText(A, B, r, items.some((h) => h.bet));
  $('#screenTitle').textContent = `${A} x ${B}`;
  body.innerHTML = `
    <div class="sec"><div class="h2h-card"><div class="t">${esc(A)}</div><div class="vs">🏆${r.wa} × 🏆${r.wb}</div><div class="t r">${esc(B)}</div>${bal ? `<div class="bal">${bal}</div>` : ''}</div></div>
    <div class="sec"><div class="sec-title">Partidas (${items.length})</div>
    ${items.map((h) => {
      // mostra sempre na mesma ordem (A à esquerda)
      const flip = h.teams.a.id !== idA;
      const L = flip ? 'b' : 'a', R = flip ? 'a' : 'b';
      const pl = (h.teams[L].players || []).filter(Boolean).join(', ');
      const pr = (h.teams[R].players || []).filter(Boolean).join(', ');
      const winName = h.winner === L ? A : B;
      return `<div class="hist-item">
        <span class="suit-corner ${h.winner === 'b' ? 'suit-red' : ''}">${TEAM_SUIT[h.winner].s}</span>
        <div class="date">${fmtDate(h.date, true)}</div>
        <div class="score">
          <div class="nm ${h.winner === L ? 'win' : ''}">${esc(A)}</div>
          <div class="pts">${h.score[L]} × ${h.score[R]}</div>
          <div class="nm r ${h.winner === R ? 'win' : ''}">${esc(B)}</div>
        </div>
        ${pl || pr ? `<div class="meta">${esc(pl || '—')} <span style="opacity:.5">vs</span> ${esc(pr || '—')}</div>` : ''}
        ${h.bet ? `<div class="meta">💰 Aposta ${esc(fmtMoney(h.bet))} → ${esc(winName)}</div>` : ''}
        <div class="acts">
          <button class="btn wa small" data-share="${h.id}">Partilhar</button>
          <button class="btn ghost small" data-hdel="${h.id}" aria-label="Apagar">🗑</button>
        </div>
      </div>`;
    }).join('')}
    </div>`;
  body.onclick = (e) => {
    const sh = e.target.closest('[data-share]');
    if (sh) { const h = db.history.find((x) => x.id === sh.dataset.share); if (h) shareModal(h); return; }
    const dl = e.target.closest('[data-hdel]');
    if (dl) {
      confirmModal({
        title: 'Apagar partida?', text: 'Esta partida sai do histórico e do confronto direto.', ok: 'Apagar', danger: true,
        onOk: () => {
          db.history = db.history.filter((x) => x.id !== dl.dataset.hdel);
          if (db.current && db.current.historyId === dl.dataset.hdel) db.current.historyId = null;
          save(); screenHistoryPair(body, key);
        },
      });
    }
  };
}

/* ---- Definições ---- */
function screenSettings(body) {
  const s = db.settings;
  const wl = 'wakeLock' in navigator;
  body.innerHTML = `
    <div class="sec"><div class="sec-title">Aposta</div>
      <div class="panel"><div class="field" style="margin:0"><label for="curInp">Moeda</label>
        <input id="curInp" class="inp" value="${esc(s.currency)}" maxlength="6" autocomplete="off"></div>
        <div class="chips" style="margin-top:8px">${['R$', '€', 'US$', '£'].map((c) => `<button class="chip ${c === s.currency ? 'on' : ''}" data-cur="${c}">${c}</button>`).join('')}</div>
      </div>
    </div>
    <div class="sec"><div class="sec-title">Ecrã</div>
      <div class="panel">
        <div class="toggle-row"><div><div>Rodar o time de cima 180°</div><div class="muted">Para quem está do outro lado da mesa</div></div>
          <label class="switch"><input type="checkbox" id="setRotate" ${s.rotateTop ? 'checked' : ''}><span></span></label></div>
        <div class="toggle-row"><div><div>Manter o ecrã ligado</div><div class="muted">${wl ? 'Durante a partida' : 'Não suportado neste dispositivo'}</div></div>
          <label class="switch"><input type="checkbox" id="setWake" ${s.wakeLock ? 'checked' : ''} ${wl ? '' : 'disabled'}><span></span></label></div>
      </div>
    </div>
    <div class="sec"><div class="sec-title">Regras</div>
      <div class="panel muted" style="line-height:1.55">
        Partida até 12 · mão vale 1 · Truco 3 → Seis 6 → Nove 9 → Doze 12.<br>
        Correr dá a quem pediu o valor anterior ao pedido.<br>
        Mão de onze: joga a 3 ou corre (adversário +1). Mão cega 11×11: vale 1 e decide a partida.
      </div>
    </div>
    <div class="sec"><div class="sec-title">Perigo</div>
      <button class="btn danger block" id="wipe">Apagar todos os dados</button>
    </div>`;
  const setCur = (v) => { s.currency = (v || '').trim() || 'R$'; save(); };
  $('#curInp', body).addEventListener('change', (e) => { setCur(e.target.value); screenSettings(body); });
  body.onclick = (e) => {
    const c = e.target.closest('[data-cur]');
    if (c) { setCur(c.dataset.cur); screenSettings(body); return; }
    if (e.target.closest('#wipe')) {
      confirmModal({
        title: 'Apagar tudo?', text: 'Times, histórico, partida atual e definições serão apagados. Faz um backup antes!', ok: 'Apagar tudo', danger: true,
        onOk: () => { db = defaultDb(); save(); lastScores = null; screenSettings(body); toast('Dados apagados'); },
      });
    }
  };
  $('#setRotate', body).addEventListener('change', (e) => { s.rotateTop = e.target.checked; save(); });
  $('#setWake', body).addEventListener('change', (e) => { s.wakeLock = e.target.checked; save(); updateWakeLock(); });
}

/* ---- Exportar / Importar ---- */
function exportJson() {
  const data = { app: 'truco-marcador', exportedAt: new Date().toISOString(), ...db };
  return JSON.stringify(data, null, 2);
}
function screenData(body) {
  body.innerHTML = `
    <div class="sec"><div class="sec-title">Exportar (backup)</div>
      <div class="panel stack">
        <div class="muted">${db.teams.length} times · ${db.history.length} partidas no histórico.</div>
        <button class="btn gold block" id="expFile">⬇️ Guardar ficheiro JSON</button>
        <button class="btn block" id="expCopy">📋 Copiar JSON</button>
      </div>
    </div>
    <div class="sec"><div class="sec-title">Importar</div>
      <div class="panel stack">
        <label class="btn petrol block" for="impFile">📂 Escolher ficheiro JSON</label>
        <input type="file" id="impFile" accept=".json,application/json,text/plain" hidden>
        <div class="muted">Ou cola aqui o conteúdo do backup:</div>
        <textarea id="impText" class="inp" placeholder='{"teams": [...], "history": [...]}'></textarea>
        <button class="btn block" id="impPaste">Importar texto colado</button>
      </div>
    </div>`;

  $('#expFile', body).onclick = async () => {
    const json = exportJson();
    const fname = `truco-backup-${new Date().toISOString().slice(0, 10)}.json`;
    try {
      const file = new File([json], fname, { type: 'application/json' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Backup Truco' });
        return;
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return;
    }
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = fname;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };
  $('#expCopy', body).onclick = () => copyText(exportJson());
  $('#impFile', body).onchange = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const rd = new FileReader();
    rd.onload = () => doImport(String(rd.result), body);
    rd.readAsText(file);
    e.target.value = '';
  };
  $('#impPaste', body).onclick = () => doImport($('#impText', body).value, body);
}
function doImport(text, body) {
  let data;
  try { data = JSON.parse(text); } catch (e) { toast('JSON inválido'); return; }
  if (!data || !Array.isArray(data.teams) || !Array.isArray(data.history)) { toast('O ficheiro não parece um backup do Truco'); return; }
  const inc = normalizeDb(data);
  openModal({
    suit: '♦', red: true, index: '⇪',
    kicker: 'Importar', title: 'Como importar?',
    text: `${inc.teams.length} times e ${inc.history.length} partidas no ficheiro.`,
    actions: [
      { label: 'Juntar aos dados atuais', cls: 'gold', onClick: () => {
        const tIds = new Set(db.teams.map((t) => t.id));
        inc.teams.forEach((t) => { if (!tIds.has(t.id)) db.teams.push(t); });
        const hIds = new Set(db.history.map((h) => h.id));
        inc.history.forEach((h) => { if (!hIds.has(h.id)) db.history.push(h); });
        db.history.sort((x, y) => x.date - y.date);
        save(); toast('Dados juntados ✓'); screenData(body);
      } },
      { label: 'Substituir tudo', cls: 'danger', onClick: () => {
        db = inc; save(); lastScores = null; toast('Dados importados ✓'); screenData(body);
      } },
      { label: 'Cancelar', cls: 'ghost' },
    ],
  });
}

/* ================= Menu ================= */
function openDrawer() { $('#drawer').hidden = false; }
function closeDrawer() { $('#drawer').hidden = true; }
$('#btnMenu').addEventListener('click', openDrawer);
$('#drawer').addEventListener('click', (e) => {
  if (e.target.closest('[data-close]')) { closeDrawer(); return; }
  const go = e.target.closest('[data-go]');
  if (go) openScreen(go.dataset.go);
});
$('#btnEmptyNew').addEventListener('click', () => openScreen('new'));
$('#btnUndo').addEventListener('click', undo);
$('#btnSwap').addEventListener('click', () => {
  const m = db.current;
  if (!m) return;
  m.swapped = !m.swapped;
  lastScores = { ...m.score };
  save(); render(); haptic();
});
$('#btnTruco').addEventListener('click', onTruco);
$('#btnBet').addEventListener('click', openBet);
$('#dealInfo').addEventListener('click', pickDealer);

/* ================= Wake Lock ================= */
let wakeLock = null;
async function updateWakeLock() {
  if (!('wakeLock' in navigator)) return;
  const want = db.settings.wakeLock && db.current && !db.current.finished && document.visibilityState === 'visible';
  try {
    if (want && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!want && wakeLock) {
      const w = wakeLock; wakeLock = null; await w.release();
    }
  } catch (e) { wakeLock = null; }
}
document.addEventListener('visibilitychange', updateWakeLock);
document.addEventListener('touchend', () => { if (!wakeLock) updateWakeLock(); }, { passive: true });

/* ================= iOS: sem zoom ================= */
// touch-action: manipulation (CSS) já desativa o zoom por duplo toque sem atrasar toques rápidos
document.addEventListener('gesturestart', (e) => e.preventDefault());

/* ================= Arranque ================= */
if (db.current) { lastScores = { ...db.current.score }; lastHandValue = db.current.hand.value; }
render();
updateWakeLock();
if (!db.current) openScreen('new');
else if (db.current.finished) showEnd();
else checkSpecial();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  });
}
