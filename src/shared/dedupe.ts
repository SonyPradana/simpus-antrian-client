/**
 * Deteksi duplikat di daftar antrian.
 *
 * Aturan (keputusan user): duplikat DITOLAK, tidak dikirim.
 *
 * Kunci = identitas + poli + dokter, bukan identitas saja:
 * satu pasien boleh punya dua antrian di poli berbeda pada hari yang sama,
 * tapi kombinasi yang persis sama hampir pasti kekeliruan operator.
 */
import type { IdentifierType } from "./schema";

export interface DuplicateCandidate {
  identifierType: IdentifierType;
  identifierValue: string;
  poliId: string;
  doctorCode: string;
}

/** Kunci pembanding; dinormalisasi supaya "05" dan " 05 " dianggap sama. */
export function duplicateKey(item: DuplicateCandidate): string {
  return [
    item.identifierType,
    item.identifierValue.trim().toLowerCase(),
    item.poliId.trim(),
    item.doctorCode.trim(),
  ].join("|");
}

/**
 * Pisahkan baris baru menjadi yang boleh masuk dan yang duplikat.
 *
 * Duplikat dihitung terhadap `existing` (isi tabel sekarang) DAN terhadap
 * baris baru sebelumnya di array yang sama.
 */
export function partitionDuplicates<T extends DuplicateCandidate>(
  incoming: readonly T[],
  existing: readonly DuplicateCandidate[] = [],
): { accepted: T[]; rejected: T[] } {
  const seen = new Set(existing.map(duplicateKey));
  const accepted: T[] = [];
  const rejected: T[] = [];

  for (const item of incoming) {
    const key = duplicateKey(item);
    if (seen.has(key)) {
      rejected.push(item);
      continue;
    }
    seen.add(key);
    accepted.push(item);
  }

  return { accepted, rejected };
}
