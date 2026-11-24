// =============================================================
//  CONFIGURAZIONE — l'unico file da modificare
//  Supabase > Project Settings > API (o "Data API"):
//   - Project URL           -> SUPABASE_URL
//   - anon / public key     -> SUPABASE_ANON_KEY  (è pubblica: è fatta per stare qui,
//                               la protezione dei dati la fanno le regole RLS)
//  NON inserire MAI la chiave "service_role" / "secret".
// =============================================================
window.APP_CONFIG = {
  SUPABASE_URL: "https://INSERISCI-IL-TUO-PROGETTO.supabase.co",
  SUPABASE_ANON_KEY: "INSERISCI-LA-TUA-ANON-KEY",

  TITOLO: "Gestionale Formatori SAF",
  SOTTOTITOLO: "Calendario e gestione formatori",

  // Primo anno del calendario (non si può tornare prima). Gli anni
  // successivi si aprono da soli a gennaio, i dati inseriti restano.
  ANNO_INIZIALE: 2027,

  // Logout automatico dopo X minuti senza attività
  MINUTI_INATTIVITA: 30
};
