// ── État global ───────────────────────────────────────────────
let student = null;
let allDecks = [];
let allProgress = [];   // { card_id, box_level, next_review }
let allCardIds = [];    // { id, deck_id }

let currentDeck = null;
let sessionCards = [];
let sessionIndex = 0;
let sessionCorrect = 0;
let sessionWrong = 0;

// ── Utilitaires ───────────────────────────────────────────────
function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  window.scrollTo(0, 0);
}

function today() {
  return new Date().toISOString().split('T')[0];
}

function addDays(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}

function md(text) {
  return marked.parse(text || '');
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
  await loadDecksView();
});

// ── Déconnexion ───────────────────────────────────────────────
document.getElementById('btn-logout').addEventListener('click', () => {
  student = null;
  allDecks = [];
  allProgress = [];
  allCardIds = [];
  document.getElementById('input-firstname').value = '';
  document.getElementById('input-lastname').value = '';
  showView('view-login');
});

// ── Vue : liste des paquets ───────────────────────────────────
async function loadDecksView() {
  document.getElementById('topbar-name').textContent =
    `${student.first_name} ${student.last_name}`;
  showView('view-decks');
  document.getElementById('decks-list').innerHTML = '<div class="spinner">Chargement…</div>';

  const [decksRes, progressRes, cardsRes] = await Promise.all([
    db.from('decks').select('*').eq('is_active', true),
    db.from('progress').select('card_id, box_level, next_review').eq('student_id', student.id),
    db.from('cards').select('id, deck_id').eq('is_active', true),
  ]);

  allDecks = decksRes.data || [];
  allProgress = progressRes.data || [];
  allCardIds = cardsRes.data || [];

  renderDecks();
}

function renderDecks() {
  const todayStr = today();
  const progressMap = Object.fromEntries(allProgress.map(p => [p.card_id, p]));

  // Calculer les cartes dues par paquet
  const stats = {};
  allDecks.forEach(d => { stats[d.id] = { due: 0, total: 0 }; });
  allCardIds.forEach(c => {
    if (!stats[c.deck_id]) return;
    stats[c.deck_id].total++;
    const p = progressMap[c.id];
    if (!p || p.next_review <= todayStr) stats[c.deck_id].due++;
  });

  // Trier : année de l'élève en premier, puis alphabétique
  const myYear = student.year_level;
  const sorted = [...allDecks].sort((a, b) => {
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

  Object.keys(groups).forEach(year => {
    const section = document.createElement('div');
    section.className = 'year-section' + (year === myYear ? ' my-year' : '');

    const label = document.createElement('div');
    label.className = 'year-label';
    label.textContent = year === myYear ? `${year} — Ma classe` : year;
    section.appendChild(label);

    groups[year].forEach(deck => {
      const s = stats[deck.id] || { due: 0, total: 0 };
      const card = document.createElement('div');
      card.className = 'deck-card';
      card.innerHTML = `
        <div class="deck-info">
          <h3>${deck.name}</h3>
          <div class="deck-meta">${deck.subject}${deck.teacher ? ' · ' + deck.teacher : ''}</div>
        </div>
        <div class="due-badge ${s.due === 0 ? 'up-to-date' : ''}">
          ${s.due === 0 ? '✓ À jour' : `${s.due} carte${s.due > 1 ? 's' : ''}`}
        </div>`;
      card.addEventListener('click', () => startSession(deck));
      section.appendChild(card);
    });

    container.appendChild(section);
  });
}

// ── Session de révision ───────────────────────────────────────
async function startSession(deck) {
  currentDeck = deck;
  const todayStr = today();
  const progressMap = Object.fromEntries(allProgress.map(p => [p.card_id, p]));

  // Charger les cartes complètes du paquet
  const { data: cards } = await db
    .from('cards')
    .select('*')
    .eq('deck_id', deck.id)
    .eq('is_active', true);

  // Filtrer : dues aujourd'hui ou jamais vues
  sessionCards = (cards || []).filter(c => {
    const p = progressMap[c.id];
    return !p || p.next_review <= todayStr;
  });

  // Mélanger
  sessionCards.sort(() => Math.random() - 0.5);

  if (sessionCards.length === 0) {
    showEndView(0, 0, true);
    return;
  }

  sessionIndex = 0;
  sessionCorrect = 0;
  sessionWrong = 0;

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

  // Contenu de la carte (recto)
  document.getElementById('card-front').innerHTML = md(card.front);
  document.getElementById('card-back').innerHTML = md(card.back);

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
    allProgress.push({ card_id: card.id, box_level: newBox, next_review: nextReview });
  }

  if (correct) sessionCorrect++; else sessionWrong++;

  document.getElementById('btn-correct').disabled = false;
  document.getElementById('btn-wrong').disabled = false;

  sessionIndex++;
  if (sessionIndex < sessionCards.length) {
    renderCard();
  } else {
    await saveSession();
    showEndView(sessionCorrect, sessionWrong, false);
  }
}

async function saveSession() {
  await db.from('review_sessions').insert({
    student_id: student.id,
    deck_id: currentDeck.id,
    cards_reviewed: sessionCorrect + sessionWrong,
    cards_correct: sessionCorrect,
  });
}

// ── Vue : fin de session ──────────────────────────────────────
function showEndView(correct, wrong, upToDate) {
  const total = correct + wrong;
  const pct = total > 0 ? Math.round((correct / total) * 100) : 0;

  let emoji = '📚';
  let title = 'Session terminée !';

  if (upToDate) {
    emoji = '🎯';
    title = 'Tout est à jour !';
    document.getElementById('end-stats').innerHTML = `
      <div class="stat-row">
        <span class="stat-label">Ce paquet</span>
        <span class="stat-value">Aucune carte à réviser aujourd'hui</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Prochaine révision</span>
        <span class="stat-value">Reviens demain 👍</span>
      </div>`;
  } else {
    if (pct === 100) emoji = '🎉';
    else if (pct >= 80) emoji = '😄';
    else if (pct >= 60) emoji = '🙂';

    document.getElementById('end-stats').innerHTML = `
      <div class="stat-row">
        <span class="stat-label">Cartes révisées</span>
        <span class="stat-value">${total}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Je savais</span>
        <span class="stat-value good">${correct}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Je ne savais pas</span>
        <span class="stat-value bad">${wrong}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Score</span>
        <span class="stat-value">${pct} %</span>
      </div>`;
  }

  document.getElementById('end-emoji').textContent = emoji;
  document.getElementById('end-title').textContent = title;
  showView('view-end');
}

// Retour aux paquets depuis la fin ou depuis la révision
document.getElementById('btn-back-end').addEventListener('click', () => {
  renderDecks();
  showView('view-decks');
});

document.getElementById('btn-back-review').addEventListener('click', () => {
  renderDecks();
  showView('view-decks');
});
