// =============================================================================
// main.cpp
// FayZul Compiler Driver — CLI Entry Point
//
// PURPOSE:
//   Drives the entire compiler pipeline:
//     1. Read the .fz source file
//     2. Lex it           → token list
//     3. Parse it         → AST
//     4. Generate C++     → generated source string
//     5. Write generated C++ to build/
//     6. Invoke g++ to compile it
//     7. Run the resulting executable
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
#include <stdexcept>
#include <cstdlib>
#include <filesystem>

#include "lexer.h"
#include "parser.h"
#include "codegen.h"

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

    // Optional: print tokens for debugging (remove or disable later)
    // Uncomment the block below to see the token stream:
    /*
    std::cout << "=== Tokens ===\n";
    for (const auto& tok : tokens) {
        std::cout << "  [" << tokenTypeName(tok.type) << "] '"
                  << tok.lexeme << "' @ line " << tok.line
                  << ", col " << tok.column << "\n";
    }
    std::cout << "\n";
    */

    // ----- 4. Parse → AST -----
    std::unique_ptr<ProgramNode> ast;
    try {
        Parser parser(std::move(tokens));
        ast = parser.parse();
    } catch (const std::exception& e) {
        std::cerr << e.what() << "\n";
        return 1;
    }

    // ----- 5. Code generation → C++ source -----
    std::string cppSource;
    try {
        CodeGenerator codegen;
        cppSource = codegen.generate(*ast);
    } catch (const std::exception& e) {
        std::cerr << e.what() << "\n";
        return 1;
    }

    // ----- 6. Determine output paths -----
    // Derive the base name from the input file: "examples/hello.fz" → "hello"
    fs::path inputPath(sourcePath);
    std::string baseName = inputPath.stem().string(); // filename without extension

    // All generated files go into the build/ directory
    fs::path buildDir = "build";
    fs::create_directories(buildDir); // ensure build/ exists

    std::string generatedCppPath = (buildDir / (baseName + ".cpp")).string();
    std::string executablePath   = (buildDir / baseName).string();
    // On Windows, g++ produces an .exe automatically when we specify the name
    std::string executablePathExe = (buildDir / (baseName + ".exe")).string();

    // ----- 7. Write generated C++ -----
    try {
        writeFile(generatedCppPath, cppSource);
    } catch (const std::exception& e) {
        std::cerr << e.what() << "\n";
        return 1;
    }

    std::cout << "=== Generated C++ written to: " << generatedCppPath << " ===\n\n";
    std::cout << cppSource << "\n";

    // ----- 8. Invoke g++ -----
    // We output to the .exe explicitly so the name is predictable on Windows.
    std::string compileCmd = "g++ -o \"" + executablePathExe + "\" \"" + generatedCppPath + "\"";

    std::cout << "=== Compiling: " << compileCmd << " ===\n";
    int compileResult = std::system(compileCmd.c_str());
    if (compileResult != 0) {
        std::cerr << "[FayZul] Compilation failed. g++ returned code: " << compileResult << "\n";
        return 1;
    }

    std::cout << "\nFayZul compiled successfully!\n";
    std::cout << "Running...\n\n";

    // ----- 9. Run the executable -----
    std::string runCmd = "\"" + executablePathExe + "\"";
    int runResult = std::system(runCmd.c_str());

    return runResult;
}
