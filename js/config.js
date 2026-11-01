const SUPABASE_URL = 'https://iuharjafrhwzhhggwzgy.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml1aGFyamFmcmh3emhoZ2d3emd5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA4MjMzMTgsImV4cCI6MjA5NjM5OTMxOH0.ieZT0hpGMcPQsJm6IjufzsZelZW3i25VSKhe_F8tqHk';

// Mot de passe du panneau d'administration — à changer !
const ADMIN_PASSWORD = 'leitner2025';

// Intervalles en jours pour chaque boîte (index = numéro de boîte)
const LEITNER_INTERVALS = [0, 1, 1, 2, 4, 7, 14, 21, 30];

// Nombre maximum de nouvelles cartes introduites par jour, TOUS PAQUETS
// CONFONDUS : c'est un budget quotidien partagé, pas une limite par paquet.
const MAX_NEW_CARDS_PER_DAY = 5;

// Seul paquet coché automatiquement à la première connexion d'un élève,
// dans son année. Les autres sont décochés : c'est à l'élève de les
// prendre. Mettre une chaine vide pour ne rien cocher du tout.
const PAQUET_COCHE_PAR_DEFAUT = 'Fonctionnement du cours';

// Groupes d'élèves proposés dans l'admin pour attribuer un paquet.
// Ils ne sont PAS recopiés ici : la composition est lue en direct dans les
// données de l'app de suivi (« Feuilles de cotes »), donc elle se met à jour
// toute seule à chaque import du classeur.
//   nom    = ce qui s'affiche dans l'admin
//   onglet = nom de l'onglet du classeur (colonne sheet_name de suivi_courses)
// Un élève peut appartenir à plusieurs groupes (sciences + maths).
// Onglets volontairement absents : « 5e Physique C » (mêmes élèves que
// « 5e Chimie C ») et « 4A Maths » (mêmes élèves que « 4A »).
const GROUPES_ELEVES = [
  { nom: '4A', onglet: '4A Sciences' },
  { nom: '4e Option', onglet: '4e Option' },
  { nom: '5e Chimie A', onglet: '5e Chimie A' },
  { nom: '5e Chimie B', onglet: '5e Chimie B' },
  { nom: '5e Chimie C', onglet: '5e Chimie C' },
  { nom: '6e Chimie', onglet: '6e Chimie' },
  // Cours de maths de Nico (M. Cormond)
  { nom: '4C Maths', onglet: '4C Maths' },
  { nom: '5e Maths 6h A', onglet: '5Maths6A' },
  { nom: '5e Maths 6h B', onglet: '5Maths6B' },
];

const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
