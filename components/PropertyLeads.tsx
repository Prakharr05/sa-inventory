"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { propertyMessage, whatsappLink, ShareProperty } from "@/lib/share";

type Lead = { id: string; name: string; phone: string | null; follow_up_on: string | null };

// "Who wants this?" — shown under the property edit form.
export default function PropertyLeads({ id }: { id: string }) {
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [prop, setProp] = useState<ShareProperty | null>(null);

  useEffect(() => {
    supabase.rpc("leads_for_property", { p_property: id }).then(({ data }) => setLeads((data ?? []) as Lead[]));
    supabase.from("properties").select("property_type,listing_type,sector,size_sqyd,floor,facing,park_facing,price_inr,photos,noc")
      .eq("id", id).single().then(({ data }) => setProp(data as ShareProperty | null));
  }, [id]);

  if (!leads) return null;
  return (
    <section className="matches pf">
      <h2>Interested leads ({leads.length})</h2>
      {!leads.length && <p className="muted">No open leads match this property.</p>}
      {leads.map((l) => (
        <div key={l.id} className="match">
          <a href={`/leads/lead?id=${l.id}`}><strong>{l.name}</strong></a>
          {l.phone && <> · <a href={`tel:+91${l.phone}`}>{l.phone}</a></>}
          {prop && l.phone && (
            <a className="btn wa" target="_blank" rel="noreferrer" href={whatsappLink(l.phone, propertyMessage(prop))}>
              Send on WhatsApp
            </a>
          )}
        </div>
      ))}
    </section>
  );
}
