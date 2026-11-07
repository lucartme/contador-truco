/* Truco — sincronização do histórico e dos times entre celulares (Firebase Firestore).
 *
 * Estrutura: grupos/{codigo}/partidas/{id}  e  grupos/{codigo}/times/{id}
 * Quem tem o mesmo código do grupo partilha o histórico.
 * O Firestore guarda tudo também no aparelho, por isso funciona offline e envia depois.
 */
const FB = 'https://www.gstatic.com/firebasejs/10.12.2/';
const K_GROUP = 'truco.sync.group';
const K_DEL = 'truco.sync.del';
const COLS = ['partidas', 'times'];
const T = window.Truco;

let fs = null;            // { F, db }
let unsubs = [];
let remote = { partidas: new Map(), times: new Map() };
let ready = { partidas: false, times: false };
let status = 'off';       // off | nocfg | connecting | online | offline | error
let lastErr = '';
let screenBody = null;

/* ---------- utilitários ---------- */
const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } },
  set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* */ } },
};
const group = () => ls.get(K_GROUP, '');
const clean = (o) => JSON.parse(JSON.stringify(o));
// JSON com chaves ordenadas (o Firestore não garante a ordem das chaves)
function ssig(v) {
  if (Array.isArray(v)) return '[' + v.map(ssig).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + ssig(v[k])).join(',') + '}';
  return JSON.stringify(v === undefined ? null : v);
}
function pendingDeletes() { try { return JSON.parse(ls.get(K_DEL, '[]')) || []; } catch (e) { return []; } }
function newCode() {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  const r = crypto.getRandomValues(new Uint8Array(8));
  return 'truco-' + Array.from(r, (n) => abc[n % abc.length]).join('');
}
function normCode(s) { return String(s || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, ''); }

function setStatus(s) {
  status = s;
  const dot = document.getElementById('syncDot');
  if (dot) dot.className = 'sync-dot ' + (group() ? s : '');
  if (screenBody && screenBody.isConnected) renderScreen(screenBody);
}

/* ---------- ligação ao Firebase ---------- */
async function getFs() {
  if (fs) return fs;
  if (!window.FIREBASE_CONFIG) throw new Error('nocfg');
  const [{ initializeApp }, F] = await Promise.all([import(FB + 'firebase-app.js'), import(FB + 'firebase-firestore.js')]);
  const app = initializeApp(window.FIREBASE_CONFIG);
  let db;
  try {
    db = F.initializeFirestore(app, { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) });
  } catch (e) {
    db = F.getFirestore(app);
  }
  fs = { F, db };
  return fs;
}

function disconnect() {
  unsubs.forEach((u) => { try { u(); } catch (e) { /* */ } });
  unsubs = [];
  remote = { partidas: new Map(), times: new Map() };
  ready = { partidas: false, times: false };
}

async function connect() {
  disconnect();
  const g = group();
  if (!g) { setStatus('off'); return; }
  if (!window.FIREBASE_CONFIG) { setStatus('nocfg'); return; }
  setStatus('connecting');
  try {
    const { F, db } = await getFs();
    if (g !== group()) return;
    COLS.forEach((col) => {
      const u = F.onSnapshot(
        F.collection(db, 'grupos', g, col),
        { includeMetadataChanges: true },
        (snap) => {
          if (g !== group()) return;
          const changes = snap.docChanges();
          changes.forEach((ch) => {
            if (ch.type === 'removed') remote[col].delete(ch.doc.id);
            else remote[col].set(ch.doc.id, ch.doc.data());
          });
          const first = !ready[col];
          ready[col] = true;
          if (ready.partidas && ready.times && (first || changes.length)) applyRemote();
          setStatus(snap.metadata.fromCache ? 'offline' : 'online');
        },
        (err) => { lastErr = err.code || err.message; setStatus('error'); },
      );
      unsubs.push(u);
    });
  } catch (e) {
    lastErr = e.message;
    setStatus(e.message === 'nocfg' ? 'nocfg' : 'error');
  }
}

/* ---------- juntar o que vem do grupo com os dados locais ---------- */
function applyRemote() {
  const d = T.db;
  const skip = new Set(pendingDeletes().map((x) => x.col + '/' + x.id));
  let changed = false;

  for (const [id, t] of remote.times) {
    if (skip.has('times/' + id)) continue;
    const i = d.teams.findIndex((x) => x.id === id);
    if (t.deleted) { if (i >= 0) { d.teams.splice(i, 1); changed = true; } continue; }
    if (i < 0) { d.teams.push(clean(t)); changed = true; }
    else if (ssig(d.teams[i]) !== ssig(t)) { d.teams[i] = clean(t); changed = true; }
  }
  let histChanged = false;
  for (const [id, h] of remote.partidas) {
    if (skip.has('partidas/' + id)) continue;
    const i = d.history.findIndex((x) => x.id === id);
    if (h.deleted) {
      if (i >= 0) { d.history.splice(i, 1); histChanged = true; }
      if (d.current && d.current.historyId === id) d.current.historyId = null;
      continue;
    }
    if (i < 0) { d.history.push(clean(h)); histChanged = true; }
    else if (ssig(d.history[i]) !== ssig(h)) { d.history[i] = clean(h); histChanged = true; }
  }
  if (histChanged) { d.history.sort((x, y) => x.date - y.date); changed = true; }
  if (unifyTeams(d)) changed = true;

  if (changed) { T.save(); T.refresh(); } // T.save chama onSave → push()
  else push();
}

/* Times com o mesmo nome criados em celulares diferentes passam a ser um só
   (fica o id mais antigo, igual em todos os aparelhos). */
function unifyTeams(d) {
  const byName = new Map();
  for (const t of d.teams) {
    const k = T.norm(t.name);
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(t);
  }
  const remap = new Map();
  for (const list of byName.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => (a.id < b.id ? -1 : 1));
    const keep = list[0];
    for (const o of list.slice(1)) {
      remap.set(o.id, keep.id);
      if (!(keep.players || []).some(Boolean) && (o.players || []).some(Boolean)) keep.players = o.players.slice();
    }
  }
  if (!remap.size) return false;
  d.teams = d.teams.filter((t) => !remap.has(t.id));
  const dels = pendingDeletes();
  remap.forEach((_, id) => dels.push({ col: 'times', id }));
  ls.set(K_DEL, JSON.stringify(dels));
  const fix = (snap) => { if (snap && remap.has(snap.id)) snap.id = remap.get(snap.id); };
  d.history.forEach((h) => { fix(h.teams.a); fix(h.teams.b); });
  if (d.current) { fix(d.current.teams.a); fix(d.current.teams.b); }
  return true;
}

/* ---------- enviar alterações locais ---------- */
function push() {
  const g = group();
  if (!fs || !g || !ready.partidas || !ready.times) return;
  const { F, db } = fs;
  const d = T.db;
  const fail = (e) => { lastErr = e.code || e.message; setStatus('error'); };

  // 1) apagamentos explícitos
  const dels = pendingDeletes();
  if (dels.length) {
    dels.forEach(({ col, id }) => {
      if (!COLS.includes(col) || !id) return;
      const tomb = { deleted: true, at: Date.now() };
      remote[col].set(id, tomb);
      F.setDoc(F.doc(db, 'grupos', g, col, id), tomb).catch(fail);
    });
    ls.set(K_DEL, null);
  }
  // 2) novos ou alterados
  const send = (col, item) => {
    const r = remote[col].get(item.id);
    if (r && r.deleted) return;
    if (r && ssig(r) === ssig(item)) return;
    const data = clean(item);
    remote[col].set(item.id, data);
    F.setDoc(F.doc(db, 'grupos', g, col, item.id), data).catch(fail);
  };
  d.teams.forEach((t) => send('times', t));
  d.history.forEach((h) => send('partidas', h));
}

/* ---------- ecrã "Sincronizar com amigos" ---------- */
const STATUS_TXT = {
  off: ['⚪', 'Desligado'],
  nocfg: ['⚪', 'Ainda não configurado'],
  connecting: ['🟡', 'A ligar…'],
  online: ['🟢', 'Sincronizado'],
  offline: ['🟠', 'Sem internet — envia quando voltar'],
  error: ['🔴', 'Erro'],
};
function renderScreen(body) {
  screenBody = body;
  const { esc } = T;
  const g = group();
  if (!window.FIREBASE_CONFIG) {
    body.innerHTML = `<div class="empty-list">A sincronização ainda não foi configurada.<br>Falta ligar o app ao Firebase.</div>`;
    return;
  }
  const [ic, txt] = STATUS_TXT[g ? status : 'off'] || STATUS_TXT.off;
  const d = T.db;
  if (g) {
    body.innerHTML = `
      <div class="sec"><div class="sec-title">Grupo</div>
        <div class="panel stack">
          <div class="sync-code">${esc(g)}</div>
          <div class="muted" style="text-align:center">${ic} ${esc(txt)}${status === 'error' && lastErr ? ' — ' + esc(lastErr) : ''}</div>
          <div class="muted" style="text-align:center">${d.history.length} partida${d.history.length === 1 ? '' : 's'} · ${d.teams.length} time${d.teams.length === 1 ? '' : 's'}</div>
        </div>
      </div>
      <div class="sec"><div class="sec-title">Convidar amigos</div>
        <div class="panel stack">
          <div class="muted">No celular do amigo: abrir o app → ☰ → Sincronizar com amigos → <b>Entrar num grupo</b> e colar este código.</div>
          <button class="btn wa block" id="sShare">Enviar código pelo WhatsApp</button>
          <button class="btn block" id="sCopy">Copiar código</button>
        </div>
      </div>
      <div class="sec"><button class="btn ghost block" id="sLeave">Sair do grupo</button>
        <div class="muted" style="margin-top:6px">Ao sair, o histórico continua neste celular, mas deixa de sincronizar.</div></div>`;
    body.querySelector('#sShare').onclick = () => T.shareWhatsApp(`🃏 Entra no meu grupo do Truco!\n\nAbre https://lucartme.github.io/contador-truco/ → ☰ → Sincronizar com amigos → Entrar num grupo e cola o código:\n\n${g}`);
    body.querySelector('#sCopy').onclick = () => T.copyText(g);
    body.querySelector('#sLeave').onclick = () => T.confirmModal({
      title: 'Sair do grupo?', text: 'O histórico fica neste celular, mas deixa de sincronizar com os amigos.', ok: 'Sair',
      onOk: () => { leave(); T.toast('Saiu do grupo'); },
    });
    return;
  }
  body.innerHTML = `
    <div class="sec">
      <div class="panel muted" style="line-height:1.55">
        Com um <b>código de grupo</b>, todos os celulares com o mesmo código partilham o histórico de partidas e os times.
        Funciona sem internet e envia quando voltar.
      </div>
    </div>
    <div class="sec"><div class="sec-title">Criar grupo</div>
      <div class="panel stack">
        <div class="muted">Para o primeiro celular. Depois envia o código aos amigos.</div>
        <button class="btn gold block" id="sNew">＋ Criar grupo novo</button>
      </div>
    </div>
    <div class="sec"><div class="sec-title">Entrar num grupo</div>
      <div class="panel stack">
        <input class="inp" id="sCode" placeholder="truco-xxxxxxxx" autocomplete="off" autocapitalize="off" spellcheck="false">
        <button class="btn petrol block" id="sJoin">Entrar</button>
      </div>
    </div>`;
  body.querySelector('#sNew').onclick = () => join(newCode());
  body.querySelector('#sJoin').onclick = () => {
    const c = normCode(body.querySelector('#sCode').value);
    if (c.length < 10) { T.toast('Código inválido'); return; }
    join(c);
  };
}

function join(code) {
  ls.set(K_GROUP, code);
  ls.set(K_DEL, null);
  T.toast('Entrou no grupo ✓');
  connect();
}
function leave() {
  ls.set(K_GROUP, null);
  ls.set(K_DEL, null);
  disconnect();
  setStatus('off');
}

window.TrucoSync = {
  onSave: push,
  leave,
  reapply() { if (ready.partidas && ready.times) applyRemote(); },
  renderScreen,
};

// Se o ecrã de sincronizar já estava aberto enquanto este ficheiro carregava
const sb = document.getElementById('screenBody');
if (sb && !document.getElementById('screen').hidden && document.getElementById('screenTitle').textContent === 'Sincronizar com amigos') renderScreen(sb);
connect();
