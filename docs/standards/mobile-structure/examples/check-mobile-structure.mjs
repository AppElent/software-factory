// Copy to scripts/, set the roots below, and run it from the project's `check`
// script. It enforces feature filenames, the src/ui/ import boundary, and
// literal font sizes. Across src/ and app/ it also reports UI text outside the
// message catalog: literal JSX text, readable props (TEXT_ATTRIBUTES, such as
// accessibilityLabel and placeholder), literal toast and alert messages,
// `locale === "…"` branches that pick text, and `*-copy.ts` modules. List words
// that read the same in every language in UNTRANSLATED. Component ownership
// still needs review.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// Adjust to the app. Set messagesRoot to null when the app has no message catalog.
const mobileRoot = "apps/mobile/";
const sourceRoot = `${mobileRoot}src/`;
const routeRoot = `${mobileRoot}app/`;
const featureRoot = `${sourceRoot}features/`;
const uiRoot = `${sourceRoot}ui/`;
const messagesRoot = `${sourceRoot}i18n/`;
/** Units and names that read the same in every supported language. */
const UNTRANSLATED = /\b(?:kcal|kg|km|lb)\b/g;
/** JSX props and object keys that people read or hear. */
const TEXT_ATTRIBUTES = new Set([
	"accessibilityLabel",
	"accessibilityHint",
	"placeholder",
	"title",
	"label",
	"message",
	"confirmLabel",
	"cancelLabel",
	"retryLabel",
]);
/** Calls whose literal arguments are shown to the user. */
const MESSAGE_CALL = /^(?:error|success|alert|convexErrorMessage)$/;
const CATALOG_MESSAGE =
	"Put UI text in the message catalog and read it through the i18n hook.";

const hasWords = (text) => /\p{L}{3,}/u.test(text.replace(UNTRANSLATED, ""));
const unwrap = (node) =>
	ts.isParenthesizedExpression(node) ? unwrap(node.expression) : node;
const literalText = (node) => {
	node = unwrap(node);
	if (ts.isStringLiteralLike(node)) return node.text;
	if (ts.isTemplateExpression(node))
		return [
			node.head.text,
			...node.templateSpans.map((span) => span.literal.text),
		].join(" ");
	return undefined;
};
const wordy = (node) => {
	const text = literalText(node);
	return text !== undefined && hasWords(text);
};
/** A rendered `"…"`, `cond ? "…" : x` or `cond || "…"` value. */
const branchText = (node) => {
	node = unwrap(node);
	if (ts.isConditionalExpression(node))
		return branchText(node.whenTrue) || branchText(node.whenFalse);
	if (
		ts.isBinaryExpression(node) &&
		[
			ts.SyntaxKind.AmpersandAmpersandToken,
			ts.SyntaxKind.BarBarToken,
			ts.SyntaxKind.QuestionQuestionToken,
		].includes(node.operatorToken.kind)
	)
		return (
			(node.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken &&
				branchText(node.left)) ||
			branchText(node.right)
		);
	return wordy(node);
};
const literalSize = (node) => {
	node = unwrap(node);
	return (
		ts.isNumericLiteral(node) ||
		ts.isStringLiteralLike(node) ||
		(ts.isPrefixUnaryExpression(node) && ts.isNumericLiteral(node.operand))
	);
};
const attributeValue = (node) =>
	node.initializer && ts.isJsxExpression(node.initializer)
		? node.initializer.expression
		: node.initializer;

/** Check syntax and direct dependency boundaries; component ownership needs review. */
export function inspectMobileSource(filename, source, resolveImport) {
	const file = filename.replaceAll("\\", "/");
	const feature = file.startsWith(featureRoot);
	const ui = file.startsWith(uiRoot);
	const messages = messagesRoot !== null && file.startsWith(messagesRoot);
	const route = file.startsWith(routeRoot);
	const issues = [];
	if (messagesRoot !== null && !messages && /-copy\.tsx?$/.test(file))
		issues.push({ file, line: 1, rule: "message-catalog", message: CATALOG_MESSAGE });
	if (!route && !file.startsWith(sourceRoot)) return issues;
	const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
	const report = (node, rule, message) => {
		const line =
			tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1;
		issues.push({ file, line, rule, message });
	};
	if (
		feature &&
		!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\.(?:ios|android|native|web|test|spec))*\.(?:ts|tsx)$/.test(
			path.posix.basename(file),
		)
	) {
		issues.push({
			file,
			line: 1,
			rule: "feature-filename",
			message:
				"Use a kebab-case basename; retain it for platform and test suffixes.",
		});
	}
	const checkText =
		messagesRoot !== null &&
		!messages &&
		!/(?:^|\/)(?:__tests__|test-support)\/|\.test\.tsx?$/.test(file);
	const jsx = file.endsWith(".tsx");
	const checkDependency = (literal) => {
		if (!ui || !literal || !ts.isStringLiteralLike(literal)) return;
		const target = resolveImport(literal.text, file)?.replaceAll("\\", "/");
		if (target?.startsWith(featureRoot))
			report(
				literal,
				"ui-feature-import",
				"Generic UI must not import or re-export feature code.",
			);
	};
	const comparesLocale = (condition) => {
		condition = unwrap(condition);
		if (
			!ts.isBinaryExpression(condition) ||
			![
				ts.SyntaxKind.EqualsEqualsEqualsToken,
				ts.SyntaxKind.ExclamationEqualsEqualsToken,
			].includes(condition.operatorToken.kind)
		)
			return false;
		const named = (side) =>
			(ts.isIdentifier(side) || ts.isPropertyAccessExpression(side)) &&
			/locale$/i.test(side.getText(tree));
		const literal = (side) => ts.isStringLiteralLike(side);
		return (
			(named(condition.left) && literal(condition.right)) ||
			(literal(condition.left) && named(condition.right))
		);
	};
	/** Words or sentences, not separators or BCP 47 tags such as "nl-NL". */
	const isText = (node) => {
		const text = literalText(node);
		return text !== undefined && /\p{L}{3,}|\s/u.test(text);
	};
	const hardcodedText = (node) => {
		if (ts.isJsxText(node)) return hasWords(node.text);
		if (ts.isJsxAttribute(node))
			return (
				TEXT_ATTRIBUTES.has(node.name.getText(tree)) &&
				Boolean(attributeValue(node) && branchText(attributeValue(node)))
			);
		if (ts.isJsxExpression(node))
			return (
				!ts.isJsxAttribute(node.parent) &&
				Boolean(node.expression && branchText(node.expression))
			);
		if (jsx && ts.isPropertyAssignment(node))
			return (
				(ts.isIdentifier(node.name) || ts.isStringLiteralLike(node.name)) &&
				TEXT_ATTRIBUTES.has(node.name.text) &&
				wordy(node.initializer)
			);
		if (jsx && ts.isCallExpression(node)) {
			// `console.error(...)` logs for developers; it is not UI text.
			const callee = ts.isPropertyAccessExpression(node.expression)
				? ts.isIdentifier(node.expression.expression) &&
					node.expression.expression.text === "console"
					? ""
					: node.expression.name.text
				: ts.isIdentifier(node.expression)
					? node.expression.text
					: "";
			return MESSAGE_CALL.test(callee) && node.arguments.some(wordy);
		}
		return false;
	};
	const visit = (node) => {
		if (checkText && hardcodedText(node))
			report(node, "hardcoded-ui-text", CATALOG_MESSAGE);
		if (
			checkText &&
			ts.isConditionalExpression(node) &&
			comparesLocale(node.condition) &&
			(isText(node.whenTrue) || isText(node.whenFalse))
		)
			report(
				node,
				"inline-locale-text",
				"Put UI text in the message catalog instead of branching on the locale.",
			);
		if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
			checkDependency(node.moduleSpecifier);
		if (
			ts.isImportEqualsDeclaration(node) &&
			ts.isExternalModuleReference(node.moduleReference)
		)
			checkDependency(node.moduleReference.expression);
		if (
			ts.isCallExpression(node) &&
			(node.expression.kind === ts.SyntaxKind.ImportKeyword ||
				(ts.isIdentifier(node.expression) &&
					node.expression.text === "require"))
		)
			checkDependency(node.arguments[0]);
		const fontSize =
			feature &&
			(ts.isPropertyAssignment(node)
				? (() => {
						const name = ts.isComputedPropertyName(node.name)
							? node.name.expression
							: node.name;
						return (
							(ts.isIdentifier(name) || ts.isStringLiteralLike(name)) &&
							name.text === "fontSize" &&
							literalSize(node.initializer)
						);
					})()
				: ts.isJsxAttribute(node) &&
					node.name.getText(tree) === "fontSize" &&
					Boolean(attributeValue(node) && literalSize(attributeValue(node))));
		if (fontSize)
			report(
				node,
				"feature-font-size",
				"Use a shared theme typography token instead of a literal fontSize.",
			);
		ts.forEachChild(node, visit);
	};
	visit(tree);
	return issues;
}

export function checkMobileArchitecture(root) {
	const configPath = path.join(root, mobileRoot, "tsconfig.json");
	const config = ts.readConfigFile(configPath, ts.sys.readFile);
	if (config.error)
		throw new Error(
			ts.flattenDiagnosticMessageText(config.error.messageText, "\n"),
		);
	const parsed = ts.parseJsonConfigFileContent(
		config.config,
		ts.sys,
		path.dirname(configPath),
	);
	if (parsed.errors.length)
		throw new Error(
			parsed.errors
				.map((error) =>
					ts.flattenDiagnosticMessageText(error.messageText, "\n"),
				)
				.join("\n"),
		);
	const resolveImport = (specifier, file) => {
		const resolved = ts.resolveModuleName(
			specifier,
			path.join(root, file),
			parsed.options,
			ts.sys,
		).resolvedModule;
		return resolved
			? path.relative(root, resolved.resolvedFileName)
			: undefined;
	};
	const scan = (directory) =>
		fs
			.readdirSync(path.join(root, directory), { withFileTypes: true })
			.flatMap((entry) => {
				const file = `${directory}/${entry.name}`;
				if (entry.isDirectory()) return scan(file);
				if (!/\.tsx?$/.test(file)) return [];
				return inspectMobileSource(
					file,
					fs.readFileSync(path.join(root, file), "utf8"),
					resolveImport,
				);
			});
	return [sourceRoot, routeRoot]
		.map((directory) => directory.slice(0, -1))
		.filter((directory) => fs.existsSync(path.join(root, directory)))
		.flatMap(scan);
}

if (
	process.argv[1] &&
	path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	const issues = checkMobileArchitecture(
		path.resolve(import.meta.dirname, ".."),
	);
	for (const issue of issues)
		console.error(
			`${issue.file}:${issue.line} [${issue.rule}] ${issue.message}`,
		);
	if (issues.length) process.exitCode = 1;
	else console.log("Mobile structure checks passed.");
}
