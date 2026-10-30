// Lettore XLSX minimale e senza dipendenze, sufficiente per l'export di Google
// Sheets: legge i valori memorizzati nelle celle (non ricalcola le formule).
import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

export type Cell = string | number | boolean | null;
export type Sheet = Map<number, Map<number, Cell>>; // riga (1-based) → colonna (1-based) → valore

function unzip(buf: Buffer): Map<string, Buffer> {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("File non valido: non è un archivio XLSX");

  const entries = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map<string, Buffer>();

  for (let n = 0; n < entries; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("Directory centrale ZIP corrotta");
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;

    const dataStart = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
    const data = buf.subarray(dataStart, dataStart + compressedSize);
    if (method === 0) files.set(name, data);
    else if (method === 8) files.set(name, inflateRawSync(data));
    else throw new Error(`Compressione ZIP non supportata (${method}) per ${name}`);
  }
  return files;
}

function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    switch (e.toLowerCase()) {
      case "amp": return "&";
      case "lt": return "<";
      case "gt": return ">";
      case "quot": return '"';
      case "apos": return "'";
      default:
        return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    }
  });
}

function attr(attrs: string, name: string): string | undefined {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(attrs);
  return m ? decodeXml(m[1]) : undefined;
}

function textRuns(xml: string): string {
  let out = "";
  for (const m of xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/g)) out += decodeXml(m[1] ?? "");
  return out;
}

function colIndex(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, "")) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

export class Workbook {
  private files: Map<string, Buffer>;
  private shared: string[] = [];
  private sheetPaths = new Map<string, string>();

  constructor(path: string) {
    this.files = unzip(readFileSync(path));

    const sst = this.files.get("xl/sharedStrings.xml");
    if (sst) {
      for (const m of sst.toString("utf8").matchAll(/<si>([\s\S]*?)<\/si>/g)) this.shared.push(textRuns(m[1]));
    }

    const rels = new Map<string, string>();
    const relsXml = this.files.get("xl/_rels/workbook.xml.rels")?.toString("utf8") ?? "";
    for (const m of relsXml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
      const id = attr(m[1], "Id");
      const target = attr(m[1], "Target");
      if (id && target) rels.set(id, target.startsWith("/") ? target.slice(1) : `xl/${target}`);
    }
    const wbXml = this.files.get("xl/workbook.xml")?.toString("utf8") ?? "";
    for (const m of wbXml.matchAll(/<sheet\b([^>]*)\/?>/g)) {
      const name = attr(m[1], "name");
      const rid = attr(m[1], "r:id");
      const target = rid ? rels.get(rid) : undefined;
      if (name && target) this.sheetPaths.set(name, target);
    }
  }

  sheetNames(): string[] {
    return [...this.sheetPaths.keys()];
  }

  sheet(name: string): Sheet {
    const path = this.sheetPaths.get(name);
    const xml = path ? this.files.get(path)?.toString("utf8") : undefined;
    if (!xml) throw new Error(`Foglio "${name}" non trovato. Fogli presenti: ${this.sheetNames().join(", ")}`);

    const rows: Sheet = new Map();
    for (const m of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = attr(m[1], "r");
      if (!ref) continue;
      const type = attr(m[1], "t");
      const body = m[2] ?? "";
      const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value: Cell = null;
      if (type === "inlineStr") value = textRuns(body);
      else if (raw === undefined) value = null;
      else if (type === "s") value = this.shared[Number(raw)] ?? null;
      else if (type === "str") value = decodeXml(raw);
      else if (type === "b") value = raw === "1";
      else if (type === "e") value = null;
      else value = Number(raw);
      if (value === "" || value === null) continue;

      const row = Number(ref.match(/\d+$/)![0]);
      if (!rows.has(row)) rows.set(row, new Map());
      rows.get(row)!.set(colIndex(ref), value);
    }
    return rows;
  }
}

/** Numero seriale Excel (giorni dal 30/12/1899, ora locale) → "YYYY-MM-DDTHH:MM:SS.mmm". */
export function serialToLocalIso(serial: number): string {
  const ms = Math.round(serial * 86_400_000);
  return new Date(Date.UTC(1899, 11, 30) + ms).toISOString().replace("Z", "");
}

export function serialToDate(serial: number): string {
  return serialToLocalIso(Math.floor(serial)).slice(0, 10);
}
