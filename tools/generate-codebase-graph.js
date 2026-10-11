#!/usr/bin/env node
// =============================================================================
// generate-codebase-graph.js
//
// Builds a dependency graph of the FayZul repository from its source code.
//
// Writes:
//   docs/CODEBASE_GRAPH.json   machine-readable dependency graph
//   docs/CODEBASE_GRAPH.html   interactive viewer (graph data inlined, no CDN)
//   docs/CODEBASE_GRAPH.md     architecture documentation
//
// HOW RELATIONSHIPS ARE FOUND:
//   Sources are lexed (comments and string contents blanked, positions kept)
//   and scanned for declarations, #include / require(), calls, constructions,
//   casts, enum and macro uses, file I/O, and test expectations. Every edge
//   carries evidence: the file, line, and source text it was read from.
//
//   The only hand-written facts are LAYERS (which part of the project a path
//   belongs to) and PIPELINE_STEPS (the order of compiler stages). Each
//   pipeline step must match a regex in its evidence file, or it is dropped
//   with a warning.
//
// Run from the project root:
//   node tools/generate-codebase-graph.js               regenerate the three files
//   node tools/generate-codebase-graph.js --check       exit 1 if they are stale or invalid
//   node tools/generate-codebase-graph.js --verify-gcc  also compare C++ call edges with
//                                                       g++ -fcallgraph-info (needs g++)
// =============================================================================

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const OUT_JSON = path.join(ROOT, "docs", "CODEBASE_GRAPH.json");
const OUT_HTML = path.join(ROOT, "docs", "CODEBASE_GRAPH.html");
const OUT_MD = path.join(ROOT, "docs", "CODEBASE_GRAPH.md");
const OUTPUT_FILES = new Set([OUT_JSON, OUT_HTML, OUT_MD].map((p) => rel(p)));
const GENERATOR = rel(__filename);
const SCHEMA_VERSION = 1;
const SOURCE_REF = "main";   // branch used for GitHub source links

// Directories that are never analyzed, with the reason recorded in the output.
const SKIP_DIRS = {
    ".git": "version-control metadata",
    "node_modules": "dependency directory",
    "build": "compiler build outputs (binaries and generated C++)",
};

// -----------------------------------------------------------------------------
// Layers: the only hand-written classification. Order = left-to-right columns
// in the viewer; the numbered layers are the compiler pipeline.
// -----------------------------------------------------------------------------
const LAYERS = [
    { id: "language", title: "Language definition", match: [/^language\//],
      description: "The single source of truth for FayZul words: keywords, word operators, arithmetic symbols." },
    { id: "tooling", title: "Generation tools", match: [/^tools\//],
      description: "Node.js scripts that generate headers, the TextMate grammar, and this graph." },
    { id: "vocabulary", title: "Generated vocabulary", match: [/^src\/(keywords|operators)\.h$/],
      description: "C++ macro headers generated from the language definition (do not edit by hand)." },
    { id: "lexer", title: "1 · Lexing", match: [/^src\/(token|lexer)\.(h|cpp)$/],
      description: "Characters to tokens (TokenType, Token, Lexer)." },
    { id: "parser", title: "2 · Parsing & AST", match: [/^src\/(ast|parser)\.(h|cpp)$/],
      description: "Tokens to the abstract syntax tree (recursive descent)." },
    { id: "semantic", title: "3 · Semantic analysis", match: [/^src\/semantic\.(h|cpp)$/],
      description: "Scope, loop, function, and return checks on the AST." },
    { id: "codegen", title: "4 · C++ generation", match: [/^src\/codegen\.(h|cpp)$/],
      description: "AST to C++17 source text plus a C++-line to FayZul-line map." },
    { id: "driver", title: "5 · Compiler driver", match: [/^src\/main\.cpp$/],
      description: "CLI entry point: runs every stage, invokes g++, runs the program, maps g++ errors." },
    { id: "build", title: "6 · Build & execution", match: [/^build\//],
      description: "Files and processes produced at compile and run time." },
    { id: "programs", title: "FayZul programs", match: [/^examples\//],
      description: "Example .fz programs (also run as smoke tests)." },
    { id: "tests", title: "Regression tests", match: [/^tests\//],
      description: "Test runner and .fz cases with expected output (.out) or errors (.err)." },
    { id: "editor", title: "VS Code extension", match: [/^vscode-extension\//, /^\.vscode\//],
      description: "Syntax highlighting, completion, and hover for .fz files." },
    { id: "docs", title: "Docs & project files", match: [/^docs\//, /\.md$/, /^\.gitignore$/],
      description: "Documentation and repository configuration." },
    { id: "external", title: "External", match: [],
      description: "Standard library headers, Node.js modules, the VS Code API, and g++." },
];
const LAYER_INDEX = new Map(LAYERS.map((l, i) => [l.id, i]));

const NODE_KINDS = {
    "file": "Source, data, or documentation file",
    "directory": "Directory referenced by code",
    "class": "C++ class",
    "struct": "C++ struct",
    "enum": "C++ enum class",
    "type-alias": "C++ using-alias",
    "function": "Free function (C++ or JavaScript)",
    "method": "C++ member function, or a JavaScript callback in an object literal",
    "macro": "Preprocessor macro",
    "json-section": "Top-level section of a JSON data file",
    "language-term": "FayZul word or symbol from the language definition",
    "test-suite": "Directory of regression test cases",
    "test-case": "One .fz test with its .out or .err expectation",
    "fz-program": "Example FayZul program",
    "artifact": "File produced or consumed at build or run time (not analyzed)",
    "data": "In-memory value passed between compiler stages",
    "tool": "External program invoked by the code",
    "external": "External library, module, or host",
};

const EDGE_KINDS = {
    "pipeline": "Compiler pipeline step (verified against src/main.cpp)",
    "dataflow": "A value returned by one call is passed into another component",
    "calls": "Function or method call, resolved statically",
    "includes": "C++ #include",
    "requires": "Node.js require()",
    "inherits": "Struct or class base",
    "instantiates": "Declares a local object of a class",
    "creates": "Constructs a struct (make_unique, constructor call, or brace init)",
    "casts": "static_cast to a type (AST node dispatch)",
    "has-field": "Struct or class field of that type",
    "aliases": "Type alias target",
    "member": "Class declares this method",
    "uses-enum": "References enumerators of an enum",
    "uses-macro": "Uses a generated FZ_* macro",
    "maps-to": "Keyword table maps a macro to a TokenType",
    "generates": "Language term is emitted as a macro by the generator",
    "reads": "Reads a file or directory",
    "writes": "Writes a file or directory",
    "executes": "Spawns a process",
    "references": "Mentions a path (manifest entry, markdown link, path argument)",
    "uses-api": "Calls an external module API",
    "registers": "Registers a callback with an API",
    "invokes": "An external host calls into this code",
    "raises": "Throws a diagnostic (std::runtime_error)",
    "reports": "Prints diagnostics to stderr",
    "expects-error": "Test expects an error formatted or raised by this function",
};

// -----------------------------------------------------------------------------
// Compiler pipeline: the order of stages in src/main.cpp. Each step is kept
// only if every evidence regex matches the file; otherwise it is reported.
// Node ids refer to nodes extracted from the code (or the data/artifact nodes
// declared in PIPELINE_NODES).
// -----------------------------------------------------------------------------
const PIPELINE_NODES = [
    { id: "artifact:*.fz", kind: "artifact", name: "FayZul source (*.fz)", layer: "programs",
      meta: { description: "Input program passed as argv[1]" } },
    { id: "data:tokens", kind: "data", name: "Token stream", layer: "lexer",
      meta: { type: "std::vector<Token>" } },
    { id: "data:cpp-source", kind: "data", name: "Generated C++17 text", layer: "codegen",
      meta: { type: "std::string" } },
    { id: "artifact:build/<name>.cpp", kind: "artifact", name: "build/<name>.cpp", layer: "build",
      meta: { description: "Generated C++ written next to the current directory" } },
    { id: "tool:g++", kind: "tool", name: "g++", layer: "build",
      meta: { description: "GNU C++ compiler" } },
    { id: "artifact:build/<name>.exe", kind: "artifact", name: "build/<name>.exe", layer: "build",
      meta: { description: "Native executable compiled from the generated C++" } },
    { id: "artifact:build/<name>.gpp.log", kind: "artifact", name: "build/<name>.gpp.log", layer: "build",
      meta: { description: "g++ stderr; kept only when compilation fails" } },
    { id: "data:program-output", kind: "data", name: "Program output", layer: "build",
      meta: { description: "stdout of the compiled FayZul program" } },
    { id: "data:diagnostics", kind: "data", name: "Compiler diagnostics (stderr)", layer: "driver",
      meta: { description: "Lexer, parser, semantic, codegen, and mapped C++ errors" } },
];

const MAIN = "src/main.cpp";
const PIPELINE_STEPS = [
    { from: "artifact:*.fz", to: "fn:src/main.cpp#readFile", label: "read argv[1]",
      evidence: [[MAIN, /std::string sourcePath = argv\[1\];/], [MAIN, /source = readFile\(sourcePath\);/]] },
    { from: "fn:src/main.cpp#readFile", to: "method:Lexer::Lexer", label: "source text",
      evidence: [[MAIN, /Lexer lexer\(source\);/]] },
    { from: "method:Lexer::Lexer", to: "method:Lexer::tokenize", label: "lexer.tokenize()",
      evidence: [[MAIN, /tokens = lexer\.tokenize\(\);/]] },
    { from: "method:Lexer::tokenize", to: "data:tokens", label: "returns",
      evidence: [[MAIN, /tokens = lexer\.tokenize\(\);/]] },
    { from: "data:tokens", to: "method:Parser::Parser", label: "std::move(tokens)",
      evidence: [[MAIN, /Parser parser\(std::move\(tokens\)\);/]] },
    { from: "method:Parser::Parser", to: "method:Parser::parse", label: "parser.parse()",
      evidence: [[MAIN, /ast = parser\.parse\(\);/]] },
    { from: "method:Parser::parse", to: "type:ProgramNode", label: "AST root",
      evidence: [[MAIN, /std::unique_ptr<ProgramNode> ast;/], [MAIN, /ast = parser\.parse\(\);/]] },
    { from: "type:ProgramNode", to: "method:SemanticAnalyzer::analyze", label: "check *ast",
      evidence: [[MAIN, /analyzer\.analyze\(\*ast\);/]] },
    { from: "method:SemanticAnalyzer::analyze", to: "method:CodeGenerator::generate", label: "no error thrown",
      evidence: [[MAIN, /analyzer\.analyze\(\*ast\);/], [MAIN, /cppSource = codegen\.generate\(\*ast\);/]] },
    { from: "type:ProgramNode", to: "method:CodeGenerator::generate", label: "lower *ast",
      evidence: [[MAIN, /cppSource = codegen\.generate\(\*ast\);/]] },
    { from: "method:CodeGenerator::generate", to: "data:cpp-source", label: "returns",
      evidence: [[MAIN, /cppSource = codegen\.generate\(\*ast\);/]] },
    { from: "data:cpp-source", to: "fn:src/main.cpp#writeFile", label: "cppSource",
      evidence: [[MAIN, /writeFile\(generatedCppPath, cppSource\);/]] },
    { from: "fn:src/main.cpp#writeFile", to: "artifact:build/<name>.cpp", label: "writes",
      evidence: [[MAIN, /generatedCppPath\s*=\s*\(buildDir \/ \(baseName \+ "\.cpp"\)\)/],
                 [MAIN, /writeFile\(generatedCppPath, cppSource\);/]] },
    { from: "artifact:build/<name>.cpp", to: "tool:g++", label: "g++ -std=c++17 -pedantic-errors",
      evidence: [[MAIN, /"g\+\+ -std=c\+\+17 -pedantic-errors/], [MAIN, /std::system\(\(compileCmd/]] },
    { from: "tool:g++", to: "artifact:build/<name>.exe", label: "-o",
      evidence: [[MAIN, /executablePathExe = \(buildDir \/ \(baseName \+ "\.exe"\)\)/]] },
    { from: "tool:g++", to: "artifact:build/<name>.gpp.log", label: "stderr (2>)",
      evidence: [[MAIN, /compileLogPath\s*=\s*\(buildDir \/ \(baseName \+ "\.gpp\.log"\)\)/],
                 [MAIN, /compileCmd \+ " 2> \\""/]] },
    { from: "artifact:build/<name>.gpp.log", to: "fn:src/main.cpp#reportCppErrors", label: "on compile failure",
      evidence: [[MAIN, /reportCppErrors\(compileLogPath,/]] },
    { from: "artifact:build/<name>.exe", to: "data:program-output", label: "std::system(runCmd)",
      evidence: [[MAIN, /int runResult = std::system\(runCmd\.c_str\(\)\);/]] },
];

// -----------------------------------------------------------------------------
// Small helpers
// -----------------------------------------------------------------------------
function rel(abs) {
    return path.relative(ROOT, abs).split(path.sep).join("/");
}

function layerOf(relPath) {
    for (const layer of LAYERS) {
        if (layer.match.some((re) => re.test(relPath))) return layer.id;
    }
    return "docs";
}

function sortedUnique(values) {
    return [...new Set(values)].sort();
}

// =============================================================================
// File discovery
// =============================================================================

// Minimal .gitignore support: plain names, "dir/" names, and "*" globs.
function loadIgnorePatterns() {
    const file = path.join(ROOT, ".gitignore");
    if (!fs.existsSync(file)) return [];
    return fs.readFileSync(file, "utf8").split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#") && !l.startsWith("!"))
        .map((l) => {
            const dirOnly = l.endsWith("/");
            const body = l.replace(/^\//, "").replace(/\/$/, "");
            const re = new RegExp("^" + body.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*") + "$");
            return { pattern: l, dirOnly, re, anchored: body.includes("/") };
        });
}

function isIgnored(relPath, isDir, patterns) {
    const base = relPath.split("/").pop();
    return patterns.find((p) => (!p.dirOnly || isDir) && (p.anchored ? p.re.test(relPath) : p.re.test(base)));
}

function discoverFiles() {
    const patterns = loadIgnorePatterns();
    const files = [];
    const excluded = [];

    function walk(dirAbs) {
        const entries = fs.readdirSync(dirAbs, { withFileTypes: true })
            .sort((a, b) => a.name.localeCompare(b.name));
        for (const entry of entries) {
            const abs = path.join(dirAbs, entry.name);
            const relPath = rel(abs);
            const isDir = entry.isDirectory();
            if (isDir && SKIP_DIRS[entry.name] !== undefined) {
                if (entry.name === "build") {
                    for (const f of fs.readdirSync(abs).sort()) {
                        const binary = isBinary(path.join(abs, f));
                        excluded.push({ path: relPath + "/" + f,
                                        reason: binary ? "binary" : "generated build output" });
                    }
                } else {
                    excluded.push({ path: relPath + "/", reason: SKIP_DIRS[entry.name] });
                }
                continue;
            }
            const ignored = isIgnored(relPath, isDir, patterns);
            if (ignored) {
                excluded.push({ path: relPath + (isDir ? "/" : ""), reason: "matches .gitignore '" + ignored.pattern + "'" });
                continue;
            }
            if (isDir) { walk(abs); continue; }
            if (OUTPUT_FILES.has(relPath)) continue;   // this generator's own outputs
            if (isBinary(abs)) { excluded.push({ path: relPath, reason: "binary" }); continue; }
            const raw = fs.readFileSync(abs, "utf8").replace(/\r\n/g, "\n");
            files.push(makeFile(relPath, raw));
        }
    }
    walk(ROOT);
    return { files, excluded };
}

function isBinary(abs) {
    const buf = fs.readFileSync(abs);
    return buf.subarray(0, 8000).includes(0);
}

function makeFile(relPath, raw) {
    const lines = raw.split("\n");
    const lineStarts = [0];
    for (let i = 0; i < raw.length; i++) if (raw[i] === "\n") lineStarts.push(i + 1);
    const ext = path.extname(relPath).toLowerCase();
    let lang = "text";
    if (ext === ".h" || ext === ".cpp") lang = "cpp";
    else if (ext === ".js") lang = "js";
    else if (ext === ".json") lang = "json";
    else if (ext === ".md") lang = "markdown";
    else if (ext === ".fz") lang = "fayzul";
    else if (ext === ".out" || ext === ".err") lang = "expectation";
    return { rel: relPath, raw, lines, lineStarts, ext, lang };
}

function lineOf(file, pos) {
    let lo = 0, hi = file.lineStarts.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (file.lineStarts[mid] <= pos) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
}

function evidence(file, line) {
    const text = (file.lines[line - 1] || "").trim();
    return { path: file.rel, line, text: text.length > 200 ? text.slice(0, 197) + "..." : text };
}

// =============================================================================
// Lexing: blank comments and literal contents (keeping offsets and newlines)
// so structural scans never match text inside strings or comments.
// =============================================================================
function unescapeChar(c) {
    return { n: "\n", t: "\t", r: "\r", 0: "\0" }[c] !== undefined ? { n: "\n", t: "\t", r: "\r", 0: "\0" }[c] : c;
}

function lexSource(raw, lang) {
    const out = raw.split("");
    const strings = [];
    const n = raw.length;
    const isJs = lang === "js";
    let i = 0;

    function blank(a, b) {
        for (let k = a; k < b; k++) if (out[k] !== "\n") out[k] = " ";
    }

    function regexAllowed() {
        let k = i - 1;
        while (k >= 0 && /\s/.test(out[k])) k--;
        if (k < 0) return true;
        const c = out[k];
        if (/[\w$]/.test(c)) {
            let s = k;
            while (s > 0 && /[\w$]/.test(out[s - 1])) s--;
            return /^(return|typeof|case|do|else|in|of|new|delete|void|throw|yield|await)$/.test(out.slice(s, k + 1).join(""));
        }
        return !/[)\]"'`]/.test(c);
    }

    function readQuoted(q) {
        const start = i++;
        let value = "";
        while (i < n && raw[i] !== q && raw[i] !== "\n") {
            if (raw[i] === "\\" && i + 1 < n) { value += unescapeChar(raw[i + 1]); i += 2; continue; }
            value += raw[i++];
        }
        const contentEnd = i;
        if (i < n && raw[i] === q) i++;
        blank(start + 1, contentEnd);
        strings.push({ start, end: i, value });
    }

    function readTemplate() {
        const start = i++;
        let seg = i;
        while (i < n && raw[i] !== "`") {
            if (raw[i] === "\\") { i += 2; continue; }
            if (raw[i] === "$" && raw[i + 1] === "{") {
                blank(seg, i);
                i += 2;
                lexCode(true);
                seg = i;
                continue;
            }
            i++;
        }
        blank(seg, Math.min(i, n));
        if (i < n) i++;
        strings.push({ start, end: i, value: null, template: true });
    }

    function readRegex() {
        const start = i;
        let k = i + 1;
        let inClass = false;
        while (k < n && raw[k] !== "\n") {
            const c = raw[k];
            if (c === "\\") { k += 2; continue; }
            if (c === "[") inClass = true;
            else if (c === "]") inClass = false;
            else if (c === "/" && !inClass) break;
            k++;
        }
        if (k >= n || raw[k] !== "/") { i++; return; }
        blank(start + 1, k);
        i = k + 1;
        while (i < n && /[a-z]/i.test(raw[i])) i++;
    }

    function lexCode(untilBrace) {
        let depth = 0;
        while (i < n) {
            const c = raw[i];
            const d = raw[i + 1];
            if (c === "/" && d === "/") {
                const s = i;
                while (i < n && raw[i] !== "\n") i++;
                blank(s, i);
                continue;
            }
            if (c === "/" && d === "*") {
                const s = i;
                const e = raw.indexOf("*/", i + 2);
                i = e < 0 ? n : e + 2;
                blank(s, i);
                continue;
            }
            if (c === "\"" || c === "'") { readQuoted(c); continue; }
            if (isJs && c === "`") { readTemplate(); continue; }
            if (isJs && c === "/" && regexAllowed()) { readRegex(); continue; }
            if (untilBrace) {
                if (c === "{") depth++;
                else if (c === "}") {
                    if (depth === 0) { i++; return; }
                    depth--;
                }
            }
            i++;
        }
    }

    lexCode(false);
    return { code: out.join(""), strings };
}

// Tokens over lexed code. String literals become single "str" tokens.
const TOKEN_RE = /([A-Za-z_$][\w$]*)|(\d[\w.]*)|(::|->|=>|===|!==|==|!=|<=|>=|&&|\|\||\+\+|--|\+=|-=|<<|>>|\.\.\.)|(\S)/y;

function tokenize(code, strings) {
    const strAt = new Map(strings.filter((s) => !s.template).map((s) => [s.start, s]));
    const toks = [];
    let i = 0;
    while (i < code.length) {
        const c = code[i];
        if (c === " " || c === "\n" || c === "\t" || c === "\r") { i++; continue; }
        const s = strAt.get(i);
        if (s) {
            toks.push({ v: s.value === null ? "`" : "\"", type: "str", value: s.value, pos: i, end: s.end });
            i = s.end;
            continue;
        }
        TOKEN_RE.lastIndex = i;
        const m = TOKEN_RE.exec(code);
        const v = m[0];
        toks.push({ v, type: m[1] ? "id" : m[2] ? "num" : "op", pos: i, end: i + v.length });
        i += v.length;
    }
    return toks;
}

function matchBrace(code, open) {
    const openC = code[open];
    const closeC = { "{": "}", "(": ")", "[": "]" }[openC];
    let depth = 0;
    for (let k = open; k < code.length; k++) {
        if (code[k] === openC) depth++;
        else if (code[k] === closeC && --depth === 0) return k;
    }
    return code.length - 1;
}

function matchToken(toks, open) {
    const openV = toks[open].v;
    const closeV = { "{": "}", "(": ")", "[": "]" }[openV];
    let depth = 0;
    for (let k = open; k < toks.length; k++) {
        if (toks[k].v === openV) depth++;
        else if (toks[k].v === closeV && --depth === 0) return k;
    }
    return toks.length - 1;
}

// Index after the '>' closing a template argument list that starts at toks[k]
// ('<'), or -1 if the tokens are not a plausible template argument list.
function skipTemplateArgs(toks, k) {
    let depth = 0;
    for (let j = k; j < toks.length && j < k + 40; j++) {
        const v = toks[j].v;
        if (v === "<") depth++;
        else if (v === ">") depth--;
        else if (v === ">>") depth -= 2;
        else if (!(toks[j].type === "id" || toks[j].type === "num" || ["::", ",", "*", "&"].includes(v))) return -1;
        if (depth === 0) return j + 1;
        if (depth < 0) return -1;
    }
    return -1;
}

// =============================================================================
// Graph container
// =============================================================================
class Graph {
    constructor() {
        this.nodes = new Map();
        this.edges = new Map();
        this.warnings = [];
    }

    node(id, props) {
        let n = this.nodes.get(id);
        if (!n) {
            n = { id, meta: {} };
            this.nodes.set(id, n);
        }
        for (const [k, v] of Object.entries(props || {})) {
            if (v === undefined) continue;
            if (k === "meta") Object.assign(n.meta, v);
            else n[k] = v;
        }
        return n;
    }

    has(id) {
        return this.nodes.has(id);
    }

    // Edges with the same source, target, kind (and optional key) are merged;
    // their details and evidence accumulate.
    edge(source, target, kind, opts = {}) {
        if (!EDGE_KINDS[kind]) throw new Error("Unknown edge kind: " + kind);
        const key = [source, target, kind, opts.key || ""].join("|");
        let e = this.edges.get(key);
        if (!e) {
            e = { source, target, kind, details: new Set(), evidence: [],
                  confidence: opts.confidence || "exact", key: opts.key };
            this.edges.set(key, e);
        }
        if (opts.detail) e.details.add(opts.detail);
        if (opts.label) e.label = opts.label;
        for (const ev of [].concat(opts.evidence || [])) {
            if (!e.evidence.some((x) => x.path === ev.path && x.line === ev.line)) e.evidence.push(ev);
        }
        return e;
    }
}

// =============================================================================
// C++ analysis
// =============================================================================
const CPP_KEYWORDS = new Set(["if", "for", "while", "switch", "return", "sizeof", "catch", "throw",
    "static_cast", "dynamic_cast", "reinterpret_cast", "const_cast", "decltype", "alignof",
    "new", "delete", "case", "do", "else", "noexcept", "typeid", "static_assert", "defined", "operator"]);

function stripAccessLabels(text) {
    return text.replace(/\b(public|private|protected)\s*:(?!:)/g, (m) => " ".repeat(m.length));
}

function fileId(relPath) { return "file:" + relPath; }

function fileSummary(file) {
    if (file.lang === "markdown") {
        const h = file.lines.find((l) => /^#\s+/.test(l));
        return h ? h.replace(/^#\s+/, "").trim() : undefined;
    }
    if (file.lang !== "cpp" && file.lang !== "js") return undefined;
    const comments = [];
    for (const line of file.lines.slice(0, 30)) {
        const m = line.match(/^\s*\/\/\s?(.*)$/);
        if (m) comments.push(m[1].trim());
        else if (line.startsWith("#!") || !line.trim()) { if (comments.length) break; }
        else break;
    }
    const base = path.basename(file.rel);
    const useful = comments.filter((c) => c && !/^=+$/.test(c) && c !== base && !/^-+$/.test(c));
    return useful[0];
}

// Pass 1 over a C++ file: includes, macros, types, enums, aliases,
// function/method declarations and definitions (bodies are kept for pass 2).
function analyzeCppStructure(file, g, ctx) {
    const lexed = lexSource(file.raw, "cpp");
    file.strings = lexed.strings;
    const chars = lexed.code.split("");

    // --- Preprocessor lines (read from raw text, then blanked) ---
    for (let ln = 1; ln <= file.lines.length; ln++) {
        const start = file.lineStarts[ln - 1];
        const lineCode = lexed.code.slice(start, start + file.lines[ln - 1].length);
        if (!/^\s*#/.test(lineCode)) continue;
        const raw = file.lines[ln - 1];
        let m;
        if ((m = raw.match(/^\s*#\s*include\s*([<"])([^>"]+)[>"]/))) {
            const local = path.posix.normalize(path.posix.join(path.posix.dirname(file.rel), m[2]));
            if (m[1] === "\"" && ctx.fileSet.has(local)) {
                g.edge(fileId(file.rel), fileId(local), "includes", { evidence: evidence(file, ln) });
                (ctx.includes.get(file.rel) || ctx.includes.set(file.rel, []).get(file.rel)).push(local);
            } else {
                const id = "ext:cpp:" + m[2];
                g.node(id, { kind: "external", name: "<" + m[2] + ">", layer: "external",
                             meta: { ecosystem: "C++ standard library" } });
                g.edge(fileId(file.rel), id, "includes", { evidence: evidence(file, ln) });
            }
        } else if ((m = raw.match(/^\s*#\s*define\s+([A-Za-z_]\w*)(?:\s+(.*))?$/))) {
            const valueRaw = (m[2] || "").trim();
            const lit = valueRaw.match(/^"((?:[^"\\]|\\.)*)"\s*(?:\/\/\s*(.*))?$/);
            const id = "macro:" + m[1];
            g.node(id, { kind: "macro", name: m[1], path: file.rel, line: ln, parent: fileId(file.rel),
                         layer: layerOf(file.rel),
                         meta: lit ? { value: lit[1], comment: lit[2] } : { value: valueRaw } });
            ctx.macros.set(m[1], { id, file: file.rel });
        }
        let k = start;
        do {
            while (k < chars.length && chars[k] !== "\n") chars[k++] = " ";
            k++;
        } while (file.lines[lineOf(file, k - 1) - 1].trimEnd().endsWith("\\") && k < chars.length);
    }
    const code = chars.join("");
    file.code = code;

    const scan = (start, end, owner, internal) => {
        let i = start;
        let head = start;
        while (i < end) {
            const c = code[i];
            if (c === ";") {
                onDecl(head, i, owner);
                head = ++i;
            } else if (c === "{") {
                const close = matchBrace(code, i);
                onBlock(head, i, close, owner, internal);
                i = close + 1;
                head = i;
            } else {
                i++;
            }
        }
    };

    const onBlock = (headStart, open, close, owner, internal) => {
        const hs = stripAccessLabels(code.slice(headStart, open));
        const h = hs.trim().replace(/^\[\[\w+\]\]\s*/, "");
        if (!h) return;
        const lead = hs.length - hs.trimStart().length;
        let m;
        if ((m = h.match(/^(?:typedef\s+)?enum\s+(?:class\s+|struct\s+)?([A-Za-z_]\w*)/))) {
            const members = code.slice(open + 1, close).split(",")
                .map((s) => s.replace(/=.*$/s, "").trim()).filter((s) => /^[A-Za-z_]\w*$/.test(s));
            const id = "enum:" + m[1];
            g.node(id, { kind: "enum", name: m[1], path: file.rel, line: lineOf(file, headStart + lead),
                         parent: fileId(file.rel), layer: layerOf(file.rel), meta: { members } });
            ctx.types.set(m[1], id);
            return;
        }
        if ((m = h.match(/^(struct|class)\s+([A-Za-z_]\w*)\s*(?::\s*(?:public|protected|private)?\s*([A-Za-z_][\w:]*))?\s*$/))) {
            const qualified = owner ? owner.name + "::" + m[2] : m[2];
            const id = "type:" + qualified;
            g.node(id, { kind: m[1], name: qualified, short: m[2], path: file.rel,
                         line: lineOf(file, headStart + lead), parent: fileId(file.rel),
                         layer: layerOf(file.rel), owner: owner ? owner.id : undefined,
                         meta: { fields: [], bases: m[3] ? [m[3]] : [] } });
            if (ctx.types.has(m[2]) && ctx.types.get(m[2]) !== id) {
                g.warnings.push("Type name " + m[2] + " is declared more than once; edges use " + id);
            }
            ctx.types.set(m[2], id);
            if (owner) ctx.pending.push({ type: "nested", from: owner.id, to: id, file, line: lineOf(file, headStart + lead) });
            scan(open + 1, close, { id, name: qualified, short: m[2], kind: m[1] }, internal);
            return;
        }
        if (/^namespace\b/.test(h)) {
            scan(open + 1, close, owner, internal || /^namespace\s*$/.test(h));
            return;
        }
        if (h.includes("(")) defineFunction(hs, headStart, open, close, owner, internal);
    };

    const defineFunction = (hs, headStart, open, close, owner, internal) => {
        const parenIdx = hs.indexOf("(");
        const before = hs.slice(0, parenIdx);
        const m = /((?:[A-Za-z_]\w*\s*::\s*)*)(~?[A-Za-z_]\w*)\s*$/.exec(before);
        if (!m) return;
        const qual = m[1].replace(/\s+/g, "").replace(/::$/, "");
        const name = m[2];
        if (CPP_KEYWORDS.has(name)) return;
        const namePos = headStart + m.index + m[1].length;
        const line = lineOf(file, namePos);
        const closeParen = matchBrace(hs, parenIdx);
        const params = hs.slice(parenIdx + 1, closeParen).trim().replace(/\s+/g, " ");
        const after = hs.slice(closeParen + 1).trim();
        const isConst = /^const\b/.test(after);
        const prefix = before.slice(0, m.index);
        const retType = prefix.replace(/\b(static|inline|virtual|explicit|constexpr)\b|\[\[\w+\]\]/g, " ")
            .replace(/\s+/g, " ").trim();
        const cls = qual ? qual.split("::").pop() : (owner ? owner.short : null);

        if (owner && !qual && owner.kind === "struct" && (name === owner.short || name.startsWith("~"))) {
            // Struct constructor: record enum tags such as ASTNode(NodeKind::PrintStmt)
            const re = /\b([A-Za-z_]\w*)\s*::\s*([A-Za-z_]\w*)/g;
            let t;
            while ((t = re.exec(hs.slice(closeParen))) !== null) {
                ctx.pending.push({ type: "tag", from: owner.id, enumName: t[1], member: t[2], file,
                                   line: lineOf(file, headStart + closeParen + t.index) });
            }
            return;
        }

        const body = { file, start: open, end: close, line };
        const signature = (retType ? retType + " " : "") + (cls ? cls + "::" : "") + name + "(" + params + ")" + (isConst ? " const" : "");
        if (cls) {
            const typeId = ctx.types.get(cls) || "type:" + cls;
            const id = "method:" + cls + "::" + name;
            const existing = g.nodes.get(id);
            const firstDef = !(existing && existing.meta.defined);
            const n = g.node(id, { kind: "method", name: cls + "::" + name, short: name + "()",
                                   path: firstDef ? file.rel : undefined, line: firstDef ? line : undefined,
                                   parent: firstDef ? fileId(file.rel) : undefined, layer: layerOf(file.rel),
                                   owner: typeId, signature: firstDef ? signature : undefined,
                                   meta: { role: name === cls ? "constructor" : undefined, defined: true } });
            addSignature(n, signature);
            ctx.bodies.push({ ...body, nodeId: id, cls });
        } else {
            const id = "fn:" + file.rel + "#" + name;
            const existing = g.nodes.get(id);
            if (existing) { addSignature(existing, signature); ctx.bodies.push({ ...body, nodeId: id, cls: null }); return; }
            const linkage = /\bstatic\b/.test(prefix) || internal ? "internal" : /\binline\b/.test(prefix) ? "inline" : undefined;
            const n = g.node(id, { kind: "function", name, short: name + "()", path: file.rel, line,
                                   parent: fileId(file.rel), layer: layerOf(file.rel), signature,
                                   meta: { linkage } });
            addSignature(n, signature);
            ctx.bodies.push({ ...body, nodeId: id, cls: null });
            (ctx.freeFunctions.get(file.rel) || ctx.freeFunctions.set(file.rel, new Map()).get(file.rel)).set(name, id);
        }
    };

    const onDecl = (headStart, end, owner) => {
        const hs = stripAccessLabels(code.slice(headStart, end));
        const h = hs.trim().replace(/^\[\[\w+\]\]\s*/, "");
        if (!h) return;
        const lead = hs.length - hs.trimStart().length;
        const line = lineOf(file, headStart + lead);
        if (!owner) {
            const m = h.match(/^using\s+([A-Za-z_]\w*)\s*=\s*([\s\S]+)$/);
            if (m) {
                const id = "alias:" + m[1];
                g.node(id, { kind: "type-alias", name: m[1], path: file.rel, line, parent: fileId(file.rel),
                             layer: layerOf(file.rel), signature: "using " + m[1] + " = " + m[2].replace(/\s+/g, " "),
                             meta: { target: m[2].replace(/\s+/g, " ") } });
                ctx.types.set(m[1], id);
                ctx.pending.push({ type: "alias", from: id, text: m[2], file, line });
            }
            return;
        }
        const paren = h.indexOf("(");
        const eq = h.search(/=(?!=)/);
        if (paren >= 0 && (eq < 0 || paren < eq)) {
            // Member function declaration
            const before = h.slice(0, paren);
            const m = /(~?[A-Za-z_]\w*)\s*$/.exec(before);
            if (!m) return;
            const name = m[1];
            if (/=\s*(default|delete)\s*$/.test(h)) return;
            if (owner.kind === "struct" && (name === owner.short || name.startsWith("~"))) return;
            const id = "method:" + owner.short + "::" + name;
            const declaredAt = file.rel + ":" + line;
            const prefix = before.slice(0, m.index);
            const retType = prefix.replace(/\b(static|inline|virtual|explicit|constexpr)\b|\[\[\w+\]\]/g, " ")
                .replace(/\s+/g, " ").trim();
            const closeParen = matchBrace(h, paren);
            const signature = (retType ? retType + " " : "") + owner.short + "::" + name + "(" +
                h.slice(paren + 1, closeParen).trim().replace(/\s+/g, " ") + ")" +
                (/^\s*const\b/.test(h.slice(closeParen + 1)) ? " const" : "");
            const n = g.nodes.get(id);
            if (n) {
                n.meta.declaredAt = sortedUnique([].concat(n.meta.declaredAt || [], declaredAt));
            } else {
                g.node(id, { kind: "method", name: owner.short + "::" + name, short: name + "()", path: file.rel, line,
                             parent: fileId(file.rel), layer: layerOf(file.rel), owner: owner.id, signature,
                             meta: { declaredAt: [declaredAt], role: name === owner.short ? "constructor" : undefined,
                                     static: /\bstatic\b/.test(prefix) || undefined } });
            }
            const node = g.nodes.get(id);
            node.meta.declaredSignatures = sortedUnique([].concat(node.meta.declaredSignatures || [], signature));
            return;
        }
        // Field
        const decl = (eq >= 0 ? h.slice(0, eq) : h).trim();
        const fm = /^([\s\S]*?)([A-Za-z_]\w*)\s*(\[[^\]]*\])?$/.exec(decl);
        if (!fm || !fm[1].trim()) return;
        const type = fm[1].replace(/\s+/g, " ").trim();
        const ownerNode = g.nodes.get(owner.id);
        ownerNode.meta.fields.push({ name: fm[2], type, line });
        ctx.pending.push({ type: "field", from: owner.id, field: fm[2], text: type, file, line });
    };

    scan(0, code.length, null, false);
}

function addSignature(node, signature) {
    const sigs = new Set(node.meta.signatures || []);
    sigs.add(signature);
    node.meta.signatures = [...sigs].sort();
    if (sigs.size > 1) {
        node.meta.overloads = sigs.size;
        node.signature = node.meta.signatures.join("\n");
    }
}

// Identifiers in a C++ type expression that name project types.
function projectTypesIn(text, ctx) {
    const ids = text.match(/[A-Za-z_]\w*/g) || [];
    return sortedUnique(ids.filter((id) => ctx.types.has(id)).map((id) => ctx.types.get(id)));
}

function resolveCppPending(g, ctx) {
    for (const p of ctx.pending) {
        const ev = evidence(p.file, p.line);
        if (p.type === "alias") {
            for (const t of projectTypesIn(p.text, ctx)) g.edge(p.from, t, "aliases", { evidence: ev });
        } else if (p.type === "field") {
            for (const t of projectTypesIn(p.text, ctx)) {
                if (t !== p.from) g.edge(p.from, t, "has-field", { detail: p.field, evidence: ev });
            }
        } else if (p.type === "tag") {
            const enumId = ctx.types.get(p.enumName);
            if (enumId && enumId.startsWith("enum:")) {
                g.edge(p.from, enumId, "uses-enum", { detail: p.member, evidence: ev });
                g.nodes.get(p.from).meta.tag = p.enumName + "::" + p.member;
            }
        } else if (p.type === "nested") {
            // nested types are linked through 'owner'; nothing to add
        }
    }
    for (const n of g.nodes.values()) {
        if ((n.kind === "struct" || n.kind === "class") && n.meta.bases) {
            for (const b of n.meta.bases) {
                const t = ctx.types.get(b.split("::").pop());
                const file = ctx.fileByRel.get(n.path);
                if (t) g.edge(n.id, t, "inherits", { evidence: evidence(file, n.line) });
            }
        }
        if (n.kind === "method" && g.has(n.owner)) {
            g.edge(n.owner, n.id, "member", { evidence: evidence(ctx.fileByRel.get(n.path), n.line) });
            for (const d of n.meta.declaredAt || []) {
                const [p, l] = [d.slice(0, d.lastIndexOf(":")), Number(d.slice(d.lastIndexOf(":") + 1))];
                g.edge(n.owner, n.id, "member", { evidence: evidence(ctx.fileByRel.get(p), l) });
            }
        }
    }
}

function includeClosure(relPath, ctx, seen = new Set()) {
    for (const inc of ctx.includes.get(relPath) || []) {
        if (!seen.has(inc)) {
            seen.add(inc);
            includeClosure(inc, ctx, seen);
        }
    }
    return seen;
}

// Pass 2 over every C++ function body: calls, constructions, casts, enum and
// macro uses, cross-component dataflow, throws, and stderr output.
function analyzeCppBodies(g, ctx) {
    const methodsOf = new Map();
    for (const n of g.nodes.values()) {
        if (n.kind !== "method") continue;
        const cls = n.name.split("::")[0];
        (methodsOf.get(cls) || methodsOf.set(cls, new Map()).get(cls)).set(n.name.split("::")[1], n.id);
    }
    const classNames = new Set([...g.nodes.values()].filter((n) => n.kind === "class").map((n) => n.short));

    for (const body of ctx.bodies) {
        const file = body.file;
        const visible = includeClosure(file.rel, ctx);
        visible.add(file.rel);
        const bodyCode = file.code.slice(body.start, body.end + 1);
        const bodyStrings = file.strings.filter((s) => s.start > body.start && s.end <= body.end)
            .map((s) => ({ ...s, start: s.start - body.start, end: s.end - body.start }));
        const toks = tokenize(bodyCode, bodyStrings);
        const at = (k) => evidence(file, lineOf(file, body.start + toks[k].pos));
        const localTypes = new Map();
        const producers = new Map();   // variable -> { nodeId, tok }
        const ownMethods = body.cls ? methodsOf.get(body.cls) || new Map() : new Map();

        const resolveFree = (name) => {
            const same = (ctx.freeFunctions.get(file.rel) || new Map()).get(name);
            if (same) return same;
            for (const inc of visible) {
                const f = (ctx.freeFunctions.get(inc) || new Map()).get(name);
                if (f) return f;
            }
            return null;
        };

        // Local objects of project classes: `Lexer lexer(source);`, `CodeGenerator codegen;`
        const ctorCalls = [];
        for (let k = 0; k + 2 < toks.length; k++) {
            if (classNames.has(toks[k].v) && toks[k + 1].type === "id" && ["(", ";", "{", "="].includes(toks[k + 2].v) &&
                (k === 0 || !["::", ".", "->"].includes(toks[k - 1].v))) {
                localTypes.set(toks[k + 1].v, toks[k].v);
                g.edge(body.nodeId, ctx.types.get(toks[k].v), "instantiates", { evidence: at(k) });
                const ctor = (methodsOf.get(toks[k].v) || new Map()).get(toks[k].v);
                if (ctor && toks[k + 2].v === "(") ctorCalls.push({ ctor, k, open: k + 2 });
            }
        }

        // Producers for dataflow: `var = call(...)` / `var = obj.method(...)` (resolved calls only)
        for (let k = 0; k + 2 < toks.length; k++) {
            if (toks[k].type !== "id" || toks[k + 1].v !== "=") continue;
            const j = k + 2;
            let target = null;
            if (toks[j].type === "id" && toks[j + 1] && toks[j + 1].v === "(") {
                target = ownMethods.get(toks[j].v) || resolveFree(toks[j].v);
            } else if (toks[j].type === "id" && toks[j + 1] && (toks[j + 1].v === "." || toks[j + 1].v === "->") &&
                       toks[j + 2] && toks[j + 3] && toks[j + 3].v === "(" && localTypes.has(toks[j].v)) {
                target = (methodsOf.get(localTypes.get(toks[j].v)) || new Map()).get(toks[j + 2].v) || null;
            }
            if (target) producers.set(toks[k].v, { nodeId: target, tok: k, line: lineOf(file, body.start + toks[k].pos) });
        }

        function recordCall(target, k, open, close) {
            g.edge(body.nodeId, target, "calls", { evidence: at(k) });
            const argVars = new Set(toks.slice(open + 1, close).filter((t) => t.type === "id").map((t) => t.v));
            for (const v of argVars) {
                const p = producers.get(v);
                if (!p || p.tok >= k || p.nodeId === target) continue;
                const pn = g.nodes.get(p.nodeId);
                const tn = g.nodes.get(target);
                const sameComponent = pn.path === tn.path || (pn.owner && pn.owner === tn.owner);
                if (!sameComponent) {
                    g.edge(p.nodeId, target, "dataflow", { detail: v, evidence: [evidence(file, p.line), at(k)] });
                }
            }
        }
        for (const c of ctorCalls) recordCall(c.ctor, c.k, c.open, matchToken(toks, c.open));

        for (let k = 0; k < toks.length; k++) {
            const t = toks[k];
            if (t.type !== "id") continue;
            const prev = toks[k - 1] ? toks[k - 1].v : "";
            const next = toks[k + 1] ? toks[k + 1].v : "";

            // Enum member: TokenType::Print
            if (next === "::" && ctx.types.has(t.v) && ctx.types.get(t.v).startsWith("enum:") && toks[k + 2] && toks[k + 2].type === "id") {
                g.edge(body.nodeId, ctx.types.get(t.v), "uses-enum", { detail: toks[k + 2].v, evidence: at(k) });
                continue;
            }
            // Generated macro
            if (ctx.macros.has(t.v) && visible.has(ctx.macros.get(t.v).file)) {
                g.edge(body.nodeId, ctx.macros.get(t.v).id, "uses-macro", { evidence: at(k) });
                continue;
            }
            // Brace construction: Parameter{...}
            if (next === "{" && ctx.types.has(t.v) && /^type:/.test(ctx.types.get(t.v))) {
                g.edge(body.nodeId, ctx.types.get(t.v), "creates", { detail: "brace init", evidence: at(k) });
                continue;
            }

            // Call candidates: name(...), name<...>(...)
            let after = k + 1;
            let templateType = null;
            if (next === "<") {
                const end = skipTemplateArgs(toks, k + 1);
                if (end < 0) continue;
                templateType = toks.slice(k + 2, end - 1).map((x) => x.v).join(" ");
                after = end;
            }
            if (!toks[after] || toks[after].v !== "(") continue;
            const close = matchToken(toks, after);

            if (templateType !== null && (t.v === "make_unique" || t.v === "make_shared")) {
                for (const ty of projectTypesIn(templateType, ctx)) {
                    g.edge(body.nodeId, ty, "creates", { detail: "std::" + t.v, evidence: at(k) });
                }
                continue;
            }
            if (templateType !== null && t.v === "static_cast") {
                for (const ty of projectTypesIn(templateType, ctx)) {
                    g.edge(body.nodeId, ty, "casts", { evidence: at(k) });
                }
                continue;
            }
            if (CPP_KEYWORDS.has(t.v)) continue;
            // `Lexer lexer(...)`: the variable name is not a call (handled above)
            if (k > 0 && classNames.has(toks[k - 1].v)) continue;

            let target = null;
            if (prev === "." || prev === "->") {
                const recv = toks[k - 2];
                if (recv && recv.v === "this") target = ownMethods.get(t.v) || null;
                else if (recv && recv.type === "id" && localTypes.has(recv.v) && (k < 3 || ![".", "->", "::"].includes(toks[k - 3].v))) {
                    target = (methodsOf.get(localTypes.get(recv.v)) || new Map()).get(t.v) || null;
                }
            } else if (prev === "::") {
                const q = toks[k - 2];
                if (q && classNames.has(q.v)) target = (methodsOf.get(q.v) || new Map()).get(t.v) || null;
            } else if (ownMethods.has(t.v)) {
                target = ownMethods.get(t.v);
            } else if (resolveFree(t.v)) {
                target = resolveFree(t.v);
            } else if (ctx.types.has(t.v) && /^type:/.test(ctx.types.get(t.v)) && !localTypes.has(t.v)) {
                const ty = ctx.types.get(t.v);
                const kind = g.nodes.get(ty).kind === "class" ? "instantiates" : "creates";
                g.edge(body.nodeId, ty, kind, { detail: "constructor call", evidence: at(k) });
                continue;
            }
            if (target) recordCall(target, k, after, close);
        }

        // Diagnostics: throws and stderr output
        let m;
        const throwRe = /\bthrow\s+std\s*::\s*runtime_error\b/g;
        while ((m = throwRe.exec(bodyCode)) !== null) {
            g.edge(body.nodeId, "data:diagnostics", "raises", { detail: "throw std::runtime_error",
                   evidence: evidence(file, lineOf(file, body.start + m.index)) });
        }
        const cerrRe = /\bstd\s*::\s*cerr\s*<</g;
        while ((m = cerrRe.exec(bodyCode)) !== null) {
            g.edge(body.nodeId, "data:diagnostics", "reports", { detail: "std::cerr",
                   evidence: evidence(file, lineOf(file, body.start + m.index)) });
        }

        // String literals, for matching test expectations to the code that emits them
        for (const s of bodyStrings) {
            if (!s.value) continue;
            const prefix = s.value.match(/^\[[A-Za-z+ ]+\]/);
            if (prefix) {
                const n = g.nodes.get(body.nodeId);
                n.meta.messagePrefixes = sortedUnique([].concat(n.meta.messagePrefixes || [], prefix[0]));
            }
            ctx.literals.push({ nodeId: body.nodeId, value: s.value, file, line: lineOf(file, body.start + s.start) });
        }
    }

    // Keyword table: m_keywords[FZ_PRINT] = TokenType::Print;
    for (const body of ctx.bodies) {
        const file = body.file;
        const bodyCode = file.code.slice(body.start, body.end + 1);
        const re = /\[\s*([A-Za-z_]\w*)\s*\]\s*=\s*([A-Za-z_]\w*)\s*::\s*([A-Za-z_]\w*)/g;
        let m;
        while ((m = re.exec(bodyCode)) !== null) {
            if (!ctx.macros.has(m[1]) || !ctx.types.has(m[2]) || !ctx.types.get(m[2]).startsWith("enum:")) continue;
            g.edge(ctx.macros.get(m[1]).id, ctx.types.get(m[2]), "maps-to", { detail: m[2] + "::" + m[3],
                   evidence: evidence(file, lineOf(file, body.start + m.index)) });
            g.nodes.get(ctx.macros.get(m[1]).id).meta.tokenType = m[2] + "::" + m[3];
        }
    }
}

// =============================================================================
// JavaScript analysis
// =============================================================================
const JS_KEYWORDS = new Set(["if", "for", "while", "switch", "return", "catch", "function", "typeof",
    "new", "await", "async", "else", "do", "try", "finally", "throw", "case", "in", "of", "delete", "void", "yield"]);
const NODE_BUILTINS = new Set(["fs", "path", "os", "child_process", "http", "https", "url", "util", "crypto", "events", "stream"]);
const FS_IO = {
    readFileSync: ["reads", "readFileSync"],
    readdirSync: ["reads", "readdirSync"],
    existsSync: ["reads", "existsSync"],
    statSync: ["reads", "statSync"],
    writeFileSync: ["writes", "writeFileSync"],
    mkdirSync: ["writes", "mkdirSync"],
    rmSync: ["writes", "rmSync"],
};

function analyzeJs(file, g, ctx) {
    const { code, strings } = lexSource(file.raw, "js");
    const toks = tokenize(code, strings);
    const at = (k) => evidence(file, lineOf(file, toks[k].pos));
    const fid = fileId(file.rel);
    const layer = layerOf(file.rel);

    // --- Classes and their methods ---
    const fns = [];
    const defTokens = new Set();
    const usedIds = new Set();
    const classes = [];
    const classMethodTokens = new Map();   // name token index -> class
    for (let k = 0; k + 2 < toks.length; k++) {
        if (toks[k].v !== "class" || toks[k + 1].type !== "id") continue;
        let open = k + 2;
        while (open < toks.length && toks[open].v !== "{") open++;
        const close = matchToken(toks, open);
        const cls = { name: toks[k + 1].v, id: "type:js:" + file.rel + "#" + toks[k + 1].v, open, close, methods: new Map() };
        classes.push(cls);
        g.node(cls.id, { kind: "class", name: cls.name, short: cls.name, path: file.rel, line: lineOf(file, toks[k + 1].pos),
                         parent: fid, layer });
        for (let j = open + 1; j < close; j++) {
            if (toks[j].v === "{") { j = matchToken(toks, j); continue; }
            if (toks[j].type === "id" && toks[j + 1] && toks[j + 1].v === "(") {
                const cp = matchToken(toks, j + 1);
                if (toks[cp + 1] && toks[cp + 1].v === "{") {
                    classMethodTokens.set(j, cls);
                    j = matchToken(toks, cp + 1);
                }
            }
        }
    }

    // --- Function definitions ---
    for (let k = 0; k < toks.length; k++) {
        const t = toks[k];
        let nameIdx = -1;
        let openParen = -1;
        let role;
        let cls = null;
        if (classMethodTokens.has(k)) {
            nameIdx = k;
            openParen = k + 1;
            cls = classMethodTokens.get(k);
        } else if (t.v === "function" && toks[k + 1] && toks[k + 1].type === "id" && toks[k + 2] && toks[k + 2].v === "(") {
            nameIdx = k + 1;
            openParen = k + 2;
        } else if (["const", "let", "var"].includes(t.v) && toks[k + 1] && toks[k + 1].type === "id" &&
                   toks[k + 2] && toks[k + 2].v === "=") {
            let j = k + 3;
            if (toks[j] && toks[j].v === "async") j++;
            if (toks[j] && toks[j].v === "(") {
                const close = matchToken(toks, j);
                if (toks[close + 1] && toks[close + 1].v === "=>" && toks[close + 2] && toks[close + 2].v === "{") {
                    nameIdx = k + 1;
                    openParen = j;
                }
            }
        } else if (t.type === "id" && !JS_KEYWORDS.has(t.v) && toks[k + 1] && toks[k + 1].v === "(" &&
                   toks[k - 1] && (toks[k - 1].v === "{" || toks[k - 1].v === ",")) {
            const close = matchToken(toks, k + 1);
            if (toks[close + 1] && toks[close + 1].v === "{") {
                nameIdx = k;
                openParen = k + 1;
                role = "callback";
            }
        }
        if (nameIdx < 0) continue;
        const closeParen = matchToken(toks, openParen);
        let bodyOpen = closeParen + 1;
        if (toks[bodyOpen] && toks[bodyOpen].v === "=>") bodyOpen++;
        if (!toks[bodyOpen] || toks[bodyOpen].v !== "{") continue;
        const bodyClose = matchToken(toks, bodyOpen);
        const name = toks[nameIdx].v;
        let id = "fn:" + file.rel + "#" + (cls ? cls.name + "." : "") + name;
        if (usedIds.has(id)) id += "@" + lineOf(file, toks[nameIdx].pos);
        usedIds.add(id);
        const params = toks.slice(openParen + 1, closeParen).map((x) => x.v).join(" ").replace(/ ,/g, ",");
        const isAsync = toks[nameIdx - 2] && toks[nameIdx - 2].v === "async" || toks[openParen - 1] && toks[openParen - 1].v === "async" ||
            toks[nameIdx - 1] && toks[nameIdx - 1].v === "async";
        g.node(id, { kind: role === "callback" || cls ? "method" : "function", name: cls ? cls.name + "." + name : name,
                     short: name + "()", path: file.rel, line: lineOf(file, toks[nameIdx].pos), parent: fid, layer,
                     owner: cls ? cls.id : undefined,
                     signature: (isAsync ? "async " : "") + (cls ? cls.name + "." : "function ") + name + "(" + params + ")",
                     meta: { role: cls && name === "constructor" ? "constructor" : role } });
        if (cls) {
            cls.methods.set(name, id);
            g.edge(cls.id, id, "member", { evidence: at(nameIdx) });
        }
        fns.push({ id, name, nameIdx, start: toks[bodyOpen].pos, end: toks[bodyClose].pos, startTok: bodyOpen, endTok: bodyClose, role, cls });
        defTokens.add(nameIdx);
    }
    const enclosing = (pos) => {
        let best = null;
        for (const f of fns) {
            if (f.start <= pos && pos <= f.end && (!best || f.start >= best.start)) best = f;
        }
        return best;
    };
    const byName = new Map();
    for (const f of fns) if (!byName.has(f.name) && !f.cls && f.role !== "callback") byName.set(f.name, f.id);
    const classByName = new Map(classes.map((c) => [c.name, c]));
    const enclosingClass = (pos) => classes.find((c) => toks[c.open].pos <= pos && pos <= toks[c.close].pos) || null;
    // `const x = new Class(...)` inside a function: x's methods resolve to Class
    const localInstances = new Map();   // fn id + ":" + var -> class
    for (let k = 0; k + 4 < toks.length; k++) {
        if (["const", "let", "var"].includes(toks[k].v) && toks[k + 1].type === "id" && toks[k + 2].v === "=" &&
            toks[k + 3].v === "new" && classByName.has(toks[k + 4].v)) {
            const fn = enclosing(toks[k].pos);
            localInstances.set((fn ? fn.id : fid) + ":" + toks[k + 1].v, classByName.get(toks[k + 4].v));
        }
    }

    // --- require() and module bindings ---
    const moduleVars = new Map();   // local name -> module id
    const moduleMembers = new Map(); // destructured name -> module id
    for (let k = 0; k + 3 < toks.length; k++) {
        if (toks[k].v !== "require" || toks[k + 1].v !== "(" || toks[k + 2].type !== "str") continue;
        const spec = toks[k + 2].value;
        let target;
        if (spec.startsWith(".")) {
            let r = path.posix.normalize(path.posix.join(path.posix.dirname(file.rel), spec));
            if (!ctx.fileSet.has(r) && ctx.fileSet.has(r + ".js")) r += ".js";
            target = fileId(r);
        } else {
            target = "ext:js:" + spec;
            g.node(target, { kind: "external", name: spec, layer: "external",
                             meta: { ecosystem: spec === "vscode" ? "VS Code extension API" : NODE_BUILTINS.has(spec) ? "Node.js built-in module" : "npm package" } });
        }
        g.edge(fid, target, "requires", { evidence: at(k) });
        // const x = require(...)  /  const { a, b } = require(...)
        let j = k - 1;
        if (toks[j] && toks[j].v === "=") {
            j--;
            if (toks[j] && toks[j].type === "id") moduleVars.set(toks[j].v, target);
            else if (toks[j] && toks[j].v === "}") {
                let s = j;
                while (s > 0 && toks[s].v !== "{") s--;
                for (const x of toks.slice(s + 1, j)) if (x.type === "id") moduleMembers.set(x.v, target);
            }
        }
    }

    // --- Path expressions: path.join / path.resolve / path.dirname ---
    // Variables holding paths are scoped to the function that declares them.
    const scopes = new Map();   // function id (or file id) -> Map(name -> { rel, assumed })
    const scopeChain = (pos) => {
        const chain = fns.filter((f) => f.start <= pos && pos <= f.end).sort((a, b) => b.start - a.start).map((f) => f.id);
        chain.push(fid);
        return chain;
    };
    const pathVars = {
        has: (name, pos) => pathVars.get(name, pos) !== undefined,
        get: (name, pos) => {
            for (const id of scopeChain(pos)) {
                const scope = scopes.get(id);
                if (scope && scope.has(name)) return scope.get(name);
            }
            return undefined;
        },
        set: (name, pos, value) => {
            const id = scopeChain(pos)[0];
            if (!scopes.has(id)) scopes.set(id, new Map());
            scopes.get(id).set(name, value);
        },
    };
    const fileDir = path.posix.dirname(file.rel);
    function evalPath(k) {
        // toks[k] is the module variable bound to "path"
        if (moduleVars.get(toks[k].v) !== "ext:js:path" || !toks[k + 1] || toks[k + 1].v !== "." || !toks[k + 2] || !toks[k + 3] || toks[k + 3].v !== "(") return null;
        const fn = toks[k + 2].v;
        if (!["join", "resolve", "dirname"].includes(fn)) return null;
        const close = matchToken(toks, k + 3);
        const args = [];
        let cur = [];
        for (let j = k + 4; j < close; j++) {
            if (toks[j].v === "," && cur.length) { args.push(cur); cur = []; } else cur.push(j);
        }
        if (cur.length) args.push(cur);
        const parts = [];
        let assumed = false;
        for (let a = 0; a < args.length; a++) {
            const first = toks[args[a][0]];
            let value = null;
            if (args[a].length === 1 && first.type === "str" && first.value !== null) {
                value = first.value;
                if (a === 0) assumed = true;
            } else if (args[a].length === 1 && first.v === "__dirname") {
                value = fileDir;
            } else if (args[a].length === 1 && pathVars.has(first.v, first.pos)) {
                value = pathVars.get(first.v, first.pos).rel;
                assumed = assumed || pathVars.get(first.v, first.pos).assumed;
            } else {
                const nested = evalPath(args[a][0]);
                if (nested && nested.end === args[a][args[a].length - 1] + 1) {
                    value = nested.rel;
                    assumed = assumed || nested.assumed;
                }
            }
            if (value === null) return null;
            parts.push(value);
        }
        if (!parts.length) return null;
        let result = fn === "dirname" ? path.posix.dirname(parts[0]) : path.posix.normalize(path.posix.join(...parts));
        if (result.startsWith("..") || path.posix.isAbsolute(result)) return null;
        if (result === "") result = ".";
        return { rel: result, assumed, end: close + 1 };
    }
    for (let k = 0; k + 3 < toks.length; k++) {
        if (["const", "let", "var"].includes(toks[k].v) && toks[k + 1].type === "id" && toks[k + 2].v === "=") {
            const r = evalPath(k + 3);
            if (r) pathVars.set(toks[k + 1].v, toks[k].pos, r);
        }
    }

    const pathNode = (relPath) => resolvePathNode(relPath, g, ctx);
    const consumedPathTokens = new Set();
    // First argument of a call: resolve to a path if possible.
    function firstArgPath(open) {
        const close = matchToken(toks, open);
        let end = open + 1;
        let depth = 0;
        for (; end < close; end++) {
            const v = toks[end].v;
            if (v === "(" || v === "[" || v === "{") depth++;
            else if (v === ")" || v === "]" || v === "}") depth--;
            else if (v === "," && depth === 0) break;
        }
        const first = toks[open + 1];
        if (!first || open + 1 >= end) return null;
        if (end - (open + 1) === 1 && first.type === "id" && pathVars.has(first.v, first.pos)) {
            consumedPathTokens.add(open + 1);
            return { ...pathVars.get(first.v, first.pos), via: first.v };
        }
        const r = evalPath(open + 1);
        if (r && r.end === end) {
            consumedPathTokens.add(open + 1);
            return r;
        }
        if (end - (open + 1) === 1 && first.type === "str") return { literal: first.value };
        return null;
    }

    // --- Calls ---
    for (let k = 0; k < toks.length; k++) {
        const t = toks[k];
        if (t.type !== "id" || !toks[k + 1] || toks[k + 1].v !== "(" || defTokens.has(k) || JS_KEYWORDS.has(t.v)) continue;
        if (toks[k - 1] && toks[k - 1].v === "function") continue;
        const fn = enclosing(t.pos);
        const from = fn ? fn.id : fid;
        // Member chain: a.b.c(
        const chain = [t.v];
        let j = k - 1;
        while (j > 0 && toks[j].v === "." && toks[j - 1].type === "id") {
            chain.unshift(toks[j - 1].v);
            j -= 2;
        }
        const isNew = toks[j] && toks[j].v === "new";
        if (isNew && chain.length === 1 && classByName.has(t.v)) {
            const c = classByName.get(t.v);
            g.edge(from, c.id, "instantiates", { evidence: at(k) });
            if (c.methods.has("constructor")) g.edge(from, c.methods.get("constructor"), "calls", { evidence: at(k) });
            continue;
        }
        if (chain.length === 2 && chain[0] === "this") {
            const c = enclosingClass(t.pos);
            if (c && c.methods.has(t.v)) g.edge(from, c.methods.get(t.v), "calls", { evidence: at(k) });
            continue;
        }
        if (chain.length === 2 && localInstances.has(from + ":" + chain[0])) {
            const c = localInstances.get(from + ":" + chain[0]);
            if (c.methods.has(t.v)) g.edge(from, c.methods.get(t.v), "calls", { evidence: at(k) });
            continue;
        }
        if (chain.length === 1) {
            if (byName.has(t.v)) {
                const target = byName.get(t.v);
                g.edge(from, target, "calls", { evidence: at(k) });
                const p = firstArgPath(k + 1);
                if (p && p.rel !== undefined) g.edge(from, pathNode(p.rel), "references",
                    { detail: t.v + "()", evidence: at(k), confidence: p.assumed ? "heuristic" : "exact" });
            } else if (moduleMembers.has(t.v)) {
                const mod = moduleMembers.get(t.v);
                g.edge(from, mod, "uses-api", { detail: t.v, evidence: at(k) });
                if (t.v === "spawn" || t.v === "spawnSync" || t.v === "execSync" || t.v === "execFileSync") {
                    const p = firstArgPath(k + 1);
                    if (p && p.rel !== undefined) {
                        g.edge(from, pathNode(p.rel), "executes", { detail: t.v, evidence: at(k), confidence: p.assumed ? "heuristic" : "exact" });
                    } else if (p && p.literal) {
                        const tool = "tool:" + p.literal;
                        g.node(tool, { kind: "tool", name: p.literal, layer: "build" });
                        g.edge(from, tool, "executes", { detail: t.v, evidence: at(k) });
                    }
                }
            }
            continue;
        }
        const root = chain[0];
        if (!moduleVars.has(root)) continue;
        const mod = moduleVars.get(root);
        g.edge(from, mod, "uses-api", { detail: chain.join("."), evidence: at(k) });
        if (mod === "ext:js:fs" && chain.length === 2 && FS_IO[t.v]) {
            const p = firstArgPath(k + 1);
            if (p && p.rel !== undefined) {
                g.edge(from, pathNode(p.rel), FS_IO[t.v][0], { detail: FS_IO[t.v][1], evidence: at(k),
                       confidence: p.assumed ? "heuristic" : "exact" });
            }
        }
    }

    // Same-file functions passed as call arguments: entries.map(makeCompletionItem)
    for (let k = 1; k + 1 < toks.length; k++) {
        const t = toks[k];
        if (t.type !== "id" || !byName.has(t.v) || defTokens.has(k)) continue;
        if (!["(", ","].includes(toks[k - 1].v) || ![")", ","].includes(toks[k + 1].v)) continue;
        let depth = 0;
        let j = k - 1;
        for (; j >= 0; j--) {
            const v = toks[j].v;
            if (v === ")" || v === "]" || v === "}") depth++;
            else if (v === "(" || v === "[" || v === "{") { if (depth === 0) break; depth--; }
        }
        if (j < 1 || toks[j].v !== "(" || toks[j - 1].type !== "id" || JS_KEYWORDS.has(toks[j - 1].v)) continue;
        const chain = [toks[j - 1].v];
        let c = j - 2;
        while (c > 0 && toks[c].v === "." && toks[c - 1].type === "id") { chain.unshift(toks[c - 1].v); c -= 2; }
        const fn = enclosing(t.pos);
        g.edge(fn ? fn.id : fid, byName.get(t.v), "calls", { key: "callback", detail: "callback passed to " + chain.join("."),
               evidence: at(k) });
    }

    // Path expressions inside functions that no I/O call consumed
    for (let k = 0; k < toks.length; k++) {
        if (consumedPathTokens.has(k)) continue;
        if (toks[k - 1] && toks[k - 1].v === "=" && toks[k - 3] && ["const", "let", "var"].includes(toks[k - 3].v)) continue;
        const r = evalPath(k);
        if (!r) continue;
        const fn = enclosing(toks[k].pos);
        if (!fn) continue;
        g.edge(fn.id, pathNode(r.rel), "references", { detail: "path", evidence: at(k),
               confidence: r.assumed ? "heuristic" : "exact" });
    }
    // Other uses of path variables inside functions (e.g. new Map([[OUT_JSON, ...]])), unless
    // the function already reads/writes/executes/references that path. The repository root is skipped.
    for (let k = 1; k < toks.length; k++) {
        const t = toks[k];
        if (t.type !== "id" || consumedPathTokens.has(k) || toks[k - 1].v === "." || !pathVars.has(t.v, t.pos)) continue;
        if (["const", "let", "var"].includes(toks[k - 1].v)) continue;
        const value = pathVars.get(t.v, t.pos);
        const fn = enclosing(t.pos);
        if (!fn || value.rel === ".") continue;
        const target = pathNode(value.rel);
        const linked = [...g.edges.values()].some((e) => e.source === fn.id && e.target === target &&
            ["reads", "writes", "executes", "references"].includes(e.kind));
        if (linked) continue;
        g.edge(fn.id, target, "references", { detail: "uses " + t.v, evidence: at(k), confidence: value.assumed ? "heuristic" : "exact" });
    }

    // --- JSON section reads: def.keywords etc., in files that read that JSON file ---
    for (const [jsonRel, info] of ctx.jsonSections) {
        const readsIt = [...g.edges.values()].some((e) => e.kind === "reads" && e.target === fileId(jsonRel) &&
            (e.source === fid || e.source.startsWith("fn:" + file.rel + "#")));
        if (!readsIt) continue;
        for (let k = 1; k + 2 < toks.length; k++) {
            if (toks[k].type !== "id" || toks[k + 1].v !== "." || !info.has(toks[k + 2].v) || toks[k - 1].v === ".") continue;
            const fn = enclosing(toks[k].pos);
            if (!fn) continue;
            g.edge(fn.id, "json:" + jsonRel + "#" + toks[k + 2].v, "reads",
                   { detail: toks[k].v + "." + toks[k + 2].v, evidence: at(k) });
        }
    }

    // --- Callbacks registered through an API: registerHoverProvider(..., { provideHover() {} }) ---
    for (const f of fns.filter((x) => x.role === "callback")) {
        let depth = 0;
        for (let j = f.nameIdx - 1; j >= 0; j--) {
            const v = toks[j].v;
            if (v === ")" || v === "}" || v === "]") depth++;
            else if (v === "(" || v === "{" || v === "[") {
                if (depth > 0) { depth--; continue; }
                if (v !== "(") continue;
                const chain = [];
                let c = j - 1;
                while (c >= 0 && toks[c].type === "id") {
                    chain.unshift(toks[c].v);
                    if (toks[c - 1] && toks[c - 1].v === ".") c -= 2; else break;
                }
                if (!chain.length || !moduleVars.has(chain[0])) break;
                const outer = enclosing(toks[j].pos);
                if (outer) g.edge(outer.id, f.id, "registers", { detail: chain.join("."), evidence: at(c) });
                g.node(f.id, { meta: { registeredWith: chain.join(".") } });
                if (moduleVars.get(chain[0]) === "ext:js:vscode") {
                    g.edge("ext:vscode-host", f.id, "invokes", { detail: chain.join("."), evidence: at(c) });
                }
                break;
            }
        }
    }

    // --- module.exports = { a, b } ---
    for (let k = 0; k + 3 < toks.length; k++) {
        if (toks[k].v !== "module" || toks[k + 2].v !== "exports" || toks[k + 3].v !== "=") continue;
        if (toks[k + 4] && toks[k + 4].v === "{") {
            const close = matchToken(toks, k + 4);
            const names = toks.slice(k + 5, close).filter((x) => x.type === "id").map((x) => x.v);
            ctx.jsExports.set(file.rel, { names, line: lineOf(file, toks[k].pos) });
            for (const name of names) {
                if (byName.has(name)) g.node(byName.get(name), { meta: { exported: true } });
            }
        }
    }
}

function resolvePathNode(relPath, g, ctx) {
    if (ctx.fileSet.has(relPath)) return fileId(relPath);
    const abs = path.join(ROOT, relPath);
    let isDir = false;
    try { isDir = fs.statSync(abs).isDirectory(); } catch { isDir = false; }
    if (isDir) {
        const id = "dir:" + relPath;
        g.node(id, { kind: "directory", name: relPath === "." ? "(repository root)" : relPath + "/",
                     path: relPath === "." ? undefined : relPath,
                     layer: relPath === "." ? "docs" : layerOf(relPath + "/x") });
        return id;
    }
    const id = "artifact:" + relPath;
    const excluded = ctx.excluded.find((e) => e.path === relPath);
    g.node(id, { kind: "artifact", name: relPath, path: relPath, layer: layerOf(relPath),
                 meta: { exists: fs.existsSync(abs), notAnalyzed: excluded ? excluded.reason : (OUTPUT_FILES.has(relPath) ? "output of " + GENERATOR : undefined) } });
    return id;
}

// =============================================================================
// JSON, markdown, and FayZul program analysis
// =============================================================================
function findLine(file, needle, fromLine = 1) {
    for (let i = fromLine - 1; i < file.lines.length; i++) if (file.lines[i].includes(needle)) return i + 1;
    return 0;
}

function analyzeLanguageDefinition(file, g, ctx) {
    const def = JSON.parse(file.raw);
    const fid = fileId(file.rel);
    const sections = new Set();
    for (const key of Object.keys(def)) {
        sections.add(key);
        const line = findLine(file, "\"" + key + "\":");
        g.node("json:" + file.rel + "#" + key, { kind: "json-section", name: key, short: key, path: file.rel, line,
               parent: fid, layer: layerOf(file.rel),
               meta: { entries: Array.isArray(def[key]) ? def[key].length : undefined } });
    }
    ctx.jsonSections.set(file.rel, sections);

    const terms = [];
    for (const [section, list] of Object.entries(def)) {
        if (!Array.isArray(list)) continue;
        let searchFrom = findLine(file, "\"" + section + "\":");
        for (const entry of list) {
            const word = entry.word || entry.symbol;
            if (!word) continue;
            const needle = entry.word ? "\"word\": \"" + word + "\"" : "\"symbol\": \"" + word + "\"";
            const line = findLine(file, needle, searchFrom) || findLine(file, needle);
            searchFrom = line || searchFrom;
            const id = "term:" + word;
            g.node(id, { kind: "language-term", name: word, short: word, path: file.rel, line, parent: fid,
                         layer: layerOf(file.rel),
                         meta: { section, macro: entry.macro, meaning: entry.meaning || entry.description,
                                 cpp: entry.cpp, group: entry.group, implemented: entry.implemented } });
            terms.push({ id, word, macro: entry.macro, line, section });
        }
    }
    ctx.terms = terms;
}

function linkTermsToMacros(g, ctx) {
    const defFile = ctx.fileByRel.get("language/language-definition.json");
    for (const term of ctx.terms || []) {
        if (!term.macro || !ctx.macros.has(term.macro)) continue;
        const macro = g.nodes.get(ctx.macros.get(term.macro).id);
        if (macro.meta.value !== term.word) {
            g.warnings.push("Macro " + term.macro + " has value '" + macro.meta.value + "' but the language definition says '" + term.word + "' (regenerate with tools/generate-language.js)");
            continue;
        }
        g.edge(term.id, macro.id, "generates", { detail: term.macro,
               evidence: [evidence(defFile, term.line), evidence(ctx.fileByRel.get(macro.path), macro.line)] });
    }
}

// Generic JSON: string values that are relative paths ("./x", "${workspaceFolder}/x")
function analyzeJsonReferences(file, g, ctx) {
    let data;
    try { data = JSON.parse(file.raw); } catch (e) {
        g.warnings.push(file.rel + ": invalid JSON (" + e.message + ")");
        return;
    }
    const dir = path.posix.dirname(file.rel);
    const visit = (value, keyPath) => {
        if (Array.isArray(value)) value.forEach((v, i) => visit(v, keyPath + "[" + i + "]"));
        else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) visit(v, keyPath ? keyPath + "." + k : k);
        else if (typeof value === "string") {
            let target = null;
            if (/^\.\.?\//.test(value)) target = path.posix.normalize(path.posix.join(dir, value));
            else if (value.startsWith("--extensionDevelopmentPath=${workspaceFolder}/")) target = value.split("${workspaceFolder}/")[1];
            else if (value.startsWith("${workspaceFolder}/")) target = value.slice("${workspaceFolder}/".length);
            if (target === null || target.startsWith("..")) return;
            if (!ctx.fileSet.has(target) && !fs.existsSync(path.join(ROOT, target))) return;
            const line = findLine(file, JSON.stringify(value).slice(1, -1));
            g.edge(fileId(file.rel), resolvePathNode(target, g, ctx), "references",
                   { detail: keyPath, evidence: evidence(file, line || 1) });
        }
    };
    visit(data, "");

    // VS Code manifest: language association and activation
    if (path.posix.basename(file.rel) === "package.json" && data.engines && data.engines.vscode) {
        g.node("ext:vscode-host", { kind: "external", name: "VS Code extension host", layer: "external",
                                    meta: { ecosystem: "VS Code" } });
        for (const lang of (data.contributes && data.contributes.languages) || []) {
            for (const ext of lang.extensions || []) {
                const line = findLine(file, JSON.stringify(ext));
                const target = "artifact:*" + ext;
                if (!g.has(target)) g.node(target, { kind: "artifact", name: "*" + ext, layer: layerOf(file.rel) });
                g.edge(fileId(file.rel), target, "references",
                       { detail: "contributes.languages[" + lang.id + "].extensions", evidence: evidence(file, line) });
            }
        }
        if (data.main && data.activationEvents) {
            const mainRel = path.posix.normalize(path.posix.join(dir, data.main));
            ctx.vscodeManifests.push({ file, mainRel, mainLine: findLine(file, "\"main\""),
                                       activationLine: findLine(file, "\"activationEvents\""), events: data.activationEvents });
        }
    }
}

function linkVsCodeActivation(g, ctx) {
    for (const m of ctx.vscodeManifests) {
        const exp = ctx.jsExports.get(m.mainRel);
        if (!exp) continue;
        const mainFile = ctx.fileByRel.get(m.mainRel);
        for (const name of ["activate", "deactivate"]) {
            const id = "fn:" + m.mainRel + "#" + name;
            if (!exp.names.includes(name) || !g.has(id)) continue;
            g.edge("ext:vscode-host", id, "invokes", { detail: name === "activate" ? m.events.join(", ") : "on shutdown",
                   evidence: [evidence(m.file, m.mainLine), evidence(m.file, m.activationLine), evidence(mainFile, exp.line)] });
        }
    }
}

function analyzeMarkdown(file, g, ctx) {
    const re = /\[[^\]]*\]\(([^)\s#]+)(?:#[^)]*)?\)/g;
    file.lines.forEach((line, i) => {
        let m;
        while ((m = re.exec(line)) !== null) {
            if (/^[a-z]+:/i.test(m[1])) continue;
            const target = path.posix.normalize(path.posix.join(path.posix.dirname(file.rel), m[1]));
            if (target.startsWith("..") || !(ctx.fileSet.has(target) || fs.existsSync(path.join(ROOT, target)))) continue;
            g.edge(fileId(file.rel), resolvePathNode(target, g, ctx), "references",
                   { detail: "markdown link", evidence: evidence(file, i + 1) });
        }
    });
}

function fayzulTermsUsed(file, ctx) {
    const { code } = lexSource(file.raw, "cpp");
    const words = new Set(code.match(/[A-Za-z_]\w*/g) || []);
    const symbols = new Set(code.match(/[+\-*/%]/g) || []);
    return (ctx.terms || []).filter((t) => (/^\w+$/.test(t.word) ? words.has(t.word) : symbols.has(t.word))).map((t) => t.word);
}

function analyzeTests(g, ctx) {
    const casesDir = "tests/cases/";
    const suites = new Map();
    for (const file of ctx.files) {
        if (!file.rel.startsWith(casesDir) || file.ext !== ".fz") continue;
        const dir = path.posix.dirname(file.rel);
        const suiteId = "suite:" + dir;
        if (!suites.has(suiteId)) {
            suites.set(suiteId, { out: 0, err: 0, missing: 0 });
            g.node(suiteId, { kind: "test-suite", name: path.posix.basename(dir), short: path.posix.basename(dir),
                              path: dir, layer: "tests" });
        }
        const base = file.rel.slice(0, -3);
        const outFile = ctx.fileByRel.get(base + ".out");
        const errFile = ctx.fileByRel.get(base + ".err");
        const id = "test:" + file.rel;
        const meta = { termsUsed: fayzulTermsUsed(file, ctx), sourceLines: file.lines.length - (file.raw.endsWith("\n") ? 1 : 0) };
        if (outFile) {
            meta.expect = "output";
            meta.expectFile = outFile.rel;
            meta.expectedOutput = outFile.raw.length > 400 ? outFile.raw.slice(0, 400) + "..." : outFile.raw;
            suites.get(suiteId).out++;
        } else if (errFile) {
            meta.expect = "error";
            meta.expectFile = errFile.rel;
            meta.expectedErrors = errFile.lines.map((l) => l.trim()).filter(Boolean);
            suites.get(suiteId).err++;
        } else {
            meta.expect = "missing";
            suites.get(suiteId).missing++;
        }
        g.node(id, { kind: "test-case", name: path.posix.basename(base), short: path.posix.basename(base),
                     path: file.rel, line: 1, parent: suiteId, layer: "tests", meta });
        if (errFile) linkExpectedErrors(id, errFile, g, ctx);
    }
    for (const [suiteId, counts] of suites) g.node(suiteId, { meta: counts });

    for (const file of ctx.files) {
        if (file.ext !== ".fz" || file.rel.startsWith("tests/")) continue;
        g.node("program:" + file.rel, { kind: "fz-program", name: path.posix.basename(file.rel), path: file.rel, line: 1,
               layer: layerOf(file.rel), meta: { termsUsed: fayzulTermsUsed(file, ctx), summary: fileSummaryFz(file) } });
    }
}

function fileSummaryFz(file) {
    const first = file.lines.find((l) => /^\s*\/\//.test(l));
    return first ? first.replace(/^\s*\/\/\s?/, "").trim() : undefined;
}

// Error-message prefixes ("[Parser Error]") are matched exactly; the message
// text is matched against string literals in function bodies (heuristic).
function linkExpectedErrors(testId, errFile, g, ctx) {
    const prefixes = new Map();
    for (const lit of ctx.literals) {
        const m = lit.value.match(/^\[([A-Za-z+ ]+)\]/);
        if (m) {
            const key = "[" + m[1] + "]";
            if (!prefixes.has(key)) prefixes.set(key, []);
            prefixes.get(key).push(lit);
        }
    }
    errFile.lines.forEach((rawLine, i) => {
        const line = rawLine.trim();
        if (!line) return;
        const ev = evidence(errFile, i + 1);
        const pm = line.match(/^(\[[A-Za-z+ ]+\])/);
        if (pm && prefixes.has(pm[1])) {
            for (const lit of prefixes.get(pm[1])) {
                g.edge(testId, lit.nodeId, "expects-error", { key: "prefix", detail: pm[1] + " prefix",
                       evidence: [ev, evidence(lit.file, lit.line)] });
            }
        }
        const message = line.replace(/^\[[A-Za-z+ ]+\]\s*/, "").replace(/^(Line \d+(, Column \d+)?: |\(generated code\): )/, "");
        // Link only through a literal that is long, appears in the message,
        // and occurs in exactly one function; the longest such literal wins.
        const candidates = ctx.literals.filter((lit) => lit.value.length >= 15 && !/^\[[A-Za-z+ ]+\]/.test(lit.value) &&
            message.includes(lit.value) && literalOwners(ctx).get(lit.value).size === 1);
        if (!candidates.length) return;
        candidates.sort((a, b) => b.value.length - a.value.length || a.line - b.line);
        const best = candidates[0];
        const longerShared = ctx.literals.some((lit) => lit.value.length > best.value.length && message.includes(lit.value) &&
            literalOwners(ctx).get(lit.value).size > 1);
        if (longerShared) return;
        g.edge(testId, best.nodeId, "expects-error", { key: "message", detail: "unique message literal", confidence: "heuristic",
               evidence: [ev, evidence(best.file, best.line)] });
    });
}

function literalOwners(ctx) {
    if (!ctx.literalOwners) {
        ctx.literalOwners = new Map();
        for (const lit of ctx.literals) {
            if (!ctx.literalOwners.has(lit.value)) ctx.literalOwners.set(lit.value, new Set());
            ctx.literalOwners.get(lit.value).add(lit.nodeId);
        }
    }
    return ctx.literalOwners;
}

// =============================================================================
// Pipeline annotations
// =============================================================================
function addPipeline(g, ctx) {
    for (const n of PIPELINE_NODES) g.node(n.id, { kind: n.kind, name: n.name, layer: n.layer, meta: { ...n.meta } });
    const steps = [];
    for (const step of PIPELINE_STEPS) {
        const evs = [];
        let ok = g.has(step.from) && g.has(step.to);
        if (!ok) g.warnings.push("Pipeline step skipped (node missing): " + step.from + " -> " + step.to);
        for (const [relPath, re] of step.evidence) {
            const file = ctx.fileByRel.get(relPath);
            const m = file ? re.exec(file.raw) : null;
            if (!m) {
                ok = false;
                g.warnings.push("Pipeline step skipped (no match for " + re + " in " + relPath + "): " + step.from + " -> " + step.to);
                continue;
            }
            evs.push(evidence(file, lineOf(file, m.index)));
        }
        if (!ok) continue;
        g.edge(step.from, step.to, "pipeline", { detail: step.label, evidence: evs });
        steps.push({ from: step.from, to: step.to, label: step.label });
    }
    // main() prints every caught stage error
    const main = ctx.fileByRel.get(MAIN);
    if (main) {
        const re = /std::cerr << e\.what\(\)/g;
        let m;
        const evs = [];
        while ((m = re.exec(main.raw)) !== null) evs.push(evidence(main, lineOf(main, m.index)));
        if (evs.length && g.has("fn:src/main.cpp#main")) {
            g.edge("fn:src/main.cpp#main", "data:diagnostics", "reports", { detail: "catch: e.what()", evidence: evs });
        }
    }
    return steps;
}

// =============================================================================
// Build the graph
// =============================================================================
function buildGraph() {
    const { files, excluded } = discoverFiles();
    const g = new Graph();
    const ctx = {
        files, excluded,
        fileSet: new Set(files.map((f) => f.rel)),
        fileByRel: new Map(files.map((f) => [f.rel, f])),
        includes: new Map(), macros: new Map(), types: new Map(), freeFunctions: new Map(),
        bodies: [], pending: [], literals: [], jsonSections: new Map(), jsExports: new Map(),
        vscodeManifests: [], terms: [],
    };

    // File nodes (expectation files are folded into their test cases)
    for (const f of files) {
        if (f.lang === "expectation" || f.lang === "fayzul") continue;
        const generated = /AUTO-GENERATED/.test(f.lines.slice(0, 5).join("\n")) || /"_comment":\s*"AUTO-GENERATED/.test(f.raw);
        g.node(fileId(f.rel), { kind: "file", name: path.posix.basename(f.rel), path: f.rel, line: 1,
                                layer: layerOf(f.rel),
                                meta: { language: f.lang, lines: f.lines.length - (f.raw.endsWith("\n") ? 1 : 0),
                                        summary: fileSummary(f), generated: generated || undefined } });
    }
    for (const n of PIPELINE_NODES) g.node(n.id, { kind: n.kind, name: n.name, layer: n.layer, meta: { ...n.meta } });

    // C++: headers first so declarations exist before out-of-line definitions
    const cpp = files.filter((f) => f.lang === "cpp").sort((a, b) => (a.ext === b.ext ? a.rel.localeCompare(b.rel) : a.ext === ".h" ? -1 : 1));
    for (const f of cpp) analyzeCppStructure(f, g, ctx);
    resolveCppPending(g, ctx);
    analyzeCppBodies(g, ctx);

    // JSON
    const langDef = ctx.fileByRel.get("language/language-definition.json");
    if (langDef) analyzeLanguageDefinition(langDef, g, ctx);
    linkTermsToMacros(g, ctx);
    for (const f of files.filter((x) => x.lang === "json")) analyzeJsonReferences(f, g, ctx);

    // JavaScript
    for (const f of files.filter((x) => x.lang === "js")) analyzeJs(f, g, ctx);
    linkVsCodeActivation(g, ctx);

    // Markdown, tests, programs
    for (const f of files.filter((x) => x.lang === "markdown")) analyzeMarkdown(f, g, ctx);
    analyzeTests(g, ctx);

    const pipeline = addPipeline(g, ctx);
    return { g, ctx, pipeline };
}

// =============================================================================
// --verify-gcc: compare extracted C++ call edges with g++ -fcallgraph-info
// =============================================================================
function verifyWithGcc(g, ctx) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fayzul-graph-gcc-"));
    const gccEdges = new Set();
    const toId = new Map();
    for (const n of g.nodes.values()) {
        if (n.kind === "method" && n.path && n.path.startsWith("src/")) toId.set(n.name, n.id);
        if (n.kind === "function" && n.path && n.path.startsWith("src/")) toId.set(n.path + "#" + n.name, n.id);
    }
    // Demangled label "Ret Class::name(args)\n/abs/src/file.h:line:col" -> node id
    const labelToId = (label) => {
        const [sig, loc] = label.split("\\n");
        if (!loc || !loc.startsWith(path.join(ROOT, "src") + path.sep)) return null;
        const m = sig.replace(/\{anonymous\}::/g, "").match(/([A-Za-z_][\w:~]*)\(/);
        if (!m) return null;
        const q = m[1];
        if (toId.has(q)) return toId.get(q);
        const file = rel(loc.replace(/:\d+:\d+$/, ""));
        return toId.get(file + "#" + q) || null;
    };
    try {
        for (const f of ctx.files.filter((x) => x.ext === ".cpp" && x.rel.startsWith("src/"))) {
            const base = path.basename(f.rel, ".cpp");
            const res = spawnSync("g++", ["-std=c++17", "-O0", "-fcallgraph-info", "-c", path.join(ROOT, f.rel),
                                          "-o", path.join(tmp, base + ".o")], { cwd: tmp, encoding: "utf8" });
            if (res.status !== 0) throw new Error("g++ failed on " + f.rel + ":\n" + res.stderr);
            const ci = fs.readFileSync(path.join(tmp, base + ".ci"), "utf8");
            const titles = new Map();
            for (const m of ci.matchAll(/node: \{ title: "([^"]+)" label: "([^"]*)"/g)) titles.set(m[1], m[2]);
            for (const m of ci.matchAll(/edge: \{ sourcename: "([^"]+)" targetname: "([^"]+)"/g)) {
                const a = labelToId(titles.get(m[1]) || "");
                const b = labelToId(titles.get(m[2]) || "");
                if (a && b) gccEdges.add(a + " -> " + b);
            }
        }
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
    const ours = new Set([...g.edges.values()].filter((e) => e.kind === "calls" && toIdHas(toId, e.source) && toIdHas(toId, e.target))
        .map((e) => e.source + " -> " + e.target));
    const missing = [...gccEdges].filter((e) => !ours.has(e)).sort();
    const extra = [...ours].filter((e) => !gccEdges.has(e)).sort();
    console.log("g++ call graph: " + gccEdges.size + " edges between project functions; extracted: " + ours.size);
    console.log("  in g++ but not extracted: " + missing.length + (missing.length ? "\n    " + missing.join("\n    ") : ""));
    console.log("  extracted but not in g++: " + extra.length + (extra.length ? "\n    " + extra.join("\n    ") : ""));
    return missing.length === 0 && extra.length === 0;
}

function toIdHas(toId, id) {
    for (const v of toId.values()) if (v === id) return true;
    return false;
}

module.exports = { buildGraph, lexSource, tokenize };

// =============================================================================
// HTML viewer (self-contained: no external scripts, works from file://)
// =============================================================================
function renderHtml(json) {
    // "<" is escaped so the JSON can never close the <script> element early
    const data = JSON.stringify(json).replace(/</g, "\\u003c");
    return VIEWER_TEMPLATE.replace("__GRAPH_JSON__", () => data);
}

const VIEWER_TEMPLATE = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>FayZul Codebase Graph</title>
<meta name="description" content="Interactive dependency graph of the FayZul compiler, extracted from the source by tools/generate-codebase-graph.js">
<style>
:root {
  --bg: #f6f6f3; --panel: #ffffff; --ink: #1c1c1e; --muted: #64646b; --line: #d8d8dd;
  --lane-a: #efefeb; --lane-b: #f6f6f3; --group: #ffffff; --head: #ececf1; --row-hover: #e8efff;
  --accent: #2f62d6; --accent-ink: #ffffff; --match: #e8a400; --shadow: 0 6px 24px rgba(0,0,0,.12);
  --code: #f1f1f4;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #121316; --panel: #1b1c20; --ink: #e9e9ec; --muted: #9b9ba4; --line: #34363d;
    --lane-a: #17181c; --lane-b: #121316; --group: #1d1f24; --head: #272a31; --row-hover: #26324d;
    --accent: #7aa2ff; --accent-ink: #0d1020; --match: #ffc23d; --shadow: 0 6px 24px rgba(0,0,0,.5);
    --code: #24262c;
    color-scheme: dark;
  }
}
:root[data-theme="dark"] {
  --bg: #121316; --panel: #1b1c20; --ink: #e9e9ec; --muted: #9b9ba4; --line: #34363d;
  --lane-a: #17181c; --lane-b: #121316; --group: #1d1f24; --head: #272a31; --row-hover: #26324d;
  --accent: #7aa2ff; --accent-ink: #0d1020; --match: #ffc23d; --shadow: 0 6px 24px rgba(0,0,0,.5);
  --code: #24262c;
  color-scheme: dark;
}
* { box-sizing: border-box; }
html, body { height: 100%; }
body {
  margin: 0; background: var(--bg); color: var(--ink);
  font: 14px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  display: flex; flex-direction: column; height: 100vh; height: 100dvh; overflow: hidden;
}
button, input, select { font: inherit; color: inherit; }
button {
  background: var(--panel); border: 1px solid var(--line); border-radius: 6px;
  padding: 5px 10px; cursor: pointer; font-size: 13px;
}
button:hover { border-color: var(--accent); }
button:focus-visible, input:focus-visible, a:focus-visible, select:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
a { color: var(--accent); }
header.bar {
  display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px;
  padding: 8px 16px; background: var(--panel); border-bottom: 1px solid var(--line); z-index: 5;
}
.brand { display: flex; align-items: baseline; gap: 10px; min-width: 0; }
.brand h1 { font-size: 15px; margin: 0; white-space: nowrap; }
.brand span { color: var(--muted); font-size: 12px; white-space: nowrap; }
.search { position: relative; flex: 1 1 260px; max-width: 460px; }
.search input {
  width: 100%; padding: 6px 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--bg);
}
#results {
  position: absolute; top: calc(100% + 4px); left: 0; right: 0; max-height: 60vh; overflow: auto;
  background: var(--panel); border: 1px solid var(--line); border-radius: 8px; box-shadow: var(--shadow); z-index: 20;
}
#results button {
  display: flex; gap: 8px; align-items: center; width: 100%; text-align: left; border: 0; border-radius: 0;
  padding: 6px 10px; background: transparent;
}
#results button[aria-selected="true"], #results button:hover { background: var(--row-hover); }
#results .r-name { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#results .r-path { color: var(--muted); font-size: 12px; margin-left: auto; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 45%; }
.controls { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.seg { display: inline-flex; }
.seg button { border-radius: 0; margin-left: -1px; }
.seg button:first-child { border-radius: 6px 0 0 6px; margin-left: 0; }
.seg button:last-child { border-radius: 0 6px 6px 0; }
button[aria-pressed="true"] { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
main { position: relative; flex: 1; min-height: 0; }
#stage { position: absolute; inset: 0; overflow: hidden; }
#svg { width: 100%; height: 100%; display: block; touch-action: none; cursor: grab; user-select: none; -webkit-user-select: none; }
#svg.dragging { cursor: grabbing; }
.zoom { position: absolute; left: 16px; bottom: 16px; display: flex; flex-direction: column; gap: 4px; }
.zoom button { width: 34px; height: 34px; padding: 0; font-size: 18px; box-shadow: var(--shadow); }
#hint { position: absolute; left: 60px; bottom: 18px; color: var(--muted); font-size: 12px; pointer-events: none; }
.panel {
  position: absolute; top: 0; bottom: 0; width: 360px; background: var(--panel); overflow: auto;
  box-shadow: var(--shadow); z-index: 10; padding: 12px 16px 24px;
}
.panel.left { left: 0; border-right: 1px solid var(--line); }
.panel.right { right: 0; border-left: 1px solid var(--line); }
.panel h2 { font-size: 15px; margin: 4px 0 8px; display: flex; align-items: center; gap: 8px; word-break: break-word; }
.panel h3 { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); margin: 16px 0 6px; }
.panel h4 { font-size: 13px; margin: 10px 0 4px; }
.panel .close { position: sticky; top: 0; float: right; }
.kv { display: grid; grid-template-columns: max-content 1fr; gap: 2px 10px; font-size: 13px; }
.kv dt { color: var(--muted); }
.kv dd { margin: 0; word-break: break-word; }
pre, code { font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
pre { background: var(--code); padding: 8px; border-radius: 6px; overflow: auto; white-space: pre-wrap; margin: 6px 0; }
ul.rel { list-style: none; padding: 0; margin: 0; }
ul.rel li { padding: 5px 0; border-bottom: 1px solid var(--line); font-size: 13px; }
ul.rel li .go { border: 0; padding: 0; background: none; color: var(--accent); font-weight: 600; text-align: left; }
ul.rel li .lbl { color: var(--muted); }
ul.rel li code { display: block; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 2px; }
.chips { display: inline-flex; flex-wrap: wrap; gap: 4px; margin-left: 4px; }
.chip { font-size: 11px; padding: 0 6px; border: 1px solid var(--line); border-radius: 10px; text-decoration: none; white-space: nowrap; }
.badge { display: inline-block; font-size: 11px; padding: 1px 6px; border-radius: 10px; background: var(--head); color: var(--muted); }
.badge.heur { background: transparent; border: 1px dashed var(--match); color: var(--ink); }
.glyph { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 4px; color: #fff; font: 700 11px/1 system-ui, sans-serif; flex: none; }
.flist label { display: flex; align-items: center; gap: 8px; padding: 3px 0; font-size: 13px; cursor: pointer; }
.flist .n { margin-left: auto; color: var(--muted); font-size: 12px; }
.swatch { width: 22px; height: 0; border-top: 3px solid; flex: none; }
.swatch.heur { border-top-style: dashed; }
.row-btns { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.muted { color: var(--muted); }
.links { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; font-size: 13px; }
/* SVG */
#svg text { fill: var(--ink); font: 12px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
#svg .lane-title { font-weight: 700; font-size: 15px; }
#svg .lane-sub { fill: var(--muted); font-size: 11px; }
#svg .lane { fill: var(--lane-a); }
#svg .lane.b { fill: var(--lane-b); }
#svg .box { fill: var(--group); stroke: var(--line); }
#svg .head { fill: var(--head); }
#svg .title { font-weight: 600; }
#svg .sub { fill: var(--muted); font-size: 11px; }
#svg .gl { fill: #fff; font: 700 10px system-ui, sans-serif; text-anchor: middle; pointer-events: none; }
#svg .rowbg { fill: transparent; }
#svg .node { cursor: pointer; }
#svg .node:hover .rowbg, #svg .node:hover .pillbg { fill: var(--row-hover); }
#svg .pillbg { fill: var(--group); stroke: var(--line); }
#svg .node.sel .box, #svg .node.sel .rowbg, #svg .node.sel .pillbg { stroke: var(--accent); stroke-width: 2.5; }
#svg .node.match .box, #svg .node.match .rowbg, #svg .node.match .pillbg { stroke: var(--match); stroke-width: 2.5; }
#svg .edge { fill: none; stroke-width: 1.3; opacity: .42; }
#svg .edge.heur { stroke-dasharray: 5 4; }
#svg.focus .edge { opacity: .05; }
#svg.focus .edge.hl { opacity: 1; stroke-width: 2.2; }
#svg.focus .node.dim { opacity: .3; }
#svg .elabel { font-size: 11px; paint-order: stroke; stroke: var(--bg); stroke-width: 4px; stroke-linejoin: round; }
#svg.pipe .edge { opacity: .9; stroke-width: 2; }
#svg .caret { fill: var(--muted); font-size: 11px; }
@media (max-width: 760px) {
  header.bar { padding: 8px 12px; }
  .brand span { display: none; }
  .search { order: 3; flex-basis: 100%; max-width: none; }
  .panel { top: auto; left: 0; right: 0; width: auto; height: 62%; border-radius: 12px 12px 0 0; border: 0; border-top: 1px solid var(--line); }
  #hint { display: none; }
}
</style>
</head>
<body>
<header class="bar">
  <div class="brand"><h1>FayZul codebase graph</h1><span id="stats"></span></div>
  <div class="search">
    <input id="q" type="search" placeholder="Search files, classes, functions, tests  ( / )" autocomplete="off" aria-label="Search the graph" aria-controls="results">
    <div id="results" role="listbox" hidden></div>
  </div>
  <div class="controls">
    <div class="seg" role="group" aria-label="View">
      <button data-view="architecture" aria-pressed="true">Architecture</button><button data-view="pipeline" aria-pressed="false">Pipeline</button>
    </div>
    <div class="seg" role="group" aria-label="Detail">
      <button data-detail="symbols" aria-pressed="true">Symbols</button><button data-detail="files" aria-pressed="false">Files</button>
    </div>
    <button id="btnFilters" aria-expanded="false" aria-controls="filters">Filters</button>
    <button id="btnAbout" aria-controls="details">About</button>
    <button id="btnFit" title="Fit to screen (F)">Fit</button>
    <button id="btnTheme" title="Switch light / dark theme">Theme</button>
  </div>
</header>
<main>
  <div id="stage">
    <svg id="svg" role="img" aria-label="Dependency graph">
      <defs id="defs"></defs>
      <g id="viewport"><g id="lanes"></g><g id="edges"></g><g id="nodes"></g><g id="labels"></g></g>
    </svg>
    <div class="zoom"><button id="zin" aria-label="Zoom in">+</button><button id="zout" aria-label="Zoom out">&minus;</button></div>
    <div id="hint">Drag to pan &middot; scroll or pinch to zoom &middot; click a node for details &middot; click a file header to fold it</div>
  </div>
  <aside id="filters" class="panel left" hidden aria-label="Filters"></aside>
  <aside id="details" class="panel right" hidden aria-label="Details"></aside>
</main>
<script id="graph-data" type="application/json">__GRAPH_JSON__</script>
<script>
(function () {
"use strict";
var DATA = JSON.parse(document.getElementById("graph-data").textContent);
var NODES = DATA.nodes, EDGES = DATA.edges;
var byId = new Map(), children = new Map(), membersOf = new Map(), outE = new Map(), inE = new Map();
function push(m, k, v) { var a = m.get(k); if (!a) { a = []; m.set(k, a); } a.push(v); }
NODES.forEach(function (n) {
  byId.set(n.id, n);
  if (n.parent) push(children, n.parent, n.id);
  if (n.owner) push(membersOf, n.owner, n.id);
});
EDGES.forEach(function (e) { push(outE, e.source, e); push(inE, e.target, e); });
var layerById = new Map(DATA.layers.map(function (l) { return [l.id, l]; }));

var KIND = {
  "file": ["F", "#6b7280"], "directory": ["D", "#64748b"], "class": ["C", "#7c3aed"], "struct": ["S", "#2563eb"],
  "enum": ["E", "#0e7490"], "type-alias": ["A", "#0891b2"], "function": ["f", "#15803d"], "method": ["m", "#16a34a"],
  "macro": ["M", "#b45309"], "json-section": ["J", "#a16207"], "language-term": ["W", "#c2410c"],
  "test-suite": ["T", "#be185d"], "test-case": ["t", "#db2777"], "fz-program": ["P", "#9333ea"],
  "artifact": ["B", "#475569"], "data": ["d", "#dc2626"], "tool": ["X", "#57534e"], "external": ["x", "#78716c"]
};
var EDGE_COLORS = {
  light: { "pipeline": "#d62728", "dataflow": "#e8590c", "calls": "#1f77b4", "includes": "#8c564b", "requires": "#9467bd",
    "inherits": "#7048e8", "instantiates": "#0c8599", "creates": "#2b8a3e", "casts": "#9c9c1a", "has-field": "#868e96",
    "aliases": "#868e96", "member": "#adb5bd", "uses-enum": "#1098ad", "uses-macro": "#d6336c", "maps-to": "#c2255c",
    "generates": "#e64980", "reads": "#2f9e44", "writes": "#f76707", "executes": "#6741d9", "references": "#868e96",
    "uses-api": "#adb5bd", "registers": "#0b7285", "invokes": "#0b7285", "raises": "#c92a2a", "reports": "#c92a2a",
    "expects-error": "#d6336c" },
  dark: { "pipeline": "#ff6b6b", "dataflow": "#ffa94d", "calls": "#74c0fc", "includes": "#d0a98f", "requires": "#c5a8f0",
    "inherits": "#b197fc", "instantiates": "#66d9e8", "creates": "#8ce99a", "casts": "#e9ec73", "has-field": "#adb5bd",
    "aliases": "#adb5bd", "member": "#6c757d", "uses-enum": "#66d9e8", "uses-macro": "#f783ac", "maps-to": "#f783ac",
    "generates": "#faa2c1", "reads": "#8ce99a", "writes": "#ffc078", "executes": "#b197fc", "references": "#adb5bd",
    "uses-api": "#868e96", "registers": "#3bc9db", "invokes": "#3bc9db", "raises": "#ff8787", "reports": "#ff8787",
    "expects-error": "#f783ac" }
};
var DEFAULT_HIDDEN_NODES = ["external"];
var DEFAULT_HIDDEN_EDGES = ["member", "has-field", "aliases", "uses-enum", "uses-macro", "casts", "creates",
  "instantiates", "uses-api", "expects-error", "references"];

function store(key, value) { try { if (value === undefined) return localStorage.getItem(key); localStorage.setItem(key, value); } catch { return null; } return null; }

var state = {
  view: "architecture", detail: "symbols", collapsed: new Set(), hiddenNodes: new Set(DEFAULT_HIDDEN_NODES),
  hiddenEdges: new Set(DEFAULT_HIDDEN_EDGES), hiddenLayers: new Set(), heuristic: true,
  selected: null, hover: null, matches: new Set(), tx: 0, ty: 0, k: 1
};
function defaultCollapse() {
  state.collapsed.clear();
  children.forEach(function (kids, id) {
    var n = byId.get(id);
    if (n.kind === "test-suite" || kids.length > 40) state.collapsed.add(id);
  });
}
defaultCollapse();

var svg = document.getElementById("svg"), viewport = document.getElementById("viewport");
var gLanes = document.getElementById("lanes"), gEdges = document.getElementById("edges");
var gNodes = document.getElementById("nodes"), gLabels = document.getElementById("labels");
var detailsEl = document.getElementById("details"), filtersEl = document.getElementById("filters");
var L = null;      // current layout
var AGG = [];      // drawn (aggregated) edges

function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]; }); }
function theme() {
  var t = document.documentElement.getAttribute("data-theme");
  if (t) return t;
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
function edgeColor(kind) { return EDGE_COLORS[theme()][kind] || "#888"; }
function glyphSvg(kind, x, y) {
  var k = KIND[kind] || ["?", "#888"];
  return "<rect x='" + x + "' y='" + y + "' width='16' height='16' rx='4' fill='" + k[1] + "'/><text class='gl' x='" + (x + 8) + "' y='" + (y + 12) + "'>" + esc(k[0]) + "</text>";
}
function glyphHtml(kind) { var k = KIND[kind] || ["?", "#888"]; return "<span class='glyph' style='background:" + k[1] + "' aria-hidden='true'>" + esc(k[0]) + "</span>"; }
function fit(text, width) { var max = Math.max(3, Math.floor(width / 6.7)); return text.length > max ? text.slice(0, max - 1) + "…" : text; }
function displayName(n) { return n.kind === "method" || n.kind === "function" ? (n.short || n.name) : n.name; }
function nodeVisible(n) { return !state.hiddenNodes.has(n.kind) && !state.hiddenLayers.has(n.layer); }
function isGroup(id) { return children.has(id); }

// ---------------------------------------------------------------- layouts
function layoutArchitecture() {
  var COLW = state.detail === "files" ? 220 : 250, GAPX = 92, ROW = 22, HEAD = 30, GAPY = 14, TOP = 64;
  var pos = new Map(), proxy = new Map(), lanes = [];
  var x = 0, col = 0, maxY = 0;
  DATA.layers.forEach(function (layer) {
    if (state.hiddenLayers.has(layer.id)) return;
    var items = NODES.filter(function (n) { return !n.parent && n.layer === layer.id && nodeVisible(n); });
    if (!items.length) return;
    var y = TOP, count = 0;
    items.forEach(function (n) {
      if (isGroup(n.id)) {
        var expanded = state.detail === "symbols" && !state.collapsed.has(n.id);
        var kids = children.get(n.id).map(function (id) { return byId.get(id); }).filter(nodeVisible);
        var shown = expanded ? kids : [];
        var h = HEAD + (shown.length ? shown.length * ROW + 8 : 0);
        pos.set(n.id, { x: x, y: y, w: COLW, h: HEAD, col: col, type: "group", boxH: h, kids: kids.length, expanded: expanded });
        shown.forEach(function (k, i) { pos.set(k.id, { x: x + 6, y: y + HEAD + 4 + i * ROW, w: COLW - 12, h: ROW - 2, col: col, type: "row" }); });
        kids.forEach(function (k) { if (!expanded) proxy.set(k.id, n.id); });
        y += h + GAPY; count += 1;
      } else {
        pos.set(n.id, { x: x, y: y, w: COLW, h: 28, col: col, type: "pill" });
        y += 28 + GAPY; count += 1;
      }
    });
    lanes.push({ x: x - GAPX / 2 + 10, w: COLW + GAPX - 20, title: layer.title, sub: layer.description, count: count, b: col % 2 === 1 });
    maxY = Math.max(maxY, y);
    x += COLW + GAPX; col += 1;
  });
  lanes.forEach(function (l) { l.h = maxY + 20; });
  return { pos: pos, proxy: proxy, lanes: lanes, w: x - GAPX, h: maxY, kind: "architecture" };
}

function availableSize() {
  var r = svg.getBoundingClientRect();
  var panel = (!detailsEl.hidden && r.width >= 760 ? 360 : 0) + (!filtersEl.hidden && r.width >= 760 ? 360 : 0);
  return { w: Math.max(200, r.width - panel), h: r.height, left: !filtersEl.hidden && r.width >= 760 ? 360 : 0, full: r };
}

function layoutPipeline() {
  var pEdges = EDGES.filter(function (e) { return e.kind === "pipeline"; });
  var ids = [];
  pEdges.forEach(function (e) { [e.source, e.target].forEach(function (id) { if (ids.indexOf(id) < 0) ids.push(id); }); });
  var rank = new Map(ids.map(function (id) { return [id, 0]; }));
  for (var it = 0; it < ids.length; it++) {
    pEdges.forEach(function (e) { if (rank.get(e.target) < rank.get(e.source) + 1) rank.set(e.target, rank.get(e.source) + 1); });
  }
  var nRanks = 0; rank.forEach(function (r) { nRanks = Math.max(nRanks, r + 1); });
  var byRank = [];
  ids.forEach(function (id) { var r = rank.get(id); (byRank[r] = byRank[r] || []).push(id); });
  var stack = 1; byRank.forEach(function (l) { stack = Math.max(stack, l.length); });
  // Error path: functions that throw or print diagnostics but are not pipeline steps
  var errIds = [];
  EDGES.forEach(function (e) {
    if ((e.kind === "raises" || e.kind === "reports") && e.target === "data:diagnostics" && ids.indexOf(e.source) < 0 && errIds.indexOf(e.source) < 0) errIds.push(e.source);
  });
  var layerOrder = new Map(DATA.layers.map(function (l, i) { return [l.id, i]; }));
  errIds.sort(function (a, b) { return layerOrder.get(byId.get(a).layer) - layerOrder.get(byId.get(b).layer) || a.localeCompare(b); });

  var av = availableSize();
  var vertical = av.w < 700;
  var W = 178, H = 46, GX = 112, GY = 22;
  var pos = new Map();
  if (vertical) {
    byRank.forEach(function (list, r) {
      list.forEach(function (id, i) { pos.set(id, { x: i * (W + 24), y: r * (H + GY + 16), w: W, h: H, col: r, type: "card" }); });
    });
    var mx = stack * (W + 24) + 40;
    errIds.forEach(function (id, i) { pos.set(id, { x: mx, y: i * (H + 40) + 40, w: W, h: H, col: -1, type: "card" }); });
    if (byId.has("data:diagnostics")) pos.set("data:diagnostics", { x: mx, y: errIds.length * (H + 40) + 80, w: W, h: H, col: -1, type: "card" });
  } else {
    // Serpentine: rows alternate direction so each row change is a short vertical step
    var perRow = Math.max(3, Math.min(nRanks, Math.floor(av.w / ((W + GX) * 0.72))));
    var rowH = stack * (H + 12) + 64;
    byRank.forEach(function (list, r) {
      var row = Math.floor(r / perRow), c = r % perRow;
      if (row % 2 === 1) c = perRow - 1 - c;
      list.forEach(function (id, i) { pos.set(id, { x: c * (W + GX), y: row * rowH + i * (H + 12), w: W, h: H, col: r, type: "card" }); });
    });
    var rows = Math.ceil(nRanks / perRow);
    var ey = rows * rowH + 40, total = perRow * (W + GX) - GX;
    var step = errIds.length > 1 ? Math.min(W + GX, (total - W) / (errIds.length - 1)) : 0;
    var ex0 = (total - (step * (errIds.length - 1) + W)) / 2;
    errIds.forEach(function (id, i) { pos.set(id, { x: ex0 + i * step, y: ey, w: W, h: H, col: -1, type: "card" }); });
    if (byId.has("data:diagnostics")) pos.set("data:diagnostics", { x: (total - W) / 2, y: ey + H + 90, w: W, h: H, col: -1, type: "card" });
  }
  var w = 0, h = 0;
  pos.forEach(function (p) { w = Math.max(w, p.x + p.w); h = Math.max(h, p.y + p.h); });
  return { pos: pos, proxy: new Map(), lanes: [], w: w, h: h, kind: "pipeline", gap: GX,
           edgeFilter: function (e) { return e.kind === "pipeline" || ((e.kind === "raises" || e.kind === "reports") && e.target === "data:diagnostics"); } };
}

function shown(id) {
  if (L.pos.has(id)) return id;
  if (L.proxy.has(id)) return L.proxy.get(id);
  return null;
}

// ---------------------------------------------------------------- drawing
function curve(a, b, idx) {
  var A = L.pos.get(a), B = L.pos.get(b), off = ((idx % 5) - 2) * 1.6;
  var sx, sy, tx, ty, c1x, c1y, c2x, c2y;
  if (a === b) {
    sx = A.x + A.w; sy = A.y + A.h / 2;
    return { d: "M" + sx + "," + (sy - 4) + " C" + (sx + 30) + "," + (sy - 16) + " " + (sx + 30) + "," + (sy + 16) + " " + sx + "," + (sy + 4), mx: sx + 24, my: sy };
  }
  if (L.kind === "pipeline") {
    var dx = (B.x + B.w / 2) - (A.x + A.w / 2), dy = (B.y + B.h / 2) - (A.y + A.h / 2);
    if (Math.abs(dx) >= Math.abs(dy)) {
      sx = dx > 0 ? A.x + A.w : A.x; tx = dx > 0 ? B.x : B.x + B.w; sy = A.y + A.h / 2; ty = B.y + B.h / 2;
      var hx = (tx - sx) / 2; c1x = sx + hx; c1y = sy; c2x = tx - hx; c2y = ty;
    } else {
      sy = dy > 0 ? A.y + A.h : A.y; ty = dy > 0 ? B.y : B.y + B.h; sx = A.x + A.w / 2; tx = B.x + B.w / 2;
      var hy = (ty - sy) / 2; c1x = sx; c1y = sy + hy; c2x = tx; c2y = ty - hy;
    }
  } else if (B.col !== A.col) {
    var right = B.col > A.col;
    sx = right ? A.x + A.w : A.x; tx = right ? B.x : B.x + B.w;
    sy = A.y + A.h / 2 + off; ty = B.y + B.h / 2 + off;
    var bend = Math.max(40, Math.abs(tx - sx) * 0.45) * (right ? 1 : -1);
    c1x = sx + bend; c1y = sy; c2x = tx - bend; c2y = ty;
  } else {
    sx = A.x + A.w; tx = B.x + B.w; sy = A.y + A.h / 2 + off; ty = B.y + B.h / 2 + off;
    var bx = Math.max(sx, tx) + 26 + Math.min(110, Math.abs(ty - sy) * 0.2);
    c1x = bx; c1y = sy; c2x = bx; c2y = ty;
  }
  return { d: "M" + sx + "," + sy + " C" + c1x + "," + c1y + " " + c2x + "," + c2y + " " + tx + "," + ty,
           mx: (sx + 3 * c1x + 3 * c2x + tx) / 8, my: (sy + 3 * c1y + 3 * c2y + ty) / 8 };
}

function drawMarkers() {
  var html = "";
  Object.keys(DATA.edgeKinds).forEach(function (k) {
    html += "<marker id='m-" + k + "' viewBox='0 0 10 10' refX='9' refY='5' markerWidth='7' markerHeight='7' orient='auto-start-reverse'>" +
      "<path d='M0,1 L9,5 L0,9 z' fill='" + edgeColor(k) + "'/></marker>";
  });
  document.getElementById("defs").innerHTML = html;
}

function render() {
  L = state.view === "pipeline" ? layoutPipeline() : layoutArchitecture();
  svg.classList.toggle("pipe", state.view === "pipeline");
  // lanes
  var lh = "";
  L.lanes.forEach(function (l) {
    lh += "<rect class='lane" + (l.b ? " b" : "") + "' x='" + l.x + "' y='0' width='" + l.w + "' height='" + l.h + "'/>" +
      "<text class='lane-title' x='" + (l.x + 14) + "' y='26'>" + esc(l.title) + "</text>" +
      "<text class='lane-sub' x='" + (l.x + 14) + "' y='44'>" + esc(fit(l.sub, l.w - 20)) + "<title>" + esc(l.sub) + "</title></text>";
  });
  gLanes.innerHTML = lh;
  // edges (aggregated by displayed endpoints and kind)
  var aggMap = new Map();
  AGG = [];
  EDGES.forEach(function (e) {
    if (L.edgeFilter ? !L.edgeFilter(e) : state.hiddenEdges.has(e.kind)) return;
    if (!state.heuristic && e.confidence !== "exact") return;
    var s = shown(e.source), t = shown(e.target);
    if (!s || !t) return;
    if (s === t && e.source !== e.target) return;
    var key = s + "|" + t + "|" + e.kind;
    var a = aggMap.get(key);
    if (!a) { a = { s: s, t: t, kind: e.kind, edges: [], heur: true }; aggMap.set(key, a); AGG.push(a); }
    a.edges.push(e);
    if (e.confidence === "exact") a.heur = false;
  });
  var kinds = Object.keys(DATA.edgeKinds);
  var eh = "";
  AGG.forEach(function (a, i) {
    var c = curve(a.s, a.t, kinds.indexOf(a.kind));
    a.mx = c.mx; a.my = c.my;
    eh += "<path class='edge" + (a.heur ? " heur" : "") + "' data-k='" + i + "' d='" + c.d + "' stroke='" + edgeColor(a.kind) +
      "' marker-end='url(#m-" + a.kind + ")'><title>" + esc(a.kind + ": " + byId.get(a.s).name + " → " + byId.get(a.t).name +
      (a.edges.length > 1 ? " (" + a.edges.length + " edges)" : " — " + a.edges[0].label)) + "</title></path>";
  });
  gEdges.innerHTML = eh;
  // nodes
  var nh = "";
  L.pos.forEach(function (p, id) {
    var n = byId.get(id), cls = "node";
    if (p.type === "group") {
      var path = n.path || n.name;
      nh += "<g class='" + cls + " grp' data-id='" + esc(id) + "'><rect class='box' x='" + p.x + "' y='" + p.y + "' width='" + p.w + "' height='" + p.boxH + "' rx='8'/>" +
        "<rect class='head' x='" + (p.x + 1) + "' y='" + (p.y + 1) + "' width='" + (p.w - 2) + "' height='" + (p.h - 2) + "' rx='7'/>" +
        glyphSvg(n.kind, p.x + 8, p.y + 7) +
        "<text class='title' x='" + (p.x + 30) + "' y='" + (p.y + 19) + "'>" + esc(fit(n.kind === "file" ? path.split("/").pop() : n.name, p.w - 82)) + "</text>" +
        "<text class='sub' x='" + (p.x + p.w - 10) + "' y='" + (p.y + 19) + "' text-anchor='end'>" + (p.kids ? (p.expanded ? "▾ " : "▸ ") + p.kids : "") + "</text>" +
        "<title>" + esc(path + (p.kids ? " — click the header to " + (p.expanded ? "fold" : "unfold") + " " + p.kids + " members" : "")) + "</title></g>";
    } else if (p.type === "row") {
      nh += "<g class='" + cls + " row' data-id='" + esc(id) + "'><rect class='rowbg' x='" + p.x + "' y='" + p.y + "' width='" + p.w + "' height='" + p.h + "' rx='4'/>" +
        glyphSvg(n.kind, p.x + 4, p.y + 2) +
        "<text x='" + (p.x + 26) + "' y='" + (p.y + 14) + "'>" + esc(fit(displayName(n), p.w - 32)) + "</text>" +
        "<title>" + esc(n.name + (n.path ? "\n" + n.path + ":" + n.line : "")) + "</title></g>";
    } else {
      var sub = p.type === "card" ? (n.kind + (n.path ? " · " + n.path.split("/").pop() + (n.line ? ":" + n.line : "") : "")) : "";
      nh += "<g class='" + cls + " pill' data-id='" + esc(id) + "'><rect class='pillbg' x='" + p.x + "' y='" + p.y + "' width='" + p.w + "' height='" + p.h + "' rx='" + (p.type === "card" ? 8 : 14) + "'/>" +
        glyphSvg(n.kind, p.x + 8, p.y + (p.type === "card" ? 8 : 6)) +
        "<text class='title' x='" + (p.x + 30) + "' y='" + (p.y + (p.type === "card" ? 20 : 18)) + "'>" + esc(fit(n.name, p.w - 40)) + "</text>" +
        (sub ? "<text class='sub' x='" + (p.x + 30) + "' y='" + (p.y + 36) + "'>" + esc(fit(sub, p.w - 40)) + "</text>" : "") +
        "<title>" + esc(n.name + (n.path ? "\n" + n.path + (n.line ? ":" + n.line : "") : "")) + "</title></g>";
    }
  });
  gNodes.innerHTML = nh;
  applyHighlight();
  updateStats();
}

function focusSet(id) {
  var set = new Set(), d = shown(id);
  if (d) set.add(d);
  if (isGroup(id)) children.get(id).forEach(function (c) { var s = shown(c); if (s) set.add(s); });
  (membersOf.get(id) || []).forEach(function (c) { var s = shown(c); if (s) set.add(s); });
  return set;
}

function applyHighlight() {
  var focus = state.selected || state.hover;
  var lbl = "";
  var nodeEls = gNodes.querySelectorAll(".node");
  var edgeEls = gEdges.querySelectorAll(".edge");
  svg.classList.toggle("focus", !!focus && L.kind !== "pipeline");
  var near = null;
  if (focus) {
    var fs = focusSet(focus);
    near = new Set(fs);
    edgeEls.forEach(function (el) {
      var a = AGG[+el.getAttribute("data-k")];
      var on = fs.has(a.s) || fs.has(a.t);
      el.classList.toggle("hl", on);
      if (on) {
        near.add(a.s); near.add(a.t);
        var text = a.edges.length > 1 ? a.kind + " ×" + a.edges.length : a.edges[0].label;
        lbl += "<text class='elabel' x='" + a.mx + "' y='" + (a.my - 3) + "' text-anchor='middle' fill='" + edgeColor(a.kind) + "'>" + esc(fit(text, 220)) + "</text>";
      }
    });
  } else {
    edgeEls.forEach(function (el) { el.classList.remove("hl"); });
  }
  if (L.kind === "pipeline") {
    lbl = "";
    AGG.forEach(function (a) {
      lbl += "<text class='elabel' x='" + a.mx + "' y='" + (a.my - 5) + "' text-anchor='middle' fill='" + edgeColor(a.kind) + "'>" + esc(fit(a.edges[0].label, L.gap - 8)) + "<title>" + esc(a.edges[0].label) + "</title></text>";
    });
  }
  gLabels.innerHTML = lbl;
  var sel = state.selected ? shown(state.selected) : null;
  nodeEls.forEach(function (el) {
    var id = el.getAttribute("data-id");
    el.classList.toggle("dim", !!near && !near.has(id));
    el.classList.toggle("sel", id === sel);
    el.classList.toggle("match", state.matches.has(id));
  });
}

// ---------------------------------------------------------------- pan & zoom
function applyTransform() { viewport.setAttribute("transform", "translate(" + state.tx + "," + state.ty + ") scale(" + state.k + ")"); }
function fitView(mode) {
  var av = availableSize();
  var w = Math.max(L.w, 1) + 60, h = Math.max(L.h, 1) + 60;
  var all = Math.min(av.w / w, av.h / h);
  state.k = Math.max(0.06, Math.min(1.3, mode === "height" ? Math.max(all, Math.min(1, (av.h - 20) / h)) : all));
  state.tx = av.left + Math.max(16, (av.w - L.w * state.k) / 2);
  state.ty = Math.max(12, (av.h - L.h * state.k) / 2);
  if (L.kind === "architecture") state.ty = 12;
  applyTransform();
}
function zoomAt(factor, cx, cy) {
  var k = Math.max(0.05, Math.min(4, state.k * factor));
  state.tx = cx - (cx - state.tx) * (k / state.k);
  state.ty = cy - (cy - state.ty) * (k / state.k);
  state.k = k; applyTransform();
}
function centerOn(id) {
  var d = shown(id); if (!d) return;
  var p = L.pos.get(d), r = svg.getBoundingClientRect();
  if (state.k < 0.9) state.k = 0.9;
  var av = availableSize();
  state.tx = av.left + av.w / 2 - (p.x + p.w / 2) * state.k;
  state.ty = (r.width < 760 ? r.height * 0.3 : r.height / 2) - (p.y + p.h / 2) * state.k;
  applyTransform();
}
svg.addEventListener("wheel", function (ev) {
  ev.preventDefault();
  var r = svg.getBoundingClientRect();
  zoomAt(Math.exp(-ev.deltaY * (ev.ctrlKey ? 0.01 : 0.0015)), ev.clientX - r.left, ev.clientY - r.top);
}, { passive: false });
var pointers = new Map(), drag = null, pinch = null;
svg.addEventListener("pointerdown", function (ev) {
  pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  if (pointers.size === 1) drag = { x: ev.clientX, y: ev.clientY, tx: state.tx, ty: state.ty, moved: false, target: ev.target };
  if (pointers.size === 2) {
    var pts = Array.from(pointers.values());
    pinch = { d: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y), k: state.k };
    drag = null;
  }
});
svg.addEventListener("pointermove", function (ev) {
  if (!pointers.has(ev.pointerId)) return;
  pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  if (pinch && pointers.size === 2) {
    var pts = Array.from(pointers.values()), r = svg.getBoundingClientRect();
    var d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    zoomAt((pinch.k * d / pinch.d) / state.k, (pts[0].x + pts[1].x) / 2 - r.left, (pts[0].y + pts[1].y) / 2 - r.top);
    return;
  }
  if (!drag) return;
  var dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
  if (!drag.moved && Math.hypot(dx, dy) > 4) { drag.moved = true; svg.classList.add("dragging"); try { svg.setPointerCapture(ev.pointerId); } catch { /* ignore */ } }
  if (drag.moved) { state.tx = drag.tx + dx; state.ty = drag.ty + dy; applyTransform(); }
});
function endPointer(ev) {
  pointers.delete(ev.pointerId);
  if (pointers.size < 2) pinch = null;
  if (!drag) return;
  var d = drag; drag = null; svg.classList.remove("dragging");
  if (d.moved || ev.type === "pointercancel") return;
  var el = d.target.closest ? d.target.closest(".node") : null;
  if (!el) { select(null); return; }
  var id = el.getAttribute("data-id"), p = L.pos.get(id);
  var r = svg.getBoundingClientRect();
  var localY = (ev.clientY - r.top - state.ty) / state.k;
  if (p && p.type === "group" && p.kids && state.detail === "symbols" && localY <= p.y + p.h) {
    if (state.collapsed.has(id)) state.collapsed.delete(id); else state.collapsed.add(id);
    state.selected = id;
    render(); showDetails(id); setHash(id);
    return;
  }
  select(id);
}
svg.addEventListener("pointerup", endPointer);
svg.addEventListener("pointercancel", endPointer);
gNodes.addEventListener("pointerover", function (ev) {
  var el = ev.target.closest(".node");
  var id = el ? el.getAttribute("data-id") : null;
  if (id !== state.hover && !state.selected) { state.hover = id; applyHighlight(); }
});
gNodes.addEventListener("pointerleave", function () { if (state.hover) { state.hover = null; if (!state.selected) applyHighlight(); } });

// ---------------------------------------------------------------- selection & details
function setHash(id) { try { history.replaceState(null, "", id ? "#n=" + encodeURIComponent(id) : location.pathname + location.search); } catch { /* file:// may refuse */ } }
function reveal(id) {
  var n = byId.get(id); if (!n) return;
  if (state.view === "pipeline" && !L.pos.has(id)) { state.view = "architecture"; syncButtons(); }
  if (state.hiddenNodes.has(n.kind)) state.hiddenNodes.delete(n.kind);
  if (state.hiddenLayers.has(n.layer)) state.hiddenLayers.delete(n.layer);
  if (n.parent) {
    var pn = byId.get(n.parent);
    if (state.hiddenNodes.has(pn.kind)) state.hiddenNodes.delete(pn.kind);
    if (state.detail === "symbols") state.collapsed.delete(n.parent);
  }
}
function select(id, opts) {
  opts = opts || {};
  state.selected = id; state.hover = null;
  if (id && opts.reveal) { reveal(id); render(); centerOn(id); }
  else applyHighlight();
  if (id) showDetails(id); else if (!opts.keepPanel && window.innerWidth < 760) detailsEl.hidden = true;
  setHash(id);
}
function linkMode() { return store("fz-graph-links") || (DATA.repository ? "github" : "local"); }
function srcHref(p, line) {
  var mode = linkMode();
  if (mode === "github" && DATA.repository) return DATA.repository + "/blob/" + DATA.sourceRef + "/" + p + (line ? "#L" + line : "");
  if (mode === "vscode") {
    var root = store("fz-graph-root");
    if (root) return "vscode://file/" + root.replace(/\\/g, "/").replace(/\/$/, "") + "/" + p + (line ? ":" + line : "");
  }
  return "../" + p;
}
function srcLink(p, line, text) { return "<a class='chip' href='" + esc(srcHref(p, line)) + "' target='_blank' rel='noopener'" + (text ? " title='" + esc(text) + "'" : "") + ">" + esc(p.split("/").pop() + (line ? ":" + line : "")) + "</a>"; }
function nameBtn(id) { var n = byId.get(id); return "<button class='go' data-go='" + esc(id) + "'>" + esc(n ? n.name : id) + "</button>"; }
function formatMeta(key, v) {
  if (Array.isArray(v)) {
    if (v.length && typeof v[0] === "object") return v.map(function (x) { return esc((x.type ? x.type + " " : "") + (x.name || x.path || "") + (x.line ? "  (line " + x.line + ")" : "")); }).join("<br>");
    return esc(v.join(", "));
  }
  if (v && typeof v === "object") return esc(JSON.stringify(v));
  return esc(String(v));
}
function relList(list, dir) {
  if (!list.length) return "<p class='muted'>None.</p>";
  var groups = new Map();
  list.forEach(function (e) { push(groups, e.kind, e); });
  var html = "";
  groups.forEach(function (es, kind) {
    html += "<h4><span class='swatch" + "' style='display:inline-block;vertical-align:middle;margin-right:6px;border-color:" + edgeColor(kind) + "'></span>" + esc(kind) + " <span class='muted'>(" + es.length + ")</span></h4><ul class='rel'>";
    es.slice(0, 80).forEach(function (e) {
      var other = dir === "out" ? e.target : e.source;
      html += "<li>" + nameBtn(other) + " <span class='lbl'>" + esc(e.label) + "</span>" +
        (e.confidence !== "exact" ? " <span class='badge heur' title='Derived by text matching; see the JSON confidence field'>heuristic</span>" : "") +
        "<span class='chips'>" + e.evidence.slice(0, 4).map(function (v) { return srcLink(v.path, v.line, v.text); }).join("") +
        (e.evidence.length > 4 ? "<span class='muted'>+" + (e.evidence.length - 4) + "</span>" : "") + "</span>" +
        (e.evidence[0] ? "<code title='" + esc(e.evidence[0].text) + "'>" + esc(e.evidence[0].text) + "</code>" : "") + "</li>";
    });
    if (es.length > 80) html += "<li class='muted'>+" + (es.length - 80) + " more (see CODEBASE_GRAPH.json)</li>";
    html += "</ul>";
  });
  return html;
}
function linkSettings() {
  var mode = linkMode();
  return "<div class='links'><label>Open source in <select id='linkMode'>" +
    (DATA.repository ? "<option value='github'" + (mode === "github" ? " selected" : "") + ">GitHub</option>" : "") +
    "<option value='local'" + (mode === "local" ? " selected" : "") + ">Local file (../)</option>" +
    "<option value='vscode'" + (mode === "vscode" ? " selected" : "") + ">VS Code</option></select></label>" +
    (mode === "vscode" ? "<button id='setRoot'>Set checkout path…</button>" : "") + "</div>";
}
function showDetails(id) {
  var n = byId.get(id); if (!n) return;
  var layer = layerById.get(n.layer);
  var h = "<button class='close' data-close='details' aria-label='Close details'>✕</button>" +
    "<h2>" + glyphHtml(n.kind) + esc(n.name) + "</h2>" +
    "<div class='links'><span class='badge'>" + esc(n.kind) + "</span><span class='badge'>" + esc(layer ? layer.title : n.layer) + "</span>" +
    (n.path ? srcLink(n.path, n.line) + "<button id='copyPath' data-copy='" + esc(n.path + (n.line ? ":" + n.line : "")) + "'>Copy path</button>" : "") + "</div>";
  if (n.signature) h += "<pre>" + esc(n.signature) + "</pre>";
  var meta = n.meta || {};
  var keys = Object.keys(meta);
  if (n.owner) h += "<h3>Member of</h3>" + nameBtn(n.owner);
  if (n.parent) h += "<h3>In</h3>" + nameBtn(n.parent);
  if (keys.length) {
    h += "<h3>Properties</h3><dl class='kv'>";
    keys.forEach(function (k) { h += "<dt>" + esc(k) + "</dt><dd>" + formatMeta(k, meta[k]) + "</dd>"; });
    h += "</dl>";
  }
  var mem = (membersOf.get(id) || []).concat(children.get(id) || []);
  if (mem.length) {
    h += "<h3>Contains (" + mem.length + ")</h3><ul class='rel'>" + mem.slice(0, 120).map(function (m) {
      var mn = byId.get(m); return "<li>" + glyphHtml(mn.kind) + " " + nameBtn(m) + (mn.line ? " <span class='muted'>line " + mn.line + "</span>" : "") + "</li>";
    }).join("") + "</ul>";
  }
  h += "<h3>Outgoing</h3>" + relList(outE.get(id) || [], "out");
  h += "<h3>Incoming</h3>" + relList(inE.get(id) || [], "in");
  h += "<h3>Links</h3>" + linkSettings();
  detailsEl.innerHTML = h;
  detailsEl.hidden = false;
  detailsEl.scrollTop = 0;
}
function showAbout() {
  var s = DATA.stats;
  var h = "<button class='close' data-close='details' aria-label='Close'>✕</button><h2>About this graph</h2>" +
    "<p>" + esc(DATA.description) + "</p>" +
    "<p class='muted'>Regenerate with <code>" + esc(DATA.regenerate) + "</code>. Machine-readable data: <a href='CODEBASE_GRAPH.json'>CODEBASE_GRAPH.json</a>; architecture notes: <a href='CODEBASE_GRAPH.md'>CODEBASE_GRAPH.md</a>.</p>" +
    "<dl class='kv'><dt>Files analyzed</dt><dd>" + s.filesAnalyzed + "</dd><dt>Nodes</dt><dd>" + s.nodes + "</dd><dt>Edges</dt><dd>" + s.edges +
    " (" + (s.edgesByConfidence.heuristic || 0) + " heuristic)</dd><dt>Excluded</dt><dd>" + DATA.coverage.excluded.map(function (x) { return esc(x.path) + " <span class='muted'>(" + esc(x.reason) + ")</span>"; }).join("<br>") + "</dd></dl>" +
    "<h3>How to read it</h3><ul>" +
    "<li><b>Architecture</b> shows one column per layer, left to right in pipeline order. Files are boxes; their functions, types and macros are rows.</li>" +
    "<li><b>Pipeline</b> shows the compiler stages exactly as <code>src/main.cpp</code> runs them, plus the error path.</li>" +
    "<li>Hover or click a node to highlight its relationships; edge labels appear on highlighted edges.</li>" +
    "<li>Dashed edges are <b>heuristic</b> (matched by text, e.g. a test's expected error message). Everything else was read directly from code.</li>" +
    "<li>Some edge kinds start hidden to keep the picture readable; turn them on under <b>Filters</b>.</li></ul>" +
    "<h3>Links</h3>" + linkSettings();
  detailsEl.innerHTML = h;
  detailsEl.hidden = false;
}
detailsEl.addEventListener("click", function (ev) {
  var go = ev.target.closest("[data-go]");
  if (go) { select(go.getAttribute("data-go"), { reveal: true }); return; }
  if (ev.target.closest("[data-close]")) { detailsEl.hidden = true; select(null, { keepPanel: true }); return; }
  var cp = ev.target.closest("#copyPath");
  if (cp) { try { navigator.clipboard.writeText(cp.getAttribute("data-copy")); cp.textContent = "Copied"; } catch { /* ignore */ } return; }
  if (ev.target.closest("#setRoot")) {
    var v = window.prompt("Absolute path of your FayZul checkout (for vscode:// links)", store("fz-graph-root") || "");
    if (v !== null) { store("fz-graph-root", v); refreshPanel(); }
  }
});
detailsEl.addEventListener("change", function (ev) {
  if (ev.target.id === "linkMode") { store("fz-graph-links", ev.target.value); refreshPanel(); }
});
function refreshPanel() { if (state.selected) showDetails(state.selected); else showAbout(); }

// ---------------------------------------------------------------- filters
function counts(list, f) { var m = {}; list.forEach(function (x) { var k = f(x); m[k] = (m[k] || 0) + 1; }); return m; }
function renderFilters() {
  var nk = counts(NODES, function (n) { return n.kind; }), ek = counts(EDGES, function (e) { return e.kind; });
  var h = "<button class='close' data-close='filters' aria-label='Close filters'>✕</button><h2>Filters</h2>" +
    "<label class='flist'><label><input type='checkbox' id='optHeur'" + (state.heuristic ? " checked" : "") + "> Show heuristic edges <span class='swatch heur' style='border-color:var(--muted)'></span></label></label>" +
    "<div class='row-btns'><button data-act='reset'>Reset</button><button data-act='expand'>Unfold all</button><button data-act='collapse'>Fold all</button></div>" +
    "<h3>Edge kinds</h3><div class='flist'>";
  Object.keys(DATA.edgeKinds).forEach(function (k) {
    if (!ek[k]) return;
    h += "<label title='" + esc(DATA.edgeKinds[k]) + "'><input type='checkbox' data-ek='" + esc(k) + "'" + (state.hiddenEdges.has(k) ? "" : " checked") + ">" +
      "<span class='swatch' style='border-color:" + edgeColor(k) + "'></span>" + esc(k) + "<span class='n'>" + ek[k] + "</span></label>";
  });
  h += "</div><h3>Node kinds</h3><div class='flist'>";
  Object.keys(DATA.nodeKinds).forEach(function (k) {
    if (!nk[k]) return;
    h += "<label title='" + esc(DATA.nodeKinds[k]) + "'><input type='checkbox' data-nk='" + esc(k) + "'" + (state.hiddenNodes.has(k) ? "" : " checked") + ">" +
      glyphHtml(k) + esc(k) + "<span class='n'>" + nk[k] + "</span></label>";
  });
  h += "</div><h3>Layers</h3><div class='flist'>";
  DATA.layers.forEach(function (l) {
    h += "<label title='" + esc(l.description) + "'><input type='checkbox' data-ly='" + esc(l.id) + "'" + (state.hiddenLayers.has(l.id) ? "" : " checked") + ">" + esc(l.title) + "</label>";
  });
  h += "</div><p class='muted'>Filters apply to the Architecture view. The Pipeline view always shows pipeline and diagnostic edges.</p>";
  filtersEl.innerHTML = h;
}
filtersEl.addEventListener("change", function (ev) {
  var t = ev.target;
  if (t.id === "optHeur") state.heuristic = t.checked;
  else if (t.hasAttribute("data-ek")) { var k = t.getAttribute("data-ek"); if (t.checked) state.hiddenEdges.delete(k); else state.hiddenEdges.add(k); }
  else if (t.hasAttribute("data-nk")) { var n = t.getAttribute("data-nk"); if (t.checked) state.hiddenNodes.delete(n); else state.hiddenNodes.add(n); }
  else if (t.hasAttribute("data-ly")) { var l = t.getAttribute("data-ly"); if (t.checked) state.hiddenLayers.delete(l); else state.hiddenLayers.add(l); }
  render();
});
filtersEl.addEventListener("click", function (ev) {
  var b = ev.target.closest("button"); if (!b) return;
  if (b.hasAttribute("data-close")) { toggleFilters(false); return; }
  var act = b.getAttribute("data-act");
  if (act === "reset") {
    state.hiddenNodes = new Set(DEFAULT_HIDDEN_NODES); state.hiddenEdges = new Set(DEFAULT_HIDDEN_EDGES);
    state.hiddenLayers.clear(); state.heuristic = true; defaultCollapse();
  } else if (act === "expand") state.collapsed.clear();
  else if (act === "collapse") children.forEach(function (_, id) { state.collapsed.add(id); });
  renderFilters(); render();
});
function toggleFilters(open) {
  var btn = document.getElementById("btnFilters");
  if (open === undefined) open = filtersEl.hidden;
  if (open) { renderFilters(); if (window.innerWidth < 760) detailsEl.hidden = true; }
  filtersEl.hidden = !open; btn.setAttribute("aria-expanded", String(open));
}

// ---------------------------------------------------------------- search
var qEl = document.getElementById("q"), resEl = document.getElementById("results"), results = [], cursor = 0;
function search(q) {
  q = q.trim().toLowerCase();
  if (!q) return [];
  var scored = [];
  NODES.forEach(function (n) {
    var name = n.name.toLowerCase(), s = 0;
    if (name === q || (n.short || "").toLowerCase() === q + "()") s = 100;
    else if (name.indexOf(q) === 0 || name.split("::").pop().indexOf(q) === 0) s = 60;
    else if (name.indexOf(q) >= 0) s = 40;
    else if ((n.path || "").toLowerCase().indexOf(q) >= 0) s = 20;
    else if (n.kind.indexOf(q) === 0) s = 10;
    if (s) scored.push([s - Math.min(9, name.length / 10), n]);
  });
  scored.sort(function (a, b) { return b[0] - a[0] || a[1].order - b[1].order; });
  return scored.map(function (x) { return x[1]; });
}
function showResults() {
  var all = search(qEl.value);
  results = all.slice(0, 40); cursor = 0;
  state.matches = new Set();
  all.forEach(function (n) { var s = shown(n.id); if (s) state.matches.add(s); });
  applyHighlight();
  if (!qEl.value.trim()) { resEl.hidden = true; return; }
  resEl.innerHTML = results.length ? results.map(function (n, i) {
    return "<button role='option' aria-selected='" + (i === 0) + "' data-i='" + i + "'>" + glyphHtml(n.kind) + "<span class='r-name'>" + esc(n.name) + "</span><span class='r-path'>" +
      esc(n.path ? n.path + (n.line ? ":" + n.line : "") : n.kind) + "</span></button>";
  }).join("") + (all.length > 40 ? "<div class='muted' style='padding:6px 10px'>" + all.length + " matches; refine the search</div>" : "")
    : "<div class='muted' style='padding:8px 10px'>No matches</div>";
  resEl.hidden = false;
}
function pick(i) {
  var n = results[i]; if (!n) return;
  resEl.hidden = true; qEl.blur();
  select(n.id, { reveal: true });
}
qEl.addEventListener("input", showResults);
qEl.addEventListener("focus", function () { if (qEl.value.trim()) showResults(); });
qEl.addEventListener("keydown", function (ev) {
  if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
    ev.preventDefault();
    cursor = Math.max(0, Math.min(results.length - 1, cursor + (ev.key === "ArrowDown" ? 1 : -1)));
    resEl.querySelectorAll("button").forEach(function (b, i) { b.setAttribute("aria-selected", String(i === cursor)); if (i === cursor) b.scrollIntoView({ block: "nearest" }); });
  } else if (ev.key === "Enter") { ev.preventDefault(); pick(cursor); }
  else if (ev.key === "Escape") { qEl.value = ""; showResults(); qEl.blur(); }
});
resEl.addEventListener("mousedown", function (ev) { var b = ev.target.closest("button[data-i]"); if (b) { ev.preventDefault(); pick(+b.getAttribute("data-i")); } });
document.addEventListener("click", function (ev) { if (!ev.target.closest(".search")) resEl.hidden = true; });

// ---------------------------------------------------------------- controls
function syncButtons() {
  document.querySelectorAll("[data-view]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-view") === state.view)); });
  document.querySelectorAll("[data-detail]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-detail") === state.detail)); b.disabled = state.view === "pipeline"; });
}
document.querySelectorAll("[data-view]").forEach(function (b) {
  b.addEventListener("click", function () { state.view = b.getAttribute("data-view"); syncButtons(); render(); fitView(state.view === "pipeline" ? "all" : "height"); });
});
document.querySelectorAll("[data-detail]").forEach(function (b) {
  b.addEventListener("click", function () { state.detail = b.getAttribute("data-detail"); syncButtons(); render(); fitView("height"); });
});
document.getElementById("btnFilters").addEventListener("click", function () { toggleFilters(); });
document.getElementById("btnAbout").addEventListener("click", function () { select(null, { keepPanel: true }); showAbout(); });
document.getElementById("btnFit").addEventListener("click", function () { fitView("all"); });
document.getElementById("zin").addEventListener("click", function () { var r = svg.getBoundingClientRect(); zoomAt(1.25, r.width / 2, r.height / 2); });
document.getElementById("zout").addEventListener("click", function () { var r = svg.getBoundingClientRect(); zoomAt(0.8, r.width / 2, r.height / 2); });
document.getElementById("btnTheme").addEventListener("click", function () {
  var next = theme() === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next); store("fz-graph-theme", next);
  drawMarkers(); render(); if (!filtersEl.hidden) renderFilters();
});
document.addEventListener("keydown", function (ev) {
  if (ev.target.closest && ev.target.closest("input, select, textarea")) return;
  if (ev.key === "/") { ev.preventDefault(); qEl.focus(); }
  else if (ev.key === "f" || ev.key === "F") fitView("all");
  else if (ev.key === "+" || ev.key === "=") document.getElementById("zin").click();
  else if (ev.key === "-") document.getElementById("zout").click();
  else if (ev.key === "Escape") { select(null); toggleFilters(false); }
});
window.addEventListener("resize", function () { if (state.view === "pipeline") { render(); fitView("all"); } });
if (window.matchMedia) {
  var mq = window.matchMedia("(prefers-color-scheme: dark)");
  if (mq.addEventListener) mq.addEventListener("change", function () { drawMarkers(); render(); });
}
function updateStats() {
  document.getElementById("stats").textContent = DATA.stats.filesAnalyzed + " files · " + DATA.stats.nodes + " nodes · " + DATA.stats.edges + " edges · showing " + L.pos.size + " nodes, " + AGG.length + " links";
}

// ---------------------------------------------------------------- start
var savedTheme = store("fz-graph-theme");
if (savedTheme === "light" || savedTheme === "dark") document.documentElement.setAttribute("data-theme", savedTheme);
drawMarkers();
syncButtons();
render();
fitView("height");
window.addEventListener("hashchange", function () {
  var h = /^#n=(.+)$/.exec(location.hash);
  var id = h ? decodeURIComponent(h[1]) : null;
  if (id && id !== state.selected && byId.has(id)) select(id, { reveal: true });
});
var m = /^#n=(.+)$/.exec(location.hash);
if (m && byId.has(decodeURIComponent(m[1]))) select(decodeURIComponent(m[1]), { reveal: true });
else if (window.innerWidth >= 1100) showAbout();
window.FZGRAPH = { state: state, select: select, render: render, data: DATA, layout: function () { return L; }, edgesShown: function () { return AGG.length; } };
})();
</script>
</body>
</html>
`;

// =============================================================================
// Markdown architecture document (every table is computed from the graph)
// =============================================================================
function sentence(text) {
    return /[.!?]$/.test(text) ? text : text.replace(/[:;,]$/, "") + ".";
}

function renderMarkdown(json) {
    const byId = new Map(json.nodes.map((n) => [n.id, n]));
    const out = (id) => json.edges.filter((e) => e.source === id);
    const inc = (id) => json.edges.filter((e) => e.target === id);
    const name = (id) => (byId.get(id) ? byId.get(id).name : id);
    const src = (p, line) => "[`" + p + (line ? ":" + line : "") + "`](../" + p + (line ? "#L" + line : "") + ")";
    const srcShort = (p, line) => "[" + path.posix.basename(p) + ":" + line + "](../" + p + "#L" + line + ")";
    const cell = (s) => String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
    const short = (id) => {
        const n = byId.get(id);
        if (!n) return id;
        return n.kind === "method" || n.kind === "function" ? n.name.split("::").pop() : n.name;
    };
    const lines = [];
    const add = (...ls) => lines.push(...ls);
    const s = json.stats;
    const layerTitle = new Map(json.layers.map((l) => [l.id, l.title]));
    let mermaidIds = new Map();
    const mid = (id) => {
        if (!mermaidIds.has(id)) mermaidIds.set(id, "n" + mermaidIds.size);
        return mermaidIds.get(id);
    };
    const mlabel = (text) => "\"" + String(text).replace(/"/g, "'").replace(/</g, "&lt;").replace(/>/g, "&gt;") + "\"";

    add("# FayZul Codebase Graph", "",
        "> Generated by `" + json.generator + "` from the source code. Do not edit by hand; regenerate with",
        "> `" + json.regenerate + "`.", "",
        "- Interactive graph: [CODEBASE_GRAPH.html](CODEBASE_GRAPH.html) (open in a browser; works offline)",
        "- Machine-readable data: [CODEBASE_GRAPH.json](CODEBASE_GRAPH.json)",
        "- Generator: [`" + json.generator + "`](../" + json.generator + ")", "",
        "Every relationship in this document and in the graph was extracted from the code and carries evidence",
        "(file, line, and source text). " + s.edges + " edges connect " + s.nodes + " nodes across " + s.filesAnalyzed +
        " analyzed files; " + (s.edgesByConfidence.heuristic || 0) + " edges are marked *heuristic* (text matching, see",
        "[How the graph is built](#9-how-the-graph-is-built)).", "");

    add("## Contents", "",
        "1. [Overview](#1-overview)", "2. [Compiler pipeline](#2-compiler-pipeline)", "3. [Module dependencies](#3-module-dependencies)",
        "4. [Components](#4-components)", "5. [AST data model](#5-ast-data-model)", "6. [Language vocabulary](#6-language-vocabulary)",
        "7. [Tests](#7-tests)", "8. [VS Code extension](#8-vs-code-extension)", "9. [How the graph is built](#9-how-the-graph-is-built)",
        "10. [Graph data format](#10-graph-data-format)", "11. [Coverage and limitations](#11-coverage-and-limitations)", "");

    // ------------------------------------------------------------------ 1
    add("## 1. Overview", "",
        "FayZul is compiled by a C++17 program in `src/`: a lexer, a recursive-descent parser that builds an AST,",
        "a semantic analyzer, and a code generator that emits C++17. `src/main.cpp` drives these stages, writes",
        "the generated C++ to `build/`, compiles it with g++, and runs the result. The FayZul vocabulary lives in",
        "one JSON file; a Node.js tool generates the C++ macro headers and the VS Code grammar from it.", "",
        "| Layer | Files | Role |", "|---|---|---|");
    for (const layer of json.layers) {
        const files = json.nodes.filter((n) => n.layer === layer.id && (n.kind === "file" || n.kind === "fz-program"));
        const others = json.nodes.filter((n) => n.layer === layer.id && !n.parent && n.kind !== "file");
        const list = files.map((f) => "[`" + f.path + "`](../" + f.path + ")");
        if (!files.length && others.length) list.push(others.length + " " + (layer.id === "external" ? "external dependencies" : "nodes"));
        if (!list.length) continue;
        add("| " + layer.title + " | " + list.join("<br>") + " | " + cell(layer.description) + " |");
    }
    add("");

    // ------------------------------------------------------------------ 2
    add("## 2. Compiler pipeline", "",
        "The stages below are the order in which `main()` in [`src/main.cpp`](../src/main.cpp) runs them. Each arrow",
        "was verified against the line cited in the table; the generator drops (and reports) any step whose code changed.", "",
        "```mermaid", "flowchart LR");
    mermaidIds = new Map();
    const pipeIds = [];
    for (const st of json.pipeline) for (const id of [st.from, st.to]) if (!pipeIds.includes(id)) pipeIds.push(id);
    for (const id of pipeIds) {
        const n = byId.get(id);
        const shape = n.kind === "data" || n.kind === "artifact" ? ["[/", "/]"] : n.kind === "tool" ? ["{{", "}}"] : n.kind === "struct" ? ["[(", ")]"] : ["[", "]"];
        add("    " + mid(id) + shape[0] + mlabel(n.name) + shape[1]);
    }
    for (const st of json.pipeline) add("    " + mid(st.from) + " -->|" + mlabel(st.label) + "| " + mid(st.to));
    add("```", "", "| # | From | Step | To | Evidence |", "|---:|---|---|---|---|");
    json.pipeline.forEach((st, i) => {
        const e = json.edges.find((x) => x.kind === "pipeline" && x.source === st.from && x.target === st.to);
        add("| " + (i + 1) + " | " + cell(name(st.from)) + " | " + cell(st.label) + " | " + cell(name(st.to)) + " | " +
            e.evidence.map((v) => srcShort(v.path, v.line)).join(", ") + " |");
    });
    add("");
    const dataflow = json.edges.filter((e) => e.kind === "dataflow");
    if (dataflow.length) {
        add("**Values passed between components** (a value returned by one call and passed into another, found in the code):", "",
            "| Producer | Value | Consumer | Evidence |", "|---|---|---|---|");
        for (const e of dataflow) {
            add("| " + cell(name(e.source)) + " | `" + (e.details || []).join("`, `") + "` | " + cell(name(e.target)) + " | " +
                e.evidence.map((v) => srcShort(v.path, v.line)).join(", ") + " |");
        }
        add("");
    }
    const raisers = json.edges.filter((e) => (e.kind === "raises" || e.kind === "reports") && e.target === "data:diagnostics");
    add("**Error path.** Every stage reports the first error and stops. These functions throw `std::runtime_error` or print",
        "to stderr; `main()` catches each stage's exception and prints it:", "",
        "| Function | How | Message prefix | Evidence |", "|---|---|---|---|");
    for (const e of raisers) {
        add("| " + cell(name(e.source)) + " | " + e.label + " | " + (byId.get(e.source).meta && byId.get(e.source).meta.messagePrefixes ? byId.get(e.source).meta.messagePrefixes.map((x) => "`" + x + "`").join(" ") : "") + " | " +
            e.evidence.slice(0, 3).map((v) => srcShort(v.path, v.line)).join(", ") + (e.evidence.length > 3 ? " (+" + (e.evidence.length - 3) + ")" : "") + " |");
    }
    add("");

    // ------------------------------------------------------------------ 3
    add("## 3. Module dependencies", "", "### C++ `#include` graph", "", "```mermaid", "graph TD");
    mermaidIds = new Map();
    const cppFiles = json.nodes.filter((n) => n.kind === "file" && /\.(h|cpp)$/.test(n.path));
    for (const f of cppFiles) add("    " + mid(f.id) + "[" + mlabel(f.path.replace(/^src\//, "")) + "]");
    for (const e of json.edges.filter((x) => x.kind === "includes" && x.target.startsWith("file:"))) add("    " + mid(e.source) + " --> " + mid(e.target));
    add("```", "", "| File | Includes (project) | Includes (standard library) |", "|---|---|---|");
    for (const f of cppFiles) {
        const es = out(f.id).filter((e) => e.kind === "includes");
        add("| " + src(f.path) + " | " + es.filter((e) => e.target.startsWith("file:")).map((e) => "`" + byId.get(e.target).path.replace(/^src\//, "") + "`").join(", ") +
            " | " + es.filter((e) => !e.target.startsWith("file:")).map((e) => "`" + byId.get(e.target).name + "`").join(" ") + " |");
    }
    add("", "### Node.js modules", "", "| File | require() | Reads | Writes | Executes |", "|---|---|---|---|---|");
    for (const f of json.nodes.filter((n) => n.kind === "file" && n.path.endsWith(".js"))) {
        const fnIds = new Set(json.nodes.filter((n) => n.parent === f.id).map((n) => n.id).concat(f.id));
        const io = (kind) => sortedUnique(json.edges.filter((e) => e.kind === kind && fnIds.has(e.source) && !e.target.startsWith("json:"))
            .map((e) => "`" + (byId.get(e.target).path || byId.get(e.target).name) + "`")).join(", ");
        add("| " + src(f.path) + " | " + out(f.id).filter((e) => e.kind === "requires").map((e) => "`" + name(e.target) + "`").join(", ") +
            " | " + io("reads") + " | " + io("writes") + " | " + io("executes") + " |");
    }
    add("");

    // ------------------------------------------------------------------ 4
    add("## 4. Components", "",
        "Calls are resolved statically: unqualified calls inside a class go to that class's methods, `obj.method()`",
        "resolves when `obj` is a local of a project class, and free functions resolve through the include graph.",
        "`--verify-gcc` compares the C++ part with g++'s own call graph.", "");
    const componentTable = (title, fnNodes, intro) => {
        if (!fnNodes.length) return;
        add("### " + title, "");
        if (intro) add(intro, "");
        add("| Function | Defined | Calls | Called by |", "|---|---|---|---|");
        for (const n of fnNodes) {
            const calls = sortedUnique(out(n.id).filter((e) => e.kind === "calls").map((e) => short(e.target)));
            const callers = sortedUnique(inc(n.id).filter((e) => e.kind === "calls").map((e) => short(e.source)));
            add("| `" + cell(n.short || n.name) + "` | " + srcShort(n.path, n.line) + " | " + cell(calls.join(", ")) + " | " + cell(callers.join(", ") || "—") + " |");
        }
        add("");
    };
    for (const cls of json.nodes.filter((n) => n.kind === "class" && n.path && n.path.startsWith("src/"))) {
        const methods = json.nodes.filter((n) => n.owner === cls.id && n.kind === "method").sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
        const file = byId.get(cls.parent);
        componentTable("`" + cls.name + "` (" + layerTitle.get(cls.layer) + ")", methods,
            "Declared in " + src(cls.path, cls.line) + (file && file.meta && file.meta.summary ? ". " + sentence(file.meta.summary) : "."));
    }
    for (const f of json.nodes.filter((n) => n.kind === "file" && (n.path.endsWith(".js") || n.path === "src/main.cpp" || n.path === "src/token.h" || n.path === "src/semantic.cpp"))) {
        const fns = json.nodes.filter((n) => n.parent === f.id && (n.kind === "function" || (n.kind === "method" && !n.path.startsWith("src/"))));
        componentTable("`" + f.path + "`", fns, f.meta && f.meta.summary ? sentence(f.meta.summary) : "");
    }
    const unused = json.nodes.filter((n) => (n.kind === "method" || n.kind === "function") && n.path && n.path.startsWith("src/") &&
        !inc(n.id).some((e) => ["calls", "pipeline", "dataflow", "invokes"].includes(e.kind)) && n.name !== "main");
    if (unused.length) {
        add("**Never called** (no call site anywhere in the analyzed code): " +
            unused.map((n) => "`" + n.name + "` (" + srcShort(n.path, n.line) + ")").join(", ") + ".", "");
    }

    // ------------------------------------------------------------------ 5
    add("## 5. AST data model", "",
        "All AST nodes derive from `ASTNode` and carry a `NodeKind` tag, so later stages dispatch with a `switch`",
        "and `static_cast` instead of `dynamic_cast`. *Created by* lists `std::make_unique` sites; *consumed by*",
        "lists functions that `static_cast` to the type.", "",
        "| Type | Tag | Fields | Created by | Consumed by |", "|---|---|---|---|---|");
    for (const t of json.nodes.filter((n) => n.kind === "struct" && n.path && (n.path === "src/ast.h" || n.path === "src/token.h"))) {
        const fields = ((t.meta && t.meta.fields) || []).map((f) => "`" + f.name + "`: `" + f.type + "`").join("<br>");
        const created = sortedUnique(inc(t.id).filter((e) => e.kind === "creates").map((e) => short(e.source)));
        const consumed = sortedUnique(inc(t.id).filter((e) => e.kind === "casts").map((e) => short(e.source)));
        add("| [`" + t.name + "`](../" + t.path + "#L" + t.line + ")" + (t.meta && t.meta.bases ? " : `" + t.meta.bases.join(", ") + "`" : "") +
            " | " + (t.meta && t.meta.tag ? "`" + t.meta.tag + "`" : "") + " | " + fields + " | " + cell(created.join(", ")) + " | " + cell(consumed.join(", ")) + " |");
    }
    add("");
    for (const en of json.nodes.filter((n) => n.kind === "enum")) {
        const users = sortedUnique(inc(en.id).filter((e) => e.kind === "uses-enum" && byId.get(e.source).kind !== "struct").map((e) => short(e.source)));
        add("- [`" + en.name + "`](../" + en.path + "#L" + en.line + ") has " + en.meta.members.length + " members and is used by " + users.length + " functions: " +
            users.map((u) => "`" + u + "`").join(", ") + ".");
    }
    add("");

    // ------------------------------------------------------------------ 6
    add("## 6. Language vocabulary", "",
        "`language/language-definition.json` is the single source of FayZul words. The chain from a word to the",
        "compiler is: JSON entry, generated `#define` in `keywords.h` / `operators.h`, the lexer's keyword table",
        "(`Lexer::Lexer`) mapping the macro to a `TokenType`, then the parser functions that consume that token.", "",
        "```mermaid", "flowchart LR");
    mermaidIds = new Map();
    const vocabFlow = json.edges.filter((e) => ["reads", "writes", "references"].includes(e.kind) &&
        [e.source, e.target].some((id) => /language-definition\.json|keywords\.h|operators\.h|tmLanguage\.json|extension\.js$/.test(id)) &&
        !e.target.startsWith("json:"));
    const fileOf = (id) => {
        const n = byId.get(id);
        return n.parent && byId.get(n.parent).kind === "file" ? byId.get(n.parent) : n;
    };
    const flowPairs = new Set();
    for (const e of vocabFlow) {
        const a = e.kind === "reads" ? fileOf(e.target) : fileOf(e.source);
        const b = e.kind === "reads" ? fileOf(e.source) : fileOf(e.target);
        const key = a.id + ">" + b.id;
        if (a.id === b.id || flowPairs.has(key)) continue;
        flowPairs.add(key);
        add("    " + mid(a.id) + "[" + mlabel(a.path || a.name) + "] -->|" + mlabel(e.kind === "reads" ? "read by" : e.kind) + "| " + mid(b.id) + "[" + mlabel(b.path || b.name) + "]");
    }
    for (const f of ["src/keywords.h", "src/operators.h"]) {
        for (const e of json.edges.filter((x) => x.kind === "includes" && x.target === "file:" + f)) {
            const key = e.target + ">" + e.source;
            if (flowPairs.has(key)) continue;
            flowPairs.add(key);
            add("    " + mid(e.target) + "[" + mlabel(f) + "] -->|\"#include\"| " + mid(e.source) + "[" + mlabel(byId.get(e.source).path) + "]");
        }
    }
    add("```", "");
    const programs = json.nodes.filter((n) => n.kind === "test-case" || n.kind === "fz-program");
    add("| Word | Section | Macro | TokenType | Code using the macro | .fz programs using it |", "|---|---|---|---|---|---:|");
    for (const t of json.nodes.filter((n) => n.kind === "language-term")) {
        const gen = out(t.id).find((e) => e.kind === "generates");
        const macro = gen ? byId.get(gen.target) : null;
        const users = macro ? sortedUnique(inc(macro.id).filter((e) => e.kind === "uses-macro").map((e) => short(e.source))) : [];
        const used = programs.filter((p) => p.meta && p.meta.termsUsed && p.meta.termsUsed.includes(t.name)).length;
        add("| [`" + cell(t.name) + "`](../" + t.path + "#L" + t.line + ") | " + t.meta.section + " | " + (macro ? "[`" + macro.name + "`](../" + macro.path + "#L" + macro.line + ")" : "") +
            " | " + (macro && macro.meta.tokenType ? "`" + macro.meta.tokenType + "`" : "") + " | " + cell(users.join(", ")) + " | " + used + " |");
    }
    add("", "Arithmetic symbols have no macros: the lexer matches them as single characters in `Lexer::tokenize`.", "");

    // ------------------------------------------------------------------ 7
    const suites = json.nodes.filter((n) => n.kind === "test-suite");
    const cases = json.nodes.filter((n) => n.kind === "test-case");
    add("## 7. Tests", "",
        "[`tests/run-tests.js`](../tests/run-tests.js) builds the compiler, then runs every `tests/cases/**/*.fz` in a",
        "temporary directory. A case with `name.out` must compile and print exactly that output; a case with",
        "`name.err` must fail and print every line of it. Each `examples/*.fz` program is also run as a smoke test.", "",
        "Test totals: " + cases.length + " cases (" + cases.filter((c) => c.meta.expect === "output").length + " output, " +
        cases.filter((c) => c.meta.expect === "error").length + " error" +
        (cases.some((c) => c.meta.expect === "missing") ? ", " + cases.filter((c) => c.meta.expect === "missing").length + " without expectation" : "") +
        ") plus " + json.nodes.filter((n) => n.kind === "fz-program").length + " example programs.", "",
        "| Suite | Cases | Output | Error | Functions whose errors are expected |", "|---|---:|---:|---:|---|");
    for (const st of suites) {
        const mine = cases.filter((c) => c.parent === st.id);
        const fns = sortedUnique(mine.flatMap((c) => out(c.id).filter((e) => e.kind === "expects-error").map((e) => short(e.target))));
        add("| `" + st.path + "` | " + mine.length + " | " + (st.meta.out || 0) + " | " + (st.meta.err || 0) + " | " + cell(fns.join(", ")) + " |");
    }
    add("", "**Which code each error test exercises.** `expects-error` edges come from two sources: the message",
        "prefix (exact: the `[Parser Error]` literal is in `Parser::parseError`), and the message text (heuristic:",
        "a string literal of 15+ characters that occurs in exactly one function and appears in the expected line).", "",
        "| Function | Error tests (prefix) | Error tests (message) |", "|---|---:|---:|");
    const targets = sortedUnique(json.edges.filter((e) => e.kind === "expects-error").map((e) => e.target));
    for (const id of targets) {
        const es = inc(id).filter((e) => e.kind === "expects-error");
        add("| `" + name(id) + "` | " + es.filter((e) => e.confidence === "exact").length + " | " + es.filter((e) => e.confidence !== "exact").length + " |");
    }
    const unlinked = cases.filter((c) => c.meta.expect === "error" && !out(c.id).some((e) => e.kind === "expects-error" && e.confidence !== "exact"));
    if (unlinked.length) {
        add("", "Error tests whose message could not be tied to a single function (the expected text is built from",
            "macros or fragments shared by several functions, or comes from g++ itself): " + unlinked.map((c) => "`" + c.path.replace("tests/cases/", "") + "`").join(", ") + ".");
    }
    add("");

    // ------------------------------------------------------------------ 8
    add("## 8. VS Code extension", "");
    const ext = json.edges.filter((e) => e.source === "ext:vscode-host" || e.kind === "registers" ||
        (e.source.startsWith("file:vscode-extension/") && e.kind === "references") || (e.source.startsWith("fn:vscode-extension/") && e.kind === "reads") ||
        e.source === "file:.vscode/launch.json");
    add("| From | Relationship | To | Evidence |", "|---|---|---|---|");
    for (const e of ext) {
        add("| " + cell(name(e.source)) + " | " + cell(e.label) + " | " + cell(name(e.target)) + " | " + e.evidence.slice(0, 3).map((v) => srcShort(v.path, v.line)).join(", ") + " |");
    }
    add("", "The extension never imports compiler code: it shares the vocabulary with the compiler only through",
        "`language/language-definition.json` (read at activation) and the generated `fayzul.tmLanguage.json`.", "");

    // ------------------------------------------------------------------ 9
    add("## 9. How the graph is built", "",
        "1. **Discovery.** All files under the repository root are listed, except " + json.coverage.excluded.map((x) => "`" + x.path + "` (" + x.reason + ")").join(", ") + ".",
        "2. **Lexing.** C++, JavaScript (including template literals and regex literals), and `.fz` sources are lexed so",
        "   that comments and string contents are blanked while offsets stay the same. Structural scans therefore never",
        "   match text inside strings or comments, and every match maps back to an exact line.",
        "3. **C++ structure.** `#include`, `#define`, `enum class`, `struct`/`class` (with bases and fields), `using`",
        "   aliases, member declarations, and function definitions (bodies found by brace matching).",
        "4. **C++ bodies.** Calls, `std::make_unique<T>`, `static_cast<T>`, constructor calls, local objects of project",
        "   classes, `Enum::Member` uses, macro uses, `throw std::runtime_error`, `std::cerr`, and dataflow of the form",
        "   `x = f(...)` followed by `g(..., x, ...)` across components.",
        "5. **JavaScript.** `require()`, functions, class methods, object-literal callbacks registered with an API,",
        "   calls (including callbacks passed by name), `path.join`/`path.resolve` expressions evaluated to repository",
        "   paths, and `fs`/`child_process` calls classified as reads, writes, or executes.",
        "6. **Data and docs.** JSON values that are relative paths, the VS Code manifest, markdown links, the language",
        "   definition (words, macros), and test expectations (`.out` / `.err`).",
        "7. **Pipeline.** The only hand-written relationships: " + json.pipeline.length + " steps, each checked against a",
        "   regex in its evidence file. A step whose code no longer matches is dropped and reported.",
        "8. **Validation.** Every edge must have evidence whose text equals the current source line, every id must",
        "   resolve, and every pipeline step must be verified; `--check` also fails when the outputs are stale.", "",
        "Confidence: " + Object.entries(s.edgesByConfidence).map(([k, v]) => v + " " + k).join(", ") +
        ". Heuristic edges come from text matching (expected error messages, paths built from literals relative to the",
        "working directory) and are drawn dashed in the viewer.", "",
        "Independent check: `node " + json.generator + " --verify-gcc` compiles each `src/*.cpp` with",
        "`g++ -fcallgraph-info` and compares g++'s call graph between project functions with the extracted `calls` edges.", "");

    // ------------------------------------------------------------------ 10
    add("## 10. Graph data format", "",
        "`CODEBASE_GRAPH.json` (schema version " + json.schemaVersion + ") contains `nodes`, `edges`, `layers`, `pipeline`,",
        "`stats`, `coverage`, and descriptions of every kind.", "",
        "- **Node:** `id`, `kind`, `name`, `short?`, `layer`, `parent?` (the file or test suite that groups it),",
        "  `owner?` (class of a method), `path?`, `line?`, `signature?`, `order` (layout order), `meta?`.",
        "- **Edge:** `id`, `source`, `target`, `kind`, `label`, `details?`, `confidence` (`exact` or `heuristic`),",
        "  `evidence` (list of `{ path, line, text }`).", "",
        "| Node kind | Count | Meaning |", "|---|---:|---|");
    for (const [k, d] of Object.entries(json.nodeKinds)) if (s.nodesByKind[k]) add("| `" + k + "` | " + s.nodesByKind[k] + " | " + d + " |");
    add("", "| Edge kind | Count | Meaning |", "|---|---:|---|");
    for (const [k, d] of Object.entries(json.edgeKinds)) if (s.edgesByKind[k]) add("| `" + k + "` | " + s.edgesByKind[k] + " | " + d + " |");
    add("");

    // ------------------------------------------------------------------ 11
    add("## 11. Coverage and limitations", "",
        "Analyzed: " + s.filesAnalyzed + " files (" + Object.entries(s.filesByLanguage).map(([k, v]) => v + " " + k).join(", ") + ").",
        "`.out` and `.err` files are folded into their test-case nodes; `.fz` files become test-case or program nodes.", "",
        "Excluded:", "");
    for (const x of json.coverage.excluded) add("- `" + x.path + "`: " + x.reason);
    add("", "Known limitations of the static analysis:", "",
        "- C++ calls through objects are resolved only when the object is a local variable of a project class",
        "  (`Lexer lexer(...)`); `--verify-gcc` reports any call g++ sees that the extraction missed.",
        "- Implicit constructions are not recorded (for example `tokens.emplace_back(TokenType::EndOfFile, ...)`",
        "  constructs a `Token` without naming the type).",
        "- JavaScript method calls on receivers of unknown type (`g.node(...)` where `g` is a parameter) are not resolved;",
        "  calls on `this` and on locals created with `new Class()` are.",
        "- Paths are resolved only when built from string literals, `__dirname`, or variables holding such paths.",
        "- Dataflow edges are recorded only between components (different files or classes) and only for",
        "  `variable = call(...)` followed by a call that receives the variable.",
        "- Run-time behaviour is not traced: which C++ functions each test executes is inferred from expected error",
        "  text, not measured.",
        "- The pipeline order and the layer of each path are hand-written (and the pipeline is verified against",
        "  `src/main.cpp`).", "");

    add("## Regenerating", "", "```sh",
        "node " + json.generator + "               # rewrite docs/CODEBASE_GRAPH.{json,html,md}",
        "node " + json.generator + " --check       # exit 1 if the files are stale or the graph is invalid",
        "node " + json.generator + " --verify-gcc  # also compare C++ calls with g++ -fcallgraph-info",
        "```", "");
    return lines.join("\n");
}

// =============================================================================
// Export: deterministic, validated JSON
// =============================================================================
function edgeLabel(e, details) {
    const list = (n) => details.slice(0, n).join(", ") + (details.length > n ? ", +" + (details.length - n) : "");
    switch (e.kind) {
        case "pipeline": return details[0] || "next";
        case "dataflow": return "passes " + list(3);
        case "includes": return "#include";
        case "requires": return "require()";
        case "inherits": return "extends";
        case "has-field": return "field " + list(3);
        case "uses-enum": return "uses " + list(3);
        case "maps-to": return "maps to " + list(1);
        case "generates": return "emitted as " + list(1);
        case "member": return "declares";
        case "casts": return "casts to";
        case "uses-macro": return "uses macro";
        case "uses-api": return list(2);
        case "reads": case "writes": case "executes": return e.kind + (details.length ? " (" + list(2) + ")" : "");
        case "references": return details.length ? list(1) : "references";
        case "registers": return "registers via " + list(1);
        case "invokes": return "invokes" + (details.length ? " (" + list(1) + ")" : "");
        case "raises": return "throws";
        case "reports": return "prints to stderr";
        case "expects-error": return e.key === "prefix" ? "expects " + details[0].replace(/ prefix$/, "") : "expects message from";
        case "calls": return e.key === "callback" ? "calls (callback)" : "calls";
        default: return e.kind;
    }
}

function repositoryUrl() {
    try {
        const config = fs.readFileSync(path.join(ROOT, ".git", "config"), "utf8");
        const m = config.match(/\[remote "origin"\][^[]*?url\s*=\s*(\S+)/);
        if (!m) return null;
        const gh = m[1].match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/);
        return gh ? "https://github.com/" + gh[1] + "/" + gh[2] : null;
    } catch {
        return null;
    }
}

function includeRank(relPath, ctx, seen = new Set()) {
    if (seen.has(relPath)) return 0;
    seen.add(relPath);
    let r = 0;
    for (const inc of ctx.includes.get(relPath) || []) r = Math.max(r, 1 + includeRank(inc, ctx, seen));
    return r;
}

function exportGraph(g, ctx, pipeline) {
    // Ordering used by the viewer: groups by include depth then path; members by line
    const pipelineOrder = new Map();
    pipeline.forEach((s, i) => {
        if (!pipelineOrder.has(s.from)) pipelineOrder.set(s.from, i);
        if (!pipelineOrder.has(s.to)) pipelineOrder.set(s.to, i + 0.5);
    });
    const groupKey = (n) => {
        if (n.kind === "file") return "0|" + String(includeRank(n.path, ctx)).padStart(2, "0") + "|" + n.path;
        if (n.kind === "test-suite") return "1|" + n.path;
        if (pipelineOrder.has(n.id)) return "2|" + String(pipelineOrder.get(n.id).toFixed(1)).padStart(6, "0");
        return "3|" + n.kind + "|" + n.name;
    };
    const all = [...g.nodes.values()];
    const sortKey = (n) => {
        const top = n.parent ? g.nodes.get(n.parent) : n;
        const layer = String(LAYER_INDEX.get(n.layer)).padStart(2, "0");
        const member = n.parent ? "1|" + String(n.line || 0).padStart(6, "0") + "|" + n.name : "0";
        return layer + "|" + groupKey(top) + "|" + member;
    };
    all.sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : sortKey(a) > sortKey(b) ? 1 : a.id.localeCompare(b.id)));

    const nodes = all.map((n, i) => {
        const meta = { ...n.meta };
        delete meta.defined;
        if (meta.signatures && meta.signatures.length < 2) delete meta.signatures;
        if (meta.declaredSignatures) delete meta.declaredSignatures;
        if (meta.fields && !meta.fields.length) delete meta.fields;
        if (meta.bases && !meta.bases.length) delete meta.bases;
        for (const k of Object.keys(meta)) if (meta[k] === undefined) delete meta[k];
        const out = { id: n.id, kind: n.kind, name: n.name };
        if (n.short && n.short !== n.name) out.short = n.short;
        out.layer = n.layer;
        if (n.parent) out.parent = n.parent;
        if (n.owner) out.owner = n.owner;
        if (n.path) out.path = n.path;
        if (n.line) out.line = n.line;
        if (n.signature) out.signature = n.signature;
        out.order = i;
        if (Object.keys(meta).length) out.meta = meta;
        return out;
    });

    const edges = [...g.edges.values()]
        .map((e) => {
            const details = [...e.details].sort();
            const evidenceList = e.evidence.slice().sort((a, b) => (a.path === b.path ? a.line - b.line : a.path.localeCompare(b.path)));
            return { source: e.source, target: e.target, kind: e.kind, label: edgeLabel(e, details),
                     details: details.length ? details : undefined, confidence: e.confidence,
                     evidence: evidenceList, key: e.key };
        })
        .sort((a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target) ||
                        a.kind.localeCompare(b.kind) || String(a.key || "").localeCompare(String(b.key || "")))
        .map((e, i) => {
            const out = { id: "e" + (i + 1), source: e.source, target: e.target, kind: e.kind, label: e.label };
            if (e.details) out.details = e.details;
            out.confidence = e.confidence;
            out.evidence = e.evidence;
            return out;
        });

    const count = (arr, f) => {
        const m = {};
        for (const x of arr) m[f(x)] = (m[f(x)] || 0) + 1;
        return Object.fromEntries(Object.entries(m).sort());
    };
    const analyzed = ctx.files.map((f) => f.rel);
    return {
        schemaVersion: SCHEMA_VERSION,
        generator: GENERATOR,
        regenerate: "node " + GENERATOR,
        repository: repositoryUrl(),
        sourceRef: SOURCE_REF,
        description: "Dependency graph of the FayZul repository, extracted from the source code. " +
                     "Every edge lists the file, line, and source text it was derived from.",
        stats: {
            nodes: nodes.length,
            edges: edges.length,
            nodesByKind: count(nodes, (n) => n.kind),
            edgesByKind: count(edges, (e) => e.kind),
            edgesByConfidence: count(edges, (e) => e.confidence),
            filesAnalyzed: analyzed.length,
            filesByLanguage: count(ctx.files, (f) => f.lang),
        },
        coverage: {
            analyzedFiles: analyzed,
            excluded: ctx.excluded,
        },
        layers: LAYERS.map((l) => ({ id: l.id, title: l.title, description: l.description })),
        nodeKinds: NODE_KINDS,
        edgeKinds: EDGE_KINDS,
        pipeline,
        warnings: g.warnings.slice(),
        nodes,
        edges,
    };
}

function validateGraph(json, ctx) {
    const errors = [];
    const ids = new Set();
    for (const n of json.nodes) {
        if (ids.has(n.id)) errors.push("Duplicate node id: " + n.id);
        ids.add(n.id);
        if (!NODE_KINDS[n.kind]) errors.push("Unknown node kind " + n.kind + " on " + n.id);
        if (!LAYER_INDEX.has(n.layer)) errors.push("Unknown layer " + n.layer + " on " + n.id);
    }
    const nodeById = new Map(json.nodes.map((n) => [n.id, n]));
    for (const n of json.nodes) {
        if (n.parent && !ids.has(n.parent)) errors.push("Missing parent " + n.parent + " of " + n.id);
        if (n.parent && nodeById.get(n.parent) && nodeById.get(n.parent).parent) errors.push("Nested group " + n.parent + " of " + n.id);
        if (n.owner && !ids.has(n.owner)) errors.push("Missing owner " + n.owner + " of " + n.id);
        const analyzedKinds = !["artifact", "directory", "external", "data", "tool", "test-suite"].includes(n.kind);
        if (analyzedKinds && n.path) {
            const file = ctx.fileByRel.get(n.path);
            if (!file) errors.push("Node " + n.id + " points at a file that was not analyzed: " + n.path);
            else if (!(n.line >= 1 && n.line <= file.lines.length)) errors.push("Node " + n.id + " has line " + n.line + " outside " + n.path);
        }
    }
    const edgeIds = new Set();
    for (const e of json.edges) {
        if (edgeIds.has(e.id)) errors.push("Duplicate edge id " + e.id);
        edgeIds.add(e.id);
        if (!ids.has(e.source)) errors.push("Edge " + e.id + " has unknown source " + e.source);
        if (!ids.has(e.target)) errors.push("Edge " + e.id + " has unknown target " + e.target);
        if (!EDGE_KINDS[e.kind]) errors.push("Edge " + e.id + " has unknown kind " + e.kind);
        if (!["exact", "heuristic"].includes(e.confidence)) errors.push("Edge " + e.id + " has bad confidence");
        if (!e.evidence || !e.evidence.length) errors.push("Edge " + e.id + " (" + e.kind + ") has no evidence");
        for (const ev of e.evidence || []) {
            const file = ctx.fileByRel.get(ev.path);
            if (!file) { errors.push("Edge " + e.id + " evidence file not analyzed: " + ev.path); continue; }
            const text = (file.lines[ev.line - 1] || "").trim();
            const expected = text.length > 200 ? text.slice(0, 197) + "..." : text;
            if (expected !== ev.text) errors.push("Edge " + e.id + " evidence text does not match " + ev.path + ":" + ev.line);
        }
    }
    for (const step of json.pipeline) {
        if (!json.edges.some((e) => e.kind === "pipeline" && e.source === step.from && e.target === step.to)) {
            errors.push("Pipeline step without edge: " + step.from + " -> " + step.to);
        }
    }
    if (json.pipeline.length !== PIPELINE_STEPS.length) errors.push("Only " + json.pipeline.length + " of " + PIPELINE_STEPS.length + " pipeline steps were verified");
    for (const w of json.warnings) errors.push("Warning: " + w);
    return errors;
}

function renderOutputs() {
    const { g, ctx, pipeline } = buildGraph();
    const json = exportGraph(g, ctx, pipeline);
    const errors = validateGraph(json, ctx);
    const jsonText = JSON.stringify(json, null, 1) + "\n";
    return {
        g, ctx, json, errors,
        files: new Map([
            [OUT_JSON, jsonText],
            [OUT_HTML, renderHtml(json)],
            [OUT_MD, renderMarkdown(json)],
        ]),
    };
}

function main() {
    const args = process.argv.slice(2);
    const check = args.includes("--check");
    const { g, ctx, json, errors, files } = renderOutputs();

    console.log("Analyzed " + json.stats.filesAnalyzed + " files: " + json.stats.nodes + " nodes, " + json.stats.edges + " edges (" +
                (json.stats.edgesByConfidence.heuristic || 0) + " heuristic).");
    if (errors.length) {
        console.error("Graph validation failed:");
        for (const e of errors) console.error("  " + e);
        process.exitCode = 1;
    } else {
        console.log("Validation passed: every edge has evidence matching the source, all ids resolve, " +
                    json.pipeline.length + "/" + PIPELINE_STEPS.length + " pipeline steps verified.");
    }

    if (check) {
        const stale = [...files].filter(([p, text]) => !fs.existsSync(p) || fs.readFileSync(p, "utf8") !== text).map(([p]) => rel(p));
        if (stale.length) {
            console.error("Out of date (run: node " + GENERATOR + "): " + stale.join(", "));
            process.exitCode = 1;
        } else {
            console.log("Up to date: " + [...files.keys()].map(rel).join(", "));
        }
    } else if (!errors.length) {
        for (const [p, text] of files) fs.writeFileSync(p, text, "utf8");
        console.log("Wrote:");
        for (const p of files.keys()) console.log("  " + rel(p));
    }

    if (args.includes("--verify-gcc") && !verifyWithGcc(g, ctx)) process.exitCode = 1;
}

if (require.main === module) {
    main();
}
