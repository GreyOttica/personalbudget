// Preferenze di aspetto, salvate su questo dispositivo (localStorage).
// Applicate prima del primo disegno dallo script in <head> (vedi THEME_SCRIPT),
// così all'apertura non c'è un lampo del tema sbagliato.

export const THEME_MODES = [
  { id: "auto", label: "Automatico", hint: "Segue l'iPhone" },
  { id: "light", label: "Chiaro", hint: "Grigio chiaro iOS" },
  { id: "paper", label: "Carta", hint: "Chiaro caldo, riposante" },
  { id: "dark", label: "Scuro", hint: "Grafite" },
  { id: "oled", label: "Nero", hint: "Nero puro, risparmia batteria" },
] as const;

export const ACCENTS = [
  { id: "blue", label: "Blu", light: "#2167c4", dark: "#4a90e8" },
  { id: "violet", label: "Viola", light: "#5b48c9", dark: "#8f84ec" },
  { id: "green", label: "Verde", light: "#0b7a55", dark: "#2fb380" },
  { id: "orange", label: "Arancio", light: "#c0480f", dark: "#f07a3c" },
  { id: "pink", label: "Rosa", light: "#c0306b", dark: "#f06a9b" },
] as const;

export type ThemeMode = (typeof THEME_MODES)[number]["id"];
export type Accent = (typeof ACCENTS)[number]["id"];
export type ThemePrefs = { mode: ThemeMode; accent: Accent };

export const DEFAULT_PREFS: ThemePrefs = { mode: "auto", accent: "blue" };
const KEY = "pb-theme";

/** Colore della barra di stato per ogni modalità (meta theme-color). */
const BAR_COLOR: Record<Exclude<ThemeMode, "auto">, string> = {
  light: "#f2f2f7",
  paper: "#f4efe6",
  dark: "#1f2024",
  oled: "#000000",
};

export function readPrefs(): ThemePrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<ThemePrefs>;
    return {
      mode: THEME_MODES.some((m) => m.id === raw.mode) ? raw.mode! : DEFAULT_PREFS.mode,
      accent: ACCENTS.some((a) => a.id === raw.accent) ? raw.accent! : DEFAULT_PREFS.accent,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function applyPrefs(prefs: ThemePrefs) {
  const root = document.documentElement;
  if (prefs.mode === "auto") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", prefs.mode);
  root.setAttribute("data-accent", prefs.accent);
  const resolved = prefs.mode === "auto" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "oled" : "light") : prefs.mode;
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) meta.setAttribute("content", BAR_COLOR[resolved]);
}

export function savePrefs(prefs: ThemePrefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // archiviazione non disponibile (navigazione privata): vale solo per questa sessione
  }
  applyPrefs(prefs);
}

/** Script in <head>: stessa logica di readPrefs/applyPrefs, ma senza attendere React. */
export const THEME_SCRIPT = `(function(){try{var p=JSON.parse(localStorage.getItem("${KEY}")||"{}");var r=document.documentElement;
if(p.mode&&p.mode!=="auto")r.setAttribute("data-theme",p.mode);r.setAttribute("data-accent",p.accent||"blue");}catch(e){}})();`;
