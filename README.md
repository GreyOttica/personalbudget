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

Requisiti: Node.js 22.18 o successivo (esegue direttamente i file `.ts`).

### 1. Progetto Supabase

1. Crea un progetto su [supabase.com](https://supabase.com) (piano Free, regione `eu-central-1` o un'altra in UE).
2. **SQL Editor** → incolla ed esegui, in ordine, i file in `supabase/migrations/`.
3. **Authentication → Sign In / Providers → Email**: lascia attivo Email, disattiva "Confirm email" se vuoi saltare la conferma al primo accesso.
4. **Authentication → Email Templates → Magic Link**: sostituisci il corpo con un testo che contenga il codice, per esempio
   `<p>Il tuo codice di accesso: <strong>{{ .Token }}</strong></p>`.
   L'app usa il codice OTP e non il link, perché su iPhone il link si aprirebbe in Safari e non nella PWA.
5. Crea il tuo utente: **Authentication → Users → Add user → Create new user** con la tua email.
6. Registrati come proprietario (SQL Editor, con la tua email):
   ```sql
   insert into public.app_owner (user_id)
   select id from auth.users where email = 'tua@email.it';
   ```
7. **Authentication → Sign In / Providers**: disattiva "Allow new users to sign up". Da qui in poi nessun altro può creare un account.

### 2. Import

```bash
cp .env.example .env.local   # compila NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY
```

Prova senza scrivere nulla (riepilogo mensile + controllo con il foglio EU):

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
| Categoria 📈 Investimenti | investimento (risparmio) |
| 📦 Altro con nota "Investimenti", oppure 📦 Altro senza nota da 200 € | investimento, spostato in 📈 Investimenti › Versamento |
| Tutto il resto | spesa |

Importi ricorrenti (non proiettati linearmente nella stima di fine mese, si usa l'importo del mese precedente):
🏠 Affitto (900 €), 📈 Investimenti (200 €), 🔁 Abbonamenti.
