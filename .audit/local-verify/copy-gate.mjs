#!/usr/bin/env node
/**
 * User-visible copy gate.
 *
 * Rule: scan only product source under apps/web/components, skip tests and
 * __tests__ directories, and mask every TypeScript/JavaScript comment before
 * matching. Comments are developer documentation, not product copy; JSX text
 * and string/template literals are where user-visible copy lives.
 *
 * Run from the repo root:
 *   node .audit/local-verify/copy-gate.mjs
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import ts from "typescript";

const ROOT = process.cwd();
// `COPY_GATE_TARGET` exists so the gate itself can be exercised against a
// negative-control fixture without touching product source.
const TARGET = process.env.COPY_GATE_TARGET
  ? resolve(ROOT, process.env.COPY_GATE_TARGET)
  : join(ROOT, "apps/web/components");
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);

const PATTERNS = [
  { name: "写入 `...` prose", re: /写入\s*`/g },
  { name: "POST /v1 in user copy", re: /\bPOST\s+\/v1\b/g },
  { name: "PATCH /v1 in user copy", re: /\bPATCH\s+\/v1\b/g },
  { name: "future integration copy", re: /接入写接口|后续接入/g },
  { name: "provider left empty", re: /provider\s*留空/g },
  { name: "minor units", re: /minor\s+units/gi },
  { name: "soft delete jargon", re: /软删除/g },
  { name: "token jargon", re: /令牌/g },
  { name: "TOKEN / ONE TIME badge", re: /TOKEN\s*\/\s*ONE\s*TIME/gi },
  { name: "server response jargon", re: /服务器返回的/g },
  { name: "physical delete jargon", re: /物理清除/g },
];

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "__tests__" || entry === "__mocks__" || entry === "node_modules") continue;
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      files.push(...walk(path));
      continue;
    }
    if (!SOURCE_EXTENSIONS.has(path.slice(path.lastIndexOf(".")))) continue;
    if (/\.(test|spec|stories)\.[cm]?[jt]sx?$/.test(entry)) continue;
    files.push(path);
  }
  return files;
}

/**
 * Replace comment characters with spaces while preserving every newline, so
 * line numbers still point at the original file. The parser (not a regex)
 * decides what is a comment, which keeps `//` inside JSX text intact.
 */
function maskComments(source, fileName) {
  const kind = fileName.endsWith(".tsx")
    ? ts.ScriptKind.TSX
    : fileName.endsWith(".jsx")
      ? ts.ScriptKind.JSX
      : fileName.endsWith(".js")
        ? ts.ScriptKind.JS
        : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
  const ranges = [];

  function collect(rangesForNode) {
    for (const range of rangesForNode ?? []) ranges.push([range.pos, range.end]);
  }

  function visit(node) {
    collect(ts.getLeadingCommentRanges(source, node.pos));
    collect(ts.getTrailingCommentRanges(source, node.end));
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  const chars = [...source];
  for (const [start, end] of ranges) {
    for (let index = start; index < end; index += 1) {
      if (chars[index] !== "\n" && chars[index] !== "\r") chars[index] = " ";
    }
  }
  return chars.join("");
}

function lineAt(source, index) {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (source[cursor] === "\n") line += 1;
  }
  return line;
}

function readWorkflowDefault(source, key, kind) {
  if (kind === "yaml") {
    return source.match(new RegExp(`^\\s*${key}:\\s*(\\S+)\\s*$`, "m"))?.[1];
  }
  if (kind === "docker-build-arg") {
    return source.match(
      new RegExp(`${key}=\\$\\{\\{\\s*vars\\.${key}\\s*\\|\\|\\s*'([^']+)'\\s*\\}\\}`),
    )?.[1];
  }
  return source.match(new RegExp(`^${key}=(\\S+)\\s*$`, "m"))?.[1];
}

function checkWorkflowDefaults() {
  const ci = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8");
  const release = readFileSync(join(ROOT, ".github/workflows/release.yml"), "utf8");
  const example = readFileSync(join(ROOT, ".env.example"), "utf8");
  const keys = ["NEXT_PUBLIC_MAP_STYLE_URL", "NEXT_PUBLIC_GEOCODER_URL"];
  const errors = [];

  for (const key of keys) {
    const values = {
      "ci.yml": readWorkflowDefault(ci, key, "yaml"),
      "release.yml": readWorkflowDefault(release, key, "docker-build-arg"),
      ".env.example": readWorkflowDefault(example, key, "dotenv"),
    };
    const distinct = new Set(Object.values(values).filter(Boolean));
    if (distinct.size !== 1 || Object.values(values).some((value) => !value)) {
      errors.push(
        `${key} drift: ${Object.entries(values)
          .map(([file, value]) => `${file}=${value ?? "(missing)"}`)
          .join(", ")}`,
      );
    }
  }

  if (errors.length > 0) {
    console.error("copy-gate: workflow map defaults are not aligned");
    for (const error of errors) console.error(`  ${error}`);
    return false;
  }
  console.log(
    "copy-gate: workflow defaults PASS (ci.yml = release.yml = .env.example, OpenFreeMap Liberty + Photon)",
  );
  return true;
}

if (!statSync(TARGET, { throwIfNoEntry: false })) {
  console.error(`copy-gate: target not found: ${TARGET}`);
  process.exit(1);
}

const files = walk(TARGET);
const hits = [];

for (const file of files) {
  const source = readFileSync(file, "utf8");
  const masked = maskComments(source, file);
  for (const pattern of PATTERNS) {
    pattern.re.lastIndex = 0;
    for (const match of masked.matchAll(pattern.re)) {
      const index = match.index ?? 0;
      const snippet = source
        .slice(Math.max(0, index - 20), Math.min(source.length, index + 160))
        .replace(/\s+/g, " ")
        .trim();
      hits.push(`${relative(ROOT, file)}:${lineAt(source, index)}: ${pattern.name} — ${snippet}`);
    }
  }
}

const defaultsOk = process.env.COPY_GATE_TARGET ? true : checkWorkflowDefaults();
console.log(
  `copy-gate: scanned ${files.length} user-visible source files (tests and comments excluded)`,
);

if (hits.length > 0 || !defaultsOk) {
  console.error(`copy-gate: ${hits.length} developer-copy hit(s)`);
  for (const hit of hits) console.error(hit);
  process.exit(1);
}

console.log(`copy-gate: PASS (0 hits across ${PATTERNS.length} rules, defaults aligned)`);
