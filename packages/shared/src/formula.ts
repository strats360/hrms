/**
 * A small, safe formula language for salary components: numbers, the variables below, + - * /,
 * parentheses, and min, max, round, floor and ceil. It never runs code: formulas are parsed into a
 * tree and worked out over plain numbers, and anything else is refused with a clear message.
 *
 *   min(basic * 0.1, 1600)        round(gross * 0.05)        max(0, ctc / 12 - gross)
 */
export const FORMULA_VARIABLES = {
  gross: "Monthly gross",
  basic: "Monthly basic",
  ctc: "Monthly CTC",
  hra: "Monthly HRA",
} as const;
export type FormulaVars = Partial<Record<keyof typeof FORMULA_VARIABLES, number>>;

type Node = { n: number } | { v: string } | { op: "+" | "-" | "*" | "/"; a: Node; b: Node } | { neg: Node } | { fn: string; args: Node[] };
const FUNCS: Record<string, (...x: number[]) => number> = {
  min: (...x) => Math.min(...x),
  max: (...x) => Math.max(...x),
  round: (x) => Math.round(x),
  floor: (x) => Math.floor(x),
  ceil: (x) => Math.ceil(x),
};

export class FormulaError extends Error {}

export function parseFormula(src: string): Node {
  const s = src.trim();
  if (!s) throw new FormulaError("Enter a formula");
  if (s.length > 200) throw new FormulaError("Keep the formula under 200 characters");
  let i = 0;
  const ws = () => {
    while (s[i] === " ") i++;
  };
  const expr = (): Node => {
    let a = term();
    for (ws(); s[i] === "+" || s[i] === "-"; ws()) {
      const op = s[i++] as "+" | "-";
      a = { op, a, b: term() };
    }
    return a;
  };
  const term = (): Node => {
    let a = unary();
    for (ws(); s[i] === "*" || s[i] === "/"; ws()) {
      const op = s[i++] as "*" | "/";
      a = { op, a, b: unary() };
    }
    return a;
  };
  const unary = (): Node => {
    ws();
    if (s[i] === "-") {
      i++;
      return { neg: unary() };
    }
    return atom();
  };
  const atom = (): Node => {
    ws();
    if (s[i] === "(") {
      i++;
      const e = expr();
      ws();
      if (s[i++] !== ")") throw new FormulaError("A bracket isn't closed");
      return e;
    }
    const num = /^\d+(\.\d+)?/.exec(s.slice(i));
    if (num) {
      i += num[0].length;
      return { n: Number(num[0]) };
    }
    const id = /^[a-z_]+/i.exec(s.slice(i));
    if (id) {
      i += id[0].length;
      const name = id[0].toLowerCase();
      ws();
      if (s[i] === "(") {
        if (!FUNCS[name]) throw new FormulaError(`${id[0]} isn't a function you can use (try min, max, round, floor or ceil)`);
        i++;
        const args: Node[] = [];
        ws();
        if (s[i] !== ")") {
          args.push(expr());
          for (ws(); s[i] === ","; ws()) {
            i++;
            args.push(expr());
          }
        }
        if (s[i++] !== ")") throw new FormulaError(`${name}( isn't closed`);
        if (!args.length) throw new FormulaError(`${name}() needs a value`);
        return { fn: name, args };
      }
      if (!(name in FORMULA_VARIABLES)) throw new FormulaError(`${id[0]} isn't something the formula knows (use ${Object.keys(FORMULA_VARIABLES).join(", ")})`);
      return { v: name };
    }
    throw new FormulaError(s[i] ? `Unexpected "${s[i]}"` : "The formula ends too soon");
  };
  const tree = expr();
  ws();
  if (i < s.length) throw new FormulaError(`Unexpected "${s[i]}"`);
  return tree;
}

function run(t: Node, vars: FormulaVars): number {
  if ("n" in t) return t.n;
  if ("v" in t) return vars[t.v as keyof FormulaVars] ?? 0;
  if ("neg" in t) return -run(t.neg, vars);
  if ("fn" in t) return FUNCS[t.fn]!(...t.args.map((a) => run(a, vars)));
  const a = run(t.a, vars);
  const b = run(t.b, vars);
  if (t.op === "+") return a + b;
  if (t.op === "-") return a - b;
  if (t.op === "*") return a * b;
  return b === 0 ? 0 : a / b;
}

/** Work a formula out. Bad formulas throw a FormulaError with a message for the person who wrote it. */
export function evalFormula(src: string, vars: FormulaVars): number {
  const v = run(parseFormula(src), vars);
  return Number.isFinite(v) ? v : 0;
}

/** Check a formula without working it out: null when it's fine, or the problem. */
export function formulaError(src: string): string | null {
  try {
    parseFormula(src);
    return null;
  } catch (e) {
    return e instanceof FormulaError ? e.message : "This formula can't be read";
  }
}
