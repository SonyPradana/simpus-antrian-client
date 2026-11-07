import type { ItemStatus } from "@/shared/types";

/** Badge status item antrian. 4 varian, sesuai docs/conventions.md §1. */
const STATUS_STYLE: Record<ItemStatus, { label: string; className: string }> = {
  menunggu: { label: "Menunggu", className: "bg-muted text-muted-foreground" },
  berjalan: { label: "Berjalan", className: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300" },
  sukses: { label: "Sukses", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" },
  gagal: { label: "Gagal", className: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300" },
};

export function StatusBadge({ status }: { status: ItemStatus }) {
  const style = STATUS_STYLE[status];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${style.className}`}
    >
      {style.label}
    </span>
  );
}
