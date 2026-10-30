# Personal Budget

PWA personale per registrare spese ed entrate, con dashboard, budget e analisi AI serale.
Stack: Next.js (App Router) + TypeScript su Vercel, Supabase (Postgres, Auth, Storage, pg_cron), API Anthropic, Web Push.

## Struttura

```
supabase/migrations/   schema SQL, RLS, funzione di import, viste di riepilogo
scripts/import-sheet.ts import idempotente dello storico dal Google Sheet esportato in .xlsx
scripts/lib/xlsx.ts     lettore XLSX senza dipendenze
data/                   file Excel locali (ignorati da git)
```

## Fase 1 — Database e import dello storico

Requisiti: Node.js 22.18 o successivo (lo script di import è TypeScript eseguito direttamente da Node).

### 1. Progetto Supabase

1. Crea un progetto su [supabase.com](https://supabase.com) (piano Free, regione `eu-central-1` o un'altra in UE).
2. **SQL Editor** → incolla ed esegui, in ordine, i file in `supabase/migrations/`.
3. **Authentication → Email Templates → Magic Link**: sostituisci il corpo con un testo che contenga il codice, per esempio
   `<p>Il tuo codice di accesso: <strong>{{ .Token }}</strong></p>`.
   L'app usa il codice OTP e non il link, perché su iPhone il link si aprirebbe in Safari e non nella PWA.
4. Crea il tuo utente: **Authentication → Users → Add user → Create new user** con la tua email, spuntando **Auto Confirm User** (la password puoi lasciarla casuale: non la userai).
5. Registrati come proprietario (SQL Editor, con la tua email):
   ```sql
   insert into public.app_owner (user_id)
   select id from auth.users where email = 'tua@email.it';
   ```
6. **Authentication → Sign In / Providers**: disattiva "Allow new users to sign up". Da qui in poi nessun altro può creare un account.

### 2. App in locale

```bash
npm install
cp .env.example .env.local   # compila NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY, OWNER_EMAIL
npm run dev
```

Apri http://localhost:3000: senza sessione vieni mandato su `/login`. Inserisci la tua email, ricevi il codice,
inseriscilo e vedi il riepilogo mensile letto dal database con la tua sessione (quindi passando da RLS).
Altre email vengono rifiutate prima ancora di chiedere il codice a Supabase.

### 3. Import

```bash
Con `.env.local` già compilato (passo 2), prova senza scrivere nulla (riepilogo mensile + controllo con il foglio EU):

```bash
node scripts/import-sheet.ts data/Personal_Budget_v_2.xlsx --dry-run
```

Import vero e proprio:

```bash
node --env-file=.env.local scripts/import-sheet.ts data/Personal_Budget_v_2.xlsx
```

Lo script si può rilanciare quante volte vuoi: la chiave è la colonna "Informazioni cronologiche" del Google Form,
quindi aggiunge solo le righe nuove e aggiorna quelle modificate nel foglio. Non cancella nulla: le righe sparite
dal foglio sono solo segnalate. Le righe eliminate dall'app non vengono ripristinate.

### Regole di classificazione

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
