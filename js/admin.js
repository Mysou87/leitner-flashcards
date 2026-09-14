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
    if (tab.dataset.tab === 'quiz') loadQuizDecks();
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
  const [{ data: allStudents }, { data: allProgress }, { data: allSessions }, { data: allCardIds }] = await Promise.all([
    db.from('students').select('id, first_name, last_name, year_level').eq('is_active', true).order('last_name'),
    db.from('progress').select('student_id, card_id, box_level, next_review'),
    db.from('review_sessions').select('student_id, reviewed_at, deck_id, cards_reviewed, cards_correct'),
    db.from('cards').select('id, deck_id').eq('is_active', true),
    chargerGroupes(), // composition des cours, lue dans les données de l'app de suivi
  ]);

  const studentMap = {};
  (allStudents || []).forEach(s => { studentMap[s.id] = { ...s, boxes: {} }; });
  (allProgress || []).forEach(p => {
    if (studentMap[p.student_id]) {
      const b = p.box_level;
      studentMap[p.student_id].boxes[b] = (studentMap[p.student_id].boxes[b] || 0) + 1;
    }
  });

  const progressByStudent = {};
  (allProgress || []).forEach(p => {
    if (!progressByStudent[p.student_id]) progressByStudent[p.student_id] = [];
    progressByStudent[p.student_id].push(p);
  });

  // Statut "à jour / en retard" : tolérance d'une journée pour laisser le temps à l'élève de se connecter
  const lagDate = new Date();
  lagDate.setDate(lagDate.getDate() - 1);
  const lagDateStr = localDateStr(lagDate);

  const sessionsByStudent = {};
  const daysByStudent = {};
  const lastSession = {};
  (allSessions || []).forEach(s => {
    if (!sessionsByStudent[s.student_id]) sessionsByStudent[s.student_id] = [];
    sessionsByStudent[s.student_id].push(s);
    const day = s.reviewed_at.split('T')[0];
    if (!daysByStudent[s.student_id]) daysByStudent[s.student_id] = new Set();
    daysByStudent[s.student_id].add(day);
    if (!lastSession[s.student_id] || s.reviewed_at > lastSession[s.student_id])
      lastSession[s.student_id] = s.reviewed_at;
  });

  // Une semaine glissante, pour le « a révisé / n'a pas révisé » de chaque cours
  const semaine = new Date();
  semaine.setDate(semaine.getDate() - 7);
  const semaineStr = semaine.toISOString();
  const actifCetteSemaine = new Set(
    (allSessions || []).filter(s => s.reviewed_at >= semaineStr).map(s => s.student_id)
  );

  dashRows = (allStudents || []).map(s => {
    const d = studentMap[s.id];
    const total = Object.values(d.boxes).reduce((a, b) => a + b, 0);
    const mastered = (d.boxes[7] || 0) + (d.boxes[8] || 0);
    const days = daysByStudent[s.id] ? daysByStudent[s.id].size : 0;
    const last = lastSession[s.id]
      ? new Date(lastSession[s.id]).toLocaleDateString('fr-BE')
      : '—';
    const lateCards = (progressByStudent[s.id] || []).filter(p => p.next_review && p.next_review < lagDateStr);
    const status = lateCards.length === 0
      ? `<span class="badge badge-green">✅ À jour</span>`
      : `<span class="badge badge-red" title="Cartes dont la révision était prévue avant le ${lagDate.toLocaleDateString('fr-BE')}">⚠️ ${lateCards.length} en retard</span>`;
    const badgeData = computeBadgeData(progressByStudent[s.id] || [], sessionsByStudent[s.id] || [], allCardIds || []);
    const unlocked = BADGE_DEFS.filter(b => b.check(badgeData));
    const badgeIcons = unlocked.map(b => b.icon).join('');
    const badgeTitle = unlocked.map(b => b.icon + ' ' + b.name).join(' · ');
    const groupe = (groupesParEleve.get(s.id) || [])[0] || null;
    return {
      groupe,
      actif: actifCetteSemaine.has(s.id),
      // valeurs de tri (une révision jamais faite = chaine vide, donc en dernier)
      nom: `${s.last_name} ${s.first_name}`,
      derniere: lastSession[s.id] || '',
      jours: days,
      cartes: total,
      html: `<tr>
        <td>${s.last_name} ${s.first_name}</td>
        <td><span class="badge badge-blue">${groupe || s.year_level}</span></td>
        <td>${total}</td>
        <td>${mastered}</td>
        <td>${days}</td>
        <td>${last}</td>
        <td>${status}</td>
        <td style="font-size:1.1rem;letter-spacing:1px;min-width:80px" title="${badgeTitle}">${badgeIcons || '—'}</td>
      </tr>`,
    };
  });

  // Menu des groupes, en conservant le choix en cours
  const select = document.getElementById('dash-group');
  const choisi = select.value;
  select.innerHTML = '<option value="">Tous les groupes (séparés)</option>' +
    '<option value="__melange__">Tous les élèves (mélangés)</option>' +
    groupesDisponibles.map(g => `<option value="${g.nom}">${g.nom}</option>`).join('') +
    (dashRows.some(r => !r.groupe) ? '<option value="__sans__">Sans groupe</option>' : '');
  select.value = choisi;
  if (select.value !== choisi) select.value = '';

  renderDashProgress();
}

// Progression par élève, découpée par cours : quand Laureline a un groupe
// devant elle, elle veut voir d'un coup d'œil qui révise et qui ne révise pas.
let dashRows = [];

// Les tris chiffrés vont du plus grand au plus petit ; à égalité on retombe
// sur l'ordre alphabétique, pour que la liste ne bouge pas d'un affichage à l'autre.
const TRIS_DASH = {
  nom: (a, b) => a.nom.localeCompare(b.nom, 'fr'),
  derniere: (a, b) => b.derniere.localeCompare(a.derniere) || a.nom.localeCompare(b.nom, 'fr'),
  jours: (a, b) => b.jours - a.jours || a.nom.localeCompare(b.nom, 'fr'),
  cartes: (a, b) => b.cartes - a.cartes || a.nom.localeCompare(b.nom, 'fr'),
};

function renderDashProgress() {
  const progEl = document.getElementById('dash-progress');
  const filtre = document.getElementById('dash-group').value;
  const tri = TRIS_DASH[document.getElementById('dash-sort').value] || TRIS_DASH.nom;
  const entete = `<thead><tr><th>Élève</th><th>Groupe</th><th>Cartes vues</th><th>Maîtrisées (7+)</th>` +
    `<th>Jours</th><th>Dernière révision</th><th>Statut</th><th>Badges</th></tr></thead>`;

  // Sans données de suivi, pas de découpage possible : tableau simple, comme avant
  if (groupesDisponibles.length === 0) {
    document.getElementById('dash-group').classList.add('hidden');
    const corps = dashRows.slice().sort(tri).map(r => r.html).join('') ||
      '<tr><td colspan="8" style="color:var(--text-light)">Aucun élève.</td></tr>';
    progEl.innerHTML = `<div style="overflow-x:auto"><table>${entete}<tbody>${corps}</tbody></table></div>`;
    return;
  }
  document.getElementById('dash-group').classList.remove('hidden');

  let sections;
  if (filtre === '__melange__') {
    // Un seul classement, groupes confondus : le tri porte sur toute l'école
    sections = [{ nom: 'Tous les élèves', lignes: dashRows.slice().sort(tri) }];
  } else {
    // Sections dans l'ordre du menu, les élèves sans groupe à la fin
    sections = groupesDisponibles.map(g => ({
      nom: g.nom,
      lignes: dashRows.filter(r => r.groupe === g.nom).sort(tri),
    }));
    sections.push({ nom: 'Sans groupe', lignes: dashRows.filter(r => !r.groupe).sort(tri) });

    if (filtre === '__sans__') sections = sections.filter(s => s.nom === 'Sans groupe');
    else if (filtre) sections = sections.filter(s => s.nom === filtre);
  }
  sections = sections.filter(s => s.lignes.length > 0);

  if (sections.length === 0) {
    progEl.innerHTML = '<p class="hint">Aucun élève.</p>';
    return;
  }

  const corps = sections.map(s => {
    const n = s.lignes.length;
    const actifs = s.lignes.filter(r => r.actif).length;
    let bilan;
    if (actifs === 0) bilan = `<strong class="aucun">aucun</strong> n'a révisé ces 7 derniers jours`;
    else if (actifs === n) bilan = `<strong>${n > 1 ? 'tous ont' : 'a'}</strong> révisé ces 7 derniers jours`;
    else bilan = `<strong>${actifs}</strong> ${actifs > 1 ? 'ont' : 'a'} révisé ces 7 derniers jours, ` +
      `${n - actifs} non`;
    const resume = `${n} élève${n > 1 ? 's' : ''} · ${bilan}`;
    return `<tr class="groupe-titre"><td colspan="8">${s.nom}<span>${resume}</span></td></tr>` +
      s.lignes.map(r => r.html).join('');
  }).join('');

  progEl.innerHTML = `<div style="overflow-x:auto"><table>${entete}<tbody>${corps}</tbody></table></div>`;
}

document.getElementById('dash-group').addEventListener('change', renderDashProgress);
document.getElementById('dash-sort').addEventListener('change', renderDashProgress);

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
const cardData = {}; // stocke front/back des cartes pour éviter les problèmes d'échappement

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
  loadAssign();
}

// ── Donner un paquet à des élèves ─────────────────────────────
// Écrit dans student_deck_selection, la table que l'élève modifie lui-même
// depuis « 📦 Mes paquets ». Cocher ici revient à le faire à sa place.
let assignStudents = [];

// Composition des groupes, lue dans les données de l'app de suivi des élèves
// (même projet Supabase, même table `students`). On ne stocke donc aucun
// groupe dans Leitner : la liste suit le classeur « Feuilles de cotes ».
// Clé = student_id, valeur = liste des groupes de l'élève (normalement un seul).
let groupesParEleve = new Map();
let groupesDisponibles = []; // [{ nom, eleves: [id, …] }]

async function chargerGroupes() {
  if (groupesDisponibles.length > 0) return;

  const { data: cours, error: errCours } =
    await db.from('suivi_courses').select('id, sheet_name');
  if (errCours || !cours) return; // pas de données de suivi : on s'en passe

  const idParOnglet = new Map(cours.map(c => [c.sheet_name, c.id]));
  const voulus = GROUPES_ELEVES
    .map(g => ({ ...g, courseId: idParOnglet.get(g.onglet) }))
    .filter(g => g.courseId != null);
  if (voulus.length === 0) return;

  const { data: inscriptions, error: errInscr } = await db
    .from('suivi_enrollments')
    .select('course_id, student_id')
    .eq('is_active', true)
    .in('course_id', voulus.map(g => g.courseId));
  if (errInscr || !inscriptions) return;

  groupesDisponibles = voulus.map(g => ({
    nom: g.nom,
    eleves: inscriptions.filter(i => i.course_id === g.courseId).map(i => i.student_id),
  })).filter(g => g.eleves.length > 0);

  groupesParEleve = new Map();
  groupesDisponibles.forEach(g => {
    g.eleves.forEach(id => {
      if (!groupesParEleve.has(id)) groupesParEleve.set(id, []);
      groupesParEleve.get(id).push(g.nom);
    });
  });
}

async function loadAssign() {
  const [elevesRes, selRes] = await Promise.all([
    db.from('students').select('id, first_name, last_name, year_level')
      .eq('is_active', true).order('last_name'),
    db.from('student_deck_selection').select('student_id, selected')
      .eq('deck_id', currentDeckId),
    chargerGroupes(),
  ]);

  assignStudents = elevesRes.data || [];

  // Groupes : s'ils sont illisibles, on retire l'option et on repasse à l'année
  const ligneGroupe = document.getElementById('assign-row-group');
  const radioGroupe = document.querySelector('input[name="assign-scope"][value="group"]');
  const selectGroupe = document.getElementById('assign-group');
  if (groupesDisponibles.length === 0) {
    ligneGroupe.classList.add('hidden');
    if (radioGroupe.checked) {
      document.querySelector('input[name="assign-scope"][value="year"]').checked = true;
      majAssignScope();
    }
  } else {
    ligneGroupe.classList.remove('hidden');
    const choisi = selectGroupe.value;
    selectGroupe.innerHTML = groupesDisponibles
      .map(g => `<option value="${g.nom}">${g.nom} (${g.eleves.length} élèves)</option>`)
      .join('');
    if (groupesDisponibles.some(g => g.nom === choisi)) selectGroupe.value = choisi;
  }
  const dejaCoches = (selRes.data || []).filter(s => s.selected).length;
  const paquet = allDecks.find(d => d.id === currentDeckId);

  document.getElementById('assign-state').textContent =
    `${dejaCoches} élève${dejaCoches > 1 ? 's' : ''} ${dejaCoches > 1 ? 'ont' : 'a'} ce paquet coché aujourd'hui.`;

  // Années proposées : celles où il y a des élèves, celle du paquet en tête
  const annees = [...new Set(assignStudents.map(e => e.year_level).filter(Boolean))].sort();
  const select = document.getElementById('assign-year');
  select.innerHTML = annees.map(a => {
    const n = assignStudents.filter(e => e.year_level === a).length;
    return `<option value="${a}">${a} (${n} élèves)</option>`;
  }).join('');
  if (paquet && annees.includes(paquet.year_level)) select.value = paquet.year_level;

  renderAssignStudents('');
  majAssignPicked();
}

function renderAssignStudents(filtre) {
  const propre = s => String(s || '').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const f = propre(filtre);
  const etiquette = e => (groupesParEleve.get(e.id) || []).join(', ') || e.year_level || '';
  // Le filtre porte aussi sur le groupe : taper « 5e Chimie B » suffit
  const liste = assignStudents.filter(e =>
    !f || propre(`${e.first_name} ${e.last_name} ${etiquette(e)}`).includes(f)
  );
  document.getElementById('assign-students-list').innerHTML = liste.length === 0
    ? '<p class="hint">Aucun élève ne correspond.</p>'
    : liste.map(e => `
        <label class="quiz-deck">
          <input type="checkbox" value="${e.id}">
          <span class="quiz-deck-nom">${e.first_name} ${e.last_name}</span>
          <span class="quiz-deck-meta">${etiquette(e)}</span>
        </label>`).join('');
}

function majAssignPicked() {
  const n = document.querySelectorAll('#assign-students-list input:checked').length;
  document.getElementById('assign-picked').textContent =
    `${n} élève${n > 1 ? 's' : ''} sélectionné${n > 1 ? 's' : ''}`;
}

function portee() {
  return document.querySelector('input[name="assign-scope"]:checked').value;
}

function majAssignScope() {
  const p = portee();
  document.getElementById('assign-students-wrap').classList.toggle('hidden', p !== 'students');
  document.getElementById('assign-year').disabled = p !== 'year';
  document.getElementById('assign-group').disabled = p !== 'group';
}

document.querySelectorAll('input[name="assign-scope"]').forEach(r => {
  r.addEventListener('change', majAssignScope);
});

document.getElementById('assign-search').addEventListener('input', (e) => {
  renderAssignStudents(e.target.value);
  majAssignPicked();
});

document.getElementById('assign-students-list').addEventListener('change', majAssignPicked);

async function appliquerAssign(selected) {
  const p = portee();
  let cibles;
  let quoi;

  if (p === 'students') {
    cibles = [...document.querySelectorAll('#assign-students-list input:checked')].map(c => c.value);
    quoi = `${cibles.length} élève(s)`;
    if (cibles.length === 0) {
      showMsg('assign-msg', 'Choisis au moins un élève.', true);
      return;
    }
  } else if (p === 'group') {
    const nom = document.getElementById('assign-group').value;
    const groupe = groupesDisponibles.find(g => g.nom === nom);
    // On ne garde que les élèves encore actifs dans Leitner
    const actifs = new Set(assignStudents.map(e => e.id));
    cibles = (groupe ? groupe.eleves : []).filter(id => actifs.has(id));
    quoi = `${cibles.length} élève(s) du groupe ${nom}`;
    if (cibles.length === 0) {
      showMsg('assign-msg', `Aucun élève actif dans le groupe ${nom}.`, true);
      return;
    }
  } else {
    const annee = document.getElementById('assign-year').value;
    cibles = assignStudents.filter(e => e.year_level === annee).map(e => e.id);
    quoi = `${cibles.length} élève(s) de ${annee}`;
    if (cibles.length === 0) {
      showMsg('assign-msg', `Aucun élève actif en ${annee}.`, true);
      return;
    }
  }

  const verbe = selected ? 'Cocher' : 'Décocher';
  if (!confirm(`${verbe} ce paquet chez ${quoi} ?`)) return;

  const btn = document.getElementById(selected ? 'btn-assign-add' : 'btn-assign-remove');
  const texte = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'En cours…';

  // « a_annoncer » déclenche le bandeau d'annonce chez l'élève. On ne le pose
  // que sur un cochage : décocher n'a rien à annoncer.
  const { error } = await db.from('student_deck_selection').upsert(
    cibles.map(id => ({
      student_id: id,
      deck_id: currentDeckId,
      selected,
      a_annoncer: selected,
    })),
    { onConflict: 'student_id,deck_id' }
  );

  btn.disabled = false;
  btn.textContent = texte;

  if (error) {
    const manque = /a_annoncer/.test(error.message);
    showMsg('assign-msg', manque
      ? 'La colonne « a_annoncer » manque en base : lance le script SQL fourni dans Supabase.'
      : 'Erreur : ' + error.message, true);
    return;
  }
  showMsg('assign-msg',
    `${verbe.replace('er', 'é')} chez ${quoi}. ` +
    (selected ? 'Ils verront une annonce' : 'Visible') + ' à leur prochaine ouverture de l\'app.');
  await loadAssign();
}

document.getElementById('btn-assign-add').addEventListener('click', () => appliquerAssign(true));
document.getElementById('btn-assign-remove').addEventListener('click', () => appliquerAssign(false));

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

  cards.forEach(c => { cardData[c.id] = { front: c.front, back: c.back }; });
  tbody.innerHTML = cards.map(c => `
    <tr style="${!c.is_active ? 'opacity:0.5' : ''}">
      <td><div class="cards-cell" data-recto="${c.id}"></div></td>
      <td><div class="cards-cell" data-verso="${c.id}"></div></td>
      <td><span class="badge ${c.is_active ? 'badge-green' : 'badge-gray'}">${c.is_active ? 'Active' : 'Inactive'}</span></td>
      <td style="white-space:nowrap;display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn-sm" style="background:var(--primary);color:white"
          onclick="editCard('${c.id}', cardData['${c.id}'].front, cardData['${c.id}'].back)">Modifier</button>
        <button class="btn-sm" style="background:${c.is_active ? '#F1F5F9' : 'var(--success)'};color:${c.is_active ? 'var(--text)' : 'white'}"
          onclick="toggleCard('${c.id}', ${c.is_active})">${c.is_active ? 'Désactiver' : 'Réactiver'}</button>
        <button class="btn-sm" style="background:var(--danger);color:white"
          onclick="deleteCard('${c.id}')">Supprimer</button>
      </td>
    </tr>`).join('');

  // Rendu Markdown et formules dans le tableau. On insère le texte entier
  // plutôt qu'un extrait : couper une formule en plein milieu l'empêcherait
  // de s'afficher. La hauteur de la cellule est bornée par le CSS, et le
  // texte complet reste accessible par « Modifier ».
  cards.forEach(c => {
    rendreContenu(tbody.querySelector(`[data-recto="${c.id}"]`), c.front);
    rendreContenu(tbody.querySelector(`[data-verso="${c.id}"]`), c.back);
  });
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

let editingCardId = null;

function editCard(id, currentFront, currentBack) {
  editingCardId = id;
  document.getElementById('edit-card-front').value = currentFront;
  document.getElementById('edit-card-back').value = currentBack;
  document.getElementById('edit-card-msg').classList.add('hidden');
  document.getElementById('modal-edit-card').classList.remove('hidden');
}

document.getElementById('btn-cancel-card-edit').addEventListener('click', () => {
  document.getElementById('modal-edit-card').classList.add('hidden');
  editingCardId = null;
});

document.getElementById('btn-save-card-edit').addEventListener('click', async () => {
  const front = document.getElementById('edit-card-front').value.trim();
  const back = document.getElementById('edit-card-back').value.trim();
  if (!front || !back) {
    showMsg('edit-card-msg', 'Les deux champs sont obligatoires.', true);
    return;
  }
  const btn = document.getElementById('btn-save-card-edit');
  btn.disabled = true;
  btn.textContent = 'Enregistrement…';
  const { error } = await db.from('cards').update({ front, back }).eq('id', editingCardId);
  btn.disabled = false;
  btn.textContent = 'Enregistrer';
  if (error) { showMsg('edit-card-msg', 'Erreur : ' + error.message, true); return; }
  document.getElementById('modal-edit-card').classList.add('hidden');
  editingCardId = null;
  await loadCards();
});

// Fermer le modal en cliquant en dehors
document.getElementById('modal-edit-card').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) {
    document.getElementById('modal-edit-card').classList.add('hidden');
    editingCardId = null;
  }
});

async function toggleCard(id, isActive) {
  await db.from('cards').update({ is_active: !isActive }).eq('id', id);
  await loadCards();
}

async function deleteCard(id) {
  if (!confirm('Supprimer cette carte définitivement ? La progression des élèves sur cette carte sera aussi effacée.')) return;
  await db.from('progress').delete().eq('card_id', id);
  const { error } = await db.from('cards').delete().eq('id', id);
  if (error) { alert('Erreur : ' + error.message); return; }
  await loadCards();
}

document.getElementById('btn-deactivate-all').addEventListener('click', async () => {
  if (!currentDeckId) return;
  if (!confirm('Désactiver toutes les cartes de ce paquet ? Elles seront invisibles pour les élèves mais conservées avec leur progression.')) return;
  await db.from('cards').update({ is_active: false }).eq('deck_id', currentDeckId);
  await loadCards();
});

document.getElementById('btn-activate-all').addEventListener('click', async () => {
  if (!currentDeckId) return;
  await db.from('cards').update({ is_active: true }).eq('deck_id', currentDeckId);
  await loadCards();
});

document.getElementById('btn-clear-deck').addEventListener('click', async () => {
  if (!currentDeckId) return;
  if (!confirm('Supprimer TOUTES les cartes de ce paquet ? Cette action est irréversible.')) return;
  const { data: cards } = await db.from('cards').select('id').eq('deck_id', currentDeckId);
  if (!cards || cards.length === 0) return;
  const ids = cards.map(c => c.id);
  await db.from('progress').delete().in('card_id', ids);
  await db.from('cards').delete().in('id', ids);
  await loadCards();
});

// ── Export Excel ─────────────────────────────────────────────
document.getElementById('btn-export-excel').addEventListener('click', async () => {
  const btn = document.getElementById('btn-export-excel');
  btn.textContent = 'Export en cours…';
  btn.disabled = true;

  const [studentsRes, sessionsRes, progressRes] = await Promise.all([
    db.from('students').select('*').eq('is_active', true).order('last_name'),
    db.from('review_sessions').select('student_id, reviewed_at, cards_reviewed, cards_correct'),
    db.from('progress').select('student_id, box_level'),
    chargerGroupes(),
  ]);

  // Même découpage que le tableau de bord : les cours dans l'ordre, puis le reste
  const rang = new Map(groupesDisponibles.map((g, i) => [g.nom, i]));
  const groupeDe = id => (groupesParEleve.get(id) || [])[0] || '';
  const students = (studentsRes.data || []).slice().sort((a, b) => {
    const ra = rang.has(groupeDe(a.id)) ? rang.get(groupeDe(a.id)) : 99;
    const rb = rang.has(groupeDe(b.id)) ? rang.get(groupeDe(b.id)) : 99;
    return ra - rb || a.last_name.localeCompare(b.last_name, 'fr');
  });
  const sessions = sessionsRes.data || [];
  const progress = progressRes.data || [];

  // Agréger par élève
  const sessionsByStudent = {};
  sessions.forEach(s => {
    if (!sessionsByStudent[s.student_id]) sessionsByStudent[s.student_id] = [];
    sessionsByStudent[s.student_id].push(s);
  });

  const progressByStudent = {};
  progress.forEach(p => {
    if (!progressByStudent[p.student_id]) progressByStudent[p.student_id] = [];
    progressByStudent[p.student_id].push(p.box_level);
  });

  const rows = [['Nom', 'Prénom', 'Groupe', 'Année', 'Sessions totales', 'Dernière révision', 'Cartes vues', 'Cartes maîtrisées (boîte 7+)', 'Score moyen (%)']];

  students.forEach(s => {
    const sSessions = sessionsByStudent[s.id] || [];
    const sProgress = progressByStudent[s.id] || [];
    const lastSession = sSessions.length > 0
      ? new Date(sSessions.sort((a, b) => b.reviewed_at.localeCompare(a.reviewed_at))[0].reviewed_at).toLocaleDateString('fr-BE')
      : '—';
    const totalReviewed = sSessions.reduce((acc, s) => acc + s.cards_reviewed, 0);
    const totalCorrect = sSessions.reduce((acc, s) => acc + s.cards_correct, 0);
    const avgScore = totalReviewed > 0 ? Math.round(totalCorrect / totalReviewed * 100) : 0;
    const mastered = sProgress.filter(b => b >= 7).length;

    rows.push([s.last_name, s.first_name, groupeDe(s.id), s.year_level, sSessions.length, lastSession, sProgress.length, mastered, avgScore]);
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [14, 14, 13, 6, 8, 14, 10, 16, 10].map(w => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, ws, 'Progression');
  XLSX.writeFile(wb, `flashcards_progression_${new Date().toISOString().split('T')[0]}.xlsx`);

  btn.textContent = '⬇ Exporter en Excel';
  btn.disabled = false;
});

// ── Import Markdown ───────────────────────────────────────────
let parsedMdCards = [];

function parseMarkdownFlashcards(text) {
  const cards = [];
  const sections = text.split(/^## /m).filter(s => s.trim());
  sections.forEach(section => {
    const lines = section.trim().split('\n');
    const front = lines[0].trim();
    const back = lines.slice(1).join('\n').trim();
    if (front && back) cards.push({ front, back });
  });
  return cards;
}

function handleMarkdownParse(text) {
  parsedMdCards = parseMarkdownFlashcards(text);
  if (parsedMdCards.length === 0) {
    alert('Aucune carte trouvée. Vérifie le format : ## Question suivie de la réponse.');
    return;
  }
  afficherApercuCartes(parsedMdCards, `${parsedMdCards.length} carte(s) détectée(s) — aperçu :`);
}

// Aperçu avant import, avec les formules rendues : c'est le moment où une
// formule mal écrite doit se voir, avant qu'elle ne parte en base.
function afficherApercuCartes(cartes, titre) {
  document.getElementById('md-preview-count').textContent = titre;
  const liste = document.getElementById('md-preview-list');
  liste.innerHTML = cartes.map((c, i) => `
    <div style="padding:8px 0;border-bottom:1px solid var(--border)">
      <div><strong>Q${i + 1} :</strong> <span class="apercu" data-recto="${i}"></span></div>
      <div style="color:var(--text-light)">R : <span class="apercu" data-verso="${i}"></span></div>
    </div>`).join('');
  cartes.forEach((c, i) => {
    rendreContenu(liste.querySelector(`[data-recto="${i}"]`), c.front);
    rendreContenu(liste.querySelector(`[data-verso="${i}"]`), c.back);
  });
  document.getElementById('md-preview').classList.remove('hidden');
}

document.getElementById('btn-parse-md').addEventListener('click', () => {
  const text = document.getElementById('md-import-text').value;
  if (!text.trim()) { alert('Colle d\'abord ton texte markdown.'); return; }
  handleMarkdownParse(text);
});

document.getElementById('md-file').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => handleMarkdownParse(ev.target.result);
  reader.readAsText(file, 'UTF-8');
});

document.getElementById('excel-file').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const workbook = XLSX.read(new Uint8Array(ev.target.result), { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

    // Ignorer les lignes vides
    const validRows = rows.filter(r => r[0] && r[1]);
    if (validRows.length === 0) {
      alert('Aucune donnée trouvée. Vérifie que la colonne A contient les questions et la colonne B les réponses.');
      return;
    }

    // Ignorer la première ligne si elle ressemble à un en-tête
    const headerWords = ['question', 'recto', 'front', 'terme', 'verso', 'back', 'réponse', 'reponse'];
    const firstCell = String(validRows[0][0]).toLowerCase();
    const hasHeader = headerWords.some(w => firstCell.includes(w));
    const dataRows = hasHeader ? validRows.slice(1) : validRows;

    const cards = dataRows.map(r => ({
      front: String(r[0]).trim(),
      back: String(r[1]).trim(),
    })).filter(c => c.front && c.back);

    if (cards.length === 0) {
      alert('Aucune carte valide trouvée après suppression de l\'en-tête.');
      return;
    }

    parsedMdCards = cards;
    afficherApercuCartes(cards, `${cards.length} carte(s) détectée(s) depuis Excel — aperçu :`);
  };
  reader.readAsArrayBuffer(file);
});

document.getElementById('btn-confirm-md-import').addEventListener('click', async () => {
  if (!currentDeckId || parsedMdCards.length === 0) return;
  const btn = document.getElementById('btn-confirm-md-import');
  btn.disabled = true;
  btn.textContent = 'Import en cours…';
  const { error } = await db.from('cards').insert(
    parsedMdCards.map(c => ({ deck_id: currentDeckId, front: c.front, back: c.back }))
  );
  btn.disabled = false;
  btn.textContent = 'Importer toutes les cartes';
  if (error) { showMsg('md-import-msg', 'Erreur : ' + error.message, true); return; }
  showMsg('md-import-msg', `${parsedMdCards.length} carte(s) importée(s) avec succès !`);
  document.getElementById('md-preview').classList.add('hidden');
  document.getElementById('md-import-text').value = '';
  document.getElementById('md-file').value = '';
  parsedMdCards = [];
  await loadCards();
});

// ── INTERROGER LA CLASSE ──────────────────────────────────────
// Afficher les questions-réponses d'un ou plusieurs paquets, pour
// interroger les élèves à l'oral. Les réponses sont masquées par défaut.

function rendreContenu(el, texte) {
  el.innerHTML = marked.parse(texte || '');
  renderMathInElement(el, {
    delimiters: [
      { left: '$$', right: '$$', display: true },
      { left: '$', right: '$', display: false },
    ],
    throwOnError: false,
  });
}

async function loadQuizDecks() {
  const container = document.getElementById('quiz-decks-list');
  const { data: decks } = await db
    .from('decks')
    .select('id, name, subject, year_level, is_active')
    .order('year_level')
    .order('name');

  const { data: cards } = await db.from('cards').select('deck_id').eq('is_active', true);
  const parPaquet = {};
  (cards || []).forEach(c => { parPaquet[c.deck_id] = (parPaquet[c.deck_id] || 0) + 1; });

  const actifs = (decks || []).filter(d => d.is_active);
  if (actifs.length === 0) {
    container.innerHTML = '<p class="hint">Aucun paquet actif.</p>';
    return;
  }

  // Grouper par année pour retrouver ses paquets rapidement
  const groupes = {};
  actifs.forEach(d => {
    const cle = d.year_level || 'Autre';
    if (!groupes[cle]) groupes[cle] = [];
    groupes[cle].push(d);
  });

  container.innerHTML = Object.keys(groupes).sort().map(annee => `
    <div class="quiz-year">
      <div class="quiz-year-head">
        <span>${annee}</span>
        <button class="btn-sm" data-annee="${annee}">Tout / rien</button>
      </div>
      ${groupes[annee].map(d => `
        <label class="quiz-deck">
          <input type="checkbox" value="${d.id}" data-annee="${annee}">
          <span class="quiz-deck-nom">${d.name}</span>
          <span class="quiz-deck-meta">${d.subject || ''} · ${parPaquet[d.id] || 0} cartes</span>
        </label>`).join('')}
    </div>`).join('');

  // « Tout / rien » sur une année
  container.querySelectorAll('button[data-annee]').forEach(btn => {
    btn.addEventListener('click', () => {
      const cases = container.querySelectorAll(`input[data-annee="${btn.dataset.annee}"]`);
      const tousCoches = [...cases].every(c => c.checked);
      cases.forEach(c => { c.checked = !tousCoches; });
    });
  });
}

document.getElementById('btn-quiz-show').addEventListener('click', async () => {
  const choisis = [...document.querySelectorAll('#quiz-decks-list input:checked')].map(c => c.value);
  if (choisis.length === 0) {
    showMsg('quiz-msg', 'Choisis au moins un paquet.', true);
    return;
  }

  const btn = document.getElementById('btn-quiz-show');
  btn.disabled = true;
  btn.textContent = 'Chargement…';

  const { data: cards, error } = await db
    .from('cards')
    .select('front, back, deck_id')
    .in('deck_id', choisis)
    .eq('is_active', true);

  btn.disabled = false;
  btn.textContent = 'Afficher les questions';

  if (error) { showMsg('quiz-msg', 'Erreur : ' + error.message, true); return; }
  if (!cards || cards.length === 0) {
    showMsg('quiz-msg', 'Ces paquets ne contiennent aucune carte active.', true);
    return;
  }

  // Nom du paquet à afficher sur chaque carte, utile quand on en mélange plusieurs
  const nomsPaquets = {};
  document.querySelectorAll('#quiz-decks-list input:checked').forEach(c => {
    nomsPaquets[c.value] = c.parentElement.querySelector('.quiz-deck-nom').textContent;
  });

  let liste = [...cards];
  if (document.getElementById('quiz-shuffle').checked) {
    liste.sort(() => Math.random() - 0.5);
  }

  const masquer = document.getElementById('quiz-hide').checked;
  const ol = document.getElementById('quiz-list');
  ol.innerHTML = '';

  liste.forEach(carte => {
    const li = document.createElement('li');
    li.className = 'quiz-item';

    const q = document.createElement('div');
    q.className = 'quiz-q';
    rendreContenu(q, carte.front);

    const r = document.createElement('div');
    r.className = 'quiz-r' + (masquer ? ' cachee' : '');
    rendreContenu(r, carte.back);
    r.addEventListener('click', () => r.classList.toggle('cachee'));

    if (choisis.length > 1) {
      const tag = document.createElement('div');
      tag.className = 'quiz-tag no-print';
      tag.textContent = nomsPaquets[carte.deck_id] || '';
      li.appendChild(tag);
    }
    li.appendChild(q);
    li.appendChild(r);
    ol.appendChild(li);
  });

  document.getElementById('quiz-count').textContent =
    `${liste.length} question${liste.length > 1 ? 's' : ''} · ${choisis.length} paquet${choisis.length > 1 ? 's' : ''}`;
  document.getElementById('btn-quiz-toggle-all').textContent = masquer ? 'Tout révéler' : 'Tout masquer';
  document.getElementById('quiz-result').classList.remove('hidden');
  document.getElementById('quiz-result').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

document.getElementById('btn-quiz-toggle-all').addEventListener('click', () => {
  const reponses = document.querySelectorAll('#quiz-list .quiz-r');
  const toutesCachees = [...reponses].every(r => r.classList.contains('cachee'));
  reponses.forEach(r => r.classList.toggle('cachee', !toutesCachees));
  document.getElementById('btn-quiz-toggle-all').textContent =
    toutesCachees ? 'Tout masquer' : 'Tout révéler';
});

document.getElementById('btn-quiz-print').addEventListener('click', () => {
  // À l'impression, les réponses cachées doivent redevenir lisibles
  document.querySelectorAll('#quiz-list .quiz-r').forEach(r => r.classList.remove('cachee'));
  document.getElementById('btn-quiz-toggle-all').textContent = 'Tout masquer';
  window.print();
});
