import * as vscode from 'vscode';
import * as path from 'node:path';

const fsdLayers = ['app', 'pages', 'widgets', 'features', 'entities', 'shared'];
const fsdPossibleSegments = ['ui', 'api', 'lib', 'model', 'config'];


export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		vscode.commands.registerCommand(
			'fsd-vscode-extension.addNewSlice',
			// For command palette
			async () => addNewSlice(), 
		),
		vscode.commands.registerCommand(
			'fsd-vscode-extension.addNewSliceFromExplorer',
			// Invoked from explorer context menu, folderUri is the URI of the right-clicked folder
			async (folderUri?: vscode.Uri) => addNewSlice(folderUri),
		),
	);
}

export function deactivate() {}

async function addNewSlice(invokedUri?: vscode.Uri) {
	let selectedLayer: string | undefined;
	let basePath: string | undefined; // This will be the absolute path of the FSD layer

	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders?.[0]) {
		vscode.window.showErrorMessage('No workspace folder found.');
		return;
	}
	
	const workspaceRoot = workspaceFolders[0].uri.fsPath;

	const tsConfigPaths = await getTsConfigPaths(workspaceRoot);
	if (!tsConfigPaths) {
		vscode.window.showWarningMessage(
			'Could not read or parse tsconfig.json paths. Please ensure it exists and is valid.',
		);
		return;
	}

	if (invokedUri) {
		const clickedPath = invokedUri.fsPath;

		let layerFound = false;
		for (const alias in tsConfigPaths) {
			const pathMappings = tsConfigPaths[alias];
			if (pathMappings && pathMappings.length > 0) {
				const layerRelativePath = pathMappings[0].replace('/*', '');
				const absoluteLayerPath = path.resolve(workspaceRoot, layerRelativePath);

				if (absoluteLayerPath === clickedPath) {
					selectedLayer = alias.replace(/[@/*]/g, ''); // Extract layer name from alias e.g. @features/* -> features
					basePath = absoluteLayerPath;
					layerFound = true;
					vscode.window.showInformationMessage(`Detected FSD Layer: ${selectedLayer}`);
					break;
				}
			}
		}

		if (!layerFound) {
			vscode.window.showWarningMessage(
				'The selected folder is not a recognized FSD layer based on tsconfig.json paths. Please use the command palette or click on a valid layer folder (e.g., src/widgets, src/features).',
			);
			return;
		}
	} else {
		// Called from Command Palette: Ask for layer
		selectedLayer = await vscode.window.showQuickPick(fsdLayers, {
			placeHolder: 'Select the FSD layer for the new slice',
		});

		if (!selectedLayer) {
			vscode.window.showInformationMessage('No layer selected.');
			return;
		}
		vscode.window.showInformationMessage(`Selected layer: ${selectedLayer}`);

		const layerPathAlias = `@${selectedLayer}/*`;
		const pathMapping = tsConfigPaths[layerPathAlias]?.[0];

		if (!pathMapping) {
			vscode.window.showWarningMessage(
				`Path alias for ${layerPathAlias} not found in tsconfig.json.`,
			);
			return;
		}
		basePath = path.resolve(workspaceRoot, pathMapping.replace('/*', ''));
	}

	if (!selectedLayer || !basePath) {
		vscode.window.showErrorMessage('Could not determine the layer or base path.');
		return;
	}

	// Get slice name
	const sliceName = await vscode.window.showInputBox({
		placeHolder: 'Enter the name of the new slice',
		validateInput: (value) => {
			const trimmedValue = value.trim();
			if (!trimmedValue) {
				return 'Slice name cannot be empty or just whitespace.';
			}
			// Regex for invalid directory characters: / \\ : * ? " < > |
			// Also, names like '.', '..' are invalid, and names cannot end with a dot or space on Windows.
			// For simplicity, we'll block common special characters and leading/trailing dots/spaces.
			const invalidCharsRegex = /[\\/\\\\:*?"<>|]/;
			if (invalidCharsRegex.test(trimmedValue)) {
				return 'Slice name contains invalid characters (e.g., / \\ : * ? " < > |).';
			}
			if (trimmedValue.startsWith('.') || trimmedValue.endsWith('.') || trimmedValue.endsWith(' ')) {
				return 'Slice name cannot start or end with a dot or space.';
			}
			if (trimmedValue === '.' || trimmedValue === '..') {
				return 'Slice name cannot be \'.\' or \'..\'';
			}
			return null;
		},
	});

	if (!sliceName) { // sliceName will be undefined if the user cancelled, or the validated string
		vscode.window.showInformationMessage('Slice creation cancelled.');
		return;
	}

	// Get segments
	const selectedSegments = await vscode.window.showQuickPick(
		fsdPossibleSegments.map((segment) => ({ label: segment })),
		{
			placeHolder: 'Select segments for the new slice',
			canPickMany: true,
		},
	);

	if (!selectedSegments || selectedSegments.length === 0) {
		vscode.window.showInformationMessage('No segments selected.');
		return;
	}

	// Create directories and files
	try {
		// basePath is the absolute path to the FSD layer (e.g., /path/to/project/src/features)
		const finalSliceName = sliceName.trim(); // Use the trimmed and validated name
		const slicePath = path.join(basePath, finalSliceName); 
		await vscode.workspace.fs.createDirectory(vscode.Uri.file(slicePath));

		const rootIndexPath = path.join(slicePath, 'index.ts');
		await vscode.workspace.fs.writeFile(vscode.Uri.file(rootIndexPath), new Uint8Array());

		for (const segment of selectedSegments) {
			const segmentPath = path.join(slicePath, segment.label);
			await vscode.workspace.fs.createDirectory(vscode.Uri.file(segmentPath));

			const indexPath = path.join(segmentPath, 'index.ts');
			await vscode.workspace.fs.writeFile(vscode.Uri.file(indexPath), new Uint8Array());
		}

		vscode.window.showInformationMessage(
			`Successfully created slice '${finalSliceName}' in '${selectedLayer}' with segments: ${selectedSegments.map((s) => s.label).join(', ')}`,
		);
	} catch (error: unknown) {
		let message = 'Unknown error during directory/file creation';
		if (error instanceof Error) {
			message = error.message;
		}
		vscode.window.showErrorMessage(`Failed to create slice structure: ${message}`);
	}
}

async function getTsConfigPaths(
	workspaceRoot: string,
): Promise<Record<string, string[]> | null> {
	const tsconfigPath = path.join(workspaceRoot, 'tsconfig.json');

	try {
		const tsconfigUri = vscode.Uri.file(tsconfigPath);
		const tsconfigFileContent = await vscode.workspace.fs.readFile(tsconfigUri);
		const tsconfigString = Buffer.from(tsconfigFileContent).toString('utf8');
		const uncommentedTsconfigString = tsconfigString.replace(
			/\/\/[^\n]*|\/\*[\s\S]*?\*\//g,
			'',
		);
		const tsconfig = JSON.parse(uncommentedTsconfigString);
		return tsconfig.compilerOptions?.paths || null;
	} catch (error: unknown) {
		let message = 'Unknown error';
		if (error instanceof Error) {
			message = error.message;
		}
		vscode.window.showErrorMessage(
			`Error reading or parsing tsconfig.json: ${message}`,
		);
		return null;
	}
}
