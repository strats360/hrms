import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";

/**
 * A small layout helper over pdf-lib for A4 documents (payslips, Form 16). It uses the
 * built-in Helvetica fonts, so nothing is embedded and files stay small. Those fonts only
 * cover Western European characters: "₹" is written as "Rs." and anything else outside
 * that set is replaced.
 */
export const A4 = { width: 595.28, height: 841.89 };
export const MARGIN = 40;

export const colors = {
  text: rgb(0.11, 0.12, 0.15),
  muted: rgb(0.39, 0.4, 0.46),
  divider: rgb(0.85, 0.86, 0.89),
  tint: rgb(0.95, 0.96, 0.97),
  okBg: rgb(0.91, 0.96, 0.93),
  okFg: rgb(0.12, 0.36, 0.2),
  accent: rgb(0.36, 0.32, 0.58),
  bad: rgb(0.7, 0.16, 0.16),
};

const WIN_ANSI = /[ -~ -ÿ–—‘’“”•…€]/;

/** Make text safe for the standard fonts. */
export function pdfSafe(s: string | number | null | undefined) {
  return String(s ?? "")
    .replace(/₹\s?/g, "Rs. ")
    .replace(/[−]/g, "-")
    .replace(/[·]/g, "·")
    .replace(/[\r\n\t]+/g, " ")
    .split("")
    .map((ch) => (WIN_ANSI.test(ch) ? ch : "?"))
    .join("");
}

/** Indian digit grouping, two decimals only when needed: Rs. 1,23,456 or Rs. 1,234.50 */
export function rs(n: number) {
  const neg = n < 0;
  const v = Math.abs(n);
  const whole = Math.floor(v);
  const paise = Math.round((v - whole) * 100);
  const str = whole.toLocaleString("en-IN") + (paise ? "." + String(paise).padStart(2, "0") : "");
  return `${neg ? "-" : ""}Rs. ${str}`;
}

export interface TextOpts {
  size?: number;
  bold?: boolean;
  color?: ReturnType<typeof rgb>;
  align?: "left" | "right" | "center";
  /** Width of the box for right/center alignment, and for wrapping. */
  width?: number;
  maxLines?: number;
  lineHeight?: number;
}

export class PdfWriter {
  private constructor(
    readonly doc: PDFDocument,
    readonly regular: PDFFont,
    readonly bold: PDFFont,
  ) {}
  page!: PDFPage;
  /** Distance from the top of the page, so layout code reads top-down. */
  y = MARGIN;

  static async create(meta: { title: string; author?: string }) {
    const doc = await PDFDocument.create();
    doc.setTitle(pdfSafe(meta.title));
    if (meta.author) doc.setAuthor(pdfSafe(meta.author));
    doc.setProducer("Strats360 People");
    doc.setCreationDate(new Date());
    const w = new PdfWriter(doc, await doc.embedFont(StandardFonts.Helvetica), await doc.embedFont(StandardFonts.HelveticaBold));
    w.addPage();
    return w;
  }

  addPage() {
    this.page = this.doc.addPage([A4.width, A4.height]);
    this.y = MARGIN;
  }

  /** Start a new page if fewer than `h` points are left. */
  ensure(h: number) {
    if (this.y + h > A4.height - MARGIN) this.addPage();
  }

  font(bold?: boolean) {
    return bold ? this.bold : this.regular;
  }

  width(s: string, size = 10, bold = false) {
    return this.font(bold).widthOfTextAtSize(pdfSafe(s), size);
  }

  /** Split text into lines that fit `width`. */
  wrap(s: string, width: number, size = 10, bold = false) {
    const words = pdfSafe(s).split(" ");
    const lines: string[] = [];
    let cur = "";
    for (const word of words) {
      const next = cur ? `${cur} ${word}` : word;
      if (this.width(next, size, bold) <= width || !cur) cur = next;
      else {
        lines.push(cur);
        cur = word;
      }
    }
    if (cur) lines.push(cur);
    return lines;
  }

  /** Draw text with its top at `top` (from the top of the page). Returns the height used. */
  text(x: number, top: number, s: string | number, o: TextOpts = {}) {
    const size = o.size ?? 10;
    const font = this.font(o.bold);
    const lh = o.lineHeight ?? size * 1.3;
    const lines = o.width && o.align !== "right" && o.align !== "center" ? this.wrap(String(s), o.width, size, o.bold).slice(0, o.maxLines ?? 99) : [pdfSafe(s)];
    lines.forEach((line, i) => {
      const w = font.widthOfTextAtSize(line, size);
      const dx = o.align === "right" && o.width ? o.width - w : o.align === "center" && o.width ? (o.width - w) / 2 : 0;
      this.page.drawText(line, { x: x + dx, y: A4.height - top - size * 0.85 - i * lh, size, font, color: o.color ?? colors.text });
    });
    return lines.length * lh;
  }

  rect(x: number, top: number, w: number, h: number, color = colors.tint, radius = 0) {
    if (radius) {
      // pdf-lib has no rounded rectangle; an SVG path draws one
      const r = Math.min(radius, h / 2, w / 2);
      const path = `M ${r} 0 H ${w - r} Q ${w} 0 ${w} ${r} V ${h - r} Q ${w} ${h} ${w - r} ${h} H ${r} Q 0 ${h} 0 ${h - r} V ${r} Q 0 0 ${r} 0 Z`;
      this.page.drawSvgPath(path, { x, y: A4.height - top, color });
    } else this.page.drawRectangle({ x, y: A4.height - top - h, width: w, height: h, color });
  }

  line(x1: number, top: number, x2: number, color = colors.divider, thickness = 0.75) {
    this.page.drawLine({ start: { x: x1, y: A4.height - top }, end: { x: x2, y: A4.height - top }, thickness, color });
  }

  /** Label over value, in a grid cell. Returns the height used. */
  kv(x: number, top: number, w: number, label: string, value: string, bold = false) {
    const h1 = this.text(x, top, label, { size: 8, color: colors.muted, width: w });
    const h2 = this.text(x, top + h1 + 1, value || "-", { size: 9.5, bold, width: w, maxLines: 2 });
    return h1 + 1 + h2;
  }

  async bytes() {
    return this.doc.save();
  }
}
