interface NavIconProps {
  readonly name: "dashboard" | "orders" | "catalog" | "loyalty" | "promos" | "quests" | "wheel" | "customers" | "segments" | "communications" | "menu";
}

export function NavIcon({ name }: NavIconProps): React.JSX.Element {
  const common = { "aria-hidden": true, className: "nav-icon", fill: "none", viewBox: "0 0 24 24" } as const;

  if (name === "dashboard") return <svg {...common}><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" /></svg>;
  if (name === "orders") return <svg {...common}><path d="M6 4h12v16H6zM9 8h6M9 12h6M9 16h4" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" /></svg>;
  if (name === "catalog") return <svg {...common}><path d="M5 5h14v14H5zM8 9h8M8 13h5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" /></svg>;
  if (name === "loyalty") return <svg {...common}><path d="m12 3 2.2 4.8 5.3.6-3.9 3.6 1.1 5.2-4.7-2.7-4.7 2.7 1.1-5.2-3.9-3.6 5.3-.6z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" /></svg>;
  if (name === "promos") return <svg {...common}><path d="m4 7 8-3 8 3-8 3zM4 7v10l8 3 8-3V7M8 9v9M16 9v9" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" /></svg>;
  if (name === "quests") return <svg {...common}><circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.8" /><circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" /><path d="m15 9 3-3" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" /></svg>;
  if (name === "wheel") return <svg {...common}><circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.8" /><path d="M12 4v16M4 12h16M6.3 6.3l11.4 11.4M17.7 6.3 6.3 17.7" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" /></svg>;
  if (name === "customers") return <svg {...common}><circle cx="12" cy="8" r="3" stroke="currentColor" strokeWidth="1.8" /><path d="M5 20a7 7 0 0 1 14 0M5 13a3 3 0 0 0-2 5M19 13a3 3 0 0 1 2 5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" /></svg>;
  if (name === "segments") return <svg {...common}><rect height="6" rx="1" stroke="currentColor" strokeWidth="1.8" width="14" x="5" y="4" /><rect height="6" rx="1" stroke="currentColor" strokeWidth="1.8" width="14" x="5" y="14" /></svg>;
  if (name === "communications") return <svg {...common}><path d="M4 6h16v11H8l-4 3z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" /><path d="m7 10 5 3 5-3" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" /></svg>;
  return <svg {...common}><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeLinecap="round" strokeWidth="2" /></svg>;
}
