/**
 * Tiny arithmetic expression evaluator for derived table columns.
 *
 * Some column values are *derived facts* that decay with time — e.g. a lead's
 * freshness, which is a function of a stored post date and "now". Storing the
 * decayed value in the graph would mean rewriting every row every day, so the
 * graph stores the durable fact and the notebook computes the derived value
 * at read time. This module is that computation.
 *
 * Grammar (deliberately small — no variables, no assignment, no property
 * access, no ambient environment; a row and a clock are the only inputs):
 *
 *   expr    := term (("+" | "-") term)*
 *   term    := unary (("*" | "/") unary)*
 *   unary   := "-" unary | primary
 *   primary := number | call | "(" expr ")"
 *   call    := ident "(" (arg ("," arg)*)? ")"
 *   arg     := expr | string
 *
 * Functions (the whole builtin surface):
 *   num("col")        — the row field parsed as a number
 *   days_since("col") — fractional days between the row field (a date or
 *                       datetime string / epoch-ms number) and now
 *   tier(x, t1, v1, t2, v2, ..., vDefault)
 *                     — first threshold t where x <= t yields its v; no
 *                       threshold matches → vDefault. Encodes step/decay
 *                       functions without needing array literals.
 *
 * Anything unparseable, a missing field, or a NaN result evaluates to null —
 * derived cells degrade to blank rather than rendering "NaN" or throwing
 * mid-render.
 */

export interface ExprContext {
  row: Record<string, unknown>;
  /** Epoch ms "now" — injected so callers control the clock (and tests can). */
  nowMs: number;
}

type Token =
  | { kind: "num"; value: number }
  | { kind: "str"; value: string }
  | { kind: "ident"; value: string }
  | { kind: "punct"; value: "(" | ")" | "," | "+" | "-" | "*" | "/" };

function tokenize(src: string): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (ch === " " || ch === "\t" || ch === "\n") {
      i++;
      continue;
    }
    if (
      ch === "(" || ch === ")" || ch === "," ||
      ch === "+" || ch === "-" || ch === "*" || ch === "/"
    ) {
      tokens.push({ kind: "punct", value: ch });
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const close = src.indexOf(ch, i + 1);
      if (close === -1) return null;
      tokens.push({ kind: "str", value: src.slice(i + 1, close) });
      i = close + 1;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      const match = /^\d*\.?\d+/.exec(src.slice(i));
      if (!match) return null;
      tokens.push({ kind: "num", value: Number(match[0]) });
      i += match[0].length;
      continue;
    }
    if (/[a-z_]/i.test(ch)) {
      const match = /^[a-z_][a-z0-9_]*/i.exec(src.slice(i));
      tokens.push({ kind: "ident", value: match![0] });
      i += match![0].length;
      continue;
    }
    return null; // any character outside the grammar rejects the whole expr
  }
  return tokens;
}

/** Parse a field's value as a timestamp; bare dates read as UTC midnight. */
function toEpochMs(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value !== "string" || value === "") return NaN;
  // Date-only and Z-less datetime strings both parse; Z-less is treated as
  // UTC (omnigraph DateTimes are stored Z-less by convention).
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}T00:00:00Z`
    : /[zZ]$|[+-]\d{2}:\d{2}$/.test(value)
      ? value
      : `${value}Z`;
  return Date.parse(iso);
}

class Parser {
  private pos = 0;
  constructor(
    private tokens: Token[],
    private ctx: ExprContext,
  ) {}

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }
  private takePunct(value: string): boolean {
    const t = this.peek();
    if (t?.kind === "punct" && t.value === value) {
      this.pos++;
      return true;
    }
    return false;
  }

  expr(): number {
    let left = this.term();
    for (;;) {
      if (this.takePunct("+")) left += this.term();
      else if (this.takePunct("-")) left -= this.term();
      else return left;
    }
  }

  private term(): number {
    let left = this.unary();
    for (;;) {
      if (this.takePunct("*")) left *= this.unary();
      else if (this.takePunct("/")) left /= this.unary();
      else return left;
    }
  }

  private unary(): number {
    if (this.takePunct("-")) return -this.unary();
    return this.primary();
  }

  private primary(): number {
    const t = this.peek();
    if (t === undefined) throw new Error("unexpected end of expression");
    if (t.kind === "num") {
      this.pos++;
      return t.value;
    }
    if (t.kind === "punct" && t.value === "(") {
      this.pos++;
      const v = this.expr();
      if (!this.takePunct(")")) throw new Error("expected )");
      return v;
    }
    if (t.kind === "ident") {
      this.pos++;
      return this.call(t.value);
    }
    throw new Error(`unexpected token`);
  }

  /** An argument is either a string literal (a column ref) or a sub-expr. */
  private arg(): number | string {
    const t = this.peek();
    if (t?.kind === "str") {
      this.pos++;
      return t.value;
    }
    return this.expr();
  }

  private call(name: string): number {
    if (!this.takePunct("(")) throw new Error(`${name} is not a value`);
    const args: Array<number | string> = [];
    if (!this.takePunct(")")) {
      do {
        args.push(this.arg());
      } while (this.takePunct(","));
      if (!this.takePunct(")")) throw new Error("expected )");
    }

    switch (name) {
      case "num": {
        if (args.length !== 1 || typeof args[0] !== "string")
          throw new Error('num() takes one column name, e.g. num("score")');
        const raw = this.ctx.row[args[0]];
        if (typeof raw === "number") return raw;
        if (typeof raw !== "string" || raw.trim() === "") return NaN;
        return Number(raw);
      }
      case "days_since": {
        if (args.length !== 1 || typeof args[0] !== "string")
          throw new Error('days_since() takes one column name');
        const ms = toEpochMs(this.ctx.row[args[0]]);
        return (this.ctx.nowMs - ms) / 86_400_000;
      }
      case "tier": {
        // tier(x, t1, v1, ..., vDefault): odd arg count >= 2, all numeric.
        if (args.length < 2 || args.length % 2 !== 0)
          throw new Error(
            "tier() wants tier(x, t1, v1, ..., default) — pairs plus a default",
          );
        if (args.some((a) => typeof a !== "number" || !Number.isFinite(a)))
          throw new Error("tier() arguments must be finite numeric values");
        const nums = args as number[];
        const x = nums[0]!;
        for (let i = 1; i < nums.length - 1; i += 2) {
          if (x <= nums[i]!) return nums[i + 1]!;
        }
        return nums[nums.length - 1]!;
      }
      default:
        throw new Error(`unknown function ${name}()`);
    }
  }

  done(): boolean {
    return this.pos === this.tokens.length;
  }
}

/**
 * Evaluate an expression against one row. Returns null (never throws, never
 * NaN) on any lexical, syntactic, or data problem — a bad expr or a missing
 * field blanks the cell instead of breaking the table.
 */
export function evaluateExpr(src: string, ctx: ExprContext): number | null {
  const tokens = tokenize(src);
  if (tokens === null || tokens.length === 0) return null;
  try {
    const parser = new Parser(tokens, ctx);
    const value = parser.expr();
    if (!parser.done()) return null;
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}
