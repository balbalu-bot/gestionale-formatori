-- =====================================================================
--  GESTIONALE FORMATORI — Schema database Supabase
--  Incollare TUTTO nel "SQL Editor" di Supabase e premere RUN.
--  Lo script si può rieseguire senza perdere dati.
--  Tutte le tabelle e funzioni hanno il prefisso gf_ : può convivere
--  con altre app nello stesso progetto senza toccarle.
--  Non modifica la tabella auth.users e non aggiunge trigger su di essa.
--
--  Sicurezza dati personali:
--   * Row Level Security (RLS) attiva su TUTTE le tabelle
--   * un nuovo utente non vede nulla finché un admin non lo approva
--   * ogni formatore vede/modifica solo i PROPRI dati personali
--   * email e telefono li vedono solo l'interessato e gli admin;
--     i colleghi vedono nome, cognome, qualifica, sede e il calendario
--   * nessun utente può promuoversi admin o auto-approvarsi
--   * registro accessi/modifiche (audit) visibile solo agli admin
--   * ogni utente può esportare e cancellare il proprio account (GDPR)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. TABELLE
-- ---------------------------------------------------------------------
create table if not exists public.gf_profili (
  id                uuid primary key default gen_random_uuid(),
  auth_id           uuid unique references auth.users(id) on delete cascade, -- collegato alla registrazione
  email             text not null default '',
  nome              text not null default '',
  cognome           text not null default '',
  qualifica         text not null default '',      -- es. VC, CS, CSE, CRE ...
  turno             text not null default '',      -- es. A8, C1, ST1
  sede              text not null default '',      -- Comando / Distaccamento
  telefono          text not null default '',
  ruolo             text not null default 'formatore' check (ruolo in ('formatore','admin')),
  approvato         boolean not null default false,
  attivo            boolean not null default true,
  consenso_privacy  timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table if not exists public.gf_disponibilita (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.gf_profili(id) on delete cascade,
  settimana   date not null check (extract(isodow from settimana) = 1),  -- sempre il LUNEDI'
  stato       text not null check (stato in ('disponibile','riserva','non_disponibile','svolto')),
  note        text not null default '' check (char_length(note) <= 200),
  updated_at  timestamptz not null default now(),
  unique (user_id, settimana)
);

create table if not exists public.gf_corsi (
  id           bigint generated always as identity primary key,
  titolo       text not null check (char_length(titolo) between 1 and 150),
  categoria    text not null default 'saf_basico'
               check (categoria in ('saf_basico','saf_fluviale','saf_avanzato','altro')),
  luogo        text not null default '',
  data_inizio  date not null,
  data_fine    date not null,
  note         text not null default '' check (char_length(note) <= 2000),
  created_by   uuid references public.gf_profili(id) on delete set null,
  created_at   timestamptz not null default now(),
  check (data_fine >= data_inizio)
);

create table if not exists public.gf_assegnazioni (
  corso_id      bigint not null references public.gf_corsi(id) on delete cascade,
  formatore_id  uuid not null references public.gf_profili(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (corso_id, formatore_id)
);

create table if not exists public.gf_audit (
  id          bigint generated always as identity primary key,
  user_id     uuid,
  azione      text not null,
  tabella     text not null,
  record_id   text,
  dettagli    jsonb,
  created_at  timestamptz not null default now()
);

create unique index if not exists gf_profiles_email_uq on public.gf_profili (lower(email)) where email <> '';
create index if not exists gf_disponibilita_sett_idx on public.gf_disponibilita (settimana);
create index if not exists gf_assegnazioni_form_idx  on public.gf_assegnazioni (formatore_id);
create index if not exists gf_corsi_date_idx         on public.gf_corsi (data_inizio, data_fine);
create index if not exists gf_audit_created_idx      on public.gf_audit (created_at desc);

-- ---------------------------------------------------------------------
-- 2. FUNZIONI DI SUPPORTO (security definer = leggono i ruoli senza
--    essere bloccate dalla RLS; search_path fisso contro hijacking)
-- ---------------------------------------------------------------------
create or replace function public.gf_my_profile_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.gf_profili where auth_id = auth.uid() and auth.uid() is not null;
$$;

create or replace function public.gf_is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.gf_profili
                 where auth_id = auth.uid() and ruolo = 'admin' and approvato and attivo);
$$;

create or replace function public.gf_is_approved()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.gf_profili
                 where auth_id = auth.uid() and approvato and attivo);
$$;

-- Elenco "pubblico" dei colleghi: solo dati non sensibili
create or replace function public.gf_elenco_formatori()
returns table (id uuid, nome text, cognome text, qualifica text, turno text, sede text, registrato boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.nome, p.cognome, p.qualifica, p.turno, p.sede, p.auth_id is not null
  from public.gf_profili p
  where public.gf_is_approved() and p.approvato and p.attivo
  order by p.cognome, p.nome;
$$;

-- ---------------------------------------------------------------------
-- 3. TRIGGER
-- ---------------------------------------------------------------------
-- 3b. Un non-admin non può cambiare ruolo/approvazione/email/consenso
create or replace function public.gf_protect_profile_fields()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- eccezione: il collegamento fatto dalla funzione gf_collega_account
  if coalesce(current_setting('gf.collega', true), '') = '1' then
    new.updated_at := now();
    return new;
  end if;
  if auth.uid() is not null then
    new.auth_id := old.auth_id;            -- il collegamento all'account non si tocca dal sito
  end if;
  if auth.uid() is not null and not public.gf_is_admin() then
    new.ruolo            := old.ruolo;
    new.approvato        := old.approvato;
    new.attivo           := old.attivo;
    new.email            := old.email;
    new.consenso_privacy := old.consenso_privacy;
  end if;
  -- un admin non può togliersi da solo i privilegi (evita di restare senza admin)
  if auth.uid() = old.auth_id and old.ruolo = 'admin' and new.ruolo <> 'admin' then
    raise exception 'Non puoi rimuovere il tuo ruolo di amministratore';
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists protect_profile on public.gf_profili;
create trigger protect_profile before update on public.gf_profili
  for each row execute function public.gf_protect_profile_fields();

-- 3c. Aggiorna timestamp disponibilità
create or replace function public.gf_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists touch_disp on public.gf_disponibilita;
create trigger touch_disp before update on public.gf_disponibilita
  for each row execute function public.gf_touch_updated_at();

-- 3d. Registro modifiche (audit)
create or replace function public.gf_audit_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
declare rec jsonb;
begin
  rec := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  insert into public.gf_audit (user_id, azione, tabella, record_id, dettagli)
  values (auth.uid(), tg_op, tg_table_name, coalesce(rec->>'id', rec->>'corso_id' || ':' || (rec->>'formatore_id')),
          case when tg_table_name = 'gf_profili'
               then jsonb_build_object('nome', rec->>'nome', 'cognome', rec->>'cognome',
                                       'ruolo', rec->>'ruolo', 'approvato', rec->>'approvato',
                                       'attivo', rec->>'attivo')
               else rec end);
  return null;
end $$;

drop trigger if exists audit_profiles on public.gf_profili;
create trigger audit_profiles after update or delete on public.gf_profili
  for each row execute function public.gf_audit_trigger();
drop trigger if exists audit_corsi on public.gf_corsi;
create trigger audit_corsi after insert or update or delete on public.gf_corsi
  for each row execute function public.gf_audit_trigger();
drop trigger if exists audit_assegnazioni on public.gf_assegnazioni;
create trigger audit_assegnazioni after insert or update or delete on public.gf_assegnazioni
  for each row execute function public.gf_audit_trigger();

-- ---------------------------------------------------------------------
-- 4. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------
alter table public.gf_profili      enable row level security;
alter table public.gf_disponibilita enable row level security;
alter table public.gf_corsi         enable row level security;
alter table public.gf_assegnazioni  enable row level security;
alter table public.gf_audit     enable row level security;

-- PROFILES -------------------------------------------------------------
drop policy if exists profiles_select on public.gf_profili;
create policy profiles_select on public.gf_profili for select to authenticated
  using (auth_id = auth.uid() or public.gf_is_admin());

drop policy if exists profiles_insert on public.gf_profili;
create policy profiles_insert on public.gf_profili for insert to authenticated
  with check (public.gf_is_admin() and auth_id is null);

drop policy if exists profiles_update on public.gf_profili;
create policy profiles_update on public.gf_profili for update to authenticated
  using (auth_id = auth.uid() or public.gf_is_admin())
  with check (auth_id = auth.uid() or public.gf_is_admin());

drop policy if exists profiles_delete on public.gf_profili;
create policy profiles_delete on public.gf_profili for delete to authenticated
  using (public.gf_is_admin() and auth_id is distinct from auth.uid());

-- DISPONIBILITA --------------------------------------------------------
drop policy if exists disp_select on public.gf_disponibilita;
create policy disp_select on public.gf_disponibilita for select to authenticated
  using (public.gf_is_approved());   -- serve a tutti per vedere il calendario comune

drop policy if exists disp_insert on public.gf_disponibilita;
create policy disp_insert on public.gf_disponibilita for insert to authenticated
  with check ((user_id = public.gf_my_profile_id() and public.gf_is_approved()) or public.gf_is_admin());

drop policy if exists disp_update on public.gf_disponibilita;
create policy disp_update on public.gf_disponibilita for update to authenticated
  using ((user_id = public.gf_my_profile_id() and public.gf_is_approved()) or public.gf_is_admin())
  with check ((user_id = public.gf_my_profile_id() and public.gf_is_approved()) or public.gf_is_admin());

drop policy if exists disp_delete on public.gf_disponibilita;
create policy disp_delete on public.gf_disponibilita for delete to authenticated
  using ((user_id = public.gf_my_profile_id() and public.gf_is_approved()) or public.gf_is_admin());

-- CORSI (lettura approvati, scrittura admin) ----------------------------
drop policy if exists corsi_select on public.gf_corsi;
create policy corsi_select on public.gf_corsi for select to authenticated
  using (public.gf_is_approved());
drop policy if exists corsi_write on public.gf_corsi;
create policy corsi_write on public.gf_corsi for all to authenticated
  using (public.gf_is_admin()) with check (public.gf_is_admin());

-- ASSEGNAZIONI (lettura approvati, scrittura admin) ---------------------
drop policy if exists ass_select on public.gf_assegnazioni;
create policy ass_select on public.gf_assegnazioni for select to authenticated
  using (public.gf_is_approved());
drop policy if exists ass_write on public.gf_assegnazioni;
create policy ass_write on public.gf_assegnazioni for all to authenticated
  using (public.gf_is_admin()) with check (public.gf_is_admin());

-- AUDIT (solo admin in lettura; nessuno scrive a mano) ------------------
drop policy if exists audit_select on public.gf_audit;
create policy audit_select on public.gf_audit for select to authenticated
  using (public.gf_is_admin());

-- Gli utenti anonimi (non loggati) non devono toccare nulla
revoke execute on function public.gf_is_admin(), public.gf_is_approved(), public.gf_my_profile_id() from anon;
revoke all on public.gf_profili, public.gf_disponibilita, public.gf_corsi,
              public.gf_assegnazioni, public.gf_audit from anon;
revoke execute on function public.gf_elenco_formatori() from anon, public;
grant  execute on function public.gf_elenco_formatori() to authenticated;

-- ---------------------------------------------------------------------
-- 5. FUNZIONI GDPR: esporta i miei dati / elimina il mio account
-- ---------------------------------------------------------------------
create or replace function public.gf_esporta_miei_dati()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'profilo',       (select to_jsonb(p) from public.gf_profili p where p.id = public.gf_my_profile_id()),
    'disponibilita', coalesce((select jsonb_agg(to_jsonb(d) order by d.settimana)
                               from public.gf_disponibilita d where d.user_id = public.gf_my_profile_id()), '[]'::jsonb),
    'corsi_assegnati', coalesce((select jsonb_agg(jsonb_build_object(
                                 'corso', c.titolo, 'dal', c.data_inizio, 'al', c.data_fine, 'luogo', c.luogo)
                                 order by c.data_inizio)
                               from public.gf_assegnazioni a join public.gf_corsi c on c.id = a.corso_id
                               where a.formatore_id = public.gf_my_profile_id()), '[]'::jsonb),
    'esportato_il',  now()
  );
$$;

create or replace function public.gf_elimina_mio_account()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Non autenticato'; end if;
  if public.gf_is_admin() and (select count(*) from public.gf_profili
                            where ruolo = 'admin' and approvato and attivo) <= 1 then
    raise exception 'Sei l''unico amministratore: nomina un altro admin prima di eliminare il tuo account';
  end if;
  insert into public.gf_audit (user_id, azione, tabella, record_id)
  values (auth.uid(), 'ACCOUNT_ELIMINATO', 'gf_profili', public.gf_my_profile_id()::text);
  -- cancella SOLO i dati del gestionale (l'account di accesso è condiviso con altre app)
  delete from public.gf_profili where auth_id = auth.uid();
end $$;

-- Collega l'utente loggato al gestionale:
--  * se la sua email (confermata) è tra i formatori pre-caricati -> collegato e già approvato
--  * altrimenti, se ha dato il consenso, crea una richiesta "in attesa di approvazione"
create or replace function public.gf_collega_account(p_nome text default '', p_cognome text default '',
  p_qualifica text default '', p_sede text default '', p_consenso boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u record; pid uuid;
begin
  if auth.uid() is null then raise exception 'Non autenticato'; end if;
  select id into pid from public.gf_profili where auth_id = auth.uid();
  if pid is not null then return jsonb_build_object('stato', 'collegato'); end if;
  select email, email_confirmed_at into u from auth.users where id = auth.uid();
  if u.email is null or u.email_confirmed_at is null then
    return jsonb_build_object('stato', 'email_non_confermata');
  end if;
  perform set_config('gf.collega', '1', true);
  update public.gf_profili set auth_id = auth.uid(),
         consenso_privacy = case when p_consenso then now() else consenso_privacy end
   where lower(email) = lower(u.email) and auth_id is null
   returning id into pid;
  perform set_config('gf.collega', '', true);
  if pid is not null then return jsonb_build_object('stato', 'collegato'); end if;
  if not p_consenso or coalesce(trim(p_nome), '') = '' or coalesce(trim(p_cognome), '') = '' then
    return jsonb_build_object('stato', 'serve_richiesta');
  end if;
  insert into public.gf_profili (auth_id, email, nome, cognome, qualifica, sede, consenso_privacy)
  values (auth.uid(), lower(u.email), left(trim(p_nome), 60), left(trim(p_cognome), 60),
          left(trim(p_qualifica), 30), left(trim(p_sede), 100), now());
  return jsonb_build_object('stato', 'in_attesa');
end $$;

revoke execute on function public.gf_esporta_miei_dati()   from anon, public;
revoke execute on function public.gf_elimina_mio_account() from anon, public;
revoke execute on function public.gf_collega_account(text, text, text, text, boolean) from anon, public;
grant  execute on function public.gf_collega_account(text, text, text, text, boolean) to authenticated;
grant  execute on function public.gf_esporta_miei_dati()   to authenticated;
grant  execute on function public.gf_elimina_mio_account() to authenticated;

-- ---------------------------------------------------------------------
-- 6. DATI INIZIALI (dal vecchio gestionale)
--    Formatori già APPROVATI: quando si registrano con QUESTA email
--    vengono collegati alla loro riga ed entrano subito.
--    Camporesi Enrico è già amministratore.
--    Chi non è in elenco può comunque registrarsi: resta in attesa
--    finché un admin non lo approva.
-- ---------------------------------------------------------------------
insert into public.gf_profili (nome, cognome, qualifica, turno, email, telefono, ruolo, approvato) values
  ('Enrico', 'Camporesi', 'VC', 'C1', 'camporesienrico@gmail.com', '3294284650', 'admin', true),
  ('Marco', 'Circolari', '', 'A8', 'marco.circolari@gmail.com', '', 'formatore', true),
  ('Daniele', 'Cortesi', '', 'C7', 'daniele.cortesi@vigilfuoco.it', '', 'formatore', true),
  ('Luigi', 'Dattilo', '', 'C4', 'luigi.dattilo@vigilfuoco.it', '', 'formatore', true),
  ('Donato', 'Demarco', '', 'A1', 'donato.demarco@vigilfuoco.it', '', 'formatore', true),
  ('Carmelino', 'Fonti', '', 'B4', 'carmelino.fonti@vigilfuoco.it', '', 'formatore', true),
  ('Gabriele', 'Gabaldo', '', 'A6', 'gabriele.gabaldo@vigilfuoco.it', '', 'formatore', true),
  ('Giuliano', 'Garoia', 'CSE', 'ST1', 'giuliano.garoia@gmail.com', '', 'formatore', true),
  ('Christian', 'Massagli', '', 'B4', 'christian.massagli@vigilfuoco.it', '', 'formatore', true),
  ('Gabriele', 'Medioli', 'CRE', 'A6', 'gabriele.medioli@vigilfuoco.it', '', 'formatore', true),
  ('Lorenzo', 'Melandri', '', 'A4', 'lorenzo.melandri@vigilfuoco.it', '', 'formatore', true),
  ('Matteo', 'Menegatti', '', 'A8', 'matteo.menegatti@vigilfuoco.it', '', 'formatore', true),
  ('Enrico', 'Nannini', '', 'D2', 'enrico.nannini@vigilfuoco.it', '', 'formatore', true),
  ('Alessandro', 'Pari', '', 'B5', 'alessandro.pari@vigilfuoco.it', '', 'formatore', true),
  ('Enrico', 'Passuti', 'VC', 'A3', 'spiderweb21@gmail.com', '', 'formatore', true),
  ('Juri', 'Pratesi', 'VC', 'ST8', 'juri.pratesi@vigilfuoco.it', '', 'formatore', true),
  ('Gian Luca', 'Rosati', '', 'D1', 'gianluca.rosati@vigilfuoco.it', '', 'formatore', true),
  ('Ciro', 'Sannino', '', 'G', 'sanninopio@gmail.com', '', 'formatore', true),
  ('Luca', 'Suzzi', '', 'A8', 'luca.suzzi@vigilfuoco.it', '', 'formatore', true),
  ('Enea', 'Tassinari', '', 'C4', 'eneatass@gmail.com', '', 'formatore', true)
on conflict do nothing;
