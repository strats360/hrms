import { useState } from "react";
import { Download, Share, X } from "lucide-react";
import { useInstall } from "@/lib/pwa";
import { Button } from "@/components/ui/button";

const KEY = "installCardHidden";
const hidden = () => {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
};

/** "Add to home screen": the browser's prompt where there is one, steps for iPhone otherwise. */
export function InstallCard() {
  const i = useInstall();
  const [gone, setGone] = useState(hidden);
  const [steps, setSteps] = useState(false);
  if (i.installed || gone || (!i.canPrompt && !i.ios)) return null;
  const close = () => {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* ignore */
    }
    setGone(true);
  };
  return (
    <div className="card relative !gap-2 !p-4" style={{ background: "var(--sel-bg)", color: "var(--sel-fg)" }} role="region" aria-label="Install the app">
      <button type="button" aria-label="Don't show this again" onClick={close} className="absolute right-2 top-2 cursor-pointer rounded-full border-0 bg-transparent p-1 text-[inherit] opacity-70 hover:opacity-100">
        <X size={16} />
      </button>
      <div className="flex items-center gap-3 pr-6">
        <img src="/icons/icon-192.png" alt="" className="h-10 w-10 flex-none rounded-[10px]" />
        <div className="min-w-0">
          <div className="text-[14px] font-semibold">Install Strats360 on your phone</div>
          <div className="text-[12.5px] opacity-85">Open it from your home screen, punch in faster, and check in even when the network drops.</div>
        </div>
      </div>
      {i.canPrompt ? (
        <div>
          <Button size="sm" variant="primary" onClick={() => void i.prompt()}>
            <Download size={14} /> Install app
          </Button>
        </div>
      ) : steps ? (
        <ol className="!m-0 flex flex-col gap-1 pl-5 text-[13px]">
          <li>
            Tap <Share size={13} className="inline align-[-2px]" aria-label="Share" /> Share at the bottom of Safari
          </li>
          <li>Choose "Add to Home Screen"</li>
          <li>Tap Add</li>
        </ol>
      ) : (
        <div>
          <Button size="sm" onClick={() => setSteps(true)}>
            Show me how
          </Button>
        </div>
      )}
    </div>
  );
}
