import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";

/**
 * Tombol ganti tema: terang <-> gelap. Tidak ada opsi "ikut sistem".
 *
 * Ikon yang ditampilkan = aksi berikutnya (matahari saat gelap, bulan saat
 * terang), supaya operator tahu apa yang terjadi kalau ditekan.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();

  // next-themes baru tahu tema setelah mount; jangan render ikon yang salah.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const isDark = mounted ? resolvedTheme === "dark" : true;
  const label = isDark ? "Aktifkan mode terang" : "Aktifkan mode gelap";

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      {mounted ? (
        isDark ? (
          <Sun className="size-4" />
        ) : (
          <Moon className="size-4" />
        )
      ) : (
        <Sun className="size-4 opacity-0" />
      )}
    </Button>
  );
}
