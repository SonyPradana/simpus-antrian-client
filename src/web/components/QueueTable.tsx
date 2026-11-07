import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { QueueItem } from "@/shared/types";
import { StatusBadge } from "@/web/components/StatusBadge";
import { IDENTIFIER_LABEL } from "@/web/lib/format";

interface QueueTableProps {
  items: QueueItem[];
  onReorder: (ids: string[]) => void;
}

function SortableRow({ item, index }: { item: QueueItem; index: number }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });

  return (
    <TableRow
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : 1,
      }}
      className={isDragging ? "bg-muted" : undefined}
    >
      <TableCell className="w-10">
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="cursor-grab touch-none rounded p-1 text-muted-foreground hover:bg-muted active:cursor-grabbing"
            aria-label={`Ubah urutan baris ${index + 1}`}
            {...attributes}
            {...listeners}
          >
            <GripVertical className="size-4" />
          </button>
          <span className="text-xs text-muted-foreground">{index + 1}</span>
        </div>
      </TableCell>
      <TableCell className="font-mono text-xs">
        {IDENTIFIER_LABEL[item.patient.type]}: {item.patient.value}
      </TableCell>
      <TableCell>{item.patientName || "-"}</TableCell>
      <TableCell className="text-xs">{item.poliId || "-"}</TableCell>
      <TableCell className="text-xs">{item.doctorCode || "-"}</TableCell>
      <TableCell className="text-xs">{item.lokasi || "-"}</TableCell>
      <TableCell className="text-xs">{item.tenaga || "-"}</TableCell>
      <TableCell>
        <StatusBadge status={item.status} />
      </TableCell>
      <TableCell className="font-mono text-xs">
        {item.queueCode || (item.sudah_terdaftar ? "(terdaftar)" : "-")}
      </TableCell>
      <TableCell className="max-w-64 text-xs text-muted-foreground">
        {item.message || item.errorCode || "-"}
      </TableCell>
    </TableRow>
  );
}

export function QueueTable({ items, onReorder }: QueueTableProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex((item) => item.id === active.id);
    const newIndex = items.findIndex((item) => item.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(items, oldIndex, newIndex);
    onReorder(next.map((item) => item.id));
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis]}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={items.map((item) => item.id)}
        strategy={verticalListSortingStrategy}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">#</TableHead>
              <TableHead>Identitas</TableHead>
              <TableHead>Nama</TableHead>
              <TableHead>Poli</TableHead>
              <TableHead>Dokter</TableHead>
              <TableHead>Lokasi</TableHead>
              <TableHead>Tenaga</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>No. Antrian</TableHead>
              <TableHead>Pesan</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item, index) => (
              <SortableRow key={item.id} item={item} index={index} />
            ))}
          </TableBody>
        </Table>
      </SortableContext>
    </DndContext>
  );
}
