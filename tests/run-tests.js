#!/usr/bin/env node
// =============================================================================
// run-tests.js
// FayZul regression test runner.
//
// Run from the project root:
//   node tests/run-tests.js              build the compiler, then run all tests
//   node tests/run-tests.js --no-build   use the existing build/fayzul.exe
//   node tests/run-tests.js loops        run only tests whose path contains "loops"
//
// Test layout (tests/cases/**):
//   name.fz    FayZul program
//   name.out   expected program stdout (exact match, CRLF normalized)
//              -> compiler must exit 0 and the program's output must match
//   name.err   one expected substring per non-empty line
//              -> compiler must exit non-zero and print every substring
//
// Every examples/*.fz file is also compiled and run as a smoke test
// (must exit 0).
//
// Each test runs in its own temporary working directory, so the compiler's
// build/ outputs never touch the project tree.
// =============================================================================

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const CASES_DIR = path.join(__dirname, "cases");
const EXAMPLES_DIR = path.join(ROOT, "examples");
const COMPILER = path.join(ROOT, "build", "fayzul.exe");

// The compiler prints this line immediately before running the program.
const RUN_MARKER = "Running...\n\n";

function normalize(text) {
    return text.replace(/\r\n/g, "\n");
}

function findFiles(dir, ext) {
    if (!fs.existsSync(dir)) return [];
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...findFiles(full, ext));
        else if (entry.name.endsWith(ext)) out.push(full);
    }
    return out.sort();
}

function buildCompiler() {
    const sources = fs.readdirSync(path.join(ROOT, "src"))
        .filter((f) => f.endsWith(".cpp"))
        .map((f) => path.join("src", f));
    const args = ["-std=c++17", "-Wall", "-Wextra", "-o", path.join("build", "fayzul.exe"), ...sources];
    console.log("Building compiler: g++ " + args.join(" "));
    fs.mkdirSync(path.join(ROOT, "build"), { recursive: true });
    const res = spawnSync("g++", args, { cwd: ROOT, encoding: "utf8" });
    const diag = (res.stdout || "") + (res.stderr || "");
    if (diag.trim()) console.log(diag);
    if (res.status !== 0) {
        console.error("Compiler build failed.");
        process.exit(1);
    }
}

function runCompiler(fzPath) {
    return new Promise((resolve) => {
        const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "fayzul-test-"));
        const child = spawn(COMPILER, [fzPath], { cwd: workDir });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (d) => (stdout += d));
        child.stderr.on("data", (d) => (stderr += d));
        child.on("close", (code) => {
            fs.rmSync(workDir, { recursive: true, force: true });
            resolve({ code, stdout: normalize(stdout), stderr: normalize(stderr) });
        });
    });
}

function programOutput(stdout) {
    const idx = stdout.indexOf(RUN_MARKER);
    return idx < 0 ? null : stdout.slice(idx + RUN_MARKER.length);
}

async function runTest(test) {
    const res = await runCompiler(test.fz);
    const all = res.stdout + res.stderr;
    const failures = [];

    if (test.kind === "out") {
        const expected = normalize(fs.readFileSync(test.expectFile, "utf8"));
        const actual = programOutput(res.stdout);
        if (res.code !== 0) failures.push(`expected exit 0, got ${res.code}`);
        if (actual === null) failures.push("program was not run (no run marker in compiler output)");
        else if (actual !== expected) {
            failures.push("output mismatch\n--- expected ---\n" + expected + "--- actual ---\n" + actual);
        }
    } else if (test.kind === "err") {
        const wanted = normalize(fs.readFileSync(test.expectFile, "utf8"))
            .split("\n").map((l) => l.trim()).filter(Boolean);
        if (res.code === 0) failures.push("expected a compile error, but the compiler exited 0");
        for (const w of wanted) {
            if (!all.includes(w)) failures.push(`missing expected text: ${w}`);
        }
    } else {
        if (res.code !== 0) failures.push(`expected exit 0, got ${res.code}`);
    }

    if (failures.length && test.kind !== "out") {
        failures.push("--- compiler output ---\n" + (res.stderr || res.stdout).trim());
    }
    return failures;
}

function collectTests(filter) {
    const tests = [];
    for (const fz of findFiles(CASES_DIR, ".fz")) {
        const base = fz.slice(0, -3);
        const name = path.relative(CASES_DIR, fz).replace(/\\/g, "/");
        if (fs.existsSync(base + ".out")) tests.push({ name, fz, kind: "out", expectFile: base + ".out" });
        else if (fs.existsSync(base + ".err")) tests.push({ name, fz, kind: "err", expectFile: base + ".err" });
        else tests.push({ name, fz, kind: "missing" });
    }
    for (const fz of findFiles(EXAMPLES_DIR, ".fz")) {
        tests.push({ name: "examples/" + path.basename(fz), fz, kind: "smoke" });
    }
    return filter ? tests.filter((t) => t.name.includes(filter)) : tests;
}

async function main() {
    const args = process.argv.slice(2);
    const noBuild = args.includes("--no-build");
    const filter = args.find((a) => !a.startsWith("--"));

    if (!noBuild) buildCompiler();
    if (!fs.existsSync(COMPILER)) {
        console.error("Compiler not found: " + COMPILER);
        process.exit(1);
    }

    const tests = collectTests(filter);
    const results = new Array(tests.length);
    const concurrency = Math.max(1, Math.min(6, os.cpus().length));
    let next = 0;

    async function worker() {
        while (next < tests.length) {
            const i = next++;
            const t = tests[i];
            results[i] = t.kind === "missing"
                ? ["no .out or .err file next to the test"]
                : await runTest(t);
        }
    }
    await Promise.all(Array.from({ length: concurrency }, worker));

    let failed = 0;
    tests.forEach((t, i) => {
        const f = results[i];
        if (f.length === 0) {
            console.log(`PASS  ${t.name}`);
        } else {
            failed++;
            console.log(`FAIL  ${t.name}`);
            for (const msg of f) console.log("      " + msg.replace(/\n/g, "\n      "));
        }
    });

    console.log(`\n${tests.length - failed} passed, ${failed} failed, ${tests.length} total`);
    process.exit(failed ? 1 : 0);
}

main();
