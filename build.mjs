import * as esbuild from "esbuild";
import { cpSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { writeIcons } from "./scripts/icons.mjs";

const watch = process.argv.includes("--watch");
const testOnly = process.argv.includes("--test");

if (testOnly) {
  rmSync("dist-test", { recursive: true, force: true });
  const entryPoints = readdirSync("test")
    .filter((name) => name.endsWith(".test.ts"))
    .map((name) => `test/${name}`);
  await esbuild.build({
    entryPoints,
    outdir: "dist-test",
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
  });
  const result = spawnSync(process.execPath, ["--test", ...entryPoints.map((entry) => entry.replace(/^test\//, "dist-test/").replace(/\.ts$/, ".js"))], {
    stdio: "inherit",
  });
  process.exit(result.status ?? 1);
}

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });
cpSync("public", "dist", { recursive: true });
writeIcons("dist/icons");

const shared = {
  bundle: true,
  sourcemap: true,
  target: "chrome120",
  platform: "browser",
  legalComments: "eof",
  logLevel: "info",
};

const entries = [
  { ...shared, entryPoints: ["src/background/index.ts"], outfile: "dist/background.js", format: "esm" },
  { ...shared, entryPoints: ["src/content/content.ts"], outfile: "dist/content.js", format: "iife" },
  { ...shared, entryPoints: ["src/injected/hook.ts"], outfile: "dist/injected.js", format: "iife" },
  { ...shared, entryPoints: ["src/offscreen/index.ts"], outfile: "dist/offscreen.js", format: "iife" },
];

if (watch) {
  const contexts = await Promise.all(entries.map((entry) => esbuild.context(entry)));
  await Promise.all(contexts.map((context) => context.watch()));
} else {
  await Promise.all(entries.map((entry) => esbuild.build(entry)));
}
