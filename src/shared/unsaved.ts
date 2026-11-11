/**
 * Kapan sebuah halaman dianggap masih punya isian yang belum dikirim.
 *
 * Dipakai `Rail` untuk memutuskan perlu konfirmasi atau tidak saat operator
 * pindah mode. Pindah mode melepas komponen halaman, jadi apa pun yang tidak
 * tersimpan di SQLite akan hilang.
 */

/**
 * Mode Manual: isian berjalan kalau operator sudah mengetik identitas atau
 * sudah masuk step 2/3. Step 4 (nomor antrian sudah terbit) bukan isian yang
 * bisa hilang - nomornya sudah sah.
 */
export function manualHasUnsavedWork(step: number, identifierValue: string): boolean {
  if (step >= 4) return false;
  return step > 1 || identifierValue.trim() !== "";
}

/**
 * Mode Batch: baris yang sudah masuk tabel aman (tersimpan di SQLite), jadi
 * yang dihitung hanya isian yang belum ditekan "Tambah ke Antrean" dan file
 * Excel yang sudah dibaca tapi barisnya belum ditambahkan.
 */
export function batchHasUnsavedWork(identifier: string, excelPending: boolean): boolean {
  return identifier.trim() !== "" || excelPending;
}
