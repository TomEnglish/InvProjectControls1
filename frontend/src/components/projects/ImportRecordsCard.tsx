import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Upload, Download } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

type ImportResult = {
  ok?: boolean;
  inserted?: number;
  updated?: number;
  errors?: { source_row: number; field: string; message: string }[];
};

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  // btoa requires latin-1 — chunk to avoid stack overflow on big files.
  const bytes = new Uint8Array(buf);
  const chunkSize = 0x8000;
  let bin = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(bin);
}

export function ImportRecordsCard({
  projectId,
  disabled,
}: {
  projectId: string;
  disabled?: boolean;
}) {
  const qc = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [filename, setFilename] = useState<string | null>(null);

  const importMutation = useMutation({
    mutationFn: async (file: File) => {
      const b64 = await fileToBase64(file);
      const { data, error } = await supabase.functions.invoke('import-audit-records', {
        body: { project_id: projectId, file: b64 },
      });
      if (error) throw error;
      const parsed = data as ImportResult & { error?: string; errors?: ImportResult['errors'] };
      if (parsed?.error) {
        const detail = parsed.errors?.length
          ? `\n${parsed.errors
              .slice(0, 5)
              .map((e) => `  Row ${e.source_row}: ${e.field} — ${e.message}`)
              .join('\n')}`
          : '';
        throw new Error(parsed.error + detail);
      }
      return parsed;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['progress-records', projectId] });
      qc.invalidateQueries({ queryKey: ['project-summary', projectId] });
    },
  });

  const onFile = (file: File | null) => {
    if (!file) return;
    setFilename(file.name);
    importMutation.mutate(file);
  };

  return (
    <Card>
      <CardHeader
        title="Quantity Takeoff Import"
        caption="61-column unified audit workbook. Validates row-by-row; rejects the whole file on any failure."
      />
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileInput}
          type="file"
          accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={(e) => onFile(e.target.files?.[0] ?? null)}
        />
        <Button
          variant="primary"
          disabled={disabled || importMutation.isPending}
          onClick={() => fileInput.current?.click()}
        >
          <Upload size={14} />
          {importMutation.isPending ? 'Importing…' : 'Upload Workbook'}
        </Button>
        <Button variant="outline" disabled title="Template download — Phase 3">
          <Download size={14} /> Download Template
        </Button>
        {filename && (
          <span className="text-xs text-[color:var(--color-text-muted)] font-mono ml-1">
            {filename}
          </span>
        )}
      </div>

      {importMutation.isSuccess && importMutation.data && (
        <div className="is-toast is-toast-success mt-4">
          Imported {importMutation.data.inserted ?? 0} new record(s),{' '}
          updated {importMutation.data.updated ?? 0} existing.
        </div>
      )}
      {importMutation.error && (
        <div className="is-toast is-toast-danger mt-4 whitespace-pre-line">
          {(importMutation.error as Error).message}
        </div>
      )}
    </Card>
  );
}
