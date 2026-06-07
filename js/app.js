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
const retriedCards = new Set(); // cartes déjà repassées dans la session

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

function renderMath(el) {
  renderMathInElement(el, {
    delimiters: [
      { left: '$$', right: '$$', display: true },
      { left: '$', right: '$', display: false },
    ],
    throwOnError: false,
  });
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
    db.from('progress').select('card_id, box_level, next_review, first_seen').eq('student_id', student.id),
    db.from('cards').select('id, deck_id').eq('is_active', true),
  ]);

  allDecks = decksRes.data || [];
  allProgress = progressRes.data || [];
  allCardIds = cardsRes.data || [];

  await renderStreak();
  renderProgressOverview();
  renderDecks();
}

async function renderStreak() {
  const { data: sessions } = await db
    .from('review_sessions')
    .select('reviewed_at')
    .eq('student_id', student.id)
    .order('reviewed_at', { ascending: false });

  if (!sessions || sessions.length === 0) {
    document.getElementById('topbar-streak').textContent = '';
    return;
  }

  // Compter les jours consécutifs jusqu'à aujourd'hui (ou hier)
  const reviewedDays = new Set(sessions.map(s => s.reviewed_at.split('T')[0]));
  const todayStr = today();
  let streak = 0;
  const d = new Date();

  // Accepter si la dernière révision était aujourd'hui ou hier
  const lastDay = sessions[0].reviewed_at.split('T')[0];
  if (lastDay !== todayStr) {
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
    if (lastDay !== yesterday.toISOString().split('T')[0]) {
      document.getElementById('topbar-streak').textContent = '';
      return;
    }
    d.setDate(d.getDate() - 1);
  }

  while (reviewedDays.has(d.toISOString().split('T')[0])) {
    streak++;
    d.setDate(d.getDate() - 1);
  }

  document.getElementById('topbar-streak').textContent = streak >= 2 ? `🔥 ${streak}j` : '';
}

function renderProgressOverview() {
  const counts = Array(9).fill(0); // index 1-8
  allProgress.forEach(p => { if (p.box_level >= 1 && p.box_level <= 8) counts[p.box_level]++; });
  const total = counts.reduce((a, b) => a + b, 0);
  if (total === 0) return;

  document.getElementById('progress-overview').classList.remove('hidden');
  const colors = ['','#EF4444','#F97316','#EAB308','#84CC16','#22C55E','#14B8A6','#0EA5E9','#8B5CF6'];
  const max = Math.max(...counts.slice(1));

  document.getElementById('boxes-chart').innerHTML = counts.slice(1).map((n, i) => {
    const box = i + 1;
    const h = max > 0 ? Math.max(4, Math.round((n / max) * 48)) : 4;
    return `<div title="Boîte ${box} : ${n} carte${n > 1 ? 's' : ''}" style="flex:1;height:${h}px;background:${colors[box]};border-radius:3px 3px 0 0;cursor:default"></div>`;
  }).join('');

  document.getElementById('boxes-legend').innerHTML = counts.slice(1).map((n, i) =>
    `<div style="flex:1;text-align:center">${i + 1}</div>`
  ).join('') + `<div style="margin-left:8px;color:var(--text-light);font-size:0.72rem;align-self:center">${total} carte${total > 1 ? 's' : ''} en cours</div>`;
}

function renderDecks() {
  const todayStr = today();
  const progressMap = Object.fromEntries(allProgress.map(p => [p.card_id, p]));

  // Compter les nouvelles cartes déjà vues aujourd'hui par paquet
  const newSeenTodayByDeck = {};
  allProgress.forEach(p => {
    if (p.first_seen === todayStr) {
      const card = allCardIds.find(c => c.id === p.card_id);
      if (card) newSeenTodayByDeck[card.deck_id] = (newSeenTodayByDeck[card.deck_id] || 0) + 1;
    }
  });

  // Calculer les cartes dues par paquet (avec limite journalière pour les nouvelles)
  const stats = {};
  allDecks.forEach(d => { stats[d.id] = { due: 0, new_total: 0 }; });
  allCardIds.forEach(c => {
    if (!stats[c.deck_id]) return;
    const p = progressMap[c.id];
    if (!p) {
      stats[c.deck_id].new_total++;
    } else if (p.next_review <= todayStr) {
      stats[c.deck_id].due++;
    }
  });
  allDecks.forEach(d => {
    const s = stats[d.id];
    const newSeenToday = newSeenTodayByDeck[d.id] || 0;
    s.effective = s.due + Math.min(Math.max(0, MAX_NEW_CARDS_PER_DAY - newSeenToday), s.new_total);
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
        <div class="due-badge ${s.effective === 0 ? 'up-to-date' : ''}">
          ${s.effective === 0 ? '✓ À jour' : `${s.effective} carte${s.effective > 1 ? 's' : ''}`}
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

  // Cartes déjà vues et dues aujourd'hui
  const dueCards = (cards || []).filter(c => {
    const p = progressMap[c.id];
    return p && p.next_review <= todayStr;
  });

  // Nouvelles cartes (jamais vues), limitées à MAX_NEW_CARDS_PER_DAY par jour
  const newCards = (cards || []).filter(c => !progressMap[c.id]);
  const deckCardIds = new Set((cards || []).map(c => c.id));
  const newSeenToday = allProgress.filter(p =>
    p.first_seen === todayStr && deckCardIds.has(p.card_id)
  ).length;
  const remaining = Math.max(0, MAX_NEW_CARDS_PER_DAY - newSeenToday);
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
          <span class="stat-value">Reviens demain pour 5 nouvelles cartes 📅</span>
        </div>`;
    } else {
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
    }
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
      </div>
      ${(() => { const d = nextReviewDate(); return d ? `<div class="stat-row"><span class="stat-label">Prochaine révision</span><span class="stat-value">${d}</span></div>` : ''; })()}`;
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
