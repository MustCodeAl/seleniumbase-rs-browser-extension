import { describe, expect, test } from "bun:test";
import { unexplainedAny } from "../scripts/rules.ts";

describe("unexplainedAny", () => {
  test.each([
    "let x: any = 1;",
    "const y = value as any;",
    "function f(a: string, b: any) {}",
    "type T = Record<string, any>;",
    "const z: string | any[] = [];",
    "const f = (): any => 1;",
  ])("finds %s", (line) => {
    expect(unexplainedAny(line)).toEqual([1]);
  });

  test.each([
    "const text = 'any value';",
    'const text = "kind: any";',
    "// a comment: any thing",
    " * @param x: any thing",
    "const many = anything;",
    "const company = 1; // any company",
    "const url = `https://x.test/?a=${1}`; // not any type",
  ])("leaves %s alone", (line) => {
    expect(unexplainedAny(line)).toEqual([]);
  });

  test("a reason on the line, or alone on the line before, explains it", () => {
    expect(unexplainedAny("let x: any = 1; // any: the page gives no type")).toEqual([]);
    expect(unexplainedAny("// any: the page gives no type\nlet x: any = 1;")).toEqual([]);
    expect(unexplainedAny("// any:\nlet x: any = 1;")).toEqual([2]);
    expect(unexplainedAny("let y = 1;\n\nlet x: any = 1;")).toEqual([3]);
  });
});
