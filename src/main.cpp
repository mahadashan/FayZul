// =============================================================================
// main.cpp
// FayZul Compiler Driver — CLI Entry Point
//
// PURPOSE:
//   Drives the entire compiler pipeline:
//     1. Read the .fz source file
//     2. Lex it              → token list
//     3. Parse it            → AST
//     4. Semantic analysis   → FayZul errors for meaningless programs
//     5. Generate C++        → generated source string
//     6. Write generated C++ to build/
//     7. Invoke g++ (strict C++17) to compile it
//     8. Run the resulting executable
//
// USAGE:
//   fayzul.exe <source.fz>
//
// The .fz filename is taken from argv[1] — nothing is hardcoded.
// =============================================================================

#include <iostream>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>
#include <set>
#include <regex>
#include <stdexcept>
#include <cstdlib>
#include <filesystem>

#include "lexer.h"
#include "parser.h"
#include "semantic.h"
#include "codegen.h"
#include "keywords.h"

namespace fs = std::filesystem;

// ---------------------------------------------------------------------------
// readFile — load an entire file into a std::string
// ---------------------------------------------------------------------------
static std::string readFile(const std::string& path) {
    std::ifstream file(path);
    if (!file.is_open()) {
        throw std::runtime_error("Cannot open file: " + path);
    }
    std::ostringstream ss;
    ss << file.rdbuf();
    return ss.str();
}

// ---------------------------------------------------------------------------
// writeFile — write a string to a file (creates/overwrites)
// ---------------------------------------------------------------------------
static void writeFile(const std::string& path, const std::string& content) {
    std::ofstream file(path);
    if (!file.is_open()) {
        throw std::runtime_error("Cannot write to file: " + path);
    }
    file << content;
}

// ---------------------------------------------------------------------------
// FayZul-facing names for the C++ types g++ mentions in return-type errors
// ---------------------------------------------------------------------------
static std::string describeCppType(const std::string& cppType) {
    if (cppType == "int")            return "a whole number";
    if (cppType == "double")         return "a decimal number";
    if (cppType == "bool")           return "a boolean";
    if (cppType == "const char*")    return "a string";
    if (cppType == "std::nullptr_t") return "'" + std::string(FZ_NULL) + "'";
    return "'" + cppType + "'";
}

// ---------------------------------------------------------------------------
// translateCppError — make a g++ error message readable in FayZul terms
// ---------------------------------------------------------------------------
static std::string translateCppError(const std::string& message) {
    static const std::regex inconsistent(
        "inconsistent deduction for auto return type: '(.*)' and then '(.*)'");
    std::smatch m;
    if (std::regex_search(message, m, inconsistent)) {
        std::string ret = "'" + std::string(FZ_RETURN) + "'";
        std::string text = "This " + ret + " returns " + describeCppType(m[2]) + ", but an earlier " +
                           ret + " in the same function returned " + describeCppType(m[1]) +
                           ". Every " + ret + " in a function must return the same type for a given call";
        bool numericMix = (m[1] == "int" && m[2] == "double") || (m[1] == "double" && m[2] == "int");
        if (numericMix) {
            text += " (if the function should also work with decimals, write the whole-number "
                    "return as a decimal, e.g. 1.0 instead of 1)";
        }
        return text;
    }

    // Hide generated-name decorations: fz_x -> x, f<void>/f<FZ_CTX> -> f
    std::string text = std::regex_replace(message, std::regex("\\bfz_"), "");
    text = std::regex_replace(text, std::regex("<(void|FZ_CTX)>"), "");
    return text;
}

// ---------------------------------------------------------------------------
// reportCppErrors
//   Prints each g++ error from the generated file at the FayZul line it came
//   from (via the code generator's line map). Falls back to the raw g++
//   output when no error line can be mapped.
// ---------------------------------------------------------------------------
static void reportCppErrors(const std::string& logPath, const std::string& cppFileName,
                            const std::vector<int>& lineMap) {
    std::string log;
    try {
        log = readFile(logPath);
    } catch (const std::exception&) {
        // No log available; fall through to the summary line.
    }

    static const std::regex errorLine("^(.*):([0-9]+):([0-9]+): (?:fatal )?error: (.*)$");
    std::set<std::string> printed;
    std::istringstream lines(log);
    std::string line;
    while (std::getline(lines, line)) {
        if (!line.empty() && line.back() == '\r') line.pop_back();
        std::smatch m;
        if (!std::regex_match(line, m, errorLine)) continue;
        if (fs::path(m[1].str()).filename().string() != cppFileName) continue;

        size_t cppLine = std::stoul(m[2]);
        int fzLine = (cppLine >= 1 && cppLine <= lineMap.size()) ? lineMap[cppLine - 1] : 0;

        std::ostringstream msg;
        msg << "[C++ Error] ";
        if (fzLine > 0) msg << "Line " << fzLine << ": ";
        else            msg << "(generated code): ";
        msg << translateCppError(m[4]);

        if (printed.insert(msg.str()).second) {
            std::cerr << msg.str() << "\n";
        }
    }

    if (printed.empty() && !log.empty()) {
        std::cerr << log;
    }
    std::cerr << "[FayZul] The generated C++ did not compile. Full g++ output: " << logPath << "\n";
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
int main(int argc, char* argv[]) {
    // ----- 1. Parse command-line arguments -----
    if (argc < 2) {
        std::cerr << "Usage: fayzul.exe <source.fz>\n";
        return 1;
    }

    std::string sourcePath = argv[1];

    // ----- 2. Read source file -----
    std::string source;
    try {
        source = readFile(sourcePath);
    } catch (const std::exception& e) {
        std::cerr << e.what() << "\n";
        return 1;
    }

    // ----- 3. Lex -----
    std::vector<Token> tokens;
    try {
        Lexer lexer(source);
        tokens = lexer.tokenize();
    } catch (const std::exception& e) {
        std::cerr << e.what() << "\n";
        return 1;
    }

    // ----- 4. Parse → AST -----
    std::unique_ptr<ProgramNode> ast;
    try {
        Parser parser(std::move(tokens));
        ast = parser.parse();
    } catch (const std::exception& e) {
        std::cerr << e.what() << "\n";
        return 1;
    }

    // ----- 5. Semantic analysis -----
    try {
        SemanticAnalyzer analyzer;
        analyzer.analyze(*ast);
    } catch (const std::exception& e) {
        std::cerr << e.what() << "\n";
        return 1;
    }

    // ----- 6. Code generation → C++ source -----
    std::string cppSource;
    std::vector<int> lineMap;
    try {
        CodeGenerator codegen;
        cppSource = codegen.generate(*ast);
        lineMap   = codegen.lineMap();
    } catch (const std::exception& e) {
        std::cerr << e.what() << "\n";
        return 1;
    }

    // ----- 7. Determine output paths -----
    // Derive the base name from the input file: "examples/hello.fz" → "hello"
    fs::path inputPath(sourcePath);
    std::string baseName = inputPath.stem().string(); // filename without extension

    // All generated files go into the build/ directory
    fs::path buildDir = "build";
    fs::create_directories(buildDir); // ensure build/ exists

    std::string generatedCppPath  = (buildDir / (baseName + ".cpp")).string();
    std::string executablePathExe = (buildDir / (baseName + ".exe")).string();
    std::string compileLogPath    = (buildDir / (baseName + ".gpp.log")).string();

    // ----- 8. Write generated C++ -----
    try {
        writeFile(generatedCppPath, cppSource);
    } catch (const std::exception& e) {
        std::cerr << e.what() << "\n";
        return 1;
    }

    std::cout << "=== Generated C++ written to: " << generatedCppPath << " ===\n\n";
    std::cout << cppSource << "\n";

    // ----- 9. Invoke g++ -----
    // Strict C++17: the generated code must not rely on g++ extensions or on
    // the compiler's default language standard (C++20 in g++ 16).
    std::string compileCmd = "g++ -std=c++17 -pedantic-errors -fno-diagnostics-color -o \"" +
                             executablePathExe + "\" \"" + generatedCppPath + "\"";

    std::cout << "=== Compiling: " << compileCmd << " ===\n";
    // Flush before std::system so our output is not reordered after the
    // child process's output when stdout is a pipe.
    std::cout.flush();

    int compileResult = std::system((compileCmd + " 2> \"" + compileLogPath + "\"").c_str());
    if (compileResult != 0) {
        reportCppErrors(compileLogPath, fs::path(generatedCppPath).filename().string(), lineMap);
        return 1;
    }
    std::error_code ignored;
    fs::remove(compileLogPath, ignored);

    std::cout << "\nFayZul compiled successfully!\n";
    std::cout << "Running...\n\n";
    std::cout.flush();

    // ----- 10. Run the executable -----
    std::string runCmd = "\"" + executablePathExe + "\"";
    int runResult = std::system(runCmd.c_str());

    return runResult;
}
