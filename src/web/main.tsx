import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { App } from "./App";
import "@/index.css";

const container = document.getElementById("root");
if (!container) throw new Error("#root tidak ditemukan");

/**
 * Tema: manual, default gelap.
 *
 * `attribute="class"` -> next-themes menambah/menghapus `.dark` di `<html>`,
 * cocok dengan `@custom-variant dark` di `index.css`.
 * `enableSystem={false}` -> tidak ikut OS; operator yang memilih.
 * `disableTransitionOnChange` -> tidak ada kilatan warna saat berganti tema.
 */
createRoot(container).render(
  <StrictMode>
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem={false}
      storageKey="antrian-theme"
      disableTransitionOnChange
    >
      <App />
      <Toaster position="top-right" richColors />
    </ThemeProvider>
  </StrictMode>,
);
