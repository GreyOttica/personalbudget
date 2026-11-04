# Personal Budget

PWA personale per registrare spese ed entrate, con dashboard, budget e analisi AI serale.
Stack: Next.js (App Router) + TypeScript su Vercel, Supabase (Postgres, Auth, Storage, pg_cron), API Anthropic, Web Push.

Design, colori e schermate di riferimento: [`docs/DESIGN.md`](docs/DESIGN.md).

## Struttura

```
supabase/migrations/    schema SQL, RLS, funzione di import, viste di riepilogo
src/app/                pagine (login, home, import)
src/lib/import/         lettura del file Excel e regole di classificazione
src/lib/supabase/       client Supabase (sessione utente, proxy, secret key)
scripts/import-sheet.ts import da riga di comando (alternativa alla pagina /import)
```

## Messa online (tutto da browser)

### 1. Supabase

1. Crea un account su [supabase.com](https://supabase.com) e un progetto **Free**, regione in UE (per esempio Frankfurt).
   Annota la password del database in un posto sicuro (non serve all'app).
2. **SQL Editor** → **New query** → incolla tutto il contenuto di ciascun file in `supabase/migrations/`,
   uno per query e in ordine di nome, poi **Run** (se Supabase avvisa di "destructive operations", conferma:
   riguardano solo tabelle temporanee e permessi). Ogni file va eseguito una volta sola:
   - [`20261030000001_init.sql`](supabase/migrations/20261030000001_init.sql)
   - [`20261030000002_seed_import_summary.sql`](supabase/migrations/20261030000002_seed_import_summary.sql)
   - [`20261031000003_entry_sync.sql`](supabase/migrations/20261031000003_entry_sync.sql) (Fase 2)
   - [`20261031000004_goals.sql`](supabase/migrations/20261031000004_goals.sql) (obiettivi di risparmio)
   - [`20261101000005_recurring_balance.sql`](supabase/migrations/20261101000005_recurring_balance.sql) (ricorrenti automatici e saldo reale)
   - [`20261101000006_ai.sql`](supabase/migrations/20261101000006_ai.sql) (Fase 4: analisi AI e chat)
   - [`20261101000007_notifications.sql`](supabase/migrations/20261101000007_notifications.sql) (Fase 5: notifiche, controllo automatico, backup, proposte di budget)
   - [`20261101000008_sync_fixes.sql`](supabase/migrations/20261101000008_sync_fixes.sql) (la coda offline non si blocca con sottocategorie nuove)
   - [`20261104000009_predictions.sql`](supabase/migrations/20261104000009_predictions.sql) (obiettivo di risparmio e notifiche positive)
   - [`20261104000010_closing_tags.sql`](supabase/migrations/20261104000010_closing_tags.sql) (chiusura del mese, budget per viaggi, ripristino da backup)
3. **Authentication → Emails → Templates → Magic Link**: sostituisci il corpo del messaggio con
   `<p>Il tuo codice di accesso: <strong>{{ .Token }}</strong></p>` e salva.
   L'app usa il codice e non il link, perché su iPhone il link si aprirebbe in Safari e non nella PWA.
4. **Authentication → Users → Add user → Create new user**: la tua email, una password qualsiasi (non la userai),
   spunta **Auto Confirm User**.
5. **SQL Editor**, nuova query, con la tua email:
   ```sql
   insert into public.app_owner (user_id)
   select id from auth.users where email = 'tua@email.it';
   ```
6. **Authentication → Sign In / Providers**: disattiva **Allow new users to sign up** e salva.
7. **Project Settings → API Keys**: tieni aperta la pagina, ti servono URL del progetto, publishable key e secret key.
   L'URL è anche in **Project Settings → Data API** (formato `https://xxxx.supabase.co`).

### 2. Vercel

1. Crea un account su [vercel.com](https://vercel.com) con **Continue with GitHub** (piano Hobby).
2. **Add New… → Project** → importa `GreyOttica/personalbudget`. Se non compare, clicca su
   **Adjust GitHub App Permissions** e dai accesso al repository.
3. Prima di premere Deploy apri **Environment Variables** e aggiungi:

   | Nome | Valore |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | URL del progetto Supabase |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | publishable key (`sb_publishable_…`) |
   | `SUPABASE_SECRET_KEY` | secret key (`sb_secret_…`) |
   | `OWNER_EMAIL` | la tua email |
   | `GEMINI_API_KEY` | chiave gratuita di Google AI Studio (`AIza…`), segna la variabile come **Sensitive** |

4. **Deploy**. Dopo un paio di minuti ottieni un indirizzo tipo `https://personalbudget-xxxx.vercel.app`.
5. Su Supabase, **Authentication → URL Configuration → Site URL**: incolla quell'indirizzo e salva.

Se cambi una variabile d'ambiente su Vercel, rifai il deploy: **Deployments → … → Redeploy**.

### 3. Primo accesso e import dello storico

1. Apri l'indirizzo Vercel, inserisci la tua email, poi il codice che ricevi.
2. **Import storico** → scegli il file Excel (Google Sheets → File → Scarica → Microsoft Excel) → **Anteprima**.
   Controlla riepilogo mensile e controllo con il foglio EU, poi premi **Importa**.
3. Deve comparire "✓ Il riepilogo del database coincide al centesimo con il file". Torna alla Home: vedi gli stessi mesi.

L'import si può ripetere quante volte vuoi: la chiave è la colonna "Informazioni cronologiche" del Google Form,
quindi aggiunge solo le righe nuove e aggiorna quelle modificate nel foglio. Non cancella nulla: le righe sparite
dal foglio sono solo segnalate. Le righe eliminate dall'app non vengono ripristinate.

Il piano email gratuito di Supabase invia pochi messaggi all'ora: se chiedi il codice molte volte di fila, aspetta.

## Installazione su iPhone

1. Apri l'indirizzo dell'app in **Safari** (non in Chrome o in un'altra app).
2. Accedi con email e codice.
3. Tocca **Condividi** (il quadrato con la freccia) → **Aggiungi alla schermata Home** → **Aggiungi**.
4. Apri l'app dall'icona "Budget": si apre sulla **Home**, a schermo intero (il **+** in basso apre il nuovo movimento).

L'app installata ha una memoria separata da Safari, quindi al primo avvio chiede di nuovo l'accesso: serve il
**codice** dell'email (il link si aprirebbe in Safari). Per questo Supabase deve inviare email con
`{{ .Token }}` nel template, cosa possibile solo con un SMTP personalizzato (per esempio Gmail con una
"password per le app": **Authentication → Emails → SMTP Settings**).

## Uso offline

- I movimenti si salvano sul telefono e partono verso il server appena c'è rete: al salvataggio, al ritorno
  della rete, quando riapri l'app e ogni 30 secondi finché c'è qualcosa in attesa. Il badge in alto mostra lo stato.
- Ogni movimento ha un identificativo generato sul telefono: rimandarlo non crea duplicati.
- Se modifichi lo stesso movimento in due posti, vince la modifica più recente.
- Serve aver aperto l'app almeno una volta con la rete, per scaricare categorie e movimenti.
- "Esci" cancella dal telefono i dati salvati per l'offline (avvisa se ci sono movimenti non sincronizzati).

## Analisi AI e chat (Fase 4)

L'AI di default è **Google Gemini, piano gratuito**. In alternativa si può usare Claude di Anthropic (a pagamento).

| Variabile su Vercel | Cosa fa |
|---|---|
| `GEMINI_API_KEY` | chiave di [aistudio.google.com](https://aistudio.google.com) → **Get API key**, gratuita, senza carta |
| `GEMINI_MODEL` | facoltativa; default `gemini-flash-latest` (sempre l'ultimo Flash). Se la quota finisce l'app prova `gemini-flash-lite-latest` |
| `AI_PROVIDER` | facoltativa: `gemini` o `anthropic`. Se manca usa quella di cui c'è la chiave (Gemini se ci sono entrambe) |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | solo per usare Claude; modello di default `claude-opus-5-5` |

- Le chiavi restano su Vercel: l'app le usa lato server, il telefono non le vede mai.
- Sul piano gratuito Google può usare i dati inviati per migliorare i suoi servizi. All'AI arrivano totali e medie
  (analisi) e, in chat, i movimenti che servono a rispondere.
- **Altro → Analisi**: serale (oggi e mese in corso), settimanale (lunedì–domenica scorsi), mensile (mese scorso).
  Tutti i numeri sono calcolati dall'app in `src/lib/ai/facts.ts`; l'AI riceve solo quei totali, li commenta e sceglie
  al massimo 3 consigli tra "leve" già calcolate in euro. Ogni cifra del testo viene confrontata con i dati: se ne
  compare una che non esiste, l'analisi lo segnala.
- **Altro → Chiedi all'assistente**: domande libere; l'AI consulta i dati con strumenti (riepilogo mese, andamento,
  categoria, movimenti, proiezione del saldo, ricorrenti e obiettivi, piccole spese).
- Il collegamento all'AI è in `src/lib/ai/gemini.ts` e `src/lib/ai/anthropic.ts`, dietro `src/lib/ai/llm.ts`.
- In chat puoi chiedere di **riorganizzare il budget** ("riorganizzami il budget per risparmiare 150 € al mese"): l'AI
  sceglie gli importi, l'app calcola totale, spesa prevista, risparmio e avvisi (`src/lib/analytics/proposal.ts`), e
  la proposta si applica dal mese in corso con il tasto **Applica**.

## Previsioni statistiche

In `src/lib/analytics/predict.ts`, funzioni pure testate in `scripts/test-analytics.ts`. Niente modelli complessi:
con un anno di dati imparerebbero il rumore.

- **Simulazione Monte Carlo** del resto del mese (2.000 simulazioni): ogni giorno futuro ripesca un giorno vero degli
  ultimi 180, di preferenza dello stesso giorno della settimana (70%) e con più peso ai giorni recenti (metà peso ogni
  60 giorni). Si ripesca il giorno intero, quindi restano i legami tra categorie. Le spese fisse non si simulano.
- Ne escono: stima probabile (mediana) e forchetta 10°–90° percentile delle spese e del risparmio, probabilità di
  sforare ogni budget (l'avviso "sforerai" parte dal 65%), probabilità di risparmiare più del solito.
- **Risparmio "di solito"**: media esponenziale dei mesi completi (metà peso ogni 3 mesi). **Entrate attese**:
  ricorrenti, altrimenti la mediana degli ultimi 3 mesi (un rimborso una tantum non gonfia la stima).
- **Quota giornaliera**: (entrate attese − fisse − obiettivo di risparmio − variabili già spese), ripartita sui giorni
  rimasti in base a quanto spendi di solito in quel giorno della settimana. Obiettivo: Budget → Obiettivo di
  risparmio, oppure "come di solito".
- **Budget proposti**: per le variabili il livello rispettato circa 2 mesi su 3 negli ultimi 12 (percentile 66 pesato
  verso i mesi recenti), non la media.
- **Precisione**: la simulazione viene rifatta il 15 di ciascuno degli ultimi 6 mesi con i soli dati di allora e
  confrontata con il totale vero; l'errore medio è mostrato in Home.
- **Notifiche positive** (19–22, al massimo una al giorno): "stai andando bene" se la probabilità di risparmiare almeno
  30 € più del solito è ≥ 75% (dal giorno 8, una volta a settimana) e serie di 5, 10, 15… giorni sotto la quota. Non
  partono se non registri movimenti da più di 2 giorni.

## Strumenti per l'uso quotidiano

- **Inserimento veloce** (`src/lib/entry/suggest.ts`, sul telefono e offline): nel passo Categoria si cerca
  ("esse", "caff") tra le combinazioni categoria/sottocategoria/nota degli ultimi 6 mesi e il suggerimento compila
  tutto con l'importo tipico; nel passo Importo gli importi usati di solito; in apertura "I tuoi abituali" in un tocco
  (frequenza × recenza, niente spese fisse né sopra i 100 €). "1.500" si legge 1500 €.
- **Chiusura del mese** (`/chiusura`): saldo di oggi confrontato con la banca e salvato come saldo reale, com'è andato
  il mese, budget proposti per il mese nuovo. Invito in Home nei primi 10 giorni; il report del 1° apre questa pagina.
- **Obiettivi e previsioni**: arrivo previsto di ogni obiettivo (in ordine di scadenza, con il risparmio previsto del
  mese e poi quello di solito), probabilità di coprire le quote del mese; se le quote superano l'obiettivo di risparmio,
  la quota giornaliera parte da quelle. Notifica se sono a rischio (dal giorno 10).
- **Budget per viaggi ed eventi**: budget per tag con data di fine facoltativa; card in Home durante il viaggio;
  notifiche all'80% e al superamento.
- **Abbonamenti**: totale delle spese ricorrenti, aumenti di prezzo (fino al 35%) e nuove spese ricorrenti
  riconosciute, con notifica. Il primo controllo registra quelle già presenti senza avvisare.
- **Ripristino da backup** (Notifiche e backup): da un backup salvato o da un file. Sostituisce tutti i dati in una
  transazione (`restore_backup`); prima viene salvato un backup dello stato attuale. Bisogna scrivere RIPRISTINA.

## Notifiche, report e backup (Fase 5)

- **Controllo automatico**: la migrazione 0007 crea su Supabase un job `pg_cron` che ogni 15 minuti chiama
  `/api/cron/tick` con un segreto generato nel database (`app_config.cron_secret`, mai nel codice). L'indirizzo
  dell'app lo salva l'app stessa quando apri **Altro → Notifiche e backup**: fallo una volta dopo la migrazione.
  Le chiamate tengono anche attivo il progetto Supabase gratuito, che altrimenti va in pausa dopo 7 giorni.
- Cosa fa, in base all'ora di Roma (ora legale compresa):

  | Quando | Cosa |
  |---|---|
  | 8:00–22:00, ogni controllo | avvisi budget: proiezione "al ritmo attuale sforerai" (dal giorno 5), oltre 80%, superato. Una volta al mese per categoria e livello |
  | 21:00 | promemoria, solo se oggi non hai registrato nulla |
  | 21:30 | analisi della sera + notifica con il titolo |
  | lunedì 8:00 | report della settimana |
  | 1° del mese 8:00 | report del mese |
  | domenica 3:00 | backup JSON nello Storage (cartella privata `backups`, si tengono gli ultimi 8) |

  Se un controllo salta, quello dopo recupera; ogni job parte una volta sola (`notification_log`).
- **Notifiche push** (Web Push, VAPID): le chiavi sono generate dall'app al primo uso e salvate in `app_config`,
  non serve configurare nulla. Su iPhone servono iOS 16.4+ e l'app aperta dall'icona sulla schermata Home:
  **Altro → Notifiche e backup → Attiva le notifiche → Consenti**, poi **Invia una notifica di prova**.
- Stato del job su Supabase: **Integrations → Cron** (job `budget-tick`), oppure nella pagina Notifiche
  ("Ultimo controllo").

## Regole di classificazione dello storico

| Condizione | Tipo |
|---|---|
| "Importo per pivot E/U" vuoto (riga senza segno) | ignorata, non importata (come nel foglio EU) |
| Nota contiene "valore iniziale" | saldo iniziale, escluso da entrate e uscite |
| "Importo per pivot E/U" positivo (anche in Altro) | entrata; se è in 📦 Altro con nota "Stipendio" passa a 💼 Stipendio |
| 📈 Investimenti › Tasse | spesa (costo degli investimenti, non risparmio) |
| Categoria 📈 Investimenti, oppure 📦 Altro con nota "Investimenti" | investimento (risparmio), spostato in 📈 Investimenti |
| 📦 Altro senza nota da 200 €, se nel mese non c'è già un investimento | investimento (versamento mensile, uno al mese) |
| Tutto il resto | spesa |

Importi ricorrenti (non proiettati linearmente nella stima di fine mese, si usa l'importo del mese precedente):
🔑 Affitto (900 €), 📈 Investimenti (200 €), 🔁 Abbonamenti (SIM, 7 €).

Le regole sono implementate due volte, in `src/lib/import/sheet.ts` (anteprima e verifica) e in
`public.import_sheet_rows` (scrittura): vanno cambiate insieme.

## Sviluppo in locale (facoltativo)

Requisiti: Node.js 22.18 o successivo.

```bash
npm install
cp .env.example .env.local   # stesse variabili di Vercel
npm run dev                   # http://localhost:3000 sul tuo computer
npm run typecheck && npm run lint
```

Import da riga di comando, con il file in `data/Personal_Budget_v_2.xlsx`:

```bash
npm run import:dry   # solo riepilogo e controllo con il foglio EU
npm run import       # scrive su Supabase
```

## Versioni e ritorno a una versione precedente

| Branch | Contenuto |
|---|---|
| `v1` | **V1**: Fasi 1–3 complete + vista giornaliera, temi, mockup di design (commit `0a9dbf3`) |
| `design-v1` | prima versione della grafica (prima di temi e vista giornaliera) |
| `main` | versione in sviluppo, quella pubblicata su Vercel |

Per tornare alla V1 senza toccare il codice: su Vercel **Deployments** → il deploy con commit `0a9dbf3`
→ **⋯** → **Instant Rollback** (o **Promote to Production**). Per riportare anche il codice di `main`
alla V1, chiedilo in una sessione: si fa un commit che ripristina i file di `v1`, senza perdere la storia.

Il database non segue le versioni del codice: le migrazioni aggiunte dopo la V1 restano, e la V1 le ignora.
