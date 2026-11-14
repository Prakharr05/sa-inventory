"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import AuthGate from "@/components/AuthGate";
import LeadForm from "@/components/LeadForm";

// /leads/lead → new;  /leads/lead?id=… → view/edit + matches
function Inner() {
  const id = useSearchParams().get("id");
  return <LeadForm key={id ?? "new"} id={id} />;
}

export default function LeadPage() {
  return <AuthGate><Suspense><Inner /></Suspense></AuthGate>;
}
