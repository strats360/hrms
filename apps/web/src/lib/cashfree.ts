/** Cashfree Checkout (JS SDK v3), loaded only when someone pays. */
declare global {
  interface Window {
    Cashfree?: (opts: { mode: "sandbox" | "production" }) => {
      checkout: (o: { paymentSessionId: string; redirectTarget?: "_self" | "_blank" | "_modal" }) => Promise<unknown>;
      subscriptionsCheckout?: (o: { subsSessionId: string; redirectTarget?: "_self" | "_blank" }) => Promise<unknown>;
    };
  }
}

let loading: Promise<void> | null = null;
function loadSdk() {
  if (window.Cashfree) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://sdk.cashfree.com/js/v3/cashfree.js";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      loading = null;
      reject(new Error("Couldn't load the payment page. Check your connection and try again."));
    };
    document.head.appendChild(s);
  });
  return loading;
}

/** Send the browser to Cashfree's hosted checkout; it returns to /settings/billing?order_id=... */
export async function openCheckout(paymentSessionId: string, mode: "sandbox" | "production") {
  await loadSdk();
  if (!window.Cashfree) throw new Error("The payment page didn't load");
  await window.Cashfree({ mode }).checkout({ paymentSessionId, redirectTarget: "_self" });
}

/** Mandate authorisation for autopay (Cashfree Subscriptions); returns to /settings/billing?autopay=... */
export async function openMandateCheckout(subsSessionId: string, mode: "sandbox" | "production") {
  await loadSdk();
  const cf = window.Cashfree?.({ mode });
  if (!cf?.subscriptionsCheckout) throw new Error("The autopay page didn't load");
  await cf.subscriptionsCheckout({ subsSessionId, redirectTarget: "_self" });
}
