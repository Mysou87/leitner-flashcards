// ── Connexion admin ───────────────────────────────────────────
document.getElementById('admin-login-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const pwd = document.getElementById('admin-pwd').value;
  if (pwd !== ADMIN_PASSWORD) {
    document.getElementById('admin-login-error').classList.remove('hidden');
    return;
  }
  document.getElementById('admin-login').classList.add('hidden');
  document.getElementById('admin-panel').classList.remove('hidden');
  initAdmin();
});

// ── Navigation par onglets ────────────────────────────────────
document.querySelectorAll('.admin-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.admin-section').forEach(s => s.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
    if (tab.dataset.tab === 'students') loadStudents();
    if (tab.dataset.tab === 'decks') loadDecks();
    if (tab.dataset.tab === 'dashboard') loadDashboard();
  });
});

// ── Init ──────────────────────────────────────────────────────
async function initAdmin() {
  await loadDashboard();
}

// ── Utilitaires ───────────────────────────────────────────────
function showMsg(id, text, isError = false) {
  const el = document.getElementById(id);
  el.textContent = text;
  el.className = isError ? 'error' : 'success-msg';
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 4000);
}

function truncate(text, n = 60) {
  return text && text.length > n ? text.slice(0, n) + '…' : (text || '');
}

// ── TABLEAU DE BORD ───────────────────────────────────────────
async function loadDashboard() {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const [sessionsRes, studentsRes, cardsRes, progressRes] = await Promise.all([
    db.from('review_sessions')
      .select('*, students(first_name, last_name), decks(name)')
      .gte('reviewed_at', sevenDaysAgo.toISOString())
      .order('reviewed_at', { ascending: false }),
    db.from('students').select('id', { count: 'exact' }).eq('is_active', true),
    db.from('cards').select('id', { count: 'exact' }).eq('is_active', true),
    db.from('progress').select('box_level'),
  ]);

  const sessions = sessionsRes.data || [];
  const todayStr = new Date().toISOString().split('T')[0];
  const todaySessions = sessions.filter(s => s.reviewed_at.startsWith(todayStr));
  const activeStudents = new Set(todaySessions.map(s => s.student_id)).size;
  const masteredCards = (progressRes.data || []).filter(p => p.box_level >= 7).length;

  document.getElementById('dash-stats').innerHTML = `
    <div class="stat-box"><div class="number">${studentsRes.count || 0}</div><div class="label">Élèves actifs</div></div>
    <div class="stat-box"><div class="number">${cardsRes.count || 0}</div><div class="label">Cartes totales</div></div>
    <div class="stat-box"><div class="number">${activeStudents}</div><div class="label">Révisions aujourd'hui</div></div>
    <div class="stat-box"><div class="number">${masteredCards}</div><div class="label">Cartes maîtrisées (boîte 7+)</div></div>
  `;

  // Activité récente
  const actEl = document.getElementById('dash-activity');
  if (sessions.length === 0) {
    actEl.innerHTML = '<p style="color:var(--text-light);font-size:0.88rem">Aucune activité ces 7 derniers jours.</p>';
  } else {
    actEl.innerHTML = `<div style="overflow-x:auto"><table>
      <thead><tr><th>Élève</th><th>Paquet</th><th>Date</th><th>Cartes</th><th>Score</th></tr></thead>
      <tbody>${sessions.slice(0, 50).map(s => {
        const pct = s.cards_reviewed > 0 ? Math.round(s.cards_correct / s.cards_reviewed * 100) : 0;
        const date = new Date(s.reviewed_at).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        const name = s.students ? `${s.students.first_name} ${s.students.last_name}` : '—';
        const deck = s.decks ? s.decks.name : '—';
        return `<tr>
          <td>${name}</td>
          <td>${deck}</td>
          <td style="white-space:nowrap">${date}</td>
          <td>${s.cards_reviewed}</td>
          <td><span class="badge ${pct >= 80 ? 'badge-green' : pct >= 50 ? 'badge-blue' : 'badge-red'}">${pct}%</span></td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;
  }

  // Progression par élève
  const progEl = document.getElementById('dash-progress');
  const { data: allStudents } = await db
    .from('students')
    .select('id, first_name, last_name, year_level')
    .eq('is_active', true)
    .order('last_name');

  const { data: allProgress } = await db.from('progress').select('student_id, box_level');

  const studentMap = {};
  (allStudents || []).forEach(s => { studentMap[s.id] = { ...s, boxes: {} }; });
  (allProgress || []).forEach(p => {
    if (studentMap[p.student_id]) {
      const b = p.box_level;
      studentMap[p.student_id].boxes[b] = (studentMap[p.student_id].boxes[b] || 0) + 1;
    }
  });

  const lastSession = {};
  sessions.forEach(s => {
    if (!lastSession[s.student_id]) lastSession[s.student_id] = s.reviewed_at;
  });

  const rows = (allStudents || []).map(s => {
    const d = studentMap[s.id];
    const total = Object.values(d.boxes).reduce((a, b) => a + b, 0);
    const mastered = (d.boxes[7] || 0) + (d.boxes[8] || 0);
    const last = lastSession[s.id]
      ? new Date(lastSession[s.id]).toLocaleDateString('fr-BE')
      : '—';
    return `<tr>
      <td>${s.last_name} ${s.first_name}</td>
      <td><span class="badge badge-blue">${s.year_level}</span></td>
      <td>${total}</td>
      <td>${mastered}</td>
      <td>${last}</td>
    </tr>`;
  }).join('');

  progEl.innerHTML = `<div style="overflow-x:auto"><table>
    <thead><tr><th>Élève</th><th>Année</th><th>Cartes vues</th><th>Maîtrisées (7+)</th><th>Dernière révision</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="5" style="color:var(--text-light)">Aucun élève.</td></tr>'}</tbody>
  </table></div>`;
}

// ── ÉLÈVES ────────────────────────────────────────────────────
let allStudents = [];
let csvParsed = [];
let studentsNotInCsv = [];

async function loadStudents() {
  const { data } = await db
    .from('students')
    .select('*')
    .order('last_name');
  allStudents = data || [];
  renderStudentsTable(allStudents);
  populateYearFilter();
}

function renderStudentsTable(students) {
  document.getElementById('student-count').textContent = students.length;
  const tbody = document.getElementById('students-tbody');
  if (students.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="color:var(--text-light)">Aucun élève.</td></tr>';
    return;
  }
  tbody.innerHTML = students.map(s => `
    <tr>
      <td>${s.last_name}</td>
      <td>${s.first_name}</td>
      <td><span class="badge badge-blue">${s.year_level}</span></td>
      <td><span class="badge ${s.is_active ? 'badge-green' : 'badge-gray'}">${s.is_active ? 'Actif' : 'Inactif'}</span></td>
      <td style="white-space:nowrap;display:flex;gap:6px">
        <button class="btn-sm" style="background:var(--primary);color:white"
          onclick="editStudentYear('${s.id}', '${s.first_name} ${s.last_name}', '${s.year_level}')">Modifier année</button>
        <button class="btn-sm" style="background:${s.is_active ? '#F1F5F9' : 'var(--success)'};color:${s.is_active ? 'var(--text)' : 'white'}"
          onclick="toggleStudent('${s.id}', ${s.is_active})">${s.is_active ? 'Désactiver' : 'Réactiver'}</button>
      </td>
    </tr>`).join('');
}

function populateYearFilter() {
  const years = [...new Set(allStudents.map(s => s.year_level))].sort();
  const sel = document.getElementById('filter-year');
  sel.innerHTML = '<option value="">Toutes les années</option>' +
    years.map(y => `<option value="${y}">${y}</option>`).join('');
}

// Recherche et filtre en temps réel
document.getElementById('search-students').addEventListener('input', filterStudents);
document.getElementById('filter-year').addEventListener('change', filterStudents);

function filterStudents() {
  const q = document.getElementById('search-students').value.toLowerCase();
  const yr = document.getElementById('filter-year').value;
  const filtered = allStudents.filter(s =>
    (!yr || s.year_level === yr) &&
    (!q || `${s.first_name} ${s.last_name}`.toLowerCase().includes(q))
  );
  renderStudentsTable(filtered);
}

// Ajouter un élève
document.getElementById('form-add-student').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fn = document.getElementById('s-firstname').value.trim();
  const ln = document.getElementById('s-lastname').value.trim();
  const yr = document.getElementById('s-year').value.trim();
  const { error } = await db.from('students').insert({ first_name: fn, last_name: ln, year_level: yr });
  if (error) { showMsg('add-student-msg', 'Erreur : ' + error.message, true); return; }
  showMsg('add-student-msg', `${fn} ${ln} ajouté(e) avec succès.`);
  e.target.reset();
  await loadStudents();
});

async function editStudentYear(id, name, currentYear) {
  const newYear = prompt(`Nouvelle année pour ${name} (actuellement : ${currentYear}) :`, currentYear);
  if (!newYear || newYear === currentYear) return;
  await db.from('students').update({ year_level: newYear.trim() }).eq('id', id);
  await loadStudents();
}

async function toggleStudent(id, isActive) {
  await db.from('students').update({ is_active: !isActive }).eq('id', id);
  await loadStudents();
}

// Import CSV
document.getElementById('btn-import-csv').addEventListener('click', () => {
  const file = document.getElementById('csv-file').files[0];
  if (!file) { alert('Sélectionne un fichier CSV.'); return; }
  const reader = new FileReader();
  reader.onload = (e) => parseCSV(e.target.result);
  reader.readAsText(file, 'UTF-8');
});

function parseCSV(text) {
  const lines = text.trim().split('\n').map(l => l.trim()).filter(l => l);
  const sep = lines[0].includes(';') ? ';' : ',';
  csvParsed = lines.map(line => {
    const parts = line.split(sep).map(p => p.trim().replace(/^["']|["']$/g, ''));
    return { first_name: parts[0] || '', last_name: parts[1] || '', year_level: parts[2] || '' };
  }).filter(s => s.first_name && s.last_name && s.year_level);

  if (csvParsed.length === 0) { alert('Fichier vide ou format incorrect.'); return; }

  // Comparer avec élèves existants
  const existingKeys = new Set(
    allStudents.map(s => `${s.first_name.toLowerCase()}|${s.last_name.toLowerCase()}`)
  );
  const csvKeys = new Set(
    csvParsed.map(s => `${s.first_name.toLowerCase()}|${s.last_name.toLowerCase()}`)
  );

  const toCreate = csvParsed.filter(s => !existingKeys.has(`${s.first_name.toLowerCase()}|${s.last_name.toLowerCase()}`));
  const toUpdate = csvParsed.filter(s => existingKeys.has(`${s.first_name.toLowerCase()}|${s.last_name.toLowerCase()}`));
  studentsNotInCsv = allStudents.filter(s =>
    s.is_active && !csvKeys.has(`${s.first_name.toLowerCase()}|${s.last_name.toLowerCase()}`)
  );

  document.getElementById('import-summary').innerHTML =
    `<strong>${csvParsed.length}</strong> élève(s) dans le fichier : ` +
    `<span style="color:var(--success-dark)">${toCreate.length} à créer</span>, ` +
    `<span style="color:var(--primary)">${toUpdate.length} à mettre à jour</span>.`;

  const absentEl = document.getElementById('import-absent');
  if (studentsNotInCsv.length > 0) {
    absentEl.innerHTML = `<div style="font-size:0.85rem;color:var(--danger)">
      <strong>${studentsNotInCsv.length} élève(s) absent(s) du fichier</strong> (toujours actifs) :<br>
      ${studentsNotInCsv.map(s => `${s.first_name} ${s.last_name}`).join(', ')}
    </div>`;
    absentEl.classList.remove('hidden');
  } else {
    absentEl.classList.add('hidden');
  }

  document.getElementById('import-preview').classList.remove('hidden');
}

document.getElementById('btn-confirm-import').addEventListener('click', async () => {
  const btn = document.getElementById('btn-confirm-import');
  btn.disabled = true;
  btn.textContent = 'Import en cours…';

  let created = 0, updated = 0, errors = 0;

  for (const s of csvParsed) {
    const existing = allStudents.find(e =>
      e.first_name.toLowerCase() === s.first_name.toLowerCase() &&
      e.last_name.toLowerCase() === s.last_name.toLowerCase()
    );
    if (existing) {
      const { error } = await db.from('students')
        .update({ year_level: s.year_level, is_active: true })
        .eq('id', existing.id);
      if (error) errors++; else updated++;
    } else {
      const { error } = await db.from('students').insert({
        first_name: s.first_name,
        last_name: s.last_name,
        year_level: s.year_level,
        is_active: true,
      });
      if (error) errors++; else created++;
    }
  }

  btn.disabled = false;
  btn.textContent = 'Confirmer l\'import';
  document.getElementById('import-preview').classList.add('hidden');
  document.getElementById('csv-file').value = '';

  const msg = `Import terminé : ${created} créé(s), ${updated} mis à jour${errors > 0 ? `, ${errors} erreur(s)` : ''}.`;
  showMsg('import-msg', msg, errors > 0);
  await loadStudents();
});

// ── PAQUETS ───────────────────────────────────────────────────
let allDecks = [];

async function loadDecks() {
  const { data: decks } = await db.from('decks').select('*').order('year_level').order('name');
  const { data: cards } = await db.from('cards').select('deck_id').eq('is_active', true);

  allDecks = decks || [];
  const cardCount = {};
  (cards || []).forEach(c => { cardCount[c.deck_id] = (cardCount[c.deck_id] || 0) + 1; });

  const tbody = document.getElementById('decks-tbody');
  if (allDecks.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="color:var(--text-light)">Aucun paquet.</td></tr>';
    return;
  }
  tbody.innerHTML = allDecks.map(d => `
    <tr>
      <td><strong>${d.name}</strong></td>
      <td>${d.subject}</td>
      <td><span class="badge badge-blue">${d.year_level}</span></td>
      <td>${d.teacher || '—'}</td>
      <td>${cardCount[d.id] || 0}</td>
      <td><span class="badge ${d.is_active ? 'badge-green' : 'badge-gray'}">${d.is_active ? 'Actif' : 'Inactif'}</span></td>
      <td style="white-space:nowrap;display:flex;gap:6px">
        <button class="btn-sm" style="background:var(--primary);color:white"
          onclick="openCards('${d.id}', '${d.name.replace(/'/g, "\\'")}')">Gérer cartes</button>
        <button class="btn-sm" style="background:${d.is_active ? '#F1F5F9' : 'var(--success)'};color:${d.is_active ? 'var(--text)' : 'white'}"
          onclick="toggleDeck('${d.id}', ${d.is_active})">${d.is_active ? 'Désactiver' : 'Réactiver'}</button>
      </td>
    </tr>`).join('');
}

document.getElementById('form-add-deck').addEventListener('submit', async (e) => {
  e.preventDefault();
  const { error } = await db.from('decks').insert({
    name: document.getElementById('d-name').value.trim(),
    subject: document.getElementById('d-subject').value.trim(),
    year_level: document.getElementById('d-year').value.trim(),
    teacher: document.getElementById('d-teacher').value.trim() || null,
  });
  if (error) { showMsg('add-deck-msg', 'Erreur : ' + error.message, true); return; }
  showMsg('add-deck-msg', 'Paquet créé !');
  e.target.reset();
  await loadDecks();
});

async function toggleDeck(id, isActive) {
  await db.from('decks').update({ is_active: !isActive }).eq('id', id);
  await loadDecks();
}

// ── CARTES ────────────────────────────────────────────────────
let currentDeckId = null;

function openCards(deckId, deckName) {
  currentDeckId = deckId;
  document.getElementById('cards-deck-title').textContent = `Cartes — ${deckName}`;
  document.getElementById('form-add-card').reset();

  // Passer à l'onglet Cartes
  document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.admin-section').forEach(s => s.classList.remove('active'));
  document.querySelector('[data-tab="cards"]').classList.add('active');
  document.getElementById('tab-cards').classList.add('active');

  loadCards();
}

document.getElementById('btn-back-to-decks').addEventListener('click', () => {
  document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.admin-section').forEach(s => s.classList.remove('active'));
  document.querySelector('[data-tab="decks"]').classList.add('active');
  document.getElementById('tab-decks').classList.add('active');
  loadDecks();
});

async function loadCards() {
  const { data: cards } = await db
    .from('cards')
    .select('*')
    .eq('deck_id', currentDeckId)
    .order('created_at', { ascending: false });

  document.getElementById('cards-count').textContent = (cards || []).filter(c => c.is_active).length;
  const tbody = document.getElementById('cards-tbody');

  if (!cards || cards.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" style="color:var(--text-light)">Aucune carte dans ce paquet.</td></tr>';
    return;
  }

  tbody.innerHTML = cards.map(c => `
    <tr style="${!c.is_active ? 'opacity:0.5' : ''}">
      <td style="font-size:0.85rem">${truncate(c.front)}</td>
      <td style="font-size:0.85rem">${truncate(c.back)}</td>
      <td><span class="badge ${c.is_active ? 'badge-green' : 'badge-gray'}">${c.is_active ? 'Active' : 'Inactive'}</span></td>
      <td style="white-space:nowrap;display:flex;gap:6px">
        <button class="btn-sm" style="background:var(--primary);color:white"
          onclick="editCard('${c.id}', ${JSON.stringify(c.front).replace(/'/g, "\\'")}, ${JSON.stringify(c.back).replace(/'/g, "\\'")})">Modifier</button>
        <button class="btn-sm" style="background:${c.is_active ? '#F1F5F9' : 'var(--success)'};color:${c.is_active ? 'var(--text)' : 'white'}"
          onclick="toggleCard('${c.id}', ${c.is_active})">${c.is_active ? 'Désactiver' : 'Réactiver'}</button>
      </td>
    </tr>`).join('');
}

document.getElementById('form-add-card').addEventListener('submit', async (e) => {
  e.preventDefault();
  const front = document.getElementById('c-front').value.trim();
  const back = document.getElementById('c-back').value.trim();
  const { error } = await db.from('cards').insert({ deck_id: currentDeckId, front, back });
  if (error) { showMsg('add-card-msg', 'Erreur : ' + error.message, true); return; }
  showMsg('add-card-msg', 'Carte ajoutée !');
  e.target.reset();
  await loadCards();
});

async function editCard(id, currentFront, currentBack) {
  const front = prompt('Question (recto) :', currentFront);
  if (front === null) return;
  const back = prompt('Réponse (verso) :', currentBack);
  if (back === null) return;
  await db.from('cards').update({ front: front.trim(), back: back.trim() }).eq('id', id);
  await loadCards();
}

async function toggleCard(id, isActive) {
  await db.from('cards').update({ is_active: !isActive }).eq('id', id);
  await loadCards();
}
