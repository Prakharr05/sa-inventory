import { formatINR } from "./normalize";
import { photoUrl } from "./photos";

export type ShareProperty = {
  property_type: string; listing_type: string; sector: string; size_sqyd: number;
  floor: string | null; facing: string | null; park_facing: boolean; price_inr: number; photos?: string[] | null;
};

const label = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

// Client-facing summary — never includes owner details or internal notes.
export function propertyMessage(p: ShareProperty): string {
  const lines = [
    `*${label(p.property_type)} for ${p.listing_type} — ${p.sector}, Faridabad*`,
    `Size: ${Number(p.size_sqyd)} sq yd`,
    p.floor && `Floor: ${p.floor}`,
    (p.facing || p.park_facing) && `Facing: ${[p.facing && label(p.facing), p.park_facing && "Park facing"].filter(Boolean).join(" · ")}`,
    `${p.listing_type === "rent" ? "Rent" : "Price"}: ${formatINR(p.price_inr)}${p.listing_type === "rent" ? "/month" : ""}`,
    p.photos?.length ? `Photos: ${photoUrl(p.photos[0])}` : null,
    "",
    "— Sharma Associates",
  ];
  return lines.filter((l) => l !== null && l !== false && l !== undefined).join("\n");
}

// phone: 10-digit Indian number, or empty to let the user pick a chat.
export function whatsappLink(phone: string | null | undefined, text: string): string {
  const to = phone ? `91${phone}` : "";
  return `https://wa.me/${to}?text=${encodeURIComponent(text)}`;
}
