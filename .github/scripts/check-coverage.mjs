#!/usr/bin/env node
// check-coverage.mjs — gate Node script coverage at 100% per AGENTS.md.
//
// Reads an lcov file (produced by `node --test --experimental-test-coverage
// --test-reporter=lcov`) and verifies each script in REQUIRED has literal
// 100% line / branch / function coverage. Fails on:
//   - any script in REQUIRED below 100% on any axis
//   - any .mjs in plugins/ievo/scripts/ that is neither REQUIRED nor in the
//     explicit CARVE_OUTS allow-list (= a new script landed without tests)
//
// CARVE_OUTS is intentionally small and version-gated. Adding to it is a
// deliberate ledger update, not a default.
//
// Usage:
//   node .github/scripts/check-coverage.mjs <path-to-coverage.lcov>
//
// Lives outside plugins/ievo/scripts/, so the 100% rule does not apply to
// itself — the workflow exercises it on real data, which is the verification.

import { readFileSync, readdirSync } from "node:fs";
import { resolve, basename } from "node:path";

const SCRIPTS_DIR = "plugins/ievo/scripts";

// Scripts that MUST hit 100% line / branch / function on every run.
const REQUIRED = new Set([
  "discover.mjs",
  "validate_agents.mjs",
]);

// Carve-outs: pre-existing scripts grandfathered against the rule with a
// pinned target version for tests-to-land. Anything else under SCRIPTS_DIR
// that is neither REQUIRED nor here triggers a "new untested script" failure.
const CARVE_OUTS = new Map([
  ["scan_repo.mjs", "tests pending — must land by v0.6.7 (HARD STOP — 5th roll, see AGENTS.md ledger)"],
]);

function parseLcov(text) {
  // lcov record: starts with "SF:<path>", ends with "end_of_record".
  // Inside: FNF/FNH (funcs), BRF/BRH (branches), LF/LH (lines).
  //
  // Stores records keyed by FULL SF path (not basename) so two scripts sharing
  // a basename in different subdirs don't silently overwrite each other. The
  // basename lookup happens at REQUIRED-resolution time in main(), where
  // collisions become a loud error instead of a silent last-record-wins.
  const records = new Map();
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("SF:")) {
      current = { sf: line.slice(3), fnf: 0, fnh: 0, brf: 0, brh: 0, lf: 0, lh: 0 };
    } else if (line === "end_of_record") {
      if (current) {
        records.set(current.sf, current);
        current = null;
      }
    } else if (current) {
      const m = line.match(/^(FNF|FNH|BRF|BRH|LF|LH):(\d+)$/);
      if (m) current[m[1].toLowerCase()] = parseInt(m[2], 10);
    }
  }
  return records;
}

function findRequiredRecord(records, name) {
  // Find lcov records whose source-file basename matches `name`. Returns:
  //   { record: <r> } when exactly one match
  //   { error: <string> } when zero or 2+ matches (collision is loud)
  const matches = [...records.entries()].filter(([sf]) => basename(sf) === name);
  if (matches.length === 0) {
    return { error: `${name}: no coverage record in lcov — was the test file run?` };
  }
  if (matches.length > 1) {
    const paths = matches.map(([sf]) => sf).join(", ");
    // Note: REQUIRED holds basenames and `findRequiredRecord` matches by basename;
    // suggesting "use the full path in REQUIRED" wouldn't work without a separate
    // exact-path code path. Stick to the actionable remediation.
    return { error: `${name}: basename collision in lcov — multiple records share this basename: ${paths}. Rename one of the scripts (e.g. ${name.replace(/\.mjs$/, "")}_<context>.mjs) so each REQUIRED basename resolves uniquely.` };
  }
  return { record: matches[0][1] };
}

function checkRecord(name, r) {
  // 100% on all three axes. lcov reports 0/0 as "no instrumentation" — treat
  // as a failure since every real script has at least one line and function.
  if (r.lf === 0 || r.fnf === 0) {
    return [`${name}: empty coverage record (lf=${r.lf}, fnf=${r.fnf}) — likely not exercised by any test`];
  }
  const errs = [];
  if (r.lh !== r.lf) errs.push(`lines ${r.lh}/${r.lf} (${((r.lh / r.lf) * 100).toFixed(2)}%)`);
  if (r.brh !== r.brf) errs.push(`branches ${r.brh}/${r.brf} (${((r.brh / r.brf) * 100).toFixed(2)}%)`);
  if (r.fnh !== r.fnf) errs.push(`functions ${r.fnh}/${r.fnf} (${((r.fnh / r.fnf) * 100).toFixed(2)}%)`);
  return errs.length ? [`${name}: ${errs.join(", ")} — must be 100/100/100`] : [];
}

function findScripts() {
  return readdirSync(SCRIPTS_DIR)
    .filter((f) => f.endsWith(".mjs"))
    .sort();
}

function main(argv) {
  const lcovPath = argv[2];
  if (!lcovPath) {
    console.error("Usage: check-coverage.mjs <lcov-file>");
    process.exit(2);
  }
  const text = readFileSync(resolve(lcovPath), "utf-8");
  const records = parseLcov(text);
  const errors = [];

  // (1) Every REQUIRED script must be present in the lcov AND hit 100/100/100.
  // Collisions on basename are loud errors, not silent last-wins.
  const resolved = new Map();
  for (const name of REQUIRED) {
    const result = findRequiredRecord(records, name);
    if (result.error) {
      errors.push(result.error);
      continue;
    }
    resolved.set(name, result.record);
    errors.push(...checkRecord(name, result.record));
  }

  // (2) Every .mjs in SCRIPTS_DIR must be REQUIRED, in CARVE_OUTS, or fail.
  const orphans = [];
  for (const f of findScripts()) {
    if (REQUIRED.has(f) || CARVE_OUTS.has(f)) continue;
    orphans.push(f);
  }
  if (orphans.length) {
    errors.push(
      `untracked scripts in ${SCRIPTS_DIR}/: ${orphans.join(", ")} — add to REQUIRED with tests, or to CARVE_OUTS with a pinned target version + ledger entry`,
    );
  }

  // (3) Report carve-outs visibly so they don't get forgotten.
  if (CARVE_OUTS.size > 0) {
    console.log("Carve-outs (tests pending):");
    for (const [name, reason] of CARVE_OUTS) {
      console.log(`  - ${name}: ${reason}`);
    }
    console.log("");
  }

  if (errors.length) {
    console.error("Coverage gate FAILED:");
    for (const e of errors) console.error(`  ✗ ${e}`);
    process.exit(1);
  }

  console.log("Coverage gate OK:");
  for (const name of REQUIRED) {
    const r = resolved.get(name);
    console.log(`  ✓ ${name}: lines ${r.lh}/${r.lf}, branches ${r.brh}/${r.brf}, functions ${r.fnh}/${r.fnf} — 100/100/100`);
  }
}

main(process.argv);
