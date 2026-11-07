import { useCallback, useEffect, useState } from "react";
import { Settings2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Separator } from "@/components/ui/separator";
import { api } from "@/web/lib/api";
import type { LocationTemplate, Settings } from "@/shared/types";

export function SettingsDialog() {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [petugas, setPetugas] = useState<Array<{ id: string; nama: string }>>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const current = await api.getSettings();
    setSettings(current);
    try {
      const options = await api.options();
      setPetugas(options.petugas);
      // Seed template lokasi dari poscheck kalau user belum punya template,
      // lalu isi default dari `terpilih` (default server).
      const seeded: LocationTemplate[] =
        current.lokasiTemplates.length === 0
          ? options.poscheck.map((item) => ({ id: item.id, nama: item.nama }))
          : current.lokasiTemplates;
      setSettings({
        ...current,
        lokasiTemplates: seeded,
        defaultPoscheckId: current.defaultPoscheckId || options.terpilih.poscheck_id,
        defaultLokasi: current.defaultLokasi || options.terpilih.lokasi,
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

  const addTemplate = () => {
    patch({
      lokasiTemplates: [...(settings?.lokasiTemplates ?? []), { id: "", nama: "" }],
    });
  };

  const updateTemplate = (index: number, next: Partial<LocationTemplate>) => {
    const templates = [...(settings?.lokasiTemplates ?? [])];
    const current = templates[index];
    if (!current) return;
    templates[index] = { ...current, ...next };
    patch({ lokasiTemplates: templates });
  };

  const removeTemplate = (index: number) => {
    patch({
      lokasiTemplates: (settings?.lokasiTemplates ?? []).filter((_, i) => i !== index),
    });
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
              <label className="flex items-start gap-2 text-sm">
                <Checkbox
                  checked={settings.mock}
                  onCheckedChange={(checked) => patch({ mock: checked === true })}
                />
                <span>
                  <span className="font-medium">Mode mock</span>
                  <span className="block text-xs text-muted-foreground">
                    Pakai data contoh, tidak menyentuh Go API sungguhan.
                  </span>
                </span>
              </label>
              <p className="text-xs text-muted-foreground">
                API key APM dibaca dari env <code>APM_API_KEY</code> di BFF. Key tidak disimpan
                di browser maupun SQLite.
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
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Template lokasi</h3>
                <Button variant="outline" size="sm" onClick={addTemplate}>
                  Tambah
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                <code>id</code> = poscheck id (dikirim sebagai <code>poscheck_id</code>);{" "}
                <code>nama</code> = label lokasi. Nama lokasi tidak dikirim ke server, server
                mengambilnya dari tabel <code>poschecks</code>.
              </p>
              <div className="space-y-2">
                {settings.lokasiTemplates.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Belum ada template lokasi.</p>
                ) : (
                  settings.lokasiTemplates.map((template, index) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: template baru punya id kosong sampai diisi
                    <div key={`${index}-${template.id}`} className="flex items-center gap-2">
                      <Input
                        className="w-28"
                        value={template.id}
                        placeholder="id"
                        onChange={(event) =>
                          updateTemplate(index, { id: event.target.value })
                        }
                      />
                      <Input
                        value={template.nama}
                        placeholder="nama lokasi"
                        onChange={(event) =>
                          updateTemplate(index, { nama: event.target.value })
                        }
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeTemplate(index)}
                      >
                        Hapus
                      </Button>
                    </div>
                  ))
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="defaultLokasi">Lokasi default</Label>
                  <Input
                    id="defaultLokasi"
                    value={settings.defaultLokasi}
                    onChange={(event) => patch({ defaultLokasi: event.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="defaultPoscheckId">Poscheck ID default</Label>
                  <Input
                    id="defaultPoscheckId"
                    value={settings.defaultPoscheckId}
                    onChange={(event) => patch({ defaultPoscheckId: event.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="defaultTenaga">Tenaga default</Label>
                  <Input
                    id="defaultTenaga"
                    list="daftar-tenaga"
                    value={settings.defaultTenaga}
                    onChange={(event) => patch({ defaultTenaga: event.target.value })}
                  />
                  <datalist id="daftar-tenaga">
                    {petugas.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.nama}
                      </option>
                    ))}
                  </datalist>
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
