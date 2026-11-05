import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { AuthShell } from "./AuthShell";

export default function NoAccess() {
  const { me, signOut } = useSession();
  return (
    <AuthShell>
      <div className="card elev-md flex w-full max-w-[440px] flex-col !gap-4 !p-9">
        <h2 className="!mb-0 text-[26px]">No company access yet</h2>
        <p className="text-muted !m-0 text-[14px]">
          You're signed in as {me?.user.email}, but this login isn't linked to a company. If your HR team sent you an invite, open the link in that email. Otherwise ask your administrator to invite you.
        </p>
        <Button onClick={signOut}>Sign out</Button>
      </div>
    </AuthShell>
  );
}
