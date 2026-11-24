# Gestionale Formatori SAF — guida all'installazione

Web-app gratuita: **GitHub Pages** (il sito) + **Supabase** (database e login).
Tempo: circa 20 minuti, una volta sola.

## Cosa c'è nella cartella

| File | A cosa serve |
|---|---|
| `index.html`, `app.js` | l'app (non toccarli) |
| `config.js` | **l'unico file da modificare**: indirizzo e chiave del tuo Supabase |
| `supabase/schema.sql` | crea il database con tutte le regole di sicurezza |

---

## 1. Apri il progetto Supabase

Usa il progetto esistente **balbalu-bot's Project** (dashboard → clic sul progetto).
Il gestionale usa solo tabelle e funzioni che iniziano con `gf_` e **non tocca** quello che c'è già nel progetto.

## 2. Crea il database

1. Menu a sinistra → **SQL Editor** → *New query*.
2. Apri `supabase/schema.sql`, copia **tutto**, incolla e premi **Run**. Deve dire *Success*.

## 3. Impostazioni di accesso (Authentication)

Il progetto è condiviso con un'altra app, quindi **non cambiare la Site URL**.
- **Authentication → URL Configuration → Redirect URLs** → *Add URL* → `https://TUO-UTENTE.github.io/gestionale-formatori/` (lo fai dopo il punto 5).
- Gli account di accesso (email + password) sono in comune con le altre app del progetto: chi ha già un account usa **Accedi**, non *Registrati*.

## 4. Copia URL e chiave in `config.js`

**Project Settings → API** (o *Data API*):
- *Project URL* → `SUPABASE_URL`
- chiave **anon / public** (o *publishable*) → `SUPABASE_ANON_KEY`

> ✅ La chiave *anon* è fatta per stare nel sito: i dati li proteggono le regole del database.
> ⛔ **Mai** mettere la chiave *service_role* / *secret*.

## 5. Pubblica su GitHub Pages

1. Su **github.com** → **New repository** → nome `gestionale-formatori` → *Public* → *Create*.
2. *uploading an existing file* → trascina `index.html`, `app.js`, `config.js` (già compilato) e la cartella `supabase` → *Commit changes*.
3. **Settings → Pages** → *Source: Deploy from a branch* → branch `main`, cartella `/ (root)` → *Save*.
4. Dopo 1-2 minuti il sito è su `https://TUO-UTENTE.github.io/gestionale-formatori/` → aggiungilo nelle *Redirect URLs* (punto 3).

## 6. Entra e invita i colleghi

1. Apri il sito → **Registrati** con **camporesienrico@gmail.com** e conferma l'email dal link ricevuto (se hai già un account in questo progetto Supabase, usa direttamente **Accedi**).
   Sei già amministratore: lo script ha caricato i 20 formatori del vecchio gestionale e ti ha impostato come admin.
2. Manda il link ai colleghi. Chi si registra con **la stessa email** presente in elenco entra subito, già collegato alla sua riga.
3. Le **nuove registrazioni** sono sempre aperte: chi non è in elenco, dopo il primo accesso, compila una breve *Richiesta di accesso*; compare in **Formatori → In attesa di approvazione** e tu premi *Approva*. Gli utenti delle altre app del progetto non vedono nulla del gestionale.
4. Da **Formatori → + Aggiungi formatore** puoi inserire altri colleghi anche prima che si registrino.

## Gli anni successivi

Il calendario parte dal **2027** (`ANNO_INIZIALE` in `config.js`). Dal 1° gennaio 2028 l'app si apre da sola sull'anno nuovo; i dati degli anni precedenti restano e si consultano con le frecce ‹ ›. Non c'è niente da aggiornare.

---

## Come si usa

- **Calendario** — una riga per formatore (anche chi non si è ancora registrato: l'admin può compilare la sua riga), una colonna per settimana. Tocca una casella della tua riga → *Disponibile / Con riserva / Non disponibile / Svolto* (+ nota). I corsi assegnati compaiono col colore della categoria; se nella stessa settimana c'è anche uno stato, la casella è divisa in diagonale. "!" = due corsi nella stessa settimana.
- **Corsi** (admin) — *+ Nuovo corso*: titolo, categoria, date, luogo, e spunta i formatori. Accanto a ognuno vedi il pallino della disponibilità per quelle settimane e ⚠ se è già su un altro corso.
- **Riepilogo** — conteggi per formatore e *Esporta CSV* (si apre in Excel).
- **Profilo** — modifica i tuoi dati, cambia password, scarica i tuoi dati, elimina l'account.

## Sicurezza dei dati personali

- **Row Level Security** su ogni tabella: le regole stanno nel database, non nel sito, quindi non si aggirano neanche modificando la pagina.
- Chi si registra **non vede nulla** finché un admin non lo approva.
- **Email e telefono** li vedono solo l'interessato e gli admin; i colleghi vedono nome, qualifica, sede e calendario.
- Ognuno modifica **solo la propria riga**; nessuno può promuoversi admin o auto-approvarsi.
- **Registro modifiche** (corsi, assegnazioni, ruoli/approvazioni) visibile agli admin.
- **Consenso privacy** registrato all'iscrizione; **esportazione** e **cancellazione** dei propri dati da Profilo.
- **Logout automatico** dopo 30 minuti di inattività (`MINUTI_INATTIVITA` in `config.js`).
- La pagina blocca script esterni (Content-Security-Policy) e la libreria Supabase è verificata con impronta SRI.
- Dati su server UE (Frankfurt), connessione sempre HTTPS.

## Domande frequenti

- **Non arriva l'email di conferma** → guarda nello spam. Il servizio email gratuito di Supabase invia poche email l'ora: se siete in tanti, in *Authentication → Emails → SMTP* puoi collegare un tuo servizio email.
- **"Elimina i miei dati"** cancella solo i dati del gestionale: l'account di accesso resta, perché è condiviso con le altre app del progetto.
- **Progetto in pausa** → nel piano gratuito Supabase mette in pausa i progetti inattivi per una settimana: basta riattivarlo dalla dashboard (i dati restano).
- **Dati della vecchia app** → non vengono trasferiti in automatico.
