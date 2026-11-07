import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SettingsDialog } from "@/web/components/SettingsDialog";
import { ThemeToggle } from "@/web/components/ThemeToggle";
import { Batch } from "@/web/pages/Batch";
import { Manual } from "@/web/pages/Manual";
import { api } from "@/web/lib/api";

type Mode = "manual" | "batch";

/**
 * Rail: switch mode Manual / Batch.
 * State disimpan di `location.hash` supaya mode bertahan saat refresh
 * (tanpa router library).
 */
export function App() {
  const [mode, setMode] = useState<Mode>(() =>
    window.location.hash === "#/batch" ? "batch" : "manual",
  );
  const [mock, setMock] = useState(false);

  useEffect(() => {
    const onHashChange = () => {
      setMode(window.location.hash === "#/batch" ? "batch" : "manual");
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // Penanda mode mock: operator tidak boleh salah kira ini data asli.
  useEffect(() => {
    void (async () => {
      try {
        const health = await api.health();
        setMock(health.mock);
      } catch {
        // BFF tidak terjangkau - biarkan penanda mati
      }
    })();
  }, []);

  const changeMode = useCallback((next: Mode) => {
    window.location.hash = next === "batch" ? "#/batch" : "#/manual";
    setMode(next);
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b">
        <div className="mx-auto flex max-w-7xl flex-col sm:flex-row items-center sm:items-baseline gap-x-4 gap-y-2 px-4 py-3">
          <div className="flex shrink-0 items-baseline gap-2 sm:order-1">
            <span className="text-lg font-semibold tracking-tight">Antrian</span>
            <span className="hidden text-xs text-muted-foreground sm:inline">Pendaftaran</span>
          </div>

          <Separator orientation="vertical" className="h-6 sm:block hidden" aria-hidden />

          <Tabs
            value={mode}
            onValueChange={(value) => changeMode(value as Mode)}
            className="order-3 w-full sm:order-none sm:w-auto"
          >
            <TabsList className="grid w-full grid-cols-2 sm:flex">
              <TabsTrigger value="manual" className="w-full">
                Manual
              </TabsTrigger>
              <TabsTrigger value="batch" className="w-full">
                Batch
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="ml-auto flex shrink-0 items-center gap-1 sm:order-3">
            {mock ? (
              <Badge
                variant="outline"
                className="border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                title="Mode mock: data contoh, tidak mengirim apa pun ke Go API"
              >
                MOCK
              </Badge>
            ) : null}
            <ThemeToggle />
            <SettingsDialog />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6">
        {mode === "manual" ? <Manual /> : <Batch />}
      </main>
    </div>
  );
}
