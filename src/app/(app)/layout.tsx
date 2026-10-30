import { TabBar } from "@/components/TabBar";

// Cornice delle pagine dell'app (tutte tranne il login): contenuto + barra in basso.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="app-content">{children}</div>
      <TabBar />
    </>
  );
}
