import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

/** Reset someone's two-factor sign-in (lost phone and backup codes). */
export function ResetTwoFactorDialog({ member, onClose }: { member: { id: string; name: string }; onClose: () => void }) {
  const qc = useQueryClient();
  const reset = useMutation({
    mutationFn: () => api.post(`/admin/access/members/${member.id}/reset-two-factor`),
    onSuccess: () => {
      toast.success(`Two-factor sign-in reset for ${member.name}`);
      qc.invalidateQueries({ queryKey: ["access"] });
      qc.invalidateQueries({ queryKey: ["employee"] });
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={`Reset two-factor sign-in for ${member.name}?`}
      description="Use this when they've lost their phone and their backup codes. They'll be signed out everywhere and can sign in with just their password. If your company requires two-factor, they'll set it up again straight away. We'll email them to let them know."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="danger" loading={reset.isPending} onClick={() => reset.mutate()}>
            Reset
          </Button>
        </>
      }
    />
  );
}
