const TITLES = {stats:'Statistiques',servers:'Serveurs',commands:'Commandes',members:'Membres',moderation:'Moderation',bans:'Bans',scores:'Scores toxicite',badwords:'Mots bannis'};
let currentGuild = null;

document.querySelectorAll('.nav-item').forEach(el => {
  el.addEventListener('click', e => {
    e.preventDefault();
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    el.classList.add('active');
    const panel = el.dataset.panel;
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    document.getElementById('panel-' + panel).classList.add('active');
    document.getElementById('page-title').textContent = TITLES[panel] || panel;
    onPanelChange(panel);
  });
});

async function api(path, opts={}) {
  try {
    const r = await fetch(path, {headers:{'Content-Type':'application/json'},...opts});
    if (!r.ok) return null;
    return r.json();
  } catch { return null; }
}

function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function toast(msg, type) {
  const t = document.createElement('div');
  t.textContent = msg;
  t.style.cssText = `position:fixed;bottom:20px;right:20px;background:${type==='ok'?'rgba(59,165,92,0.9)':'rgba(237,66,69,0.9)'};color:#fff;padding:10px 18px;border-radius:8px;font-size:13px;z-index:9999`;
  document.body.appendChild(t);
  setTimeout(()=>t.remove(), 3000);
}

async function init() {
  const data = await api('/api/stats');
  if (data) {
    document.getElementById('s-guilds').textContent = data.guilds ?? '—';
    document.getElementById('s-users').textContent = data.tracked_users ?? '—';
    document.getElementById('s-score').textContent = data.top_score ?? '—';
    document.getElementById('s-bw').textContent = data.bad_words ?? '—';
    document.getElementById('maintenance-toggle').checked = data.maintenance;
  }
  loadGuilds();
  loadBadwords();
  loadScores();
}

async function loadGuilds() {
  const guilds = await api('/api/guilds');
  const list = document.getElementById('guild-list');
  const sel = document.getElementById('guild-select');
  if (!guilds || !guilds.length) { list.innerHTML = '<div class="loading">Aucun serveur.</div>'; return; }
  list.innerHTML = guilds.map(g => {
    const icon = g.icon
      ? `<img src="https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png" alt="">`
      : `<span>🌐</span>`;
    return `<div class="server-row">
      <div class="server-icon">${icon}</div>
      <div><div class="server-name">${esc(g.name)}</div><div class="server-sub">${g.id}</div></div>
      <span style="margin-left:auto" class="badge ${g.owner?'green':'blue'}">${g.owner?'Owner':'Membre'}</span>
    </div>`;
  }).join('');
  sel.innerHTML = '<option value="">— Choisir un serveur —</option>' +
    guilds.map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join('');
}

function onGuildChange(gid) {
  currentGuild = gid || null;
  const active = document.querySelector('.panel.active');
  if (active) onPanelChange(active.id.replace('panel-',''));
}

function onPanelChange(panel) {
  if (panel === 'commands') loadCommands();
  if (panel === 'members')  loadMembers();
  if (panel === 'bans')     loadBans();
  if (panel === 'scores')   loadScores();
  if (panel === 'badwords') loadBadwords();
}

async function loadCommands() {
  const msg = document.getElementById('cmd-msg');
  const wrap = document.getElementById('cmd-wrap');
  if (!currentGuild) { msg.style.display=''; wrap.style.display='none'; return; }
  msg.style.display = 'none'; wrap.style.display = '';
  document.getElementById('cmd-body').innerHTML = '<tr><td colspan="2" class="loading">Chargement...</td></tr>';
  const cmds = await api(`/api/guild/${currentGuild}/commands`);
  if (!cmds || !cmds.length) { document.getElementById('cmd-body').innerHTML = '<tr><td colspan="2" class="loading">Aucune commande.</td></tr>'; return; }
  document.getElementById('cmd-body').innerHTML = cmds.map(c =>
    `<tr><td><code>/${esc(c.name)}</code></td><td style="color:var(--muted)">${esc(c.description||'—')}</td></tr>`
  ).join('');
}

async function loadMembers() {
  const msg = document.getElementById('members-msg');
  const wrap = document.getElementById('members-wrap');
  if (!currentGuild) { msg.style.display=''; wrap.style.display='none'; return; }
  msg.style.display = 'none'; wrap.style.display = '';
  document.getElementById('members-body').innerHTML = '<tr><td colspan="4" class="loading">Chargement...</td></tr>';
  const members = await api(`/api/guild/${currentGuild}/members`);
  if (!members || !members.length) { document.getElementById('members-body').innerHTML = '<tr><td colspan="4" class="loading">Aucun membre.</td></tr>'; return; }
  document.getElementById('members-body').innerHTML = members.map(m => {
    const joined = m.joined_at ? new Date(m.joined_at).toLocaleDateString('fr-FR') : '—';
    const scoreColor = m.score > 15 ? 'var(--red)' : m.score > 5 ? 'var(--yellow)' : 'var(--green)';
    return `<tr>
      <td>${esc(m.username)}</td>
      <td><span style="color:${scoreColor};font-weight:500">${m.score}</span></td>
      <td style="color:var(--muted)">${joined}</td>
      <td style="display:flex;gap:6px">
        <button class="btn danger" onclick="kickMember('${m.id}','${esc(m.username)}')">Kick</button>
        <button class="btn" onclick="resetScore('${m.id}','${esc(m.username)}')">Reset score</button>
      </td>
    </tr>`;
  }).join('');
}

async function kickMember(uid, uname) {
  if (!currentGuild || !confirm(`Kick ${uname} ?`)) return;
  const r = await api(`/api/guild/${currentGuild}/kick/${uid}`, {method:'POST'});
  if (r?.success) { toast(`${uname} kick.`, 'ok'); loadMembers(); }
  else toast('Erreur kick.', 'err');
}

async function resetScore(uid, uname) {
  const r = await api(`/api/scores/${uid}`, {method:'DELETE'});
  if (r?.success) { toast(`Score de ${uname} remis a zero.`, 'ok'); loadMembers(); loadScores(); }
  else toast('Erreur reset.', 'err');
}

async function loadBans() {
  const msg = document.getElementById('bans-msg');
  const wrap = document.getElementById('bans-wrap');
  if (!currentGuild) { msg.style.display=''; wrap.style.display='none'; return; }
  msg.style.display = 'none'; wrap.style.display = '';
  document.getElementById('bans-body').innerHTML = '<tr><td colspan="3" class="loading">Chargement...</td></tr>';
  const bans = await api(`/api/guild/${currentGuild}/bans`);
  if (!bans || !bans.length) { document.getElementById('bans-body').innerHTML = '<tr><td colspan="3" class="loading">Aucun ban.</td></tr>'; return; }
  document.getElementById('bans-body').innerHTML = bans.map(b =>
    `<tr><td>${esc(b.user?.username||b.user?.id||'—')}</td><td style="color:var(--muted)">${esc(b.reason||'Aucune raison')}</td>
    <td><button class="btn primary" onclick="doUnban('${b.user?.id}')">Debannir</button></td></tr>`
  ).join('');
}

async function doUnban(uid) {
  if (!currentGuild) return;
  const r = await api(`/api/guild/${currentGuild}/ban/${uid}`, {method:'DELETE'});
  if (r?.success) { toast('Utilisateur debanni.', 'ok'); loadBans(); }
  else toast('Erreur deban.', 'err');
}

async function loadScores() {
  const scores = await api('/api/scores');
  const el = document.getElementById('scores-list');
  if (!scores || !scores.length) { el.innerHTML = '<div class="loading">Aucun score enregistre.</div>'; return; }
  el.innerHTML = scores.map((s,i) => {
    const scoreColor = s.score > 15 ? 'var(--red)' : s.score > 5 ? 'var(--yellow)' : 'var(--green)';
    return `<div class="score-row">
      <span>${i+1}. <code>${s.user_id}</code></span>
      <span style="display:flex;align-items:center;gap:10px">
        <span style="color:${scoreColor};font-weight:500">Score: ${s.score}</span>
        <button class="btn danger" onclick="resetScore('${s.user_id}','${s.user_id}')">Reset</button>
      </span>
    </div>`;
  }).join('');
}

async function loadBadwords() {
  const words = await api('/api/badwords');
  const el = document.getElementById('words-list');
  if (!words || !words.length) { el.innerHTML = '<div class="loading">Aucun mot banni.</div>'; return; }
  el.innerHTML = words.map(w =>
    `<span class="word-tag">${esc(w)}<button onclick="delWord('${esc(w)}')">×</button></span>`
  ).join('');
}

async function addWord() {
  const input = document.getElementById('new-word');
  const word = input.value.trim().toLowerCase();
  if (!word) return;
  await api('/api/badwords', {method:'POST', body:JSON.stringify({word})});
  input.value = '';
  loadBadwords();
}

async function delWord(word) {
  await api(`/api/badwords/${encodeURIComponent(word)}`, {method:'DELETE'});
  loadBadwords();
}

async function setMaintenance(enabled) {
  const r = await api('/api/maintenance', {method:'POST', body:JSON.stringify({enabled})});
  toast(enabled ? 'Maintenance activee.' : 'Maintenance desactivee.', 'ok');
}

async function doKick() {
  const uid = document.getElementById('kick-uid').value.trim();
  const res = document.getElementById('kick-result');
  if (!uid || !currentGuild) { res.textContent='Selectionnez un serveur et entrez un ID.'; res.className='action-result err'; return; }
  const r = await api(`/api/guild/${currentGuild}/kick/${uid}`, {method:'POST'});
  if (r?.success) { res.textContent='Kick effectue.'; res.className='action-result ok'; }
  else { res.textContent='Erreur : verifiez les permissions du bot.'; res.className='action-result err'; }
}

async function doBan() {
  const uid = document.getElementById('ban-uid').value.trim();
  const reason = document.getElementById('ban-reason').value.trim();
  const res = document.getElementById('ban-result');
  if (!uid || !currentGuild) { res.textContent='Selectionnez un serveur et entrez un ID.'; res.className='action-result err'; return; }
  const r = await api(`/api/guild/${currentGuild}/ban/${uid}`, {method:'POST', body:JSON.stringify({reason: reason||'Banni via le panel'})});
  if (r?.success) { res.textContent='Utilisateur banni.'; res.className='action-result ok'; }
  else { res.textContent='Erreur : verifiez les permissions du bot.'; res.className='action-result err'; }
}

async function doTimeout() {
  const uid = document.getElementById('to-uid').value.trim();
  const min = document.getElementById('to-min').value.trim() || '10';
  const res = document.getElementById('to-result');
  if (!uid || !currentGuild) { res.textContent='Selectionnez un serveur et entrez un ID.'; res.className='action-result err'; return; }
  const r = await api(`/api/guild/${currentGuild}/timeout/${uid}`, {method:'POST', body:JSON.stringify({minutes:parseInt(min)})});
  if (r?.success) { res.textContent=`Timeout ${min} min applique.`; res.className='action-result ok'; }
  else { res.textContent='Erreur : verifiez les permissions du bot.'; res.className='action-result err'; }
}

init();
