# Da fare (prossima sessione)

Richieste del 31/10/2026, da riprendere prima della Fase 4 (analisi AI).

## 1. Ricorrenti modificabili (icona matita ✏️)
- In **Altro → Ricorrenti e abbonamenti** ogni voce deve avere una matita per cambiare l'importo previsto:
  per esempio l'affitto che aumenta o diminuisce, un abbonamento che cambia prezzo.
- La modifica deve valere da una data in poi (lo storico resta com'è) e alimentare:
  - la **stima di fine mese** (oggi per le spese fisse usa l'importo del mese scorso),
  - la **proposta di budget** per le spese fisse,
  - l'elenco dei ricorrenti (importo tipico, costo annuale, prossimo addebito).
- Valutare anche: aggiungere a mano un ricorrente non riconosciuto, toglierne uno riconosciuto per errore.
- Probabile nuova tabella (per esempio `recurring_overrides`: categoria, sottocategoria, importo, valido dal).

## 2. Saldo del conto corretto a mano (icona matita ✏️)
- Il saldo stimato in **Altro → Saldo del conto** non coincide con quello reale.
- Serve una matita per inserire il **saldo vero** a una data: da lì in poi il calcolo riparte da quel valore
  (saldo reale + entrate − spese − investimenti successivi), mostrando anche la differenza rispetto alla stima.
- Capire perché la stima è sbagliata: possibili cause le 7 righe senza segno ignorate all'import (66,15 €),
  movimenti non registrati, investimenti che non escono dal conto ING, spese pagate con altri conti.
- Probabile nuova tabella (per esempio `balance_checkpoints`: conto, data, saldo).
