/* assert_lite.js — assertion tối giản, output rõ PASS/FAIL từng case. */
"use strict";

let passed = 0;
let failed = 0;
const failures = [];
let currentSuite = "";

function suite(name) { currentSuite = name; console.log("\n=== " + name + " ==="); }

function ok(cond, name, detail) {
    if (cond) { passed++; console.log("  [PASS] " + name); }
    else { failed++; failures.push(currentSuite + " :: " + name + (detail ? " :: " + detail : "")); console.log("  [FAIL] " + name + (detail ? "\n         " + detail : "")); }
}

function eq(actual, expected, name) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    ok(a === e, name, a === e ? "" : ("expected=" + e + " actual=" + a));
}

function summary() {
    console.log("\n----------------------------------------");
    console.log("PASSED: " + passed + "  FAILED: " + failed);
    if (failures.length) {
        console.log("\nFailures:");
        failures.forEach((f) => console.log("  - " + f));
    }
    return failed === 0;
}

module.exports = { suite, ok, eq, summary, stats: () => ({ passed, failed }) };
