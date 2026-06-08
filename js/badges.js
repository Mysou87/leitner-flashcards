const BADGE_DEFS = [
  { icon: '🌱', name: 'Premier pas',        check: d => d.total >= 1 },
  { icon: '🎯', name: 'Sans faute',         check: d => d.hasPerfectSession },
  { icon: '📚', name: 'Assidu·e',           check: d => d.total >= 20 },
  { icon: '🃏', name: 'Collectionneur·se',  check: d => d.total >= 50 },
  { icon: '🗂️', name: 'Bibliothèque',      check: d => d.total >= 100 },
  { icon: '🔟', name: '10 sessions',        check: d => d.sessionCount >= 10 },
  { icon: '💯', name: 'Centenaire',         check: d => d.sessionCount >= 100 },
  { icon: '🐢', name: 'Régulier·e',        check: d => d.distinctDays >= 7 },
  { icon: '🔥', name: '3 jours de suite',   check: d => d.streak >= 3 },
  { icon: '⚡', name: 'Semaine parfaite',   check: d => d.streak >= 7 },
  { icon: '📅', name: 'Un mois de suite',   check: d => d.streak >= 30 },
  { icon: '☀️', name: 'Lève-tôt',         check: d => d.hasEarlySession },
  { icon: '🌙', name: 'Noctambule',        check: d => d.hasLateSession },
  { icon: '🌟', name: 'En progression',     check: d => d.maxBox >= 5 },
  { icon: '🏆', name: 'Première maîtrise',  check: d => d.mastered >= 1 },
  { icon: '🎓', name: 'Diplômé·e',         check: d => d.mastered >= 50 },
  { icon: '🥇', name: 'Boîte max',         check: d => d.maxBox >= 8 },
  { icon: '🧹', name: 'Paquet maîtrisé',   check: d => d.deckMastered },
  { icon: '🦋', name: 'Métamorphose',      check: d => d.allBoxesFilled },
  { icon: '🌈', name: 'Arc-en-ciel',       check: d => d.distinctDecks >= 3 },
];

function localDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function computeStreak(sessions) {
  if (!sessions || sessions.length === 0) return 0;
  const daySet = new Set(sessions.map(s => localDateStr(new Date(s.reviewed_at))));
  const todayStr = localDateStr(new Date());
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = localDateStr(yesterday);
  const start = daySet.has(todayStr) ? todayStr : daySet.has(yesterdayStr) ? yesterdayStr : null;
  if (!start) return 0;
  let streak = 0;
  const d = new Date(start + 'T12:00:00');
  while (daySet.has(localDateStr(d))) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

function computeBadgeData(progress, sessions, allCardIds) {
  const total = progress.length;
  const counts = Array(9).fill(0);
  progress.forEach(p => { if (p.box_level >= 1 && p.box_level <= 8) counts[p.box_level]++; });
  const mastered = (counts[7] || 0) + (counts[8] || 0);
  const maxBox = total > 0 ? Math.max(...progress.map(p => p.box_level)) : 0;
  const allBoxesFilled = total > 0 && counts.slice(1).every(n => n > 0);
  const sessionCount = sessions.length;
  const distinctDays = new Set(sessions.map(s => s.reviewed_at.split('T')[0])).size;
  const streak = computeStreak(sessions);
  const hasEarlySession = sessions.some(s => new Date(s.reviewed_at).getHours() < 8);
  const hasLateSession = sessions.some(s => new Date(s.reviewed_at).getHours() >= 21);
  const hasPerfectSession = sessions.some(s => s.cards_reviewed > 0 && s.cards_correct === s.cards_reviewed);
  const distinctDecks = new Set(sessions.map(s => s.deck_id).filter(Boolean)).size;
  const progressMap = Object.fromEntries(progress.map(p => [p.card_id, p.box_level]));
  const deckCardMap = {};
  (allCardIds || []).forEach(c => {
    if (!deckCardMap[c.deck_id]) deckCardMap[c.deck_id] = [];
    deckCardMap[c.deck_id].push(c.id);
  });
  const deckMastered = Object.values(deckCardMap).some(cards =>
    cards.length > 0 && cards.every(id => (progressMap[id] || 0) >= 5)
  );
  return { total, mastered, maxBox, allBoxesFilled, sessionCount, distinctDays, streak, hasEarlySession, hasLateSession, hasPerfectSession, distinctDecks, deckMastered };
}
