import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { JOURNAL_ACCOUNT_DEFAULTS, type JournalSettings } from "@hrms/shared";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Checkbox, Field, Input } from "@/components/ui/field";
import { ErrorState, Loading } from "@/components/ui/page";

const LABELS: Record<string, string> = {
  salary_expense: "Salary expense",
  employer_expense: "Employer contributions expense",
  reimbursement_expense: "Reimbursements expense",
  salary_payable: "Net pay owed to employees",
  pf: "PF owed (employee and employer)",
  esi: "ESI owed",
  pt: "Professional tax owed",
  lwf: "Labour welfare fund owed",
  tds: "TDS owed",
  nps: "NPS owed",
  loans: "Staff loans and advances",
  other_deductions: "Other deductions",
};

/** The ledger names the payroll journal posts to, so imports into Zoho Books or Tally match your chart of accounts. */
export default function Accounting() {
  const { can } = useSession();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["tenant"], queryFn: () => api.get<{ settings: { journal?: JournalSettings } }>("/admin/org/tenant") });
  const [accounts, setAccounts] = useState<Record<string, string>>({});
  const [byDepartment, setByDepartment] = useState(false);
  useEffect(() => {
    if (!q.data) return;
    setAccounts({ ...JOURNAL_ACCOUNT_DEFAULTS, ...(q.data.settings?.journal?.accounts ?? {}) });
    setByDepartment(!!q.data.settings?.journal?.byDepartment);
  }, [q.data]);
  const editable = can("settings", "configure");
  const save = useMutation({
    mutationFn: () => {
      const changed = Object.fromEntries(Object.entries(accounts).filter(([k, v]) => v.trim() && v.trim() !== JOURNAL_ACCOUNT_DEFAULTS[k]).map(([k, v]) => [k, v.trim()]));
      return api.patch("/admin/org/settings", { journal: { accounts: changed, byDepartment } });
    },
    onSuccess: () => {
      toast.success("Accounts saved");
      qc.invalidateQueries({ queryKey: ["tenant"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  return (
    <Card className="!gap-4">
      <CardHeader
        title="Accounting"
        sub="Each payroll run has a journal you can download for Zoho Books, Tally or any ledger, from the last step of the run. Use the account names from your books here so the import matches. Other countries' schemes get an account named after the payslip line."
        actions={editable ? <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Save</Button> : undefined}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        {Object.keys(JOURNAL_ACCOUNT_DEFAULTS).map((k) => (
          <Field key={k} label={LABELS[k] ?? k}>
            <Input value={accounts[k] ?? ""} onChange={(e) => setAccounts((a) => ({ ...a, [k]: e.target.value }))} disabled={!editable} placeholder={JOURNAL_ACCOUNT_DEFAULTS[k]} />
          </Field>
        ))}
      </div>
      <Checkbox checked={byDepartment} onChange={setByDepartment} disabled={!editable} label="Split salary and employer costs by department (cost centres)" />
    </Card>
  );
}
