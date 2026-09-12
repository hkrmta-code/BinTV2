#!/usr/bin/env node
/* run_all.js — chạy toàn bộ suite mock-E2E của BinTV-Fixed.
 * Exit code 0 khi TẤT CẢ suite pass. */
"use strict";
const { spawnSync } = require("child_process");
const path = require("path");

const suites = [
    ["T1 app.js logic (hàm THẬT + mock API)", "node", ["test_app_js_logic.js"]],
    ["T2 m3u8 rewrite (port 1:1 PhimLocalServer.swift)", "node", ["test_m3u8_rewrite.js"]],
    ["T3 E2E proxy chain (mock CDN + mirror proxy + app.js thật)", "node", ["test_proxy_chain_e2e.js"]],
    ["T4 project consistency (pbxproj/plist/fixes/JS assets)", "python3", ["test_project_consistency.py"]],
];

let allOk = true;
const results = [];
for (const [label, cmd, args] of suites) {
    console.log("\n############################################################");
    console.log("# " + label);
    console.log("############################################################");
    const r = spawnSync(cmd, args, { cwd: __dirname, stdio: "inherit" });
    const ok = r.status === 0;
    results.push([label, ok]);
    if (!ok) allOk = false;
}

console.log("\n=================== TỔNG KẾT ===================");
for (const [label, ok] of results) {
    console.log((ok ? "  [PASS] " : "  [FAIL] ") + label);
}
console.log(allOk ? "\nALL SUITES PASSED" : "\nSOME SUITES FAILED");
process.exit(allOk ? 0 : 1);
