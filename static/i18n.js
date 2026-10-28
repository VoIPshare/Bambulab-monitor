"use strict";
// UI strings. {name} placeholders are filled in by t(). Add a language by adding a block here
// and an <option> to #lang in index.html.
const I18N = {
  en: {
    title: "Bambu LAN Monitor Pro",
    subtitle: "Local multi-printer dashboard · temperatures, AMS, progress",
    filterLabel: "Filter printers", filterAll: "All printers", filterPrinting: "Printing", filterOffline: "Offline", filterError: "Errors",
    refresh: "Refresh", loading: "Loading…", language: "Language",
    footer: 'Read-only, local network only. The daemon only sends the Bambu "pushall" status request.',
    summaryLabel: "Fleet summary", sumOnline: "Online", sumActive: "Active prints", sumAms: "AMS slots loaded", sumErrors: "Errors", sumHistory: "History", on: "On", off: "Off",
    stOffline: "Offline", stError: "Error", stFailed: "Failed", stPaused: "Paused", stPreparing: "Preparing", stPrinting: "Printing", stFinished: "Finished", stIdle: "Idle", stQuiet: "Quiet · {age}",
    never: "Never", secondsAgo: "{n}s ago", minutesAgo: "{n}m ago", hoursAgo: "{n}h ago",
    layer: "Layer {n} / {total}", noJob: "No active job", left: "left", doneAt: "Done at", started: "Started",
    nozzle: "Nozzle", bed: "Bed", chamber: "Chamber",
    ams: "AMS", empty: "Empty", slot: "Slot {n}", inUse: "in use", loaded: "Loaded", humidityLevel: "Humidity {n}/5", rh: "{n}% RH",
    fanPart: "Part fan", fanAux: "Aux", fanExhaust: "Exhaust",
    camera: "Camera stream", cameraSize: "Camera size", camOff: "Off", live: "Live", tileShow: "Show", tileModel: "Model", tileCamera: "Camera", frameAt: "{time} · every minute", cameraOf: "Live camera of {name}",
    cameraDemo: "Live camera appears here when server.py is running.", cameraConnecting: "Connecting to camera…",
    platePreview: "Plate preview", noPreview: "No preview", loadingPreview: "Loading preview…", enlarge: "Click to enlarge",
    details: "Details", state: "State", waiting: "Waiting", lastReport: "Last report", wifi: "Wi-Fi", speed: "Speed", printError: "Print error", hms: "HMS alerts", reconnects: "Reconnects", noReport: "No report received",
    speed1: "Silent", speed2: "Standard", speed3: "Sport", speed4: "Ludicrous",
    noMatch: "No printers match this filter.", tabPrinting: "({n} printing) Bambu LAN Monitor",
    demoBanner: "Standalone preview mode with sample data. Start server.py for live printer data.",
    updated: "Updated {time}", backendDown: "Backend unavailable", apiDown: "Live API unavailable ({error}). Is server.py running?",
  },
  fr: {
    title: "Bambu LAN Monitor Pro",
    subtitle: "Tableau de bord local multi-imprimantes · températures, AMS, progression",
    filterLabel: "Filtrer les imprimantes", filterAll: "Toutes les imprimantes", filterPrinting: "En impression", filterOffline: "Hors ligne", filterError: "Erreurs",
    refresh: "Actualiser", loading: "Chargement…", language: "Langue",
    footer: "Lecture seule, réseau local uniquement. Le démon envoie seulement la requête d'état Bambu « pushall ».",
    summaryLabel: "Résumé du parc", sumOnline: "En ligne", sumActive: "Impressions en cours", sumAms: "Emplacements AMS chargés", sumErrors: "Erreurs", sumHistory: "Historique", on: "Activé", off: "Désactivé",
    stOffline: "Hors ligne", stError: "Erreur", stFailed: "Échec", stPaused: "En pause", stPreparing: "Préparation", stPrinting: "Impression", stFinished: "Terminé", stIdle: "Inactive", stQuiet: "Silencieuse · {age}",
    never: "Jamais", secondsAgo: "il y a {n} s", minutesAgo: "il y a {n} min", hoursAgo: "il y a {n} h",
    layer: "Couche {n} / {total}", noJob: "Aucune impression", left: "restant", doneAt: "Fin à", started: "Début",
    nozzle: "Buse", bed: "Plateau", chamber: "Caisson",
    ams: "AMS", empty: "Vide", slot: "Empl. {n}", inUse: "actif", loaded: "Chargé", humidityLevel: "Humidité {n}/5", rh: "{n} % HR",
    fanPart: "Ventilateur pièce", fanAux: "Auxiliaire", fanExhaust: "Extraction",
    camera: "Flux caméra", cameraSize: "Taille de la caméra", camOff: "Non", live: "Direct", tileShow: "Afficher", tileModel: "Modèle", tileCamera: "Caméra", frameAt: "{time} · chaque minute", cameraOf: "Caméra en direct de {name}",
    cameraDemo: "La caméra en direct s'affiche ici quand server.py est lancé.", cameraConnecting: "Connexion à la caméra…",
    platePreview: "Aperçu du plateau", noPreview: "Pas d'aperçu", loadingPreview: "Chargement de l'aperçu…", enlarge: "Cliquer pour agrandir",
    details: "Détails", state: "État", waiting: "En attente", lastReport: "Dernier rapport", wifi: "Wi-Fi", speed: "Vitesse", printError: "Erreur d'impression", hms: "Alertes HMS", reconnects: "Reconnexions", noReport: "Aucun rapport reçu",
    speed1: "Silencieux", speed2: "Standard", speed3: "Sport", speed4: "Extrême",
    noMatch: "Aucune imprimante ne correspond à ce filtre.", tabPrinting: "({n} en impression) Bambu LAN Monitor",
    demoBanner: "Mode aperçu autonome avec des données d'exemple. Lancez server.py pour les données en direct.",
    updated: "Mis à jour à {time}", backendDown: "Serveur indisponible", apiDown: "API en direct indisponible ({error}). server.py est-il lancé ?",
  },
  it: {
    title: "Bambu LAN Monitor Pro",
    subtitle: "Dashboard locale multi-stampante · temperature, AMS, avanzamento",
    filterLabel: "Filtra stampanti", filterAll: "Tutte le stampanti", filterPrinting: "In stampa", filterOffline: "Offline", filterError: "Errori",
    refresh: "Aggiorna", loading: "Caricamento…", language: "Lingua",
    footer: "Sola lettura, solo rete locale. Il demone invia soltanto la richiesta di stato Bambu \"pushall\".",
    summaryLabel: "Riepilogo stampanti", sumOnline: "Online", sumActive: "Stampe attive", sumAms: "Slot AMS caricati", sumErrors: "Errori", sumHistory: "Cronologia", on: "Attiva", off: "Disattiva",
    stOffline: "Offline", stError: "Errore", stFailed: "Fallita", stPaused: "In pausa", stPreparing: "Preparazione", stPrinting: "In stampa", stFinished: "Completata", stIdle: "Inattiva", stQuiet: "Silenziosa · {age}",
    never: "Mai", secondsAgo: "{n} s fa", minutesAgo: "{n} min fa", hoursAgo: "{n} h fa",
    layer: "Strato {n} / {total}", noJob: "Nessuna stampa attiva", left: "rimanenti", doneAt: "Fine alle", started: "Iniziata",
    nozzle: "Ugello", bed: "Piatto", chamber: "Camera",
    ams: "AMS", empty: "Vuoto", slot: "Slot {n}", inUse: "in uso", loaded: "Caricato", humidityLevel: "Umidità {n}/5", rh: "{n}% UR",
    fanPart: "Ventola pezzo", fanAux: "Ausiliaria", fanExhaust: "Estrazione",
    camera: "Streaming videocamera", cameraSize: "Dimensione videocamera", camOff: "No", live: "Live", tileShow: "Mostra", tileModel: "Modello", tileCamera: "Videocamera", frameAt: "{time} · ogni minuto", cameraOf: "Videocamera in diretta di {name}",
    cameraDemo: "La videocamera in diretta appare qui quando server.py è in esecuzione.", cameraConnecting: "Connessione alla videocamera…",
    platePreview: "Anteprima piatto", noPreview: "Nessuna anteprima", loadingPreview: "Caricamento anteprima…", enlarge: "Clicca per ingrandire",
    details: "Dettagli", state: "Stato", waiting: "In attesa", lastReport: "Ultimo rapporto", wifi: "Wi-Fi", speed: "Velocità", printError: "Errore di stampa", hms: "Avvisi HMS", reconnects: "Riconnessioni", noReport: "Nessun rapporto ricevuto",
    speed1: "Silenziosa", speed2: "Standard", speed3: "Sport", speed4: "Folle",
    noMatch: "Nessuna stampante corrisponde al filtro.", tabPrinting: "({n} in stampa) Bambu LAN Monitor",
    demoBanner: "Modalità anteprima con dati di esempio. Avvia server.py per i dati in tempo reale.",
    updated: "Aggiornato alle {time}", backendDown: "Server non disponibile", apiDown: "API in tempo reale non disponibile ({error}). server.py è in esecuzione?",
  },
};
const LANGS = Object.keys(I18N);
let lang = (() => {
  try { const saved = localStorage.getItem("lang"); if (LANGS.includes(saved)) return saved; } catch {}
  const browser = (navigator.language || "en").slice(0, 2).toLowerCase();
  return LANGS.includes(browser) ? browser : "en";
})();
function t(key, vars = {}) {
  const text = I18N[lang][key] ?? I18N.en[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (_, name) => vars[name] ?? "");
}
// Fills elements marked data-i18n (text) and data-i18n-label (aria-label) in index.html.
function applyStaticText() {
  document.documentElement.lang = lang;
  document.querySelectorAll("[data-i18n]").forEach(el => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll("[data-i18n-label]").forEach(el => el.setAttribute("aria-label", t(el.dataset.i18nLabel)));
}
function setLanguage(next) {
  if (!LANGS.includes(next)) return;
  lang = next;
  try { localStorage.setItem("lang", lang); } catch {}
  applyStaticText();
}
