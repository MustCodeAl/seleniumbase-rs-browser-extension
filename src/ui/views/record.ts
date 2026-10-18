// The Record view: start and stop, the steps (edit, move, delete), and export.

import { ext } from "../../shared/api.ts";
import { type ExportFormat, FORMATS, isExportFormat } from "../../shared/codegen/index.ts";
import { copyText } from "../../shared/clipboard.ts";
import { h } from "../../shared/dom.ts";
import { downloadFile } from "../../shared/download.ts";
import { errorText } from "../../shared/guards.ts";
import { type ExportedFile, MSG, type RecorderSnapshot } from "../../shared/protocol.ts";
import { type Step, type StepType, pickSelector } from "../../shared/steps.ts";
import { registerView } from "../registry.ts";

const TYPE_LABELS: Record<StepType, string> = {
  navigate: "open",
  click: "click",
  doubleClick: "double click",
  rightClick: "right click",
  hover: "hover",
  change: "type",
  setValue: "set value",
  select: "select",
  check: "check",
  uncheck: "uncheck",
  keyPress: "key",
  setFiles: "file",
  scroll: "scroll",
  scrollIntoView: "scroll to",
  viewport: "window",
  waitFor: "wait",
  unsupported: "skipped",
};

function summarize(s: Step): string {
  const selector = pickSelector(s) ?? "";
  switch (s.type) {
    case "navigate":
      return s.url ?? "";
    case "change":
      return s.sensitive ? `${selector}  (value not recorded)` : `${selector}  =  ${JSON.stringify(s.value ?? "")}`;
    case "setValue":
      return `${selector}  =  ${JSON.stringify(s.value ?? "")}`;
    case "select":
      return `${selector}  =  ${JSON.stringify(s.text || s.value || "")}`;
    case "keyPress":
      return `${s.key}${selector ? `  in  ${selector}` : ""}`;
    case "setFiles":
      return `${selector}  ${(s.names ?? []).join(", ")}`;
    case "scroll":
      return `x ${s.x ?? 0}, y ${s.y ?? 0}`;
    case "viewport":
      return `${s.width} x ${s.height}`;
    case "unsupported":
      return s.description ?? "";
    default:
      return selector || (s.target?.text ?? "");
  }
}

function remembered(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function remember(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // not remembered
  }
}

registerView({
  id: "record",
  title: "Record",
  order: 10,
  render(root, ctx) {
    let state: RecorderSnapshot = {
      active: false,
      tabId: null,
      warning: null,
      steps: [],
      settings: { recordScroll: false, entry: "test" },
      name: "",
      title: "",
    };
    let editing: string | null = null;
    const savedFormat = remembered("sbrs.format", "cdp");
    let format: ExportFormat = isExportFormat(savedFormat) ? savedFormat : "cdp";
    let previewText = "";
    let busy = false;

    const guard = async (task: () => Promise<void>): Promise<void> => {
      if (busy) return;
      busy = true;
      try {
        await task();
        ctx.notify(null);
      } catch (error) {
        ctx.notify(errorText(error));
      } finally {
        busy = false;
      }
    };

    async function refresh(): Promise<void> {
      try {
        state = await ctx.call(MSG.RECORDER_STATE);
        ctx.notify(state.warning);
        draw();
        await refreshPreview();
      } catch (error) {
        ctx.notify(errorText(error));
      }
    }

    async function refreshPreview(): Promise<void> {
      try {
        const file = await ctx.call(MSG.RECORDER_EXPORT, { format, name: state.name, entry: state.settings.entry });
        previewText = file.text;
      } catch (error) {
        previewText = `// ${errorText(error)}`;
      }
      const pre = root.querySelector("pre[data-preview]");
      if (pre) pre.textContent = previewText;
    }

    async function edit(id: string, patch: Record<string, unknown>): Promise<void> {
      state = await ctx.call(MSG.RECORDER_EDIT_STEP, { id, patch });
      draw();
      await refreshPreview();
    }

    async function start(): Promise<void> {
      const tab = await ctx.activeTab();
      // One prompt, once: access to every site is what lets the recording follow
      // links. Without it the recorder still works on this page.
      try {
        if (!(await ext.permissions.contains({ origins: ["<all_urls>"] }))) {
          await ext.permissions.request({ origins: ["<all_urls>"] });
        }
      } catch {
        // declined, or not possible here
      }
      state = await ctx.call(MSG.RECORDER_START, { tabId: tab.id, append: false });
      draw();
      await refreshPreview();
    }

    function stepEditor(s: Step) {
      const id = s.id ?? "";
      const candidates = (s.target?.selectors ?? []).filter((c) => c.syntax !== "aria");
      const rows = [];
      if (candidates.length > 0 || s.selector) {
        const current = pickSelector(s) ?? "";
        const choose = h(
          "select",
          { "aria-label": "Selector" },
          candidates.map((c) => h("option", { value: c.value, text: `${c.kind}: ${c.value}`, selected: c.value === current && !s.selector })),
        );
        choose.addEventListener("change", () => edit(id, { selector: choose.value }));
        const custom = h("input", { type: "text", value: s.selector ?? "", placeholder: "or type a selector", "aria-label": "Custom selector" });
        custom.addEventListener("change", () => edit(id, { selector: custom.value.trim() }));
        rows.push(h("label", {}, "Selector", choose), h("label", {}, "Custom", custom));
      }
      if (["change", "setValue"].includes(s.type)) {
        const value = h("input", {
          type: "text",
          value: s.sensitive ? "" : (s.value ?? ""),
          disabled: s.sensitive,
          placeholder: s.sensitive ? "never recorded" : "",
          "aria-label": "Value",
        });
        value.addEventListener("change", () => edit(id, { value: value.value }));
        rows.push(h("label", {}, "Value", value));
      }
      if (s.type === "navigate") {
        const url = h("input", { type: "text", value: s.url ?? "", "aria-label": "Address" });
        url.addEventListener("change", () => edit(id, { url: url.value }));
        rows.push(h("label", {}, "Address", url));
      }
      if (s.type === "keyPress") {
        const key = h("input", { type: "text", value: s.key ?? "", "aria-label": "Key" });
        key.addEventListener("change", () => edit(id, { key: key.value }));
        rows.push(h("label", {}, "Key", key));
      }
      return h("div", { class: "edit" }, rows);
    }

    function stepItem(s: Step, index: number) {
      const id = s.id ?? "";
      const move = async (delta: number): Promise<void> => {
        state = await ctx.call(MSG.RECORDER_MOVE_STEP, { id, delta });
        draw();
        await refreshPreview();
      };
      return h(
        "li",
        { dataset: { id } },
        h(
          "div",
          { class: "step-head" },
          h("span", { class: "sub", text: String(index + 1) }),
          h("span", { class: "chip", text: TYPE_LABELS[s.type] ?? s.type }),
          h("span", { class: "step-main", text: summarize(s) }),
          h(
            "span",
            { class: "step-tools" },
            h("button", { type: "button", title: "Edit", "aria-label": "Edit step", text: "Edit", onclick: () => { editing = editing === id ? null : id; draw(); } }),
            h("button", { type: "button", title: "Move up", "aria-label": "Move step up", text: "↑", disabled: index === 0, onclick: () => guard(() => move(-1)) }),
            h("button", { type: "button", title: "Move down", "aria-label": "Move step down", text: "↓", disabled: index === state.steps.length - 1, onclick: () => guard(() => move(1)) }),
            h("button", {
              type: "button",
              class: "danger",
              title: "Delete",
              "aria-label": "Delete step",
              text: "×",
              onclick: () =>
                guard(async () => {
                  state = await ctx.call(MSG.RECORDER_DELETE_STEP, { id });
                  draw();
                  await refreshPreview();
                }),
            }),
          ),
        ),
        editing === id ? stepEditor(s) : null,
      );
    }

    function draw(): void {
      if (root.contains(document.activeElement) && document.activeElement?.tagName === "INPUT") return;
      const toggle = state.active
        ? h("button", { type: "button", class: "primary", text: "Stop", onclick: () => guard(async () => { state = await ctx.call(MSG.RECORDER_STOP); draw(); await refreshPreview(); }) })
        : h("button", { type: "button", class: "primary", text: state.steps.length > 0 ? "Record again" : "Start recording", onclick: () => guard(start) });
      const scrolls = h("input", { type: "checkbox", checked: Boolean(state.settings.recordScroll), "aria-label": "Record scrolling" });
      scrolls.addEventListener("change", () =>
        guard(async () => {
          state = await ctx.call(MSG.RECORDER_SETTINGS, { patch: { recordScroll: scrolls.checked } });
        }),
      );
      const name = h("input", { type: "text", value: state.name, placeholder: "test name", "aria-label": "Test name", class: "grow" });
      name.addEventListener("change", () =>
        guard(async () => {
          state = await ctx.call(MSG.RECORDER_SETTINGS, { patch: { name: name.value } });
          await refreshPreview();
        }),
      );
      const formatSelect = h("select", { "aria-label": "Export format" }, FORMATS.map((f) => h("option", { value: f.id, text: f.label, selected: f.id === format })));
      formatSelect.addEventListener("change", () => {
        if (isExportFormat(formatSelect.value)) format = formatSelect.value;
        remember("sbrs.format", format);
        void refreshPreview();
        draw();
      });
      const entrySelect = h("select", { "aria-label": "Rust entry" }, [
        h("option", { value: "test", text: "#[tokio::test]", selected: state.settings.entry !== "main" }),
        h("option", { value: "main", text: "#[tokio::main]", selected: state.settings.entry === "main" }),
      ]);
      entrySelect.addEventListener("change", () =>
        guard(async () => {
          state = await ctx.call(MSG.RECORDER_SETTINGS, { patch: { entry: entrySelect.value } });
          await refreshPreview();
        }),
      );
      const exportNow = async (): Promise<ExportedFile> => ctx.call(MSG.RECORDER_EXPORT, { format, name: state.name, entry: state.settings.entry });
      root.replaceChildren(
        h(
          "div",
          { class: "bar" },
          h("span", { class: "status" }, h("i", { class: `dot${state.active ? " on" : ""}` }), state.active ? "Recording this tab" : "Not recording"),
          h("span", { class: "grow" }),
          toggle,
          h("button", { type: "button", text: "Clear", disabled: state.steps.length === 0 || state.active, onclick: () => guard(async () => { state = await ctx.call(MSG.RECORDER_CLEAR); editing = null; draw(); await refreshPreview(); }) }),
        ),
        h("label", { class: "sub" }, scrolls, " Record scrolling"),
        state.steps.length === 0
          ? h("p", { class: "empty", text: "No steps yet. Press Start recording, then use the page: clicks, typing, menus and keys become steps. Passwords and card numbers are never recorded." })
          : h("ol", { class: "steps" }, state.steps.map(stepItem)),
        h("h3", { text: "Export" }),
        h("div", { class: "bar" }, name, formatSelect, format === "devtools" ? null : entrySelect),
        h(
          "div",
          { class: "bar" },
          h("button", { type: "button", class: "primary", text: "Download", disabled: state.steps.length === 0, onclick: () => guard(async () => downloadFile(await exportNow())) }),
          h("button", { type: "button", text: "Copy", disabled: state.steps.length === 0, onclick: () => guard(async () => { await copyText((await exportNow()).text); }) }),
        ),
        h("pre", { "data-preview": "" }, previewText),
      );
    }

    ctx.onChange("recorder", () => void refresh());
    draw();
    void refresh();
  },
});
