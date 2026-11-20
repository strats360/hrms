import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { CUSTOM_FIELD_TYPE_LABELS, CUSTOM_FIELD_TYPES, customFieldDefsSchema, type CustomFieldDef, type CustomFieldType } from "@hrms/shared";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Checkbox, Field, Input, Select } from "@/components/ui/field";
import { ErrorState, Loading, Notice } from "@/components/ui/page";

/** Turns "T-shirt size" into "t_shirt_size" so people don't have to think about keys. */
const keyFrom = (label: string) =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^(\d)/, "f_$1")
    .slice(0, 32) || "field";

type Row = CustomFieldDef & { optionsText: string; isNew?: boolean };

export default function CustomFields() {
  const { can } = useSession();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["tenant"], queryFn: () => api.get<{ settings: { customFields?: CustomFieldDef[] } }>("/admin/org/tenant") });
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    if (q.data) setRows((q.data.settings?.customFields ?? []).map((d) => ({ ...d, optionsText: (d.options ?? []).join(", ") })));
  }, [q.data]);
  const editable = can("settings", "configure");
  const set = (i: number, p: Partial<Row>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...p, ...(x.isNew && p.label !== undefined ? { key: keyFrom(p.label) } : {}) } : x)));

  const save = useMutation({
    mutationFn: async () => {
      const defs = rows.map(({ optionsText, isNew: _n, ...d }) => ({ ...d, options: d.type === "select" ? optionsText.split(",").map((s) => s.trim()).filter(Boolean) : undefined }));
      const parsed = customFieldDefsSchema.safeParse(defs);
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Check the fields");
      return api.patch("/admin/org/settings", { customFields: parsed.data });
    },
    onSuccess: () => {
      toast.success("Custom fields saved");
      qc.invalidateQueries({ queryKey: ["tenant"] });
      qc.invalidateQueries({ queryKey: ["lookups"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} retry={() => q.refetch()} />;

  return (
    <Card className="!gap-4">
      <CardHeader
        title="Custom fields"
        sub="Keep your own details on each employee, like T-shirt size, cost centre or the date a badge was issued. They show on the employee form and profile, and as columns in the employee export."
        actions={editable ? <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Save fields</Button> : undefined}
      />
      {!editable ? <Notice tone="warn">You can see these fields but only admins who can configure settings can change them.</Notice> : null}
      {rows.length === 0 ? <div className="text-muted text-[13.5px]">You haven't added any fields yet.</div> : null}
      {rows.map((r, i) => (
        <div key={r.isNew ? `new-${i}` : r.key} className="grid gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] p-3 md:grid-cols-[1.4fr_1fr_1.4fr_auto]">
          <Field label="Name">
            <Input value={r.label} onChange={(e) => set(i, { label: e.target.value })} disabled={!editable} placeholder="T-shirt size" />
          </Field>
          <Field label="Type">
            <Select value={r.type} onChange={(e) => set(i, { type: e.target.value as CustomFieldType })} disabled={!editable}>
              {CUSTOM_FIELD_TYPES.map((t) => <option key={t} value={t}>{CUSTOM_FIELD_TYPE_LABELS[t]}</option>)}
            </Select>
          </Field>
          {r.type === "select" ? (
            <Field label="Choices" hint="Separate with commas">
              <Input value={r.optionsText} onChange={(e) => set(i, { optionsText: e.target.value })} disabled={!editable} placeholder="S, M, L, XL" />
            </Field>
          ) : (
            <div />
          )}
          <div className="flex items-end">
            {editable ? <Button icon aria-label={`Remove ${r.label || "field"}`} onClick={() => setRows((x) => x.filter((_, j) => j !== i))}><Trash2 size={14} /></Button> : null}
          </div>
          <div className="flex flex-wrap gap-5 md:col-span-4">
            <Checkbox checked={r.required} onChange={(v) => set(i, { required: v })} disabled={!editable || r.type === "yes_no"} label="Required" />
            <Checkbox checked={r.showToEmployee} onChange={(v) => set(i, { showToEmployee: v })} disabled={!editable} label="Employees can see it on their profile" />
            <span className="text-muted text-[12px]">Key: {r.key}</span>
          </div>
        </div>
      ))}
      {editable ? (
        <div>
          <Button onClick={() => setRows((x) => [...x, { key: "field", label: "", type: "text", required: false, showToEmployee: false, optionsText: "", isNew: true }])} disabled={rows.length >= 30}>
            <Plus size={14} /> Add a field
          </Button>
        </div>
      ) : null}
      <div className="text-muted text-[12px]">Removing a field hides it but keeps what you've already saved for each employee, so adding it back with the same name brings the values back.</div>
    </Card>
  );
}
