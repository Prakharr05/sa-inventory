"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import AuthGate from "@/components/AuthGate";
import PropertyForm from "@/components/PropertyForm";

// /inventory/property → add new;  /inventory/property?id=… → edit
function Inner() {
  const id = useSearchParams().get("id");
  return <PropertyForm key={id ?? "new"} id={id} />;
}

export default function PropertyPage() {
  return <AuthGate><Suspense><Inner /></Suspense></AuthGate>;
}
