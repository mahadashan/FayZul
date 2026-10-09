// FayZul VS Code language support
// Completions, hover text, and snippets are built from
// language/language-definition.json — not from a second keyword list.

const vscode = require("vscode");
const fs = require("fs");
const path = require("path");

function loadLanguageDefinition() {
    const defPath = path.join(__dirname, "..", "language", "language-definition.json");
    return JSON.parse(fs.readFileSync(defPath, "utf8"));
}

function allEntries(def) {
    const entries = [];

    for (const kw of def.keywords) {
        entries.push({
            word: kw.word,
            meaning: kw.meaning,
            description: kw.description,
            implemented: kw.implemented,
            snippet: kw.snippet ? kw.snippet.body : null,
            kind: vscode.CompletionItemKind.Keyword
        });
    }

    for (const op of def.comparisonOperators) {
        entries.push({
            word: op.word,
            meaning: op.meaning,
            description: op.description,
            implemented: op.implemented,
            snippet: null,
            kind: vscode.CompletionItemKind.Operator
        });
    }

    for (const op of def.logicalOperators) {
        entries.push({
            word: op.word,
            meaning: op.meaning,
            description: op.description,
            implemented: op.implemented,
            snippet: null,
            kind: vscode.CompletionItemKind.Operator
        });
    }

    return entries;
}

function makeCompletionItem(entry) {
    const item = new vscode.CompletionItem(entry.word, entry.kind);
    item.detail = entry.meaning;
    item.documentation = new vscode.MarkdownString(entry.description);
    if (!entry.implemented) {
        item.documentation.appendMarkdown("\n\n_Reserved — not compiled yet._");
    }
    if (entry.snippet) {
        item.insertText = new vscode.SnippetString(entry.snippet);
    } else {
        item.insertText = entry.word;
    }
    item.filterText = entry.word;
    return item;
}

function activate(context) {
    let def;
    try {
        def = loadLanguageDefinition();
    } catch (err) {
        vscode.window.showErrorMessage(
            "FayZul: could not load language/language-definition.json — " + err.message
        );
        return;
    }

    const entries = allEntries(def);
    const byWord = new Map(entries.map((e) => [e.word, e]));
    const completionItems = entries.map(makeCompletionItem);

    const completions = vscode.languages.registerCompletionItemProvider(
        { language: "fayzul" },
        {
            provideCompletionItems() {
                return completionItems;
            }
        }
    );

    const hovers = vscode.languages.registerHoverProvider(
        { language: "fayzul" },
        {
            provideHover(document, position) {
                const range = document.getWordRangeAtPosition(position);
                if (!range) {
                    return undefined;
                }
                const word = document.getText(range);
                const entry = byWord.get(word);
                if (!entry) {
                    return undefined;
                }
                const md = new vscode.MarkdownString();
                md.appendMarkdown(`**${entry.word}** — ${entry.meaning}\n\n`);
                md.appendMarkdown(entry.description);
                return new vscode.Hover(md, range);
            }
        }
    );

    context.subscriptions.push(completions, hovers);
}

function deactivate() {}

module.exports = { activate, deactivate };
