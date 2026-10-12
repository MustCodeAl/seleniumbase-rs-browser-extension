// Checks the built extensions: our own manifest rules on both, then `web-ext lint`
// (the linter Mozilla runs on add-ons) on dist/firefox. It is not run on dist/chrome:
// it holds every manifest to Firefox's rules, and a Chrome manifest correctly has a
// service_worker, no add-on id and the sidePanel permission. Run after `bun run build`.
//
// The allow lists below are deliberate: a feature that needs a permission adds
// it here, on purpose, and says why in the README.

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const WEB_EXT = "web-ext@10.7.0";

const ALLOWED_PERMISSIONS = new Set(["activeTab", "scripting", "storage", "sidePanel"]);
const ALLOWED_OPTIONAL_HOSTS = new Set(["<all_urls>"]);

const problems: string[] = [];
const problem = (text: string) => problems.push(text);

for (const target of ["chrome", "firefox"]) {
  const file = join(ROOT, "dist", target, "manifest.json");
  if (!existsSync(file)) {
    problem(`${target}: dist/${target}/manifest.json is missing; run bun run build`);
    continue;
  }
  const m = JSON.parse(readFileSync(file, "utf8"));
  for (const p of m.permissions ?? []) if (!ALLOWED_PERMISSIONS.has(p)) problem(`${target}: permission ${p} is not in the allow list`);
  for (const p of m.optional_permissions ?? []) if (!ALLOWED_PERMISSIONS.has(p)) problem(`${target}: optional permission ${p} is not in the allow list`);
  for (const p of m.optional_host_permissions ?? []) if (!ALLOWED_OPTIONAL_HOSTS.has(p)) problem(`${target}: optional host permission ${p} is not in the allow list`);
  if (m.host_permissions?.length) problem(`${target}: static host_permissions ${JSON.stringify(m.host_permissions)}`);
  if (m.content_scripts?.length) problem(`${target}: content_scripts are declared; inject on demand instead`);
  for (const r of m.web_accessible_resources ?? []) {
    if (JSON.stringify(r).includes("<all_urls>")) problem(`${target}: web_accessible_resources open to every site`);
  }
  const csp = m.content_security_policy?.extension_pages ?? "";
  if (!csp.includes("script-src 'self'")) problem(`${target}: extension CSP does not pin script-src to 'self'`);
  if (/unsafe-|wasm-unsafe-eval|https?:/.test(csp)) problem(`${target}: extension CSP is not strict: ${csp}`);
}

if (problems.length > 0) {
  console.error(problems.map((p) => `lint: ${p}`).join("\n"));
  process.exit(1);
}
console.log("manifest rules: ok");

let failed = false;
for (const target of ["firefox"]) {
  // `bun x` through the running bun, not a `bunx` found on PATH.
  const run = Bun.spawnSync([process.execPath, "x", WEB_EXT, "lint", "--source-dir", join(ROOT, "dist", target), "--self-hosted", "--warnings-as-errors"], {
    cwd: ROOT,
    stdout: "inherit",
    stderr: "inherit",
  });
  console.log(`web-ext lint ${target}: exit ${run.exitCode}`);
  if (run.exitCode !== 0) failed = true;
}
process.exit(failed ? 1 : 0);
