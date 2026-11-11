import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SettingsDialog } from "@/web/components/SettingsDialog";
import { ThemeToggle } from "@/web/components/ThemeToggle";
import { Batch } from "@/web/pages/Batch";
import { Manual } from "@/web/pages/Manual";
import { api } from "@/web/lib/api";

type Mode = "manual" | "batch";

const HASH: Record<Mode, string> = { manual: "#/manual", batch: "#/batch" };
const MODE_LABEL: Record<Mode, string> = { manual: "Manual", batch: "Batch" };

function modeFromHash(): Mode {
  return window.location.hash === HASH.batch ? "batch" : "manual";
}

/**
 * Rail: switch mode Manual / Batch.
 * State disimpan di `location.hash` supaya mode bertahan saat refresh
 * (tanpa router library).
 *
 * Pindah mode melepas komponen halaman, jadi isian yang belum dikirim ikut
 * hilang. Perpindahan karena itu dikonfirmasi dulu selama halaman aktif
 * melaporkan masih ada isian (`onDirtyChange`).
 */
export function App() {
  const [mode, setMode] = useState<Mode>(modeFromHash);
  const [mock, setMock] = useState(false);
  /** Mode tujuan yang menunggu konfirmasi; `null` = dialog tertutup. */
  const [pending, setPending] = useState<Mode | null>(null);

  // Status "masih ada isian" hanya dipakai untuk memutuskan, bukan dirender,
  // jadi cukup ref. Dibaca juga dari listener hashchange yang dipasang sekali.
  const modeRef = useRef(mode);
  const dirtyRef = useRef<Record<Mode, boolean>>({ manual: false, batch: false });

  const applyMode = useCallback((next: Mode) => {
    const current = modeRef.current;
    if (next === current) return;
    dirtyRef.current[current] = false;
    modeRef.current = next;
    if (window.location.hash !== HASH[next]) window.location.hash = HASH[next];
    setMode(next);
  }, []);

  const requestMode = useCallback(
    (next: Mode) => {
      const current = modeRef.current;
      if (next === current) return;
      if (dirtyRef.current[current]) {
        setPending(next);
        return;
      }
      applyMode(next);
    },
    [applyMode],
  );

  useEffect(() => {
    const onHashChange = () => {
      const next = modeFromHash();
      const current = modeRef.current;
      if (next === current) return;
      if (dirtyRef.current[current]) {
        // Batalkan perpindahan; pindah hanya kalau operator setuju.
        setPending(next);
        window.location.hash = HASH[current];
        return;
      }
      modeRef.current = next;
      setMode(next);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const setManualDirty = useCallback((value: boolean) => {
    dirtyRef.current.manual = value;
  }, []);

  const setBatchDirty = useCallback((value: boolean) => {
    dirtyRef.current.batch = value;
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
            onValueChange={(value) => requestMode(value as Mode)}
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
        {mode === "manual" ? (
          <Manual onDirtyChange={setManualDirty} />
        ) : (
          <Batch onDirtyChange={setBatchDirty} />
        )}
      </main>

      <Dialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Isian belum selesai</DialogTitle>
            <DialogDescription>
              Masih ada isian di mode {MODE_LABEL[mode]} yang belum dikirim. Pindah ke mode{" "}
              {pending ? MODE_LABEL[pending] : ""} akan menghapus isian itu.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)}>
              Tetap di sini
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                const next = pending;
                setPending(null);
                if (next) applyMode(next);
              }}
            >
              Buang &amp; pindah
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
