import { useCallback, useEffect, useState } from "react";
import { Settings2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import type { RegistrationOption } from "@/shared/schema";
import type { Settings } from "@/shared/types";
import { api } from "@/web/lib/api";

export function SettingsDialog() {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [petugas, setPetugas] = useState<RegistrationOption[]>([]);
  const [poscheck, setPoscheck] = useState<RegistrationOption[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const current = await api.getSettings();
    setSettings(current);
    try {
      const options = await api.options();
      setPetugas(options.petugas);
      setPoscheck(options.poscheck);
      // Default mengikuti pilihan server selama user belum menyimpan sendiri.
      setSettings({
        ...current,
        defaultPoscheckId: current.defaultPoscheckId || options.terpilih.poscheck_id,
        defaultTenaga: current.defaultTenaga || options.terpilih.petugas_id,
      });
    } catch {
      // options gagal (mis. Go API belum hidup) - settings tetap bisa disimpan
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const patch = (next: Partial<Settings>) =>
    setSettings((prev) => (prev ? { ...prev, ...next } : prev));

  const save = async () => {
    if (!settings) return;
    setBusy(true);
    try {
      await api.saveSettings(settings);
      toast.success("Pengaturan disimpan");
      setOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "gagal menyimpan");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" aria-label="Pengaturan">
          <Settings2 />
          <span className="hidden sm:inline">Pengaturan</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Pengaturan</DialogTitle>
          <DialogDescription>
            Koneksi API dan nilai default pendaftaran. Disimpan di SQLite lokal.
          </DialogDescription>
        </DialogHeader>

        {settings ? (
          <div className="space-y-6">
            <section className="space-y-3">
              <h3 className="text-sm font-semibold">Koneksi</h3>
              <div className="space-y-1.5">
                <Label htmlFor="apiBaseUrl">Base URL Go API</Label>
                <Input
                  id="apiBaseUrl"
                  value={settings.apiBaseUrl}
                  onChange={(event) => patch({ apiBaseUrl: event.target.value })}
                  placeholder="http://localhost:8080"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                API key APM dibaca dari env <code>APM_API_KEY</code> di BFF. Key tidak disimpan
                di browser maupun SQLite.
              </p>
              <p className="text-xs text-muted-foreground">
                Mode mock dikonfigurasi lewat environment BFF (<code>MOCK_API=1</code>), bukan
                dari browser.
              </p>
            </section>

            <Separator />

            <section className="space-y-3">
              <h3 className="text-sm font-semibold">Verifikasi BPJS (PCare)</h3>
              <p className="text-xs text-muted-foreground">
                Pencarian pasien tidak memanggil PCare. Registrasi selalu memverifikasi BPJS
                supaya kolom &quot;Nama Faskes&quot; terisi.
              </p>
            </section>

            <Separator />

            <section className="space-y-3">
              <h3 className="text-sm font-semibold">Default pendaftaran</h3>
              <p className="text-xs text-muted-foreground">
                Daftar lokasi dan petugas dibaca langsung dari server. Client hanya mengirim{" "}
                <code>poscheck_id</code>; nama lokasi diambil server dari tabel{" "}
                <code>poschecks</code>.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="defaultPoscheckId">Lokasi default</Label>
                  <Select
                    value={settings.defaultPoscheckId}
                    onValueChange={(value) => patch({ defaultPoscheckId: value })}
                  >
                    <SelectTrigger id="defaultPoscheckId" className="w-full">
                      <SelectValue placeholder="Pilih lokasi" />
                    </SelectTrigger>
                    <SelectContent>
                      {poscheck.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.nama}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {poscheck.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Daftar lokasi belum termuat dari server.
                    </p>
                  ) : null}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="defaultTenaga">Petugas default</Label>
                  <Select
                    value={settings.defaultTenaga}
                    onValueChange={(value) => patch({ defaultTenaga: value })}
                  >
                    <SelectTrigger id="defaultTenaga" className="w-full">
                      <SelectValue placeholder="Pilih petugas" />
                    </SelectTrigger>
                    <SelectContent>
                      {petugas.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.nama}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {petugas.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Daftar petugas belum termuat dari server.
                    </p>
                  ) : null}
                </div>
              </div>
            </section>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Memuat pengaturan…</p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Batal
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? "Menyimpan…" : "Simpan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
