"use client";

import { useEffect, useMemo, useState } from "react";
import Papa from "papaparse";
import readXlsxFile from "read-excel-file";
import { supabase } from "@/lib/supabase";
import AuthGate, { useIsAdmin } from "@/components/AuthGate";
import { formatINR } from "@/lib/normalize";
import {
  COLUMNS, ColKey, RawRow, DupKey, emptyRow, isBlank, validateRow, isLikelyDup, mapHeader,
} from "@/lib/validate";

const START_ROWS = 15;
type Batch = { id: string; file_name: string | null; row_count: number; created_at: string };

export default function ImportPage() {
  return <AuthGate><AdminOnly /></AuthGate>;
}

function AdminOnly() {
  return useIsAdmin() ? <Importer /> : <main><p className="muted">Bulk import is for admins only.</p></main>;
}

function Importer() {
  const [rows, setRows] = useState<RawRow[]>(() => Array.from({ length: START_ROWS }, emptyRow));
  const [sectors, setSectors] = useState<string[]>([]);
  const [existing, setExisting] = useState<(DupKey & { id: string })[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [batches, setBatches] = useState<Batch[]>([]);

  const loadBatches = async () => {
    const { data } = await supabase.from("import_batches")
      .select("id,file_name,row_count,created_at").order("created_at", { ascending: false }).limit(10);
    setBatches(data ?? []);
  };

  useEffect(() => {
    supabase.from("sectors").select("name").then(({ data }) => setSectors((data ?? []).map((d) => d.name)));
    loadBatches();
  }, []);

  // ---- validation (live) ----
  const results = useMemo(() => rows.map((r) => (isBlank(r) ? null : validateRow(r, sectors))), [rows, sectors]);

  // Fetch existing DB rows in the sectors being imported, for duplicate checks.
  const sectorKey = useMemo(
    () => [...new Set(results.flatMap((r) => (r?.clean ? [r.clean.sector] : [])))].sort().join("|"),
    [results],
  );
  useEffect(() => {
    if (!sectorKey) { setExisting([]); return; }
    const t = setTimeout(async () => {
      const { data } = await supabase.from("properties")
        .select("id,sector,property_type,listing_type,size_sqyd,price_inr")
        .in("sector", sectorKey.split("|")).neq("status", "sold");
      setExisting(data ?? []);
    }, 400);
    return () => clearTimeout(t);
  }, [sectorKey]);

  const dupNotes = useMemo(() => results.map((r, i) => {
    if (!r?.clean) return null;
    if (existing.some((e) => isLikelyDup(e, r.clean!))) return "Possible duplicate of an existing property";
    const j = results.findIndex((o, k) => k < i && o?.clean && isLikelyDup(o.clean, r.clean!));
    return j >= 0 ? `Same as row ${j + 1}` : null;
  }), [results, existing]);

  const filled = results.filter(Boolean).length;
  const valid = results.filter((r) => r?.clean).length;
  const invalid = filled - valid;
  const flagged = results.filter((r, i) => r?.clean && (r.warnings.length || dupNotes[i])).length;

  // ---- editing ----
  const setCell = (ri: number, key: ColKey, v: string) =>
    setRows((rs) => rs.map((r, i) => (i === ri ? { ...r, [key]: v } : r)));

  // Paste a block from Excel/Sheets (tab-separated) starting at the focused cell.
  const onPaste = (ri: number, ci: number) => (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text/plain");
    if (!/[\t\n]/.test(text)) return; // single value → normal paste
    e.preventDefault();
    const lines = text.replace(/\r/g, "").replace(/\n$/, "").split("\n").map((l) => l.split("\t"));
    // If the first line is a header row, map by header instead of by position.
    const headerMap = lines[0].map(mapHeader);
    if (headerMap.filter(Boolean).length >= 3) {
      const rest = lines.slice(1);
      setRows((rs) => {
        const base = rs.slice(0, ri);
        const incoming = rest.map((cells) => {
          const r = emptyRow();
          headerMap.forEach((k, idx) => { if (k) r[k] = (cells[idx] ?? "").trim(); });
          return r;
        });
        return pad([...base, ...incoming]);
      });
      return;
    }
    setRows((rs) => {
      const next = [...rs];
      lines.forEach((cells, dr) => {
        const target = ri + dr;
        while (next.length <= target) next.push(emptyRow());
        const r = { ...next[target] };
        cells.forEach((v, dc) => { const col = COLUMNS[ci + dc]; if (col) r[col.key] = v.trim(); });
        next[target] = r;
      });
      return pad(next);
    });
  };

  const onKeyDown = (ri: number, ci: number) => (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (ri === rows.length - 1) setRows((rs) => [...rs, emptyRow()]);
      setTimeout(() => document.getElementById(`c-${ri + 1}-${ci}`)?.focus());
    }
  };

  // ---- file upload ----
  const onFile = async (f: File) => {
    setMsg("");
    let table: string[][];
    if (/\.xlsx$/i.test(f.name)) {
      table = (await readXlsxFile(f)).map((r) => r.map((c) => (c == null ? "" : String(c))));
    } else {
      table = Papa.parse<string[]>(await f.text(), { skipEmptyLines: true }).data;
    }
    if (table.length < 2) { setMsg("File has no data rows"); return; }
    const map = table[0].map(mapHeader);
    const unknown = table[0].filter((_, i) => !map[i]);
    const imported = table.slice(1).map((cells) => {
      const r = emptyRow();
      map.forEach((k, i) => { if (k) r[k] = (cells[i] ?? "").trim(); });
      return r;
    });
    setRows(pad(imported));
    setFileName(f.name);
    if (unknown.length) setMsg(`Ignored columns: ${unknown.join(", ")}`);
  };

  // ---- commit ----
  const commit = async (validOnly: boolean) => {
    const payload = results.flatMap((r) => (r?.clean ? [r.clean] : []));
    if (!payload.length || (!validOnly && invalid)) return;
    setBusy(true); setMsg("");
    const { error } = await supabase.rpc("import_properties_admin", {
      p_rows: payload, p_file_name: fileName ?? "manual entry",
    });
    setBusy(false);
    if (error) { setMsg(`Import failed: ${error.message}`); return; }
    setMsg(`Imported ${payload.length} properties.`);
    // Keep only the rows that failed, so they can be fixed.
    setRows(pad(rows.filter((_, i) => results[i] && !results[i]!.clean)));
    setFileName(null);
    loadBatches();
  };

  const undo = async (b: Batch) => {
    if (!confirm(`Delete the ${b.row_count} properties from this import?`)) return;
    const { data, error } = await supabase.rpc("undo_import_admin", { p_batch: b.id });
    setMsg(error ? `Undo failed: ${error.message}` : `Removed ${data} properties.`);
    loadBatches();
  };

  return (
    <main>
      <h1>Bulk add inventory</h1>
      <div className="muted">Type in the grid, paste rows from Excel, or upload a CSV/XLSX. Nothing is saved until you click Import.</div>

      <div className="bar">
        <label className="btn">
          Upload CSV / XLSX
          <input type="file" accept=".csv,.xlsx" hidden onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        </label>
        <a className="btn" href="/inventory_template.csv" download>Download template</a>
        <button onClick={() => setRows((rs) => [...rs, ...Array.from({ length: 10 }, emptyRow)])}>+ 10 rows</button>
        <button onClick={() => { setRows(pad([])); setFileName(null); }}>Clear</button>
        {fileName && <span className="muted">From: {fileName}</span>}
      </div>

      <div className="grid-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              {COLUMNS.map((c) => (
                <th key={c.key} title={"hint" in c ? c.hint : ""}>
                  {c.label}{"required" in c && c.required && <span className="req"> *</span>}
                </th>
              ))}
              <th>Check</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => {
              const res = results[ri];
              return (
                <tr key={ri}>
                  <td className="idx">{ri + 1}</td>
                  {COLUMNS.map((c, ci) => {
                    const e = res?.errors[c.key];
                    return (
                      <td key={c.key} className={e ? "err" : ""} title={e ?? ""}>
                        <input
                          id={`c-${ri}-${ci}`}
                          value={r[c.key]}
                          placeholder={ri === 0 && "hint" in c ? c.hint : ""}
                          onChange={(ev) => setCell(ri, c.key, ev.target.value)}
                          onPaste={onPaste(ri, ci)}
                          onKeyDown={onKeyDown(ri, ci)}
                        />
                      </td>
                    );
                  })}
                  <td className="state">
                    {!res ? "" : !res.clean
                      ? <span className="bad">✕ {Object.keys(res.errors).length} error(s)</span>
                      : dupNotes[ri] || res.warnings.length
                        ? <span className="warn">⚠ {[dupNotes[ri], ...res.warnings].filter(Boolean).join("; ")}</span>
                        : <span className="ok">✓ {formatINR(res.clean.price_inr)}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="bar">
        <div className="summary">
          <span className="ok">{valid} ready</span>
          <span className="bad">{invalid} with errors</span>
          <span className="warn">{flagged} flagged</span>
        </div>
        <button className="primary" disabled={busy || !valid || invalid > 0} onClick={() => commit(false)}>
          Import {valid} rows
        </button>
        {invalid > 0 && valid > 0 && (
          <button disabled={busy} onClick={() => commit(true)}>Import {valid} valid, keep errors here</button>
        )}
        {msg && <span>{msg}</span>}
      </div>

      <div className="batches">
        <strong>Recent imports</strong>
        <ul>
          {batches.map((b) => (
            <li key={b.id}>
              {new Date(b.created_at).toLocaleString("en-IN")} — {b.file_name ?? "manual"} — {b.row_count} rows{" "}
              <button onClick={() => undo(b)}>Undo</button>
            </li>
          ))}
          {!batches.length && <li className="muted">None yet</li>}
        </ul>
      </div>
    </main>
  );
}

function pad(rs: RawRow[]): RawRow[] {
  const out = [...rs];
  while (out.length < START_ROWS) out.push(emptyRow());
  return out;
}
