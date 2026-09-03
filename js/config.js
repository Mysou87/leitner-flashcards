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

const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
