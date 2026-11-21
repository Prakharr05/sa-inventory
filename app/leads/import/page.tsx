"use client";

import { useEffect, useMemo, useState } from "react";
import Papa from "papaparse";
import readXlsxFile from "read-excel-file";
import { supabase } from "@/lib/supabase";
import AuthGate, { useIsAdmin } from "@/components/AuthGate";
import { formatINR } from "@/lib/normalize";
import { LEAD_COLUMNS, LeadKey, RawLead, emptyLead, isBlankLead, validateLead, mapLeadHeader } from "@/lib/leadImport";

const START_ROWS = 10;
type Batch = { id: string; file_name: string | null; row_count: number; created_at: string };

export default function LeadImportPage() {
  return <AuthGate><AdminOnly /></AuthGate>;
}

function AdminOnly() {
  return useIsAdmin() ? <Importer /> : <main><p className="muted">Bulk add is for admins only.</p></main>;
}

function Importer() {
  const [rows, setRows] = useState<RawLead[]>(() => pad([]));
  const [sectors, setSectors] = useState<string[]>([]);
  const [phones, setPhones] = useState<Set<string>>(new Set());
  const [fileName, setFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [batches, setBatches] = useState<Batch[]>([]);

  const loadBatches = async () => {
    const { data } = await supabase.from("import_batches").select("id,file_name,row_count,created_at")
      .eq("kind", "leads").order("created_at", { ascending: false }).limit(10);
    setBatches(data ?? []);
  };
  const loadPhones = async () => {
    const { data } = await supabase.from("leads").select("phone").in("status", ["new", "active"]).not("phone", "is", null);
    setPhones(new Set((data ?? []).map((d) => d.phone as string)));
  };

  useEffect(() => {
    supabase.from("sectors").select("name").then(({ data }) => setSectors((data ?? []).map((d) => d.name)));
    loadBatches();
    loadPhones();
  }, []);

  const results = useMemo(() => rows.map((r) => (isBlankLead(r) ? null : validateLead(r, sectors))), [rows, sectors]);
  // Not blocking: one broker often sends several different requirements.
  const notes = useMemo(() => results.map((r, i) => {
    const p = r?.clean?.phone;
    if (!p) return null;
    if (phones.has(p)) return "Phone already has an open lead";
    const j = results.findIndex((o, k) => k < i && o?.clean?.phone === p);
    return j >= 0 ? `Same phone as row ${j + 1}` : null;
  }), [results, phones]);

  const filled = results.filter(Boolean).length;
  const valid = results.filter((r) => r?.clean).length;
  const invalid = filled - valid;

  const setCell = (ri: number, key: LeadKey, v: string) =>
    setRows((rs) => rs.map((r, i) => (i === ri ? { ...r, [key]: v } : r)));

  const fromTable = (table: string[][]) => {
    const map = table[0].map(mapLeadHeader);
    const unknown = table[0].filter((h, i) => h.trim() && !map[i]);
    return {
      rows: table.slice(1).map((cells) => {
        const r = emptyLead();
        map.forEach((k, i) => { if (k) r[k] = (cells[i] ?? "").trim(); });
        return r;
      }),
      unknown,
    };
  };

  // Paste from Excel/Sheets: with a header row, map by header; otherwise fill from the focused cell.
  const onPaste = (ri: number, ci: number) => (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text/plain");
    if (!/[\t\n]/.test(text)) return;
    e.preventDefault();
    const lines = text.replace(/\r/g, "").replace(/\n$/, "").split("\n").map((l) => l.split("\t"));
    if (lines[0].map(mapLeadHeader).filter(Boolean).length >= 3) {
      const { rows: incoming } = fromTable(lines);
      setRows((rs) => pad([...rs.slice(0, ri), ...incoming]));
      return;
    }
    setRows((rs) => {
      const next = [...rs];
      lines.forEach((cells, dr) => {
        while (next.length <= ri + dr) next.push(emptyLead());
        const r = { ...next[ri + dr] };
        cells.forEach((v, dc) => { const col = LEAD_COLUMNS[ci + dc]; if (col) r[col.key] = v.trim(); });
        next[ri + dr] = r;
      });
      return pad(next);
    });
  };

  const onFile = async (f: File) => {
    setMsg("");
    const table = /\.xlsx$/i.test(f.name)
      ? (await readXlsxFile(f)).map((r) => r.map((c) => (c == null ? "" : String(c))))
      : Papa.parse<string[]>(await f.text(), { skipEmptyLines: true }).data;
    if (table.length < 2) { setMsg("File has no data rows"); return; }
    const { rows: imported, unknown } = fromTable(table);
    setRows(pad(imported));
    setFileName(f.name);
    if (unknown.length) setMsg(`Ignored columns: ${unknown.join(", ")}`);
  };

  const commit = async () => {
    const payload = results.flatMap((r) => (r?.clean ? [r.clean] : []));
    if (!payload.length) return;
    setBusy(true); setMsg("");
    const { error } = await supabase.rpc("import_leads_admin", { p_rows: payload, p_file_name: fileName ?? "manual entry" });
    setBusy(false);
    if (error) { setMsg(`Import failed: ${error.message}`); return; }
    setMsg(`Imported ${payload.length} leads.`);
    setRows(pad(rows.filter((_, i) => results[i] && !results[i]!.clean)));   // keep rows with errors to fix
    setFileName(null);
    loadBatches(); loadPhones();
  };

  const undo = async (b: Batch) => {
    if (!confirm(`Delete the ${b.row_count} leads from this import?`)) return;
    const { data, error } = await supabase.rpc("undo_leads_import_admin", { p_batch: b.id });
    setMsg(error ? `Undo failed: ${error.message}` : `Removed ${data} leads.`);
    loadBatches(); loadPhones();
  };

  return (
    <main>
      <h1>Bulk add leads</h1>
      <div className="muted">
        Type in the grid, paste rows from Excel, or upload a CSV/XLSX (the WhatsApp processor's requirements.csv works as is).
        Separate several types or sectors with ; — blank means any. Nothing is saved until you click Import.
      </div>

      <div className="bar">
        <label className="btn">
          Upload CSV / XLSX
          <input type="file" accept=".csv,.xlsx" hidden onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        </label>
        <a className="btn" href="/leads_template.csv" download>Download template</a>
        <button onClick={() => setRows((rs) => [...rs, ...Array.from({ length: 10 }, emptyLead)])}>+ 10 rows</button>
        <button onClick={() => { setRows(pad([])); setFileName(null); }}>Clear</button>
        <a className="btn" href="/leads">Back to leads</a>
        {fileName && <span className="muted">From: {fileName}</span>}
      </div>

      <div className="grid-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              {LEAD_COLUMNS.map((c) => (
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
              const warn = [notes[ri], ...(res?.warnings ?? [])].filter(Boolean).join("; ");
              const c = res?.clean;
              return (
                <tr key={ri}>
                  <td className="idx">{ri + 1}</td>
                  {LEAD_COLUMNS.map((col, ci) => {
                    const e = res?.errors[col.key];
                    return (
                      <td key={col.key} className={e ? "err" : ""} title={e ?? ""}>
                        <input id={`l-${ri}-${ci}`} value={r[col.key]} placeholder={ri === 0 && "hint" in col ? col.hint : ""}
                          onChange={(ev) => setCell(ri, col.key, ev.target.value)} onPaste={onPaste(ri, ci)} />
                      </td>
                    );
                  })}
                  <td className="state">
                    {!res ? "" : !c
                      ? <span className="bad">✕ {Object.entries(res.errors).map(([k, v]) => `${k}: ${v}`).join("; ")}</span>
                      : warn
                        ? <span className="warn">⚠ {warn}</span>
                        : <span className="ok">✓ {c.wants === "rent" ? "rent" : "buy"}
                            {c.budget_max != null ? ` · up to ${formatINR(c.budget_max)}` : ""}</span>}
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
        </div>
        <button className="primary" disabled={busy || !valid} onClick={commit}>
          {invalid ? `Import ${valid} valid, keep errors here` : `Import ${valid} leads`}
        </button>
        {msg && <span>{msg}</span>}
      </div>

      <div className="batches">
        <strong>Recent lead imports</strong>
        <ul>
          {batches.map((b) => (
            <li key={b.id}>
              {new Date(b.created_at).toLocaleString("en-IN")} — {b.file_name ?? "manual"} — {b.row_count} leads{" "}
              <button onClick={() => undo(b)}>Undo</button>
            </li>
          ))}
          {!batches.length && <li className="muted">None yet</li>}
        </ul>
      </div>
    </main>
  );
}

function pad(rs: RawLead[]): RawLead[] {
  const out = [...rs];
  while (out.length < START_ROWS) out.push(emptyLead());
  return out;
}
