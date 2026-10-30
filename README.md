# Personal Budget

PWA personale per registrare spese ed entrate, con dashboard, budget e analisi AI serale.
Stack: Next.js (App Router) + TypeScript su Vercel, Supabase (Postgres, Auth, Storage, pg_cron), API Anthropic, Web Push.

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
4. Apri l'app dall'icona "Budget": si apre direttamente su **Nuovo movimento**, a schermo intero.

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
