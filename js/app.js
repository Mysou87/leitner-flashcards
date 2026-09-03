// ── État global ───────────────────────────────────────────────
let student = null;
let allDecks = [];
let allProgress = [];        // { card_id, box_level, next_review }
let allCardIds = [];         // { id, deck_id }
let allSessionsStudent = []; // { reviewed_at, deck_id, cards_reviewed, cards_correct }
let allDeckSelections = []; // { deck_id, selected }

let sessionDecks = [];       // les paquets de la session en cours
let sessionParPaquet = {};   // deck_id -> { reviewed, correct }
let sessionCards = [];
let sessionIndex = 0;
let sessionCorrect = 0;
let sessionWrong = 0;
const retriedCards = new Set(); // cartes déjà repassées dans la session

// ── Utilitaires ───────────────────────────────────────────────
function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  window.scrollTo(0, 0);
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function md(text) {
  return marked.parse(text || '');
}

function renderMath(el) {
  renderMathInElement(el, {
    delimiters: [
      { left: '$$', right: '$$', display: true },
      { left: '$', right: '$', display: false },
    ],
    throwOnError: false,
  });
}

// ── Mémorisation de l'élève connecté ──────────────────────────
const STUDENT_STORAGE_KEY = 'leitner_student_id';

function rememberStudent(id) {
  try { localStorage.setItem(STUDENT_STORAGE_KEY, id); } catch (e) { /* stockage indisponible */ }
}

function forgetStudent() {
  try { localStorage.removeItem(STUDENT_STORAGE_KEY); } catch (e) { /* stockage indisponible */ }
}

function storedStudentId() {
  try { return localStorage.getItem(STUDENT_STORAGE_KEY); } catch (e) { return null; }
}

// ── Connexion ─────────────────────────────────────────────────
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button');
  const errEl = document.getElementById('login-error');
  errEl.classList.add('hidden');
  btn.textContent = 'Connexion…';
  btn.disabled = true;

  const firstName = document.getElementById('input-firstname').value.trim();
  const lastName = document.getElementById('input-lastname').value.trim();

  const { data, error } = await db
    .from('students')
    .select('*')
    .ilike('first_name', firstName)
    .ilike('last_name', lastName)
    .eq('is_active', true)
    .maybeSingle();

  btn.textContent = 'Commencer →';
  btn.disabled = false;

  if (!data) {
    errEl.textContent = 'Prénom ou nom non reconnu. Vérifie l\'orthographe ou contacte ton professeur.';
    errEl.classList.remove('hidden');
    return;
  }

  student = data;
  rememberStudent(data.id);
  await loadDecksView();
});

// Reconnexion automatique : l'élève reste connecté d'une visite à l'autre
async function autoLogin() {
  const id = storedStudentId();
  if (!id) return;

  const form = document.getElementById('login-form');
  const loadingEl = document.getElementById('login-loading');
  form.classList.add('hidden');
  loadingEl.classList.remove('hidden');

  const { data, error } = await db
    .from('students')
    .select('*')
    .eq('id', id)
    .eq('is_active', true)
    .maybeSingle();

  if (!data) {
    // Élève supprimé ou désactivé : on oublie. En cas de simple souci
    // réseau, on garde la mémorisation pour la prochaine visite.
    if (!error) forgetStudent();
    loadingEl.classList.add('hidden');
    form.classList.remove('hidden');
    return;
  }

  student = data;
  await loadDecksView();
  loadingEl.classList.add('hidden');
  form.classList.remove('hidden');
}

// ── Déconnexion ───────────────────────────────────────────────
document.getElementById('btn-logout').addEventListener('click', () => {
  forgetStudent();
  student = null;
  allDecks = [];
  allProgress = [];
  allCardIds = [];
  allSessionsStudent = [];
  allDeckSelections = [];
  document.getElementById('input-firstname').value = '';
  document.getElementById('input-lastname').value = '';
  showView('view-login');
});

// ── Vue : liste des paquets ───────────────────────────────────
// Redessine toute la page de départ à partir des données en mémoire
// (à appeler chaque fois qu'on y revient : les cartes ont pu changer de boîte)
function refreshDecksView() {
  renderStreak();
  renderProgressOverview();
  renderBadgesSummary();
  renderDeckSelectionLink();
  renderDecks();
}

async function loadDecksView({ silent = false } = {}) {
  document.getElementById('topbar-name').textContent =
    `${student.first_name} ${student.last_name}`;
  if (!silent) {
    showView('view-decks');
    document.getElementById('decks-list').innerHTML = '<div class="spinner">Chargement…</div>';
  }

  const [decksRes, progressRes, cardsRes, sessionsRes, selectionsRes] = await Promise.all([
    db.from('decks').select('*').eq('is_active', true),
    db.from('progress').select('card_id, box_level, next_review, first_seen').eq('student_id', student.id),
    db.from('cards').select('id, deck_id').eq('is_active', true),
    db.from('review_sessions').select('reviewed_at, deck_id, cards_reviewed, cards_correct').eq('student_id', student.id),
    db.from('student_deck_selection').select('deck_id, selected').eq('student_id', student.id),
  ]);

  allDecks = decksRes.data || [];
  allProgress = progressRes.data || [];
  allCardIds = cardsRes.data || [];
  allSessionsStudent = sessionsRes.data || [];
  allDeckSelections = selectionsRes.data || [];

  await seedDeckSelections();

  refreshDecksView();
}

// Recharger les données quand l'élève revient sur l'application après
// l'avoir laissée en arrière-plan (révision sur un autre appareil,
// ou changement de jour pendant que l'onglet restait ouvert)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (!student) return;
  if (!document.getElementById('view-decks').classList.contains('active')) return;
  loadDecksView({ silent: true });
});

// ── Sélection des paquets par l'élève ─────────────────────────
function isDeckSelected(deckId) {
  const row = allDeckSelections.find(s => s.deck_id === deckId);
  return row ? row.selected : false;
}

// Comparaison de noms tolérante aux accents et aux majuscules
function memeNom(a, b) {
  const propre = s => String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
  return propre(a) === propre(b);
}

// À la toute première connexion, un seul paquet est coché : celui du
// fonctionnement du cours, de l'année de l'élève. Tous les autres sont
// laissés décochés, à l'élève de les prendre au fur et à mesure.
async function seedDeckSelections() {
  const knownIds = new Set(allDeckSelections.map(s => s.deck_id));
  const aCocher = allDecks.filter(d =>
    d.year_level === student.year_level &&
    memeNom(d.name, PAQUET_COCHE_PAR_DEFAUT) &&
    !knownIds.has(d.id)
  );
  if (aCocher.length === 0) return;

  const rows = aCocher.map(d => ({ student_id: student.id, deck_id: d.id, selected: true }));
  const { data } = await db.from('student_deck_selection').insert(rows).select('deck_id, selected');
  if (data) allDeckSelections.push(...data);
}

async function toggleDeckSelection(deckId, selected) {
  const existing = allDeckSelections.find(s => s.deck_id === deckId);
  if (existing) existing.selected = selected;
  else allDeckSelections.push({ deck_id: deckId, selected });

  await db.from('student_deck_selection').upsert({
    student_id: student.id,
    deck_id: deckId,
    selected,
  }, { onConflict: 'student_id,deck_id' });

  renderDeckSelectionLink();
}

function renderDeckSelectionLink() {
  const link = document.getElementById('deck-selection-link');
  if (allDecks.length === 0) { link.classList.add('hidden'); return; }
  link.classList.remove('hidden');
  const selectedCount = allDecks.filter(d => isDeckSelected(d.id)).length;
  document.getElementById('deck-selection-summary').textContent = `${selectedCount} / ${allDecks.length} sélectionnés`;
}

function renderDeckSelectionView() {
  const myYear = student.year_level;
  const sorted = [...allDecks].sort((a, b) => {
    const am = a.year_level === myYear ? 0 : 1;
    const bm = b.year_level === myYear ? 0 : 1;
    if (am !== bm) return am - bm;
    return (a.year_level || '').localeCompare(b.year_level || '') ||
           a.name.localeCompare(b.name);
  });

  const groups = {};
  sorted.forEach(d => {
    const k = d.year_level || 'Autre';
    if (!groups[k]) groups[k] = [];
    groups[k].push(d);
  });

  const container = document.getElementById('deck-selection-list');
  container.innerHTML = '';

  Object.keys(groups).forEach(year => {
    const section = document.createElement('div');
    section.className = 'year-section' + (year === myYear ? ' my-year' : '');

    const label = document.createElement('div');
    label.className = 'year-label';
    label.textContent = year === myYear ? `${year} — Mon année` : year;
    section.appendChild(label);

    groups[year].forEach(deck => {
      const row = document.createElement('div');
      row.className = 'deck-card';
      row.style.cursor = 'default';
      row.innerHTML = `
        <div class="deck-info">
          <h3>${deck.name}</h3>
          <div class="deck-meta">${deck.subject}${deck.teacher ? ' · ' + deck.teacher : ''}</div>
        </div>
        <label class="toggle-switch">
          <input type="checkbox" ${isDeckSelected(deck.id) ? 'checked' : ''}>
          <span class="toggle-slider"></span>
        </label>`;
      row.querySelector('input').addEventListener('change', e => toggleDeckSelection(deck.id, e.target.checked));
      section.appendChild(row);
    });

    container.appendChild(section);
  });
}

document.getElementById('deck-selection-link').addEventListener('click', () => {
  renderDeckSelectionView();
  showView('view-deck-selection');
});

document.getElementById('btn-back-deck-selection').addEventListener('click', () => {
  refreshDecksView();
  showView('view-decks');
});

function renderStreak() {
  const streak = computeStreak(allSessionsStudent);
  document.getElementById('topbar-streak').textContent = streak >= 2 ? `🔥 ${streak}j` : '';
}

function streakMessage(streak) {
  if (streak <= 1) return `Tu as révisé aujourd'hui, bravo ! 💪 Reviens demain pour démarrer une série.`;
  if (streak < 7) return `🔥 ${streak} jours de suite ! Continue comme ça, tu es sur une belle lancée.`;
  return `🔥 ${streak} jours de suite ! Impressionnant, ne lâche rien !`;
}

function renderProgressOverview() {
  const counts = Array(9).fill(0); // index 1-8
  allProgress.forEach(p => { if (p.box_level >= 1 && p.box_level <= 8) counts[p.box_level]++; });
  const total = counts.reduce((a, b) => a + b, 0);
  if (total === 0) return;

  document.getElementById('progress-overview').classList.remove('hidden');
  const colors = ['','#EF4444','#F97316','#EAB308','#84CC16','#22C55E','#14B8A6','#0EA5E9','#8B5CF6'];
  const max = Math.max(...counts.slice(1));

  const chartEl = document.getElementById('boxes-chart');
  chartEl.style.height = 'auto';
  chartEl.innerHTML = counts.slice(1).map((n, i) => {
    const box = i + 1;
    const h = max > 0 ? Math.max(4, Math.round((n / max) * 44)) : 4;
    return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px">` +
      `<div style="font-size:0.65rem;font-weight:700;color:var(--text-light);line-height:1;visibility:${n > 0 ? 'visible' : 'hidden'}">${n}</div>` +
      `<div title="Boîte ${box} : ${n} carte${n !== 1 ? 's' : ''}" style="width:100%;height:${h}px;background:${colors[box]};border-radius:3px 3px 0 0"></div>` +
      `</div>`;
  }).join('');

  document.getElementById('boxes-legend').innerHTML = counts.slice(1).map((n, i) =>
    `<div style="flex:1;text-align:center">${i + 1}</div>`
  ).join('');
}

function renderBadgesGrid(targetId) {
  const data = computeBadgeData(allProgress, allSessionsStudent, allCardIds);
  document.getElementById(targetId).innerHTML = BADGE_DEFS.map(b =>
    `<div class="reward-badge ${b.check(data) ? 'unlocked' : 'locked'}" title="${b.name}">
      <div class="rb-icon">${b.icon}</div>
      <div class="rb-name">${b.name}</div>
    </div>`
  ).join('');
  return data;
}

function renderBadgesSummary() {
  const link = document.getElementById('badges-link');
  if (allProgress.length === 0) { link.classList.add('hidden'); return; }
  const data = computeBadgeData(allProgress, allSessionsStudent, allCardIds);
  const unlockedCount = BADGE_DEFS.filter(b => b.check(data)).length;
  link.classList.remove('hidden');
  document.getElementById('badges-summary').textContent = `${unlockedCount} / ${BADGE_DEFS.length} débloqués`;
}

document.getElementById('badges-link').addEventListener('click', () => {
  renderBadgesGrid('badges-list-page');
  showView('view-badges');
});

document.getElementById('btn-back-badges').addEventListener('click', () => {
  refreshDecksView();
  showView('view-decks');
});

// Nouvelles cartes encore autorisées aujourd'hui. La limite est globale :
// c'est un budget quotidien partagé par tous les paquets, sinon une douzaine
// de paquets cochés donneraient une session interminable.
function nouvellesRestantesAujourdhui() {
  const todayStr = today();
  const vuesAujourdhui = allProgress.filter(p => p.first_seen === todayStr).length;
  return Math.max(0, MAX_NEW_CARDS_PER_DAY - vuesAujourdhui);
}

function renderDecks() {
  const todayStr = today();
  const progressMap = Object.fromEntries(allProgress.map(p => [p.card_id, p]));
  const visibleDecks = allDecks.filter(d => isDeckSelected(d.id));

  // Budget de nouvelles cartes restant pour aujourd'hui, tous paquets confondus
  const restantGlobal = nouvellesRestantesAujourdhui();

  // Calculer les cartes dues par paquet
  const stats = {};
  visibleDecks.forEach(d => { stats[d.id] = { due: 0, new_total: 0 }; });
  allCardIds.forEach(c => {
    if (!stats[c.deck_id]) return;
    const p = progressMap[c.id];
    if (!p) {
      stats[c.deck_id].new_total++;
    } else if (p.next_review <= todayStr) {
      stats[c.deck_id].due++;
    }
  });
  // L'étiquette d'un paquet ne montre que ses cartes dues. Les nouvelles
  // cartes viennent d'un budget commun, donc les compter dans chaque paquet
  // afficherait « 5 cartes » partout et laisserait croire à un total énorme.
  visibleDecks.forEach(d => {
    const s = stats[d.id];
    if (s.due > 0) {
      s.badge = `${s.due} carte${s.due > 1 ? 's' : ''}`;
      s.classe = '';
    } else if (s.new_total > 0) {
      s.badge = 'À découvrir';
      s.classe = '';
    } else {
      s.badge = '✓ À jour';
      s.classe = 'up-to-date';
    }
  });

  // Total de la session fusionnée : toutes les cartes dues, plus le budget
  // de nouvelles réparti sur l'ensemble des paquets cochés
  const totalDues = visibleDecks.reduce((n, d) => n + stats[d.id].due, 0);
  const totalNouvelles = visibleDecks.reduce((n, d) => n + stats[d.id].new_total, 0);
  const totalSession = totalDues + Math.min(restantGlobal, totalNouvelles);

  // Trier : année de l'élève en premier, puis alphabétique
  const myYear = student.year_level;
  const sorted = [...visibleDecks].sort((a, b) => {
    const am = a.year_level === myYear ? 0 : 1;
    const bm = b.year_level === myYear ? 0 : 1;
    if (am !== bm) return am - bm;
    return (a.year_level || '').localeCompare(b.year_level || '') ||
           a.name.localeCompare(b.name);
  });

  // Grouper par année
  const groups = {};
  sorted.forEach(d => {
    const k = d.year_level || 'Autre';
    if (!groups[k]) groups[k] = [];
    groups[k].push(d);
  });

  const container = document.getElementById('decks-list');
  container.innerHTML = '';

  if (allDecks.length === 0) {
    container.innerHTML = '<p style="color:var(--text-light);text-align:center;padding:32px">Aucun paquet disponible pour le moment.</p>';
    return;
  }
  if (visibleDecks.length === 0) {
    container.innerHTML = '<p style="color:var(--text-light);text-align:center;padding:32px">Aucun paquet sélectionné. Touche « 📦 Mes paquets » ci-dessus pour en choisir.</p>';
    return;
  }

  // Session fusionnée : toutes les cartes dues de tous les paquets cochés,
  // mélangées. Réviser plusieurs sujets dans la même session retient mieux
  // que de les enchainer par blocs.
  const tout = document.createElement('div');
  tout.className = 'deck-card revise-tout';
  tout.innerHTML = `
    <div class="deck-info">
      <h3>⚡ Tout réviser</h3>
      <div class="deck-meta">${visibleDecks.length} paquet${visibleDecks.length > 1 ? 's' : ''} mélangé${visibleDecks.length > 1 ? 's' : ''}</div>
    </div>
    <div class="due-badge ${totalSession === 0 ? 'up-to-date' : ''}">
      ${totalSession === 0 ? '✓ À jour' : `${totalSession} carte${totalSession > 1 ? 's' : ''}`}
    </div>`;
  tout.addEventListener('click', () => startSession(visibleDecks));
  container.appendChild(tout);

  const separateur = document.createElement('h2');
  separateur.textContent = 'Ou un paquet à la fois';
  container.appendChild(separateur);

  Object.keys(groups).forEach(year => {
    const section = document.createElement('div');
    section.className = 'year-section' + (year === myYear ? ' my-year' : '');

    const label = document.createElement('div');
    label.className = 'year-label';
    label.textContent = year === myYear ? `${year} — Mon année` : year;
    section.appendChild(label);

    groups[year].forEach(deck => {
      const s = stats[deck.id] || { badge: '✓ À jour', classe: 'up-to-date' };
      const card = document.createElement('div');
      card.className = 'deck-card';
      card.innerHTML = `
        <div class="deck-info">
          <h3>${deck.name}</h3>
          <div class="deck-meta">${deck.subject}${deck.teacher ? ' · ' + deck.teacher : ''}</div>
        </div>
        <div class="due-badge ${s.classe}">${s.badge}</div>`;
      card.addEventListener('click', () => startSession(deck));
      section.appendChild(card);
    });

    container.appendChild(section);
  });
}

// ── Session de révision ───────────────────────────────────────
// Accepte un seul paquet ou une liste de paquets. Dans les deux cas les
// cartes sont mélangées entre elles.
async function startSession(paquets) {
  const decks = Array.isArray(paquets) ? paquets : [paquets];
  if (decks.length === 0) return;

  sessionDecks = decks;
  sessionParPaquet = {};

  const todayStr = today();
  const progressMap = Object.fromEntries(allProgress.map(p => [p.card_id, p]));

  // Charger les cartes complètes des paquets concernés
  const { data: cards } = await db
    .from('cards')
    .select('*')
    .in('deck_id', decks.map(d => d.id))
    .eq('is_active', true);

  // Cartes déjà vues et dues aujourd'hui
  const dueCards = (cards || []).filter(c => {
    const p = progressMap[c.id];
    return p && p.next_review <= todayStr;
  });

  // Nouvelles cartes (jamais vues), dans la limite du budget global du jour
  const newCards = (cards || []).filter(c => !progressMap[c.id]);
  const remaining = nouvellesRestantesAujourdhui();
  const selectedNew = newCards.sort(() => Math.random() - 0.5).slice(0, remaining);

  sessionCards = [...dueCards, ...selectedNew].sort(() => Math.random() - 0.5);

  if (sessionCards.length === 0) {
    const limitReached = newCards.length > 0 && remaining === 0;
    showEndView(0, 0, true, limitReached);
    return;
  }

  sessionIndex = 0;
  sessionCorrect = 0;
  sessionWrong = 0;
  retriedCards.clear();

  showView('view-review');
  renderCard();
}

function renderCard() {
  const card = sessionCards[sessionIndex];
  const total = sessionCards.length;
  const progressMap = Object.fromEntries(allProgress.map(p => [p.card_id, p]));
  const currentBox = (progressMap[card.id]?.box_level) || 1;

  // Barre de progression
  const pct = (sessionIndex / total) * 100;
  document.getElementById('progress-bar').style.width = pct + '%';
  document.getElementById('progress-count').textContent = `${sessionIndex + 1} / ${total}`;

  // Indicateur de boîte
  document.getElementById('box-chip').textContent = `Boîte ${currentBox} / 8`;

  // Contenu de la carte (recto + verso avec rendu LaTeX)
  const frontEl = document.getElementById('card-front');
  const backEl = document.getElementById('card-back');
  frontEl.innerHTML = md(card.front);
  backEl.innerHTML = md(card.back);
  renderMath(frontEl);
  renderMath(backEl);

  // Remettre en état "question seulement"
  document.getElementById('card-divider').classList.add('hidden');
  document.getElementById('card-back-label').classList.add('hidden');
  document.getElementById('card-back').classList.add('hidden');
  document.getElementById('action-bar').classList.remove('hidden');
  document.getElementById('action-bar-answer').classList.add('hidden');
}

// Retourner la carte
document.getElementById('btn-flip').addEventListener('click', () => {
  document.getElementById('card-divider').classList.remove('hidden');
  document.getElementById('card-back-label').classList.remove('hidden');
  document.getElementById('card-back').classList.remove('hidden');
  document.getElementById('action-bar').classList.add('hidden');
  document.getElementById('action-bar-answer').classList.remove('hidden');
});

// Boutons de réponse
document.getElementById('btn-correct').addEventListener('click', () => recordAnswer(true));
document.getElementById('btn-wrong').addEventListener('click', () => recordAnswer(false));

async function recordAnswer(correct) {
  // Désactiver les boutons pendant la sauvegarde
  document.getElementById('btn-correct').disabled = true;
  document.getElementById('btn-wrong').disabled = true;

  const card = sessionCards[sessionIndex];
  const progressMap = Object.fromEntries(allProgress.map(p => [p.card_id, p]));
  const currentBox = (progressMap[card.id]?.box_level) || 1;

  const newBox = correct ? Math.min(8, currentBox + 1) : 1;
  const nextReview = addDays(LEITNER_INTERVALS[newBox]);

  // Mettre à jour en base
  await db.from('progress').upsert({
    student_id: student.id,
    card_id: card.id,
    box_level: newBox,
    next_review: nextReview,
    last_reviewed: new Date().toISOString(),
  }, { onConflict: 'student_id,card_id' });

  // Mettre à jour le cache local
  const existing = allProgress.find(p => p.card_id === card.id);
  if (existing) {
    existing.box_level = newBox;
    existing.next_review = nextReview;
  } else {
    allProgress.push({ card_id: card.id, box_level: newBox, next_review: nextReview, first_seen: today() });
  }

  // Compter aussi par paquet : une session fusionnée doit produire une ligne
  // de statistique par paquet touché, sinon les badges liés aux paquets
  // (« Arc-en-ciel », « Paquet maîtrisé ») ne verraient plus rien.
  const parPaquet = sessionParPaquet[card.deck_id] || { reviewed: 0, correct: 0 };
  parPaquet.reviewed++;
  if (correct) parPaquet.correct++;
  sessionParPaquet[card.deck_id] = parPaquet;

  if (correct) {
    sessionCorrect++;
  } else {
    sessionWrong++;
    // Repasser la carte en fin de session si pas encore repassée
    if (!retriedCards.has(card.id)) {
      retriedCards.add(card.id);
      sessionCards.push(card);
    }
  }

  document.getElementById('btn-correct').disabled = false;
  document.getElementById('btn-wrong').disabled = false;

  sessionIndex++;
  if (sessionIndex < sessionCards.length) {
    renderCard();
  } else {
    await saveSession();
    const maintenant = new Date().toISOString();
    lignesDeSession().forEach(l => allSessionsStudent.push({ ...l, reviewed_at: maintenant }));
    showEndView(sessionCorrect, sessionWrong, false);
  }
}

// Une ligne par paquet réellement révisé pendant la session
function lignesDeSession() {
  return Object.entries(sessionParPaquet).map(([deckId, s]) => ({
    deck_id: deckId,
    cards_reviewed: s.reviewed,
    cards_correct: s.correct,
  }));
}

async function saveSession() {
  const lignes = lignesDeSession();
  if (lignes.length === 0) return;
  await db.from('review_sessions').insert(
    lignes.map(l => ({ student_id: student.id, ...l }))
  );
}

// ── Vue : fin de session ──────────────────────────────────────
function nextReviewDate() {
  const deckCardIds = new Set(sessionCards.map(c => c.id));
  const progressMap = Object.fromEntries(allProgress.map(p => [p.card_id, p]));
  const dates = allProgress
    .filter(p => p.next_review && p.next_review > today())
    .map(p => p.next_review)
    .sort();
  if (dates.length === 0) return null;
  return new Date(dates[0]).toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long' });
}

function showEndView(correct, wrong, upToDate, limitReached = false) {
  const total = correct + wrong;
  const pct = total > 0 ? Math.round((correct / total) * 100) : 0;

  let emoji = '📚';
  let title = 'Session terminée !';

  const streakEl = document.getElementById('end-streak-message');
  streakEl.classList.add('hidden');

  if (upToDate) {
    if (limitReached) {
      emoji = '⏰';
      title = 'Limite journalière atteinte';
      document.getElementById('end-stats').innerHTML = `
        <div class="stat-row">
          <span class="stat-label">Nouvelles cartes aujourd'hui</span>
          <span class="stat-value">${MAX_NEW_CARDS_PER_DAY} / ${MAX_NEW_CARDS_PER_DAY}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Prochaine série</span>
          <span class="stat-value">Reviens demain pour ${MAX_NEW_CARDS_PER_DAY} nouvelles cartes 📅</span>
        </div>`;
    } else {
      emoji = '🎯';
      title = 'Tout est à jour !';
      document.getElementById('end-stats').innerHTML = `
        <div class="stat-row">
          <span class="stat-label">${sessionDecks.length > 1 ? 'Tes paquets' : 'Ce paquet'}</span>
          <span class="stat-value">Aucune carte à réviser aujourd'hui</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Prochaine révision</span>
          <span class="stat-value">Reviens demain 👍</span>
        </div>`;
    }
  } else {
    if (pct === 100) emoji = '🎉';
    else if (pct >= 80) emoji = '😄';
    else if (pct >= 60) emoji = '🙂';

    if (total > 0) {
      const streak = computeStreak(allSessionsStudent);
      if (streak >= 1) {
        streakEl.textContent = streakMessage(streak);
        streakEl.classList.remove('hidden');
      }
    }

    document.getElementById('end-stats').innerHTML = `
      <div class="stat-row">
        <span class="stat-label">Cartes révisées</span>
        <span class="stat-value">${total}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Correct</span>
        <span class="stat-value good">${correct}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">À revoir</span>
        <span class="stat-value bad">${wrong}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Score</span>
        <span class="stat-value">${pct} %</span>
      </div>
      ${(() => { const d = nextReviewDate(); return d ? `<div class="stat-row"><span class="stat-label">Prochaine révision</span><span class="stat-value">${d}</span></div>` : ''; })()}`;
  }

  document.getElementById('end-emoji').textContent = emoji;
  document.getElementById('end-title').textContent = title;
  showView('view-end');
}

// Retour aux paquets depuis la fin ou depuis la révision
document.getElementById('btn-back-end').addEventListener('click', () => {
  refreshDecksView();
  showView('view-decks');
});

document.getElementById('btn-back-review').addEventListener('click', () => {
  refreshDecksView();
  showView('view-decks');
});

// ── Démarrage ─────────────────────────────────────────────────
autoLogin();
