import { describe, expect, test } from "bun:test";
import { commentText, envName, fnIdent, rustStr, testIdent } from "../src/shared/rust.ts";

describe("rustStr", () => {
  test("plain text", () => {
    expect(rustStr("hello")).toBe('"hello"');
    expect(rustStr("")).toBe('""');
  });

  test("quotes, backslashes and line breaks", () => {
    expect(rustStr('say "hi"')).toBe('"say \\"hi\\""');
    expect(rustStr("c:\\temp")).toBe('"c:\\\\temp"');
    expect(rustStr("a\nb\r\tc")).toBe('"a\\nb\\r\\tc"');
    expect(rustStr("nul\0")).toBe('"nul\\0"');
  });

  test("a string cannot be ended by its text", () => {
    const out = rustStr('"; std::process::exit(1); "');
    expect(out).toBe('"\\"; std::process::exit(1); \\""');
  });

  test("control, bidi and invisible characters become escapes", () => {
    expect(rustStr("\u001b")).toBe('"\\u{1b}"');
    expect(rustStr("\u202e")).toBe('"\\u{202e}"');
    expect(rustStr("\u2066")).toBe('"\\u{2066}"');
    expect(rustStr("\u200b")).toBe('"\\u{200b}"');
    expect(rustStr("\ufeff")).toBe('"\\u{feff}"');
    expect(rustStr("\u2028")).toBe('"\\u{2028}"');
    expect(rustStr("\u0085")).toBe('"\\u{85}"');
  });

  test("private-use Selenium key codes are escaped", () => {
    expect(rustStr("\ue007")).toBe('"\\u{e007}"');
  });

  test("ordinary non-ASCII text stays readable", () => {
    expect(rustStr("café 日本語 😀")).toBe('"café 日本語 😀"');
  });

  test("a lone surrogate cannot reach the source", () => {
    expect(rustStr("a\ud800b")).toBe('"a\\u{fffd}b"');
  });
});

describe("commentText", () => {
  test("stays on one line", () => {
    expect(commentText("a\nb\r\nc\td")).toBe("a b c d");
    expect(commentText("x\u202ey")).toBe("x\\u{202e}y");
  });
});

describe("identifiers", () => {
  test("fnIdent mirrors the recorder's rust_identifier", () => {
    expect(fnIdent("my test")).toBe("my_test");
    expect(fnIdent("")).toBe("recorded_test");
    expect(fnIdent("1st")).toBe("_1st");
    expect(fnIdent("fn")).toBe("fn_");
    expect(fnIdent("gen")).toBe("gen_");
    // One non-ASCII character is one "_", which the recorder replaces.
    expect(fnIdent("é")).toBe("recorded_test");
    expect(fnIdent("é1")).toBe("_1");
  });

  test("testIdent makes snake case names", () => {
    expect(testIdent("Sign in works", "fallback")).toBe("sign_in_works");
    expect(testIdent("submitButton", "fallback")).toBe("submit_button");
    expect(testIdent("", "fallback")).toBe("fallback");
    expect(testIdent("2 steps", "fallback")).toBe("test_2_steps");
    expect(testIdent("match", "fallback")).toBe("match_test");
  });

  test("envName", () => {
    expect(envName("password")).toBe("RECORDED_PASSWORD");
    expect(envName("card number")).toBe("RECORDED_CARD_NUMBER");
    expect(envName("")).toBe("RECORDED_SECRET");
    expect(envName("a;rm -rf")).toBe("RECORDED_A_RM_RF");
  });
});
