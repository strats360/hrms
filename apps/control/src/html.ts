/** Small server rendered pages for the control plane, in the Saralix look. */

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]!);

/** A template tag that escapes every value unless it's already safe HTML. */
export class Safe {
  constructor(public html: string) {}
  toString() {
    return this.html;
  }
}
export function html(strings: TemplateStringsArray, ...values: unknown[]): Safe {
  let out = strings[0]!;
  values.forEach((v, i) => {
    const part = Array.isArray(v) ? v.map((x) => (x instanceof Safe ? x.html : esc(x))).join("") : v instanceof Safe ? v.html : esc(v);
    out += part + strings[i + 1]!;
  });
  return new Safe(out);
}

const FAVICON = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#9184d9"/><text x="16" y="22" font-family="Inter,Arial,sans-serif" font-size="17" font-weight="600" text-anchor="middle" fill="#161826">S</text></svg>')}`;

const CSS = `
:root { --bg:#f7f7fb; --card:#ffffff; --text:#1b1d2b; --muted:#5d6075; --border:#e3e3ee; --accent:#6f62c4; --accent-fg:#ffffff; --ok:#1f7a4d; --bad:#b4233c; --tint:#f0eff8; color-scheme: light dark; }
@media (prefers-color-scheme: dark) { :root { --bg:#161826; --card:#1e2133; --text:#ececf4; --muted:#9a9db3; --border:#2d3047; --accent:#9184d9; --accent-fg:#161826; --ok:#5fcf98; --bad:#ff7a8f; --tint:#262a40; } }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--text); font: 15px/1.5 Inter, system-ui, -apple-system, "Segoe UI", sans-serif; }
a { color: var(--accent); }
.wrap { max-width: 440px; margin: 0 auto; padding: 56px 16px; }
.wide { max-width: 1180px; padding: 32px 16px; }
.brand { display:flex; align-items:center; gap:10px; font-size:20px; font-weight:600; margin-bottom:28px; }
.mark { width:34px; height:34px; border-radius:9px; background:#9184d9; color:#161826; display:grid; place-items:center; font-weight:600; }
.card { background:var(--card); border:1px solid var(--border); border-radius:14px; padding:24px; }
h1 { font-size:24px; margin:0 0 6px; font-weight:600; }
h2 { font-size:17px; margin:28px 0 10px; font-weight:600; }
p { margin: 0 0 14px; }
.muted { color: var(--muted); }
label { display:block; font-size:13px; font-weight:500; margin-bottom:6px; }
input[type=email] { width:100%; padding:11px 12px; border:1px solid var(--border); border-radius:10px; background:var(--bg); color:var(--text); font:inherit; }
input:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
.btn { display:inline-flex; justify-content:center; align-items:center; gap:8px; width:100%; margin-top:14px; padding:11px 14px; border:0; border-radius:10px; background:var(--accent); color:var(--accent-fg); font:inherit; font-weight:600; cursor:pointer; text-decoration:none; }
.site { display:flex; justify-content:space-between; align-items:center; gap:12px; padding:14px 16px; border:1px solid var(--border); border-radius:12px; text-decoration:none; color:var(--text); margin-top:10px; }
.site:hover { background: var(--tint); }
.small { font-size:13px; }
.err { color: var(--bad); font-size:13px; margin-top:8px; }
table { width:100%; border-collapse:collapse; font-size:14px; }
th { text-align:start; font-size:11.5px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); font-weight:600; padding:8px 10px; border-bottom:1px solid var(--border); }
td { padding:9px 10px; border-bottom:1px solid var(--border); vertical-align: top; }
td.num, th.num { text-align:end; font-variant-numeric: tabular-nums; }
.tag { display:inline-block; padding:1px 8px; border-radius:999px; font-size:12px; background:var(--tint); }
.up { color: var(--ok); } .down { color: var(--bad); }
.grid { display:grid; gap:14px; grid-template-columns: repeat(auto-fit, minmax(min(240px, 100%), 1fr)); }
.stat { font-size: 26px; font-weight: 600; }
.scroll { overflow-x: auto; }
nav.top { display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; }
`;

export function page(title: string, body: Safe, opts: { wide?: boolean } = {}) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>${esc(title)}</title>
<link rel="icon" href="${FAVICON}" />
<style>${CSS}</style>
</head>
<body><main class="wrap${opts.wide ? " wide" : ""}">
<div class="brand"><span class="mark">S</span>Saralix</div>
${body.html}
</main></body>
</html>`;
}
