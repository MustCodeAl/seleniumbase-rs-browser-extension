import { describe, expect, test } from "bun:test";
import { generate } from "../src/shared/codegen/index.js";
import { cdpProgram, cdpStatements } from "../src/shared/codegen/cdp.js";
import { basecaseProgram, basecaseStatements } from "../src/shared/codegen/basecase.js";
import { fromReplay, toReplay } from "../src/shared/codegen/replay.js";
import { callsFor } from "../src/shared/calls.js";
import { step, targetOf } from "../src/shared/steps.js";

const on = (selector) => ({ target: targetOf(selector) });

const flow = [
  step("navigate", { url: "https://example.com/" }),
  step("click", on("#go")),
  step("change", { ...on("#q"), value: "hello" }),
  step("select", { ...on("#color"), value: "g", text: "Green", index: 1 }),
  step("check", on("#agree")),
  step("uncheck", on("#agree")),
  step("doubleClick", on("#row")),
  step("keyPress", { ...on("#q"), key: "Enter" }),
];

describe("pure CDP program", () => {
  test("a test, exact output", () => {
    expect(cdpProgram(flow, { entry: "test", name: "recorded_test" })).toBe(`use seleniumbase_rs::sb_cdp::{Browser, Key, LaunchOptions, SelectBy};

#[tokio::test]
async fn recorded_test() -> Result<(), Box<dyn std::error::Error>> {
    let browser = Browser::launch(LaunchOptions::builder().build()?).await?;
    let page = browser.default_page().await?;
    page.goto("https://example.com/").await?;
    page.locator("#go").click().await?;
    page.locator("#q").clear().await?;
    page.locator("#q").type_text("hello").await?;
    page.locator("#color").select_option(SelectBy::Text("Green")).await?;
    page.locator("#agree").check().await?;
    page.locator("#agree").uncheck().await?;
    page.locator("#row").double_click().await?;
    page.locator("#q").press(Key::Enter).await?;
    browser.close().await?;
    Ok(())
}
`);
  });

  test("a program has the shape of ActionRecorder::to_cdp_script", () => {
    const text = cdpProgram([step("navigate", { url: "https://example.com" }), step("click", on("#go"))], {
      entry: "main",
    });
    expect(text).toBe(`use seleniumbase_rs::sb_cdp::{Browser, LaunchOptions};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let browser = Browser::launch(LaunchOptions::builder().build()?).await?;
    let page = browser.default_page().await?;
    page.goto("https://example.com").await?;
    page.locator("#go").click().await?;
    browser.close().await?;
    Ok(())
}
`);
  });

  test("no steps is still a program", () => {
    expect(cdpProgram([], { entry: "main" })).toContain("browser.close().await?;");
  });

  test("a test name is made a function name", () => {
    expect(cdpProgram([], { entry: "test", name: "my test!" })).toContain("async fn my_test_()");
    expect(cdpProgram([], { entry: "test", name: "fn" })).toContain("async fn fn_()");
  });

  test("hostile text stays inside its literal", () => {
    const hostile = '"; std::process::exit(1); //\n‮\\';
    const text = cdpProgram(
      [
        step("navigate", { url: `https://x.test/?q=${hostile}` }),
        step("click", on(`a[title="${hostile}"]`)),
        step("change", { ...on("#q"), value: hostile }),
      ],
      { entry: "main" },
    );
    expect(text).not.toContain("\n; std::process");
    expect(text).toContain('\\"; std::process::exit(1); //\\n\\u{202e}\\\\');
    // Every line of the body is a statement we wrote; none starts with the payload.
    for (const line of text.split("\n")) {
      expect(line.trimStart().startsWith("std::process")).toBe(false);
    }
  });

  test("a sensitive field reads its value from the environment", () => {
    const text = cdpProgram(
      [step("change", { ...on("#pw"), value: "", sensitive: true, secret: "password" })],
      { entry: "main" },
    );
    expect(text).toContain("// the value of this field was not recorded: set RECORDED_PASSWORD");
    expect(text).toContain('page.locator("#pw").type_text(std::env::var("RECORDED_PASSWORD").unwrap_or_default()).await?;');
    expect(text).not.toContain("hunter2");
  });

  test("a step with an edited selector uses it", () => {
    const lines = cdpStatements({ ...step("click", on("#a")), selector: "link=Home" }).lines;
    expect(lines).toEqual(['page.locator("link=Home").click().await?;']);
  });

  test("a step with no usable selector is skipped with a reason", () => {
    const lines = cdpStatements(step("click", { target: { selectors: [] } })).lines;
    expect(lines).toEqual(["// skipped: click has no selector"]);
  });

  test("files are a to-do, not a guess", () => {
    const lines = cdpStatements(step("setFiles", { ...on("#up"), names: ["a.txt", "b.png"] })).lines;
    expect(lines[0]).toContain("// TODO");
    expect(lines.join("\n")).toContain('"a.txt"');
    for (const line of lines) {
      expect(line.startsWith("//")).toBe(true);
    }
  });

  test("scroll and keys without a target", () => {
    expect(cdpStatements(step("scroll", { x: 0, y: 400 })).lines).toEqual(['page.evaluate("window.scrollTo(0, 400)").await?;']);
    expect(cdpStatements(step("keyPress", { key: "Escape" })).lines).toEqual(["page.keyboard().press(Key::Escape).await?;"]);
    expect(cdpStatements(step("keyPress", { key: "a" })).lines[0]).toStartWith("// skipped:");
  });

  test("scroll numbers come from numbers", () => {
    expect(cdpStatements(step("scroll", { x: "0); evil(", y: 1 })).lines[0]).toStartWith("// skipped:");
  });
});

describe("BaseCase test", () => {
  test("exact output", () => {
    expect(basecaseProgram(flow, { entry: "test", name: "recorded_test" })).toBe(`use seleniumbase_rs::{BaseCase, BrowserConfig};

#[tokio::test]
async fn recorded_test() -> Result<(), Box<dyn std::error::Error>> {
    let mut sb = BaseCase::new(BrowserConfig::default()).await?;
    sb.open("https://example.com/").await?;
    sb.click("#go").await?;
    sb.type_text("#q", "hello").await?;
    sb.select_option_by_text("#color", "Green").await?;
    sb.check_if_unchecked("#agree").await?;
    sb.uncheck_if_checked("#agree").await?;
    sb.double_click("#row").await?;
    sb.send_keys("#q", "\\u{e007}").await?;
    sb.quit().await?;
    Ok(())
}
`);
  });

  test("a main program", () => {
    const text = basecaseProgram([step("click", on("#go"))], { entry: "main" });
    expect(text).toContain("#[tokio::main]\nasync fn main() -> Result<(), Box<dyn std::error::Error>> {");
  });

  test("a sensitive field", () => {
    const lines = basecaseStatements(step("change", { ...on("#pw"), value: "", sensitive: true, secret: "card number" })).lines;
    expect(lines[1]).toBe('sb.type_text("#pw", &std::env::var("RECORDED_CARD_NUMBER").unwrap_or_default()).await?;');
  });

  test("hostile text", () => {
    const text = basecaseProgram([step("click", on('a[title="x\\"]'))], { entry: "main" });
    expect(text).toContain('sb.click("a[title=\\"x\\\\\\"]").await?;');
  });

  test("the window and wait steps", () => {
    expect(basecaseStatements(step("viewport", { width: 800, height: 600 })).lines).toEqual(["sb.set_window_size(800, 600).await?;"]);
    expect(basecaseStatements(step("waitFor", { ...on("#done"), visible: true })).lines).toEqual(['sb.wait_for_element_visible("#done", 10).await?;']);
  });
});

describe("DevTools Recorder JSON", () => {
  test("shape of @puppeteer/replay", () => {
    const withAria = {
      target: {
        tag: "button",
        selectors: [
          { kind: "id", syntax: "css", value: "#go", unique: true },
          { kind: "role-name", syntax: "xpath", value: '//button[normalize-space(.)="Go"]', aria: 'Go[role="button"]', unique: true },
          { kind: "link-text", syntax: "link", value: "link=Go", unique: true },
        ],
      },
      offsetX: 5,
      offsetY: 6,
    };
    const replay = toReplay(
      [step("navigate", { url: "https://example.com/" }), step("click", withAria), step("keyPress", { ...on("#q"), key: "Enter" })],
      { title: "Flow", viewport: { width: 1280, height: 720 } },
    );
    expect(replay.title).toBe("Flow");
    expect(replay.steps[0]).toEqual({
      type: "setViewport",
      width: 1280,
      height: 720,
      deviceScaleFactor: 1,
      isMobile: false,
      hasTouch: false,
      isLandscape: false,
    });
    expect(replay.steps[1]).toEqual({
      type: "navigate",
      url: "https://example.com/",
      assertedEvents: [{ type: "navigation", url: "https://example.com/", title: "" }],
    });
    expect(replay.steps[2]).toEqual({
      type: "click",
      target: "main",
      selectors: [['aria/Go[role="button"]'], ["#go"], ['xpath///button[normalize-space(.)="Go"]'], ["text/Go"]],
      offsetX: 5,
      offsetY: 6,
    });
    expect(replay.steps[3]).toEqual({ type: "keyDown", target: "main", key: "Enter" });
    expect(replay.steps[4]).toEqual({ type: "keyUp", key: "Enter", target: "main" });
  });

  test("selects and checkboxes become what Chrome records", () => {
    const replay = toReplay(
      [
        step("select", { ...on("#color"), value: "g", text: "Green" }),
        step("check", on("#agree")),
        step("doubleClick", on("#row")),
        step("change", { ...on("#pw"), value: "", sensitive: true, secret: "password" }),
        step("scroll", { x: 0, y: 120 }),
      ],
      { title: "t" },
    );
    const types = replay.steps.map((s) => s.type);
    expect(types).toEqual(["setViewport", "change", "click", "doubleClick", "change", "scroll"]);
    expect(replay.steps[1].value).toBe("g");
    expect(replay.steps[4].value).toBe("");
    expect(JSON.stringify(replay)).not.toContain("hunter2");
  });
});

describe("from a DevTools recording", () => {
  const recording = {
    title: "Rec",
    steps: [
      { type: "setViewport", width: 1000, height: 800, deviceScaleFactor: 1, isMobile: false, hasTouch: false, isLandscape: false },
      { type: "navigate", url: "https://x.test/", assertedEvents: [{ type: "navigation", url: "https://x.test/", title: "X" }] },
      {
        type: "click",
        target: "main",
        selectors: [["aria/Sign in"], ["#go"], ['xpath///*[@id="go"]'], ["pierce/#go"], ["text/Sign in"]],
        offsetX: 5,
        offsetY: 5,
      },
      { type: "change", value: "alice", selectors: [["#user"]], target: "main" },
      { type: "keyDown", target: "main", key: "Enter" },
      { type: "keyUp", target: "main", key: "Enter" },
      { type: "doubleClick", target: "main", selectors: [[".row"]], offsetX: 1, offsetY: 1 },
      { type: "scroll", target: "main", x: 0, y: 200 },
      { type: "waitForElement", selectors: [["#done"]] },
      { type: "customStep", name: "x", parameters: {} },
    ],
  };

  test("steps", () => {
    const steps = fromReplay(recording);
    expect(steps.map((s) => s.type)).toEqual([
      "viewport",
      "navigate",
      "click",
      "setValue",
      "keyPress",
      "doubleClick",
      "scroll",
      "waitFor",
      "unsupported",
    ]);
    expect(pickOf(steps[2])).toBe("#go");
    expect(steps[3].value).toBe("alice");
    expect(steps[4].key).toBe("Enter");
  });

  test("the pure CDP export of a recording", () => {
    const text = generate("cdp", fromReplay(recording), { entry: "test", name: "from_devtools" }).text;
    expect(text).toContain("page.window().set_bounds(0, 0, 1000, 800).await?;");
    expect(text).toContain('page.goto("https://x.test/").await?;');
    expect(text).toContain('page.locator("#go").click().await?;');
    expect(text).toContain('page.locator("#user").set_value("alice").await?;');
    expect(text).toContain("page.keyboard().press(Key::Enter).await?;");
    expect(text).toContain('page.locator(".row").double_click().await?;');
    expect(text).toContain('page.locator("#done").wait_for(State::Visible).await?;');
    expect(text).toContain("// skipped: the Recorder step customStep");
    expect(text).toContain("use seleniumbase_rs::sb_cdp::{Browser, Key, LaunchOptions, State};");
  });

  test("the BaseCase export of a recording", () => {
    const text = generate("basecase", fromReplay(recording), { entry: "test", name: "from_devtools" }).text;
    expect(text).toContain("sb.set_window_size(1000, 800).await?;");
    expect(text).toContain('sb.open("https://x.test/").await?;');
    expect(text).toContain('sb.click("#go").await?;');
    expect(text).toContain('sb.type_text("#user", "alice").await?;');
    expect(text).toContain('sb.send_keys("body", "\\u{e007}").await?;');
  });

  test("only aria selectors become an xpath", () => {
    const steps = fromReplay({ steps: [{ type: "click", target: "main", selectors: [['aria/Sign in[role="button"]']], offsetX: 1, offsetY: 1 }] });
    expect(pickOf(steps[0])).toBe('//*[@role="button" and (@aria-label="Sign in" or normalize-space(.)="Sign in")]');
  });

  test("a step in another frame or tab is skipped, not guessed", () => {
    const steps = fromReplay({ steps: [{ type: "click", target: "main", frame: [0], selectors: [["#in-frame"]], offsetX: 1, offsetY: 1 }] });
    expect(steps[0].type).toBe("unsupported");
  });
});

describe("generate()", () => {
  test("formats and file names", () => {
    const cdp = generate("cdp", flow, { entry: "test", name: "My Flow" });
    expect(cdp.filename).toBe("my_flow.rs");
    expect(cdp.mime).toBe("text/x-rust");
    const base = generate("basecase", flow, { entry: "main", name: "My Flow" });
    expect(base.filename).toBe("my_flow.rs");
    const json = generate("devtools", flow, { name: "My Flow" });
    expect(json.filename).toBe("my_flow.json");
    expect(json.mime).toBe("application/json");
    expect(JSON.parse(json.text).title).toBe("My Flow");
  });

  test("an unknown format is an error", () => {
    expect(() => generate("nope", flow, {})).toThrow();
  });
});

describe("ready-to-copy calls", () => {
  test("a button", () => {
    const calls = callsFor("#go", { tag: "button", text: "Order now" });
    const labels = calls.map((c) => c.label);
    expect(labels).toContain("click");
    const click = calls.find((c) => c.label === "click");
    expect(click.cdp).toBe('page.locator("#go").click().await?;');
    expect(click.basecase).toBe('sb.click("#go").await?;');
    const text = calls.find((c) => c.label === "assert text");
    expect(text.cdp).toBe('page.locator("#go").expect().to_contain_text("Order now").await?;');
    expect(text.basecase).toBe('sb.assert_text("#go", "Order now").await?;');
  });

  test("a text field and a select", () => {
    const field = callsFor("#q", { tag: "input", inputType: "text" });
    expect(field.find((c) => c.label === "type").cdp).toBe('page.locator("#q").type_text("").await?;');
    const select = callsFor("#c", { tag: "select" });
    expect(select.find((c) => c.label === "select").cdp).toBe('page.locator("#c").select_option(SelectBy::Text("")).await?;');
  });

  test("a selector with quotes", () => {
    const calls = callsFor('a[title="x"]', { tag: "a" });
    expect(calls[0].cdp).toContain('page.locator("a[title=\\"x\\"]")');
  });
});

function pickOf(s) {
  return s.selector ?? s.target.selectors.find((c) => c.syntax !== "aria")?.value;
}
