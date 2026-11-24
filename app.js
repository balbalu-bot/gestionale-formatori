/* =====================================================================
   GESTIONALE FORMATORI — app (GitHub Pages + Supabase)
   Nessun dato è salvato qui: tutto sta su Supabase, protetto dalle
   regole RLS definite in supabase/schema.sql.
   ===================================================================== */
(() => {
"use strict";

const CFG = window.APP_CONFIG || {};
const $app = document.getElementById("app");

// ---------- costanti --------------------------------------------------
const STATI = {
  disponibile:     { l: "Disponibile",     c: "#22a55b" },
  riserva:         { l: "Con riserva",     c: "#e8a317" },
  non_disponibile: { l: "Non disponibile", c: "#e5484d" },
  svolto:          { l: "Svolto",          c: "#1f2937" },
};
const CAT = {
  saf_basico:   { l: "SAF Basico",   c: "#38bdf8" },
  saf_fluviale: { l: "SAF Fluviale", c: "#14b8a6" },
  saf_avanzato: { l: "SAF Avanzato", c: "#2563eb" },
  altro:        { l: "Altro",        c: "#f97316" },
};
const INFORMATIVA = `<div class="privacy"><b>Informativa privacy (sintesi).</b> I dati inseriti (nome, cognome, qualifica, sede, email,
        telefono facoltativo, disponibilità settimanali e corsi assegnati) servono solo a organizzare l'attività formativa.
        Email e telefono sono visibili solo a te e agli amministratori; i colleghi vedono nome, qualifica, sede e calendario.
        Puoi modificare, esportare o cancellare definitivamente i tuoi dati in ogni momento dalla pagina <i>Profilo</i>.
        L'accesso è attivo solo dopo l'approvazione di un amministratore.</div>`;
const MESI = ["Gen","Feb","Mar","Apr","Mag","Giu","Lug","Ago","Set","Ott","Nov","Dic"];
const MESI_L = ["Gennaio","Febbraio","Marzo","Aprile","Maggio","Giugno","Luglio","Agosto","Settembre","Ottobre","Novembre","Dicembre"];

// ---------- configurazione mancante ------------------------------------
if (!CFG.SUPABASE_URL || CFG.SUPABASE_URL.includes("INSERISCI") || !window.supabase) {
  $app.innerHTML = `<div class="auth"><div class="card"><h1>Configurazione mancante</h1>
  <p>Apri il file <b>config.js</b> e inserisci <b>SUPABASE_URL</b> e <b>SUPABASE_ANON_KEY</b>
  del tuo progetto Supabase (vedi LEGGIMI.md).</p></div></div>`;
  return;
}
document.title = CFG.TITOLO || "Gestionale Formatori";

const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

// ---------- stato ------------------------------------------------------
const S = {
  session: null, me: null, recovery: false,
  view: "calendario", authTab: "login",
  anno: Math.max(new Date().getFullYear(), CFG.ANNO_INIZIALE || 0),
  formatori: [], profili: [], disp: [], corsi: [], ass: [], audit: [],
  mostraPassati: false,
};

// ---------- utilità ----------------------------------------------------
const esc = (v) => String(v ?? "").replace(/[&<>"'`]/g, (ch) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" }[ch]));
const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const D = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const addDays = (d, n) => new Date(d.getTime() + n * 864e5);
const fmt = (s) => { const d = D(s); return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}`; };
const fmtY = (s) => { const d = D(s); return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`; };
const mondayOf = (d) => addDays(d, -((d.getUTCDay() + 6) % 7));
const todayUTC = () => { const n = new Date(); return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate())); };
const nomeF = (f) => f ? `${f.cognome} ${f.nome}`.trim() || "(senza nome)" : "?";

// settimane ISO dell'anno (lunedì)
function settimane(anno) {
  let m = mondayOf(new Date(Date.UTC(anno, 0, 4)));
  const fine = mondayOf(new Date(Date.UTC(anno + 1, 0, 4)));
  const out = [];
  for (let n = 1; m < fine; n++, m = addDays(m, 7)) out.push({ n, lun: iso(m), dom: iso(addDays(m, 6)), mese: addDays(m, 3).getUTCMonth() });
  return out;
}
const corsoInSett = (c, w) => c.data_inizio <= w.dom && c.data_fine >= w.lun;

function toast(msg, err = false) {
  const t = document.getElementById("toast");
  t.textContent = msg; t.className = err ? "err" : "";
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add("hidden"), err ? 6000 : 2500);
}
function errore(e) {
  console.error(e);
  const m = (e && (e.message || e.error_description)) || String(e);
  const tr = {
    "Invalid login credentials": "Email o password errate.",
    "Email not confirmed": "Devi prima confermare l'email (controlla la posta, anche lo spam).",
    "User already registered": "Questa email è già registrata.",
  };
  toast(tr[m] || m, true);
}
const isAdmin = () => S.me && S.me.ruolo === "admin" && S.me.approvato && S.me.attivo;

function modal(html) {
  closeModal();
  const ov = document.createElement("div");
  ov.className = "ov"; ov.id = "ov";
  ov.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  ov.addEventListener("mousedown", (e) => { if (e.target === ov) closeModal(); });
  document.body.appendChild(ov);
  const f = ov.querySelector("input,select,textarea"); if (f) f.focus();
}
function closeModal() { const o = document.getElementById("ov"); if (o) o.remove(); }

function scaricaFile(nome, testo, tipo) {
  const blob = new Blob([testo], { type: tipo });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = nome;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- logout per inattività --------------------------------------
let ultimaAttivita = Date.now();
["click", "keydown", "touchstart", "scroll"].forEach((ev) =>
  window.addEventListener(ev, () => { ultimaAttivita = Date.now(); }, { passive: true }));
setInterval(async () => {
  const lim = (CFG.MINUTI_INATTIVITA || 30) * 60e3;
  if (S.session && Date.now() - ultimaAttivita > lim) {
    await sb.auth.signOut(); toast("Disconnesso per inattività.");
  }
}, 60e3);

// =====================================================================
//  AUTENTICAZIONE
// =====================================================================
sb.auth.onAuthStateChange((evento, session) => {
  if (evento === "PASSWORD_RECOVERY") S.recovery = true;
  const cambiato = (session && session.user.id) !== (S.session && S.session.user.id);
  S.session = session;
  if (evento === "SIGNED_OUT") { S.me = null; S.recovery = false; render(); return; }
  if (cambiato || evento === "PASSWORD_RECOVERY" || evento === "INITIAL_SESSION") setTimeout(avvio, 0);
});

async function avvio() {
  if (!S.session) { S.me = null; return render(); }
  if (S.recovery) return render();
  // collega l'account al gestionale (formatore pre-caricato) o crea la richiesta
  const md = S.session.user.user_metadata || {};
  const r = await sb.rpc("gf_collega_account", { p_nome: md.nome || "", p_cognome: md.cognome || "",
    p_qualifica: md.qualifica || "", p_sede: md.sede || "", p_consenso: md.consenso_privacy === "true" });
  if (r.error) errore(r.error);
  S.collega = r.data ? r.data.stato : null;
  const { data, error } = await sb.from("gf_profili").select("*").eq("auth_id", S.session.user.id).maybeSingle();
  if (error) { errore(error); }
  S.me = data || null;
  if (S.me && S.me.approvato && S.me.attivo) await caricaTutto();
  render();
}

function renderAuth() {
  const t = S.authTab;
  const titolo = esc(CFG.TITOLO || "Gestionale Formatori");
  let corpo = "";
  if (t === "login") corpo = `
    <form data-form="login">
      <label>Email</label><input type="email" name="email" autocomplete="username" required>
      <label>Password</label><input type="password" name="password" autocomplete="current-password" required>
      <button class="btn p" style="width:100%;margin-top:14px">Accedi</button>
    </form>
    <p style="text-align:center"><a href="#" data-act="auth-tab" data-v="reset">Password dimenticata?</a></p>`;
  else if (t === "signup") corpo = `
    <form data-form="signup">
      <div class="grid2">
        <div><label>Nome</label><input type="text" name="nome" maxlength="60" required></div>
        <div><label>Cognome</label><input type="text" name="cognome" maxlength="60" required></div>
        <div><label>Qualifica</label><input type="text" name="qualifica" maxlength="30" placeholder="es. CS, CR, VP"></div>
        <div><label>Sede</label><input type="text" name="sede" maxlength="100" placeholder="Comando / Distaccamento"></div>
      </div>
      <label>Email</label><input type="email" name="email" autocomplete="username" required>
      <label>Password (min. 10 caratteri)</label><input type="password" name="password" minlength="10" autocomplete="new-password" required>
      ${INFORMATIVA}
      <label class="check"><input type="checkbox" name="consenso" required> Ho letto l'informativa e acconsento al trattamento dei dati</label>
      <button class="btn p" style="width:100%;margin-top:14px">Registrati</button>
    </form>`;
  else corpo = `
    <form data-form="reset">
      <p class="small muted">Inserisci la tua email: riceverai un link per impostare una nuova password.</p>
      <label>Email</label><input type="email" name="email" required>
      <button class="btn p" style="width:100%;margin-top:14px">Invia link</button>
    </form>
    <p style="text-align:center"><a href="#" data-act="auth-tab" data-v="login">Torna all'accesso</a></p>`;
  return `<div class="auth"><div class="logo">SAF</div><h1>${titolo}</h1>
    <p class="sub">${esc(CFG.SOTTOTITOLO || "")}</p>
    <div class="card">
      ${t !== "reset" ? `<div class="tabs"><button data-act="auth-tab" data-v="login" class="${t === "login" ? "on" : ""}">Accedi</button>
        <button data-act="auth-tab" data-v="signup" class="${t === "signup" ? "on" : ""}">Registrati</button></div>` : ""}
      ${corpo}
    </div></div>`;
}

function renderRecovery() {
  return `<div class="auth"><div class="logo">SAF</div><h1>Nuova password</h1><div class="card">
    <form data-form="newpass">
      <label>Nuova password (min. 10 caratteri)</label><input type="password" name="p1" minlength="10" autocomplete="new-password" required>
      <label>Ripeti password</label><input type="password" name="p2" minlength="10" autocomplete="new-password" required>
      <button class="btn p" style="width:100%;margin-top:14px">Salva password</button>
    </form></div></div>`;
}

function renderRichiesta() {
  return `<div class="auth"><div class="logo">SAF</div><h1>Richiedi accesso</h1>
    <p class="sub">La tua email non è tra i formatori già registrati. Compila la richiesta: un amministratore la approverà.</p>
    <div class="card"><form data-form="richiesta">
      <div class="grid2">
        <div><label>Nome</label><input type="text" name="nome" maxlength="60" required></div>
        <div><label>Cognome</label><input type="text" name="cognome" maxlength="60" required></div>
        <div><label>Qualifica</label><input type="text" name="qualifica" maxlength="30"></div>
        <div><label>Sede</label><input type="text" name="sede" maxlength="100"></div>
      </div>
      ${INFORMATIVA}
      <label class="check"><input type="checkbox" name="consenso" required> Ho letto l'informativa e acconsento al trattamento dei dati</label>
      <button class="btn p" style="width:100%;margin-top:14px">Invia richiesta</button>
    </form>
    <p style="text-align:center"><a href="#" data-act="logout">Esci</a></p></div></div>`;
}

function renderAttesa() {
  if (!S.me && S.collega === "serve_richiesta") return renderRichiesta();
  const disatt = S.me && !S.me.attivo;
  return `<div class="auth"><div class="logo">SAF</div><div class="card" style="text-align:center">
    <h1>${disatt ? "Account disattivato" : S.me ? "In attesa di approvazione" : S.collega === "email_non_confermata" ? "Email da confermare" : "Profilo non trovato"}</h1>
    <p class="muted">${disatt ? "Il tuo account è stato disattivato da un amministratore."
      : S.me ? "La registrazione è andata a buon fine. Un amministratore deve abilitare il tuo account: riprova più tardi."
      : S.collega === "email_non_confermata" ? "Conferma prima la tua email dal link che hai ricevuto, poi premi Riprova."
      : "Contatta un amministratore."}</p>
    <div class="row" style="justify-content:center">
      <button class="btn" data-act="ricarica">Riprova</button>
      <button class="btn" data-act="logout">Esci</button>
    </div>
    ${S.me ? `<p class="small" style="margin-top:18px"><a href="#" data-act="elimina-account">Elimina la mia registrazione</a></p>` : ""}
  </div></div>`;
}

// =====================================================================
//  CARICAMENTO DATI
// =====================================================================
async function caricaTutto() {
  const w = settimane(S.anno);
  const da = w[0].lun, a = w[w.length - 1].dom;
  const [f, d, c] = await Promise.all([
    sb.rpc("gf_elenco_formatori"),
    sb.from("gf_disponibilita").select("user_id,settimana,stato,note").gte("settimana", da).lte("settimana", a),
    sb.from("gf_corsi").select("*").lte("data_inizio", a).gte("data_fine", da).order("data_inizio"),
  ]);
  for (const r of [f, d, c]) if (r.error) { errore(r.error); }
  S.formatori = f.data || []; S.disp = d.data || []; S.corsi = c.data || [];
  const ids = S.corsi.map((x) => x.id);
  if (ids.length) {
    const r = await sb.from("gf_assegnazioni").select("corso_id,formatore_id").in("corso_id", ids);
    if (r.error) errore(r.error);
    S.ass = r.data || [];
  } else S.ass = [];
  if (isAdmin()) {
    const r = await sb.from("gf_profili").select("*").order("cognome");
    if (r.error) errore(r.error);
    S.profili = r.data || [];
  }
}

// indici veloci
function indici() {
  const disp = new Map(); S.disp.forEach((x) => disp.set(x.user_id + "|" + x.settimana, x));
  const corsiDi = new Map();
  const cById = new Map(S.corsi.map((c) => [c.id, c]));
  S.ass.forEach((a) => {
    const c = cById.get(a.corso_id); if (!c) return;
    if (!corsiDi.has(a.formatore_id)) corsiDi.set(a.formatore_id, []);
    corsiDi.get(a.formatore_id).push(c);
  });
  return { disp, corsiDi, cById };
}

// =====================================================================
//  LAYOUT
// =====================================================================
function render() {
  closeModal();
  if (!S.session) { $app.innerHTML = renderAuth(); return; }
  if (S.recovery) { $app.innerHTML = renderRecovery(); return; }
  if (!S.me || !S.me.approvato || !S.me.attivo) { $app.innerHTML = renderAttesa(); return; }

  const inAttesa = isAdmin() ? S.profili.filter((p) => !p.approvato && p.attivo).length : 0;
  const voci = [["calendario", "Calendario"], ["corsi", "Corsi"], ["riepilogo", "Riepilogo"],
    ["formatori", "Formatori" + (inAttesa ? `<span class="badge">${inAttesa}</span>` : "")], ["profilo", "Profilo"]];
  const viste = { calendario: vCalendario, corsi: vCorsi, riepilogo: vRiepilogo, formatori: vFormatori, profilo: vProfilo };
  $app.innerHTML = `
  <header>
    <div class="logo">SAF</div>
    <div class="brand">${esc(CFG.TITOLO || "Gestionale Formatori")}<div class="small muted" style="font-weight:400">${esc(nomeF(S.me))}${isAdmin() ? " · admin" : ""}</div></div>
    <nav>${voci.map(([k, l]) => `<button data-act="vai" data-v="${k}" class="${S.view === k ? "on" : ""}">${l}</button>`).join("")}
      <button data-act="logout" title="Esci">Esci</button></nav>
  </header>
  <main>${viste[S.view]()}</main>`;
  if (S.view === "calendario") scrollOggi();
}

function selAnno() {
  const a = S.anno, min = CFG.ANNO_INIZIALE || 0;
  return `<div class="row"><button class="btn sm" data-act="anno" data-v="${a - 1}" ${a - 1 < min ? "disabled" : ""}>‹ ${a - 1}</button>
    <b style="font-size:16px">${a}</b><button class="btn sm" data-act="anno" data-v="${a + 1}">${a + 1} ›</button></div>`;
}

// =====================================================================
//  VISTA: CALENDARIO
// =====================================================================
function vCalendario() {
  const W = settimane(S.anno);
  const { disp, corsiDi } = indici();
  const oggi = iso(mondayOf(todayUTC()));
  // intestazione mesi
  const mesi = []; W.forEach((w) => { const u = mesi[mesi.length - 1]; if (u && u.m === w.mese) u.n++; else mesi.push({ m: w.mese, n: 1 }); });
  // ordino: io per primo
  const righe = [...S.formatori].sort((a, b) => (b.id === S.me.id) - (a.id === S.me.id));
  const cella = (f, w) => {
    const d = disp.get(f.id + "|" + w.lun);
    const cs = (corsiDi.get(f.id) || []).filter((c) => corsoInSett(c, w));
    const can = f.id === S.me.id || isAdmin();
    let bg = "", tip = [];
    const cc = cs.length ? CAT[cs[0].categoria].c : null, sc = d ? STATI[d.stato].c : null;
    if (cc && sc) bg = `background:linear-gradient(135deg,${cc} 50%,${sc} 50%)`;
    else if (cc || sc) bg = `background:${cc || sc}`;
    cs.forEach((c) => tip.push("Corso: " + c.titolo + (c.luogo ? " – " + c.luogo : "")));
    if (cs.length > 1) tip.push("⚠ " + cs.length + " corsi nella stessa settimana");
    if (d) tip.push(STATI[d.stato].l + (d.note ? ": " + d.note : ""));
    tip.unshift(`${nomeF(f)} · S${w.n} (${fmt(w.lun)}–${fmt(w.dom)})`);
    return `<td class="c${can ? " can" : ""}" ${can ? `data-act="cella" data-f="${esc(f.id)}" data-w="${w.lun}"` : ""}
      style="${bg}" title="${esc(tip.join("\n"))}">${cs.length > 1 ? `<b style="color:#fff">!</b>` : ""}</td>`;
  };
  return `
  <div class="row" style="justify-content:space-between;margin-bottom:6px">
    <div><h1>Calendario ${S.anno}</h1><p class="sub" style="margin:0">Tocca una casella della <b>tua riga</b> per indicare la disponibilità di quella settimana.</p></div>
    ${selAnno()}
  </div>
  <div class="legend" style="margin-top:10px">
    ${Object.values(STATI).map((s) => `<span><i class="dot" style="background:${s.c}"></i>${s.l}</span>`).join("")}
    <span class="muted">|</span>
    ${Object.values(CAT).map((s) => `<span><i class="dot" style="background:${s.c}"></i>${s.l}</span>`).join("")}
  </div>
  <div class="calwrap" id="calwrap"><table class="cal">
    <thead>
      <tr><th class="nm mese"></th>${mesi.map((m) => `<th class="mese" colspan="${m.n}">${MESI_L[m.m]}</th>`).join("")}</tr>
      <tr><th class="nm" style="font-size:11px;color:var(--mut)">Corsi</th>${W.map((w) => {
        const cs = S.corsi.filter((c) => corsoInSett(c, w));
        return `<th class="cbar" title="${esc(cs.map((c) => c.titolo).join("\n"))}">${cs.slice(0, 3).map((c) => `<i style="background:${CAT[c.categoria].c}"></i>`).join("")}</th>`;
      }).join("")}</tr>
      <tr><th class="nm">Formatore</th>${W.map((w) => `<th class="wk${w.lun === oggi ? " oggi" : ""}" ${w.lun === oggi ? 'id="wkoggi"' : ""} title="${fmt(w.lun)} – ${fmt(w.dom)}">S${w.n}</th>`).join("")}</tr>
    </thead>
    <tbody>
      ${righe.map((f) => `<tr class="${f.id === S.me.id ? "me" : ""}"><td class="nm" title="${esc(nomeF(f))}">${esc(nomeF(f))}<span class="q">${esc([f.qualifica, f.turno].filter(Boolean).join(" · "))}</span></td>
        ${W.map((w) => cella(f, w)).join("")}</tr>`).join("")}
      ${righe.length ? "" : `<tr><td class="nm muted" colspan="${W.length + 1}">Nessun formatore approvato.</td></tr>`}
    </tbody>
  </table></div>`;
}
function scrollOggi() {
  const wrap = document.getElementById("calwrap"), th = document.getElementById("wkoggi");
  if (wrap && th) wrap.scrollLeft = Math.max(0, th.offsetLeft - 220);
}

function apriCella(fid, lun) {
  const f = S.formatori.find((x) => x.id === fid);
  const d = S.disp.find((x) => x.user_id === fid && x.settimana === lun);
  const dom = iso(addDays(D(lun), 6));
  const cs = S.ass.filter((a) => a.formatore_id === fid).map((a) => S.corsi.find((c) => c.id === a.corso_id))
    .filter((c) => c && c.data_inizio <= dom && c.data_fine >= lun);
  modal(`<h2>${esc(nomeF(f))}</h2>
    <p class="muted" style="margin-top:-6px">Settimana ${fmtY(lun)} – ${fmtY(dom)}</p>
    ${cs.map((c) => `<p><span class="chip"><i class="dot" style="background:${CAT[c.categoria].c}"></i>${esc(c.titolo)}</span> ${esc(c.luogo)}</p>`).join("")}
    <form data-form="cella" data-f="${esc(fid)}" data-w="${lun}">
      <div class="stati">${Object.entries(STATI).map(([k, s]) => `<button type="button" data-act="scegli-stato" data-v="${k}" class="${d && d.stato === k ? "on" : ""}">
        <i class="dot" style="background:${s.c};width:14px;height:14px"></i>${s.l}</button>`).join("")}</div>
      <input type="hidden" name="stato" value="${d ? esc(d.stato) : ""}">
      <label>Nota (facoltativa)</label><input type="text" name="note" maxlength="200" value="${esc(d ? d.note : "")}" placeholder="es. ferie, missione, corso CS…">
      <div class="row" style="margin-top:16px">
        ${d ? `<button type="button" class="btn d" data-act="svuota-cella">Svuota</button>` : ""}
        <span class="grow"></span>
        <button type="button" class="btn" data-act="chiudi">Annulla</button>
        <button class="btn p">Salva</button>
      </div>
    </form>`);
}

// =====================================================================
//  VISTA: CORSI
// =====================================================================
function vCorsi() {
  const { corsiDi } = indici();
  const oggi = iso(todayUTC());
  const lista = S.corsi.filter((c) => S.mostraPassati || c.data_fine >= oggi);
  const fById = new Map(S.formatori.map((f) => [f.id, f]));
  const sovrapposto = (fid, c) => (corsiDi.get(fid) || []).some((o) => o.id !== c.id && o.data_inizio <= c.data_fine && o.data_fine >= c.data_inizio);
  return `
  <div class="row" style="justify-content:space-between">
    <div><h1>Corsi ${S.anno}</h1><p class="sub" style="margin:0">${isAdmin() ? "Crea un corso e spunta i formatori: vedi subito chi è libero." : "Corsi programmati e formatori assegnati."}</p></div>
    <div class="row">${selAnno()}${isAdmin() ? `<button class="btn p" data-act="nuovo-corso">+ Nuovo corso</button>` : ""}</div>
  </div>
  <p><label class="check" style="display:inline-flex"><input type="checkbox" data-act="passati" ${S.mostraPassati ? "checked" : ""}> Mostra anche i corsi conclusi</label></p>
  ${lista.length ? "" : `<div class="card muted">Nessun corso ${S.mostraPassati ? "" : "in programma "}per il ${S.anno}.</div>`}
  ${lista.map((c) => {
    const fs = S.ass.filter((a) => a.corso_id === c.id).map((a) => fById.get(a.formatore_id)).filter(Boolean)
      .sort((a, b) => nomeF(a).localeCompare(nomeF(b)));
    const io = fs.some((f) => f.id === S.me.id);
    return `<div class="card corso" style="border-left-color:${CAT[c.categoria].c}">
      <div class="row">
        <div class="grow"><h3>${esc(c.titolo)} ${io ? `<span class="chip" style="background:var(--blu2);color:var(--blu)">ci sei anche tu</span>` : ""}</h3>
          <div class="muted small">${CAT[c.categoria].l} · ${fmtY(c.data_inizio)} → ${fmtY(c.data_fine)}${c.luogo ? " · " + esc(c.luogo) : ""}</div></div>
        ${isAdmin() ? `<button class="btn sm" data-act="modifica-corso" data-v="${c.id}">Modifica</button>` : ""}
      </div>
      ${c.note ? `<p class="small" style="white-space:pre-wrap;margin:8px 0 0">${esc(c.note)}</p>` : ""}
      <div style="margin-top:8px"><span class="small muted">Formatori (${fs.length}):</span>
        ${fs.map((f) => `<span class="chip">${esc(nomeF(f))}${sovrapposto(f.id, c) ? ` <span class="warn" title="Assegnato a un altro corso nelle stesse date">⚠</span>` : ""}</span>`).join("") || `<span class="small muted">nessuno</span>`}</div>
    </div>`;
  }).join("")}`;
}

function apriCorso(id) {
  const c = id ? S.corsi.find((x) => x.id === id) : null;
  const ass = new Set(c ? S.ass.filter((a) => a.corso_id === c.id).map((a) => a.formatore_id) : []);
  const lun = iso(mondayOf(addDays(todayUTC(), 7)));
  modal(`<h2>${c ? "Modifica corso" : "Nuovo corso"}</h2>
  <form data-form="corso" data-id="${c ? c.id : ""}">
    <label>Titolo</label><input type="text" name="titolo" maxlength="150" required value="${esc(c ? c.titolo : "")}" placeholder="es. SAF Basico 104°">
    <div class="grid2">
      <div><label>Categoria</label><select name="categoria">${Object.entries(CAT).map(([k, v]) => `<option value="${k}" ${c && c.categoria === k ? "selected" : ""}>${v.l}</option>`).join("")}</select></div>
      <div><label>Luogo</label><input type="text" name="luogo" maxlength="120" value="${esc(c ? c.luogo : "")}"></div>
      <div><label>Dal</label><input type="date" name="data_inizio" required value="${c ? c.data_inizio : lun}"></div>
      <div><label>Al</label><input type="date" name="data_fine" required value="${c ? c.data_fine : iso(addDays(D(lun), 4))}"></div>
    </div>
    <label>Note</label><textarea name="note" maxlength="2000">${esc(c ? c.note : "")}</textarea>
    <label>Formatori <span class="muted small" style="font-weight:400">(il pallino indica la disponibilità dichiarata in quelle settimane)</span></label>
    <div class="fsel" id="fsel">${S.formatori.map((f) => `<label class="${ass.has(f.id) ? "sel" : ""}"><input type="checkbox" name="f" value="${esc(f.id)}" ${ass.has(f.id) ? "checked" : ""}>
      <span class="grow">${esc(nomeF(f))} <span class="q">${esc(f.qualifica)}</span></span><span data-disp="${esc(f.id)}"></span></label>`).join("")}</div>
    <div class="row" style="margin-top:16px">
      ${c ? `<button type="button" class="btn d" data-act="elimina-corso" data-v="${c.id}">Elimina</button>` : ""}
      <span class="grow"></span>
      <button type="button" class="btn" data-act="chiudi">Annulla</button>
      <button class="btn p">Salva</button>
    </div>
  </form>`);
  aggiornaDispCorso(c ? c.id : null);
}

// mostra accanto a ogni formatore la disponibilità nelle settimane del corso
async function aggiornaDispCorso(corsoId) {
  const form = document.querySelector('form[data-form="corso"]'); if (!form) return;
  const di = form.data_inizio.value, df = form.data_fine.value;
  if (!di || !df || df < di) return;
  const da = iso(mondayOf(D(di)));
  const { data, error } = await sb.from("gf_disponibilita").select("user_id,stato,settimana").gte("settimana", da).lte("settimana", df);
  if (error) return;
  // altri corsi sovrapposti
  const altri = S.corsi.filter((c) => c.id !== corsoId && c.data_inizio <= df && c.data_fine >= di).map((c) => c.id);
  const occupati = new Set(S.ass.filter((a) => altri.includes(a.corso_id)).map((a) => a.formatore_id));
  const prio = ["non_disponibile", "riserva", "svolto", "disponibile"];
  document.querySelectorAll("#fsel [data-disp]").forEach((el) => {
    const fid = el.getAttribute("data-disp");
    const st = (data || []).filter((x) => x.user_id === fid).map((x) => x.stato);
    const peggiore = prio.find((p) => st.includes(p));
    let h = peggiore ? `<i class="dot" title="${STATI[peggiore].l}" style="background:${STATI[peggiore].c}"></i>` : `<i class="dot" title="Non indicato" style="background:#e2e8f0"></i>`;
    if (occupati.has(fid)) h = `<span class="warn" title="Già assegnato a un altro corso in queste date">⚠</span> ` + h;
    el.innerHTML = h;
  });
}

// =====================================================================
//  VISTA: RIEPILOGO
// =====================================================================
function datiRiepilogo() {
  const W = settimane(S.anno);
  const { corsiDi } = indici();
  return S.formatori.map((f) => {
    const mie = S.disp.filter((d) => d.user_id === f.id);
    const cnt = (k) => mie.filter((d) => d.stato === k).length;
    const cs = (corsiDi.get(f.id) || []).filter((c) => c.data_inizio.slice(0, 4) <= S.anno && c.data_fine.slice(0, 4) >= S.anno);
    const settCorso = W.filter((w) => cs.some((c) => corsoInSett(c, w))).length;
    const perCat = Object.fromEntries(Object.keys(CAT).map((k) => [k, cs.filter((c) => c.categoria === k).length]));
    return { f, corsi: cs.length, settCorso, perCat, disp: cnt("disponibile"), ris: cnt("riserva"), no: cnt("non_disponibile"), sv: cnt("svolto") };
  }).sort((a, b) => nomeF(a.f).localeCompare(nomeF(b.f)));
}
function vRiepilogo() {
  const R = datiRiepilogo();
  const tot = (k) => R.reduce((s, r) => s + r[k], 0);
  return `
  <div class="row" style="justify-content:space-between">
    <div><h1>Riepilogo ${S.anno}</h1><p class="sub" style="margin:0">Conteggi in settimane. "Settimane di corso" = settimane con almeno un corso assegnato.</p></div>
    <div class="row">${selAnno()}<button class="btn p" data-act="csv">Esporta CSV (Excel)</button></div>
  </div>
  <div class="card tscroll" style="margin-top:14px;padding:6px">
  <table class="t"><thead><tr><th>Formatore</th>
    ${Object.values(CAT).map((c) => `<th class="n"><i class="dot" style="background:${c.c}"></i> ${c.l}</th>`).join("")}
    <th class="n">Sett. di corso</th>
    ${Object.values(STATI).map((s) => `<th class="n"><i class="dot" style="background:${s.c}"></i> ${s.l}</th>`).join("")}
  </tr></thead><tbody>
  ${R.map((r) => `<tr${r.f.id === S.me.id ? ' style="background:#f7fbff;font-weight:600"' : ""}><td>${esc(nomeF(r.f))} <span class="q">${esc(r.f.qualifica)}</span></td>
    ${Object.keys(CAT).map((k) => `<td class="n">${r.perCat[k] || "<span class=muted>0</span>"}</td>`).join("")}
    <td class="n"><b>${r.settCorso}</b></td>
    <td class="n">${r.disp}</td><td class="n">${r.ris}</td><td class="n">${r.no}</td><td class="n">${r.sv}</td></tr>`).join("")}
  <tr style="font-weight:700"><td>Totale</td>${Object.keys(CAT).map((k) => `<td class="n">${R.reduce((s, r) => s + r.perCat[k], 0)}</td>`).join("")}
    <td class="n">${tot("settCorso")}</td><td class="n">${tot("disp")}</td><td class="n">${tot("ris")}</td><td class="n">${tot("no")}</td><td class="n">${tot("sv")}</td></tr>
  </tbody></table></div>`;
}
function esportaCSV() {
  const R = datiRiepilogo();
  const q = (v) => { let s = String(v ?? ""); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return `"${s.replace(/"/g, '""')}"`; };
  const head = ["Cognome", "Nome", "Qualifica", "Turno", "Sede", ...Object.values(CAT).map((c) => "Corsi " + c.l), "Settimane di corso", ...Object.values(STATI).map((s) => "Sett. " + s.l)];
  const rows = R.map((r) => [r.f.cognome, r.f.nome, r.f.qualifica, r.f.turno, r.f.sede, ...Object.keys(CAT).map((k) => r.perCat[k]), r.settCorso, r.disp, r.ris, r.no, r.sv]);
  const csv = "﻿" + [head, ...rows].map((r) => r.map(q).join(";")).join("\r\n");
  scaricaFile(`riepilogo-formatori-${S.anno}.csv`, csv, "text/csv;charset=utf-8");
}

// =====================================================================
//  VISTA: FORMATORI (+ gestione admin)
// =====================================================================
function vFormatori() {
  if (!isAdmin()) {
    return `<h1>Formatori</h1><p class="sub">${S.formatori.length} formatori attivi. I contatti sono visibili solo agli amministratori.</p>
    <div class="fgrid">${S.formatori.map((f) => `<div class="card" style="margin:0"><b>${esc(nomeF(f))}</b> ${f.qualifica ? `<span class="chip">${esc(f.qualifica)}</span>` : ""}${f.turno ? `<span class="chip">${esc(f.turno)}</span>` : ""}
      <div class="small muted">${esc(f.sede)}</div></div>`).join("")}</div>`;
  }
  const attesa = S.profili.filter((p) => !p.approvato && p.attivo);
  const attivi = S.profili.filter((p) => p.approvato && p.attivo);
  const disatt = S.profili.filter((p) => !p.attivo);
  const card = (p, azioni) => `<div class="card" style="margin:0">
    <div class="row"><b class="grow">${esc(nomeF(p))}</b>${p.ruolo === "admin" ? `<span class="chip" style="background:#fde68a">admin</span>` : ""}${p.qualifica ? `<span class="chip">${esc(p.qualifica)}</span>` : ""}${p.turno ? `<span class="chip">${esc(p.turno)}</span>` : ""}</div>
    <div class="small muted">${esc(p.sede)}</div>
    <div class="small">✉ ${esc(p.email || "—")}${p.telefono ? `<br>☎ ${esc(p.telefono)}` : ""}</div>
    <div class="small muted">${p.auth_id ? (p.consenso_privacy ? "Registrato · consenso privacy ✓" : "Registrato · <span class=warn>consenso privacy mancante</span>")
      : `<span class="warn">Non ancora registrato</span> — entra registrandosi con questa email`}</div>
    <div class="row" style="margin-top:8px"><button class="btn sm" data-act="edit-formatore" data-v="${esc(p.id)}">Modifica</button>${azioni}</div></div>`;
  return `<div class="row" style="justify-content:space-between"><div><h1>Formatori</h1><p class="sub" style="margin:0">Approva i nuovi iscritti, aggiungi formatori e gestisci gli accessi.</p></div>
    <button class="btn p" data-act="edit-formatore" data-v="">+ Aggiungi formatore</button></div>
  ${attesa.length ? `<h3>In attesa di approvazione (${attesa.length})</h3><div class="fgrid">${attesa.map((p) => card(p,
    `<button class="btn p sm" data-act="prof" data-op="approva" data-v="${esc(p.id)}">Approva</button>
     <button class="btn d sm" data-act="prof" data-op="disattiva" data-v="${esc(p.id)}">Rifiuta</button>`)).join("")}</div>` : ""}
  <h3>Attivi (${attivi.length})</h3><div class="fgrid">${attivi.map((p) => card(p, p.id === S.me.id ? `<span class="small muted">Sei tu</span>` :
    `${p.ruolo === "admin" ? `<button class="btn sm" data-act="prof" data-op="togli-admin" data-v="${esc(p.id)}">Togli admin</button>`
      : `<button class="btn sm" data-act="prof" data-op="admin" data-v="${esc(p.id)}">Rendi admin</button>`}
     <button class="btn d sm" data-act="prof" data-op="disattiva" data-v="${esc(p.id)}">Disattiva</button>`)).join("")}</div>
  ${disatt.length ? `<h3>Disattivati / rifiutati (${disatt.length})</h3><div class="fgrid">${disatt.map((p) => card(p,
    `<button class="btn sm" data-act="prof" data-op="riattiva" data-v="${esc(p.id)}">Riattiva</button>
     <button class="btn d sm" data-act="prof" data-op="elimina" data-v="${esc(p.id)}">Elimina dati</button>`)).join("")}</div>` : ""}
  <h3 style="margin-top:24px">Registro modifiche</h3>
  <div class="card"><button class="btn sm" data-act="audit">Mostra ultime 100 operazioni</button><div id="audit"></div></div>`;
}

async function azioneProfilo(op, id) {
  const p = S.profili.find((x) => x.id === id); if (!p) return;
  const upd = { approva: { approvato: true }, disattiva: { attivo: false }, riattiva: { attivo: true },
    admin: { ruolo: "admin" }, "togli-admin": { ruolo: "formatore" } }[op];
  if (op === "elimina") {
    modal(`<h2>Eliminare i dati di ${esc(nomeF(p))}?</h2><p>Verranno cancellati profilo, disponibilità e assegnazioni. L'operazione non si può annullare.
      </p>
      <div class="row"><span class="grow"></span><button class="btn" data-act="chiudi">Annulla</button>
      <button class="btn d" data-act="prof-elimina-ok" data-v="${esc(id)}">Elimina definitivamente</button></div>`);
    return;
  }
  const { error } = await sb.from("gf_profili").update(upd).eq("id", id);
  if (error) return errore(error);
  toast("Fatto."); await caricaTutto(); render();
}

function apriFormatore(id) {
  const p = id ? S.profili.find((x) => x.id === id) : null;
  const v = (k) => esc(p ? p[k] : "");
  modal(`<h2>${p ? "Modifica formatore" : "Aggiungi formatore"}</h2>
  ${p ? "" : `<p class="small muted" style="margin-top:-6px">Compare subito nel calendario. Quando si registrerà con questa email verrà collegato a questa scheda ed entrerà senza bisogno di approvazione.</p>`}
  <form data-form="formatore" data-id="${p ? esc(p.id) : ""}">
    <div class="grid2">
      <div><label>Nome</label><input type="text" name="nome" maxlength="60" required value="${v("nome")}"></div>
      <div><label>Cognome</label><input type="text" name="cognome" maxlength="60" required value="${v("cognome")}"></div>
      <div><label>Qualifica</label><input type="text" name="qualifica" maxlength="30" value="${v("qualifica")}" placeholder="es. VC, CS"></div>
      <div><label>Turno</label><input type="text" name="turno" maxlength="10" value="${v("turno")}" placeholder="es. A8"></div>
      <div><label>Sede</label><input type="text" name="sede" maxlength="100" value="${v("sede")}"></div>
      <div><label>Telefono</label><input type="tel" name="telefono" maxlength="30" value="${v("telefono")}"></div>
    </div>
    <label>Email ${p && p.auth_id ? '<span class="muted small" style="font-weight:400">(già registrato: non modificabile)</span>' : ""}</label>
    <input type="email" name="email" maxlength="120" value="${v("email")}" ${p && p.auth_id ? "disabled" : ""}>
    <div class="row" style="margin-top:16px"><span class="grow"></span>
      <button type="button" class="btn" data-act="chiudi">Annulla</button><button class="btn p">Salva</button></div>
  </form>`);
}

async function mostraAudit() {
  const { data, error } = await sb.from("gf_audit").select("*").order("created_at", { ascending: false }).limit(100);
  if (error) return errore(error);
  const chi = new Map(S.profili.filter((p) => p.auth_id).map((p) => [p.auth_id, nomeF(p)]));
  document.getElementById("audit").innerHTML = `<div class="tscroll"><table class="t" style="margin-top:8px"><thead><tr><th>Quando</th><th>Chi</th><th>Operazione</th><th>Dettagli</th></tr></thead><tbody>
    ${(data || []).map((r) => `<tr><td class="small">${esc(new Date(r.created_at).toLocaleString("it-IT"))}</td><td class="small">${esc(chi.get(r.user_id) || (r.user_id ? "utente eliminato" : "sistema"))}</td>
      <td class="small">${esc(r.azione)} ${esc(r.tabella)}</td><td class="small muted">${esc(r.dettagli ? (r.dettagli.titolo || [r.dettagli.cognome, r.dettagli.nome, r.dettagli.ruolo, r.dettagli.approvato === "true" ? "approvato" : "", r.dettagli.attivo === "false" ? "disattivato" : ""].filter(Boolean).join(" ")) : "")}</td></tr>`).join("")}
  </tbody></table></div>`;
}

// =====================================================================
//  VISTA: PROFILO
// =====================================================================
function vProfilo() {
  const m = S.me;
  return `<h1>Il mio profilo</h1><p class="sub">Email e telefono sono visibili solo a te e agli amministratori.</p>
  <div class="card"><form data-form="profilo">
    <div class="grid2">
      <div><label>Nome</label><input type="text" name="nome" maxlength="60" required value="${esc(m.nome)}"></div>
      <div><label>Cognome</label><input type="text" name="cognome" maxlength="60" required value="${esc(m.cognome)}"></div>
      <div><label>Qualifica</label><input type="text" name="qualifica" maxlength="30" value="${esc(m.qualifica)}"></div>
      <div><label>Sede</label><input type="text" name="sede" maxlength="100" value="${esc(m.sede)}"></div>
      <div><label>Turno</label><input type="text" name="turno" maxlength="10" value="${esc(m.turno)}"></div>
      <div><label>Telefono (facoltativo)</label><input type="tel" name="telefono" maxlength="30" value="${esc(m.telefono)}"></div>
      <div><label>Email</label><input type="email" value="${esc(m.email)}" disabled></div>
    </div>
    <button class="btn p" style="margin-top:14px">Salva</button>
  </form></div>
  <div class="card"><h3 style="margin-top:0">Cambia password</h3><form data-form="newpass">
    <div class="grid2"><div><label>Nuova password (min. 10)</label><input type="password" name="p1" minlength="10" autocomplete="new-password" required></div>
    <div><label>Ripeti</label><input type="password" name="p2" minlength="10" autocomplete="new-password" required></div></div>
    <button class="btn" style="margin-top:14px">Aggiorna password</button></form></div>
  <div class="card"><h3 style="margin-top:0">I miei dati</h3>
    <p class="small muted">Puoi scaricare una copia di tutti i tuoi dati o cancellarli definitivamente dal gestionale.</p>
    <div class="row"><button class="btn" data-act="esporta">Scarica i miei dati (JSON)</button>
    <button class="btn d" data-act="elimina-account">Elimina il mio account</button></div></div>`;
}

// =====================================================================
//  EVENTI (delegati: niente JavaScript inline, compatibile con la CSP)
// =====================================================================
document.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-act]"); if (!el) return;
  const act = el.getAttribute("data-act"), v = el.getAttribute("data-v");
  if (el.tagName === "A") e.preventDefault();
  try {
    switch (act) {
      case "auth-tab": S.authTab = v; render(); break;
      case "logout": await sb.auth.signOut(); break;
      case "ricarica": await avvio(); break;
      case "vai": S.view = v; render(); window.scrollTo(0, 0); break;
      case "anno": S.anno = Number(v); await caricaTutto(); render(); break;
      case "chiudi": closeModal(); break;
      case "cella": apriCella(el.getAttribute("data-f"), el.getAttribute("data-w")); break;
      case "scegli-stato": {
        const f = el.closest("form"); f.stato.value = v;
        f.querySelectorAll("[data-act=scegli-stato]").forEach((b) => b.classList.toggle("on", b === el));
        break;
      }
      case "svuota-cella": {
        const f = el.closest("form");
        const { error } = await sb.from("gf_disponibilita").delete().eq("user_id", f.dataset.f).eq("settimana", f.dataset.w);
        if (error) return errore(error);
        S.disp = S.disp.filter((x) => !(x.user_id === f.dataset.f && x.settimana === f.dataset.w));
        render(); break;
      }
      case "nuovo-corso": apriCorso(null); break;
      case "modifica-corso": apriCorso(Number(v)); break;
      case "elimina-corso":
        modal(`<h2>Eliminare il corso?</h2><p>Verranno tolte anche le assegnazioni dei formatori. Non si può annullare.</p>
          <div class="row"><span class="grow"></span><button class="btn" data-act="modifica-corso" data-v="${esc(v)}">Annulla</button>
          <button class="btn d" data-act="elimina-corso-ok" data-v="${esc(v)}">Elimina</button></div>`); break;
      case "elimina-corso-ok": {
        const { error } = await sb.from("gf_corsi").delete().eq("id", Number(v));
        if (error) return errore(error);
        toast("Corso eliminato."); await caricaTutto(); render(); break;
      }
      case "passati": S.mostraPassati = el.checked; render(); break;
      case "csv": esportaCSV(); break;
      case "prof": await azioneProfilo(el.getAttribute("data-op"), v); break;
      case "prof-elimina-ok": {
        const { error } = await sb.from("gf_profili").delete().eq("id", v);
        if (error) return errore(error);
        toast("Dati eliminati."); await caricaTutto(); render(); break;
      }
      case "audit": await mostraAudit(); break;
      case "edit-formatore": apriFormatore(v || null); break;
      case "esporta": {
        const { data, error } = await sb.rpc("gf_esporta_miei_dati");
        if (error) return errore(error);
        scaricaFile("i-miei-dati.json", JSON.stringify(data, null, 2), "application/json"); break;
      }
      case "elimina-account":
        modal(`<h2>Eliminare il tuo account?</h2>
          <p>Verranno cancellati definitivamente dal gestionale il tuo profilo, le tue disponibilità e le assegnazioni ai corsi.</p>
          <form data-form="elimina-account"><label>Per confermare scrivi <b>ELIMINA</b></label><input type="text" name="conf" autocomplete="off" required>
          <div class="row" style="margin-top:14px"><span class="grow"></span><button type="button" class="btn" data-act="chiudi">Annulla</button>
          <button class="btn d">Elimina definitivamente</button></div></form>`); break;
    }
  } catch (err) { errore(err); }
});

document.addEventListener("change", (e) => {
  const t = e.target;
  if (t.form && t.form.dataset.form === "corso") {
    if (t.name === "f") t.closest("label").classList.toggle("sel", t.checked);
    if (t.name === "data_inizio" || t.name === "data_fine") aggiornaDispCorso(Number(t.form.dataset.id) || null);
  }
});

document.addEventListener("submit", async (e) => {
  const f = e.target; const tipo = f.dataset.form; if (!tipo) return;
  e.preventDefault();
  const btn = f.querySelector("button:not([type=button])"); if (btn) btn.disabled = true;
  const val = (n) => (f[n] ? f[n].value.trim() : "");
  try {
    switch (tipo) {
      case "login": {
        const { error } = await sb.auth.signInWithPassword({ email: val("email"), password: f.password.value });
        if (error) errore(error);
        break;
      }
      case "signup": {
        if (!f.consenso.checked) { toast("Serve il consenso privacy.", true); break; }
        const { data, error } = await sb.auth.signUp({
          email: val("email"), password: f.password.value,
          options: { emailRedirectTo: location.origin + location.pathname,
            data: { nome: val("nome"), cognome: val("cognome"), qualifica: val("qualifica"), sede: val("sede"), consenso_privacy: "true" } },
        });
        if (error) { errore(error); break; }
        if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
          S.authTab = "login"; render(); toast("Questa email ha già un account: usa Accedi con la tua password (o \"Password dimenticata?\").", true); break;
        }
        if (!data.session) { S.authTab = "login"; render(); toast("Registrazione inviata: conferma l'email dal link ricevuto, poi accedi."); }
        break;
      }
      case "reset": {
        const { error } = await sb.auth.resetPasswordForEmail(val("email"), { redirectTo: location.origin + location.pathname });
        if (error) errore(error); else toast("Se l'email è registrata, riceverai un link.");
        break;
      }
      case "newpass": {
        if (f.p1.value !== f.p2.value) { toast("Le password non coincidono.", true); break; }
        const { error } = await sb.auth.updateUser({ password: f.p1.value });
        if (error) { errore(error); break; }
        toast("Password aggiornata."); f.reset();
        if (S.recovery) { S.recovery = false; history.replaceState(null, "", location.pathname); await avvio(); }
        break;
      }
      case "richiesta": {
        if (!f.consenso.checked) { toast("Serve il consenso privacy.", true); break; }
        const { data, error } = await sb.rpc("gf_collega_account", { p_nome: val("nome"), p_cognome: val("cognome"),
          p_qualifica: val("qualifica"), p_sede: val("sede"), p_consenso: true });
        if (error) { errore(error); break; }
        S.collega = data && data.stato; await avvio(); break;
      }
      case "cella": {
        const stato = val("stato");
        if (!stato) { toast("Scegli uno stato.", true); break; }
        const rec = { user_id: f.dataset.f, settimana: f.dataset.w, stato, note: val("note") };
        const { error } = await sb.from("gf_disponibilita").upsert(rec, { onConflict: "user_id,settimana" });
        if (error) { errore(error); break; }
        S.disp = S.disp.filter((x) => !(x.user_id === rec.user_id && x.settimana === rec.settimana)).concat(rec);
        render(); break;
      }
      case "corso": {
        const rec = { titolo: val("titolo"), categoria: val("categoria"), luogo: val("luogo"),
          data_inizio: val("data_inizio"), data_fine: val("data_fine"), note: val("note") };
        if (rec.data_fine < rec.data_inizio) { toast("La data di fine è prima di quella di inizio.", true); break; }
        let id = Number(f.dataset.id) || null;
        if (id) {
          const { error } = await sb.from("gf_corsi").update(rec).eq("id", id);
          if (error) { errore(error); break; }
        } else {
          const { data, error } = await sb.from("gf_corsi").insert({ ...rec, created_by: S.me.id }).select("id").single();
          if (error) { errore(error); break; }
          id = data.id;
        }
        const scelti = new Set([...f.querySelectorAll("input[name=f]:checked")].map((x) => x.value));
        const prima = new Set(S.ass.filter((a) => a.corso_id === id).map((a) => a.formatore_id));
        const add = [...scelti].filter((x) => !prima.has(x)).map((x) => ({ corso_id: id, formatore_id: x }));
        const del = [...prima].filter((x) => !scelti.has(x));
        if (add.length) { const r = await sb.from("gf_assegnazioni").insert(add); if (r.error) errore(r.error); }
        if (del.length) { const r = await sb.from("gf_assegnazioni").delete().eq("corso_id", id).in("formatore_id", del); if (r.error) errore(r.error); }
        toast("Corso salvato."); await caricaTutto(); render(); break;
      }
      case "formatore": {
        const rec = { nome: val("nome"), cognome: val("cognome"), qualifica: val("qualifica"), turno: val("turno"), sede: val("sede"), telefono: val("telefono") };
        if (!f.email.disabled) rec.email = val("email").toLowerCase();
        const id = f.dataset.id;
        const { error } = id ? await sb.from("gf_profili").update(rec).eq("id", id)
          : await sb.from("gf_profili").insert({ ...rec, approvato: true });
        if (error) { errore(error.code === "23505" ? new Error("Esiste già un formatore con questa email.") : error); break; }
        toast("Formatore salvato."); await caricaTutto(); render(); break;
      }
      case "profilo": {
        const rec = { nome: val("nome"), cognome: val("cognome"), qualifica: val("qualifica"), turno: val("turno"), sede: val("sede"), telefono: val("telefono") };
        const { data, error } = await sb.from("gf_profili").update(rec).eq("id", S.me.id).select().single();
        if (error) { errore(error); break; }
        S.me = data; toast("Profilo salvato."); await caricaTutto(); render(); break;
      }
      case "elimina-account": {
        if (val("conf") !== "ELIMINA") { toast("Scrivi ELIMINA per confermare.", true); break; }
        const { error } = await sb.rpc("gf_elimina_mio_account");
        if (error) { errore(error); break; }
        await sb.auth.signOut(); toast("Account eliminato."); break;
      }
    }
  } catch (err) { errore(err); }
  finally { if (btn && btn.isConnected) btn.disabled = false; }
});

document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });
})();
