import {
	App,
	Plugin,
	PluginSettingTab,
	Setting,
	Notice,
	FileSystemAdapter,
	TFile,
	Platform
} from 'obsidian';

// Plugin settings interface
interface OpenInClaudeCodeSettings {
	terminalApp: string;
	customCommand: string;
	claudeCodePath: string;
	useCustomClaudePath: boolean;
	keyboardShortcut: string;
	showDebugInfo?: boolean;
	terminalDelay?: number;
	alwaysOpenVaultRoot?: boolean;
	// Custom vault path options
	useCustomVaultPath?: boolean;
	customVaultPath?: string;
	// Claude CLI options
	permissionMode?: 'acceptEdits' | 'bypassPermissions' | 'plan' | 'default' | 'custom';
	dangerouslySkipPermissions?: boolean;
	allowedTools?: string[];
	deniedTools?: string[];
	claudeModel?: string;
	continueLastSession?: boolean;
	additionalDirectories?: string[];
	maxTurns?: number;
	verboseMode?: boolean;
}

// Default settings for Windows
const DEFAULT_SETTINGS: OpenInClaudeCodeSettings = {
	terminalApp: 'cmd',
	customCommand: '',
	claudeCodePath: 'claude',
	useCustomClaudePath: false,
	keyboardShortcut: 'Ctrl+Shift+C',
	showDebugInfo: false,
	terminalDelay: 1500,
	alwaysOpenVaultRoot: false,
	// Custom vault path defaults
	useCustomVaultPath: false,
	customVaultPath: '',
	// Claude CLI defaults
	permissionMode: 'default',
	dangerouslySkipPermissions: false,
	allowedTools: [],
	deniedTools: [],
	claudeModel: 'default',
	continueLastSession: false,
	additionalDirectories: [],
	maxTurns: 10,
	verboseMode: false
};

// Windows terminal app configurations
const TERMINAL_APPS: Record<string, {
	name: string;
	executableName: string;
	openCommand: ((cwd: string, claudePath: string) => string) | null;
	requiresDelay?: boolean;
	customDelay?: number;
}> = {
	cmd: {
		name: 'Command Prompt',
		executableName: 'cmd.exe',
		openCommand: (cwd: string, claudePath: string) => {
			const escapedPath = escapeWindowsPath(cwd);
			return `cmd /c "start cmd /k \\"cd /d ${escapedPath} && ${claudePath}\\""`;
		}
	},
	powershell: {
		name: 'PowerShell',
		executableName: 'powershell.exe',
		openCommand: (cwd: string, claudePath: string) => {
			const escapedPath = escapeWindowsPath(cwd);
			return `powershell -Command "Start-Process powershell -ArgumentList '-NoExit', '-Command', 'Set-Location \\"${escapedPath}\\"; ${claudePath}'"`;
		}
	},
	windowsterminal: {
		name: 'Windows Terminal',
		executableName: 'wt.exe',
		openCommand: (cwd: string, claudePath: string) => {
			const escapedPath = escapeWindowsPath(cwd);
			return `wt -d "${escapedPath}" cmd /k "${claudePath}"`;
		}
	},
	vscode: {
		name: 'VS Code',
		executableName: 'code.exe',
		openCommand: (cwd: string, claudePath: string) => {
			const escapedPath = escapeWindowsPath(cwd);
			return `code "${escapedPath}"`;
		},
		requiresDelay: true
	},
	cursor: {
		name: 'Cursor',
		executableName: 'cursor.exe',
		openCommand: (cwd: string, claudePath: string) => {
			const escapedPath = escapeWindowsPath(cwd);
			return `cursor "${escapedPath}"`;
		},
		requiresDelay: true
	}
};

// Cache for terminal app detection
const terminalAppCache = new Map<string, { installed: boolean; timestamp: number }>();
const CACHE_DURATION = 60000; // 1 minute cache

// Utility function to escape Windows paths
function escapeWindowsPath(str: string): string {
	return str.replace(/"/g, '""');
}

// Utility function to escape PowerShell strings
function escapePowerShellString(str: string): string {
	return str.replace(/["`$]/g, '`$&');
}

// Promise-based exec wrapper
function execAsync(command: string, options?: any): Promise<{ stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		const { exec } = require('child_process');
		exec(command, options, (error: any, stdout: string, stderr: string) => {
			if (error) {
				reject(error);
			} else {
				resolve({ stdout, stderr });
			}
		});
	});
}

// Enhanced PowerShell execution with timeout
async function runPowerShellScript(script: string, timeout: number = 10000): Promise<void> {
	return new Promise((resolve, reject) => {
		const { exec } = require('child_process');
		const powershell = exec(`powershell -Command "${escapePowerShellString(script)}"`, { timeout }, (error: any, stdout: string, stderr: string) => {
			if (error) {
				if (error.killed) {
					reject(new Error('PowerShell execution timed out'));
				} else {
					reject(new Error(`PowerShell error: ${stderr || error.message}`));
				}
			} else {
				resolve();
			}
		});
	});
}

// Build Claude command with CLI options
function buildClaudeCommand(settings: OpenInClaudeCodeSettings): string {
	let command = settings.useCustomClaudePath ? settings.claudeCodePath : 'claude';

	// Add permission mode if not default
	if (settings.permissionMode && settings.permissionMode !== 'default') {
		command += ` --permission-mode ${settings.permissionMode}`;
	}

	// Add dangerous skip permissions flag
	if (settings.dangerouslySkipPermissions) {
		command += ' --dangerously-skip-permissions';
	}

	// Add allowed tools
	if (settings.allowedTools && settings.allowedTools.length > 0) {
		command += ` --allowedTools ${settings.allowedTools.join(',')}`;
	}

	// Add denied tools
	if (settings.deniedTools && settings.deniedTools.length > 0) {
		command += ` --disallowedTools ${settings.deniedTools.join(',')}`;
	}

	// Add model selection
	if (settings.claudeModel && settings.claudeModel !== 'default') {
		command += ` --model ${settings.claudeModel}`;
	}

	// Add continue last session
	if (settings.continueLastSession) {
		command += ' --continue';
	}

	// Add max turns if not default
	if (settings.maxTurns && settings.maxTurns !== 10) {
		command += ` --max-turns ${settings.maxTurns}`;
	}

	// Add verbose mode
	if (settings.verboseMode) {
		command += ' --verbose';
	}

	// Add additional directories
	if (settings.additionalDirectories && settings.additionalDirectories.length > 0) {
		for (const dir of settings.additionalDirectories) {
			if (dir.trim()) {
				command += ` --add-dir "${escapeWindowsPath(dir.trim())}"`;
			}
		}
	}

	return command;
}

export default class OpenInClaudeCodePlugin extends Plugin {
	settings: OpenInClaudeCodeSettings;
	private claudeInstalled: boolean | null = null;

	/**
	 * Detect Claude Code installation path
	 */
	async detectClaudePath(): Promise<string | null> {
		try {
			// Try to find claude in PATH first
			try {
				const { stdout } = await execAsync('where claude');
				const path = stdout.trim().split('\n')[0];
				if (path) return path;
			} catch {
				// Continue to check specific paths
			}

			// Check common installation paths for Windows
			const paths = [
				'claude',
				'claude.exe',
				`${process.env.USERPROFILE}\\AppData\\Local\\Programs\\Claude\\claude.exe`,
				`${process.env.PROGRAMFILES}\\Claude\\claude.exe`,
				`${process.env.PROGRAMFILES_X86}\\Claude\\claude.exe`
			];

			for (const path of paths) {
				try {
					const { stdout } = await execAsync(`powershell -Command "Test-Path '${path}'"`);
					if (stdout.trim() === 'True') {
						return path;
					}
				} catch {
					// Continue checking other paths
				}
			}

			return null;
		} catch (error) {
			console.error('Error detecting Claude Code path:', error);
			return null;
		}
	}

	/**
	 * Verify if a given path contains Claude Code executable
	 */
	async verifyClaudePath(path: string): Promise<boolean> {
		if (!path) return false;

		try {
			// Check if file exists and is executable
			const { stdout } = await execAsync(`powershell -Command "Test-Path '${path}'"`);
			return stdout.trim() === 'True';
		} catch {
			return false;
		}
	}

	async onload() {
		// Load settings
		await this.loadSettings();

		// Check platform support
		if (!Platform.isDesktopApp || !Platform.isWin) {
			new Notice('Open in Claude Code: This plugin only supports Windows desktop. The plugin will not function on this platform.', 10000);
			console.warn('Open in Claude Code: Plugin requires Windows desktop');
		}

		// Add ribbon icon
		this.addRibbonIcon('terminal', 'Open in Claude Code', () => {
			this.openClaudeCode();
		});

		// Add command
		this.addCommand({
			id: 'open-in-claude-code',
			name: 'Open in Claude Code',
			callback: () => {
				this.openClaudeCode();
			},
			hotkeys: this.parseHotkey(this.settings.keyboardShortcut)
		});

		// Add settings tab
		this.addSettingTab(new OpenInClaudeCodeSettingTab(this.app, this));

		// Check if Claude Code is installed on startup (with caching)
		if (Platform.isDesktopApp && Platform.isWin) {
			this.checkClaudeCodeInstallation();
		}
	}

	/**
	 * Parse hotkey string into Obsidian hotkey format
	 */
	parseHotkey(hotkeyString: string): any[] {
		if (!hotkeyString) return [];

		const parts = hotkeyString.split('+').map(s => s.trim());
		const modifiers: string[] = [];
		let key = '';

		parts.forEach(part => {
			const lowerPart = part.toLowerCase();
			if (lowerPart === 'ctrl' || lowerPart === 'cmd') {
				modifiers.push('Mod');
			} else if (lowerPart === 'alt' || lowerPart === 'option') {
				modifiers.push('Alt');
			} else if (lowerPart === 'shift') {
				modifiers.push('Shift');
			} else {
				key = part;
			}
		});

		return [{
			modifiers: modifiers,
			key: key
		}];
	}

	/**
	 * Get the vault path from Obsidian or custom setting
	 */
	getVaultPath(): string {
		// Use custom vault path if enabled and configured
		if (this.settings.useCustomVaultPath && this.settings.customVaultPath) {
			return this.settings.customVaultPath;
		}

		// Fall back to Obsidian's detected path
		if (this.app.vault.adapter instanceof FileSystemAdapter) {
			return this.app.vault.adapter.getBasePath();
		}
		return '';
	}

	/**
	 * Get the working directory based on the active note
	 */
	getWorkingDirectory(): string {
		const vaultPath = this.getVaultPath();

		// If alwaysOpenVaultRoot is enabled, always return vault root
		if (this.settings.alwaysOpenVaultRoot) {
			return vaultPath;
		}

		const activeFile = this.app.workspace.getActiveFile();

		if (!activeFile) {
			// No active file, use vault root
			return vaultPath;
		}

		// Get the folder containing the active file
		const folderPath = activeFile.parent?.path || '';

		// Return absolute path to the folder
		if (folderPath) {
			return `${vaultPath}\\${folderPath.replace(/\//g, '\\')}`;
		}

		return vaultPath;
	}

	/**
	 * Check if Claude Code is installed (with caching)
	 */
	async checkClaudeCodeInstallation(): Promise<boolean> {
		// Use cached result if available
		if (this.claudeInstalled !== null) {
			return this.claudeInstalled;
		}

		try {
			// If using custom path, verify it
			if (this.settings.useCustomClaudePath) {
				this.claudeInstalled = await this.verifyClaudePath(this.settings.claudeCodePath);
				return this.claudeInstalled;
			}

			// Otherwise, try to auto-detect
			const detectedPath = await this.detectClaudePath();
			if (detectedPath) {
				this.settings.claudeCodePath = detectedPath;
				await this.saveSettings();
				this.claudeInstalled = true;
				return true;
			}

			this.claudeInstalled = false;
			return false;
		} catch (error) {
			console.error('Error checking Claude Code installation:', error);
			this.claudeInstalled = false;
			return false;
		}
	}

	/**
	 * Check if a terminal app is installed (with caching)
	 */
	async checkTerminalAppInstalled(executableName: string): Promise<boolean> {
		if (!Platform.isWin) return true; // Only check on Windows

		// Check cache first
		const cached = terminalAppCache.get(executableName);
		if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
			return cached.installed;
		}

		try {
			// Try to find the executable using where command
			try {
				const { stdout } = await execAsync(`where ${executableName}`);
				if (stdout.trim()) {
					terminalAppCache.set(executableName, { installed: true, timestamp: Date.now() });
					return true;
				}
			} catch {
				// Continue with other methods
			}

			// Check common installation paths
			const commonPaths = [
				`${process.env.WINDIR}\\System32\\${executableName}`,
				`${process.env.PROGRAMFILES}\\${executableName}`,
				`${process.env.PROGRAMFILES_X86}\\${executableName}`,
				`${process.env.LOCALAPPDATA}\\Programs\\${executableName}`
			];

			for (const path of commonPaths) {
				try {
					const { stdout } = await execAsync(`powershell -Command "Test-Path '${path}'"`);
					if (stdout.trim() === 'True') {
						terminalAppCache.set(executableName, { installed: true, timestamp: Date.now() });
						return true;
					}
				} catch {
					// Continue checking other paths
				}
			}

			terminalAppCache.set(executableName, { installed: false, timestamp: Date.now() });
			return false;
		} catch (error) {
			console.error(`Error checking for ${executableName}:`, error);
			terminalAppCache.set(executableName, { installed: false, timestamp: Date.now() });
			return false;
		}
	}

	/**
	 * Open Claude Code in the appropriate directory
	 */
	async openClaudeCode() {
		// Check if we're on desktop and Windows
		if (!Platform.isDesktopApp || !Platform.isWin) {
			new Notice('This feature is only available on Windows desktop');
			return;
		}

		// Check if Claude is installed
		const claudeInstalled = await this.checkClaudeCodeInstallation();
		if (!claudeInstalled) {
			new Notice('Claude Code not found. Please install it first.');
			return;
		}

		const workingDir = this.getWorkingDirectory();
		const activeFile = this.app.workspace.getActiveFile();
		const displayPath = activeFile ? activeFile.parent?.path || 'vault root' : 'vault root';

		try {
			if (this.settings.terminalApp === 'custom') {
				// Use custom command
				await this.executeCustomCommand(workingDir);
			} else {
				// Use predefined terminal app
				await this.openInTerminal(workingDir);
			}

			// Don't show success notice for VS Code/Cursor as they have their own handling
			if (!['vscode', 'cursor'].includes(this.settings.terminalApp)) {
				new Notice(`Opening Claude Code in: ${displayPath}`);
			}
		} catch (error) {
			console.error('Failed to open Claude Code:', error);
			new Notice(`Failed to open Claude Code: ${error.message}`);
		}
	}

	/**
	 * Execute custom command with working directory
	 */
	async executeCustomCommand(cwd: string): Promise<void> {
		const claudeCommand = buildClaudeCommand(this.settings);
		const command = this.settings.customCommand
			.replace('{{cwd}}', cwd)
			.replace('{{claude}}', claudeCommand);

		try {
			await execAsync(command, { cwd });
		} catch (error) {
			throw new Error(`Custom command failed: ${error.message}`);
		}
	}

	/**
	 * Open in the selected terminal application
	 */
	async openInTerminal(cwd: string): Promise<void> {
		const terminalConfig = TERMINAL_APPS[this.settings.terminalApp];

		if (!terminalConfig) {
			throw new Error('Invalid terminal application selected');
		}

		// Build the Claude command with all options
		const claudeCommand = buildClaudeCommand(this.settings);

		// Handle VS Code and Cursor specially
		if (this.settings.terminalApp === 'vscode' || this.settings.terminalApp === 'cursor') {
			await this.handleCodeEditor(terminalConfig, cwd, claudeCommand);
			return;
		}

		// Use Windows commands for other terminals
		if (Platform.isWin && terminalConfig.openCommand) {
			const command = terminalConfig.openCommand(cwd, claudeCommand);
			await execAsync(command);
		} else {
			// Fallback
			await execAsync(claudeCommand, { cwd });
		}
	}

	/**
	 * Handle VS Code and Cursor editors
	 */
	private async handleCodeEditor(terminalConfig: any, cwd: string, claudeCommand: string): Promise<void> {
		const delay = terminalConfig.customDelay || this.settings.terminalDelay || DEFAULT_SETTINGS.terminalDelay!;

		// Open the directory in the editor
		const openCommand = terminalConfig.openCommand!(cwd, claudeCommand);
		await execAsync(openCommand);

		const editorName = this.settings.terminalApp === 'vscode' ? 'VS Code' : 'Cursor';
		new Notice(`Opening ${editorName}... Terminal will open automatically.`, 5000);

		// Wait and then open terminal with Claude command
		setTimeout(async () => {
			try {
				let terminalScript: string;

				if (this.settings.terminalApp === 'vscode') {
					// VS Code terminal opening via PowerShell automation
					terminalScript = `
            Add-Type -AssemblyName System.Windows.Forms
            Start-Sleep -Milliseconds 500
            [System.Windows.Forms.SendKeys]::SendWait("^\`")
            Start-Sleep -Milliseconds 1000
            [System.Windows.Forms.SendKeys]::SendWait("${claudeCommand}")
            [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
          `;
				} else {
					// Cursor terminal opening
					terminalScript = `
            Add-Type -AssemblyName System.Windows.Forms
            Start-Sleep -Milliseconds 500
            [System.Windows.Forms.SendKeys]::SendWait("^j")
            Start-Sleep -Milliseconds 1000
            [System.Windows.Forms.SendKeys]::SendWait("${claudeCommand}")
            [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
          `;
				}

				await runPowerShellScript(terminalScript);
			} catch (error) {
				console.error(`Failed to send command to ${editorName}:`, error);
				new Notice(`Failed to open terminal in ${editorName}. Please open it manually.`);
			}
		}, delay);
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

/**
 * Settings tab for the plugin
 */
class OpenInClaudeCodeSettingTab extends PluginSettingTab {
	plugin: OpenInClaudeCodePlugin;

	constructor(app: App, plugin: OpenInClaudeCodePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: 'Open in Claude Code Settings (Windows)' });

		// Check Claude Code installation
		this.checkAndDisplayClaudeStatus(containerEl);

		// Claude Code custom path section
		const pathSection = new Setting(containerEl)
			.setName('Claude Code custom path')
			.setDesc('Override the auto-detected Claude Code path')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.useCustomClaudePath || false)
				.onChange(async (value) => {
					this.plugin.settings.useCustomClaudePath = value;

					if (!value) {
						// Reset to auto-detected path
						const detectedPath = await this.plugin.detectClaudePath();
						if (detectedPath) {
							this.plugin.settings.claudeCodePath = detectedPath;
						}
					}

					await this.plugin.saveSettings();
					this.display(); // Refresh to show/hide path input
				}));

		// Only show path input and test button when custom path is enabled
		if (this.plugin.settings.useCustomClaudePath) {
			pathSection.addText(text => {
				text.setPlaceholder('C:\\Users\\YourName\\AppData\\Local\\Programs\\Claude\\claude.exe')
					.setValue(this.plugin.settings.claudeCodePath || '')
					.onChange(async (value) => {
						this.plugin.settings.claudeCodePath = value;
						await this.plugin.saveSettings();
					});

				text.inputEl.style.width = '400px';
				text.inputEl.style.fontFamily = 'var(--font-monospace)';
				text.inputEl.style.fontSize = '13px';

				return text;
			});

			// Add test button
			pathSection.addButton(button => button
				.setButtonText('Test')
				.onClick(async () => {
					const isValid = await this.plugin.verifyClaudePath(this.plugin.settings.claudeCodePath);
					if (isValid) {
						new Notice('✓ Claude Code found at this path!');
					} else {
						new Notice('✗ Claude Code not found at this path');
					}
				}));
		}

		// Custom vault path section
		const vaultPathSection = new Setting(containerEl)
			.setName('Custom vault path')
			.setDesc('Override the auto-detected vault path (useful if Obsidian detects the wrong path)')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.useCustomVaultPath || false)
				.onChange(async (value) => {
					this.plugin.settings.useCustomVaultPath = value;

					if (!value) {
						// Reset to empty when disabled
						this.plugin.settings.customVaultPath = '';
					}

					await this.plugin.saveSettings();
					this.display(); // Refresh to show/hide path input
				}));

		// Only show path input and test button when custom vault path is enabled
		if (this.plugin.settings.useCustomVaultPath) {
			vaultPathSection.addText(text => {
				text.setPlaceholder('C:\\Note Vault\\Aiden\'s Vault')
					.setValue(this.plugin.settings.customVaultPath || '')
					.onChange(async (value) => {
						this.plugin.settings.customVaultPath = value;
						await this.plugin.saveSettings();
					});

				text.inputEl.style.width = '400px';
				text.inputEl.style.fontFamily = 'var(--font-monospace)';
				text.inputEl.style.fontSize = '13px';

				return text;
			});

			// Add test button to verify vault path
			vaultPathSection.addButton(button => button
				.setButtonText('Test')
				.onClick(async () => {
					const path = this.plugin.settings.customVaultPath;
					if (!path) {
						new Notice('Please enter a vault path first');
						return;
					}

					try {
						const { exec } = require('child_process');
						const { stdout } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
							exec(`powershell -Command "Test-Path '${path}'"`, (error: any, stdout: string, stderr: string) => {
								if (error) {
									reject(error);
								} else {
									resolve({ stdout, stderr });
								}
							});
						});

						if (stdout.trim() === 'True') {
							new Notice('✓ Vault path exists and is accessible!');
						} else {
							new Notice('✗ Vault path not found or not accessible');
						}
					} catch (error) {
						new Notice('✗ Error checking vault path');
					}
				}));
		}

		// Terminal application selection
		const terminalSetting = new Setting(containerEl)
			.setName('Terminal application')
			.setDesc('Select your preferred terminal application');

		// Create dropdown with loading message
		let dropdownComponent: any;
		terminalSetting.addDropdown(dropdown => {
			dropdownComponent = dropdown;
			dropdown.addOption('loading', 'Checking installed apps...');
			dropdown.setValue('loading');
		});

		// Check installed apps asynchronously and update dropdown
		this.checkInstalledTerminalApps().then(availableApps => {
			// Clear the dropdown
			const selectEl = dropdownComponent.selectEl;
			selectEl.empty();

			// Add available options
			Object.entries(availableApps).forEach(([key, name]) => {
				dropdownComponent.addOption(key, name);
			});

			// Always add custom option
			dropdownComponent.addOption('custom', 'Custom Command');

			// If current selection is not available, reset to first available option
			if (this.plugin.settings.terminalApp !== 'custom' && !availableApps[this.plugin.settings.terminalApp]) {
				this.plugin.settings.terminalApp = Object.keys(availableApps)[0] || 'cmd';
				this.plugin.saveSettings();
			}

			dropdownComponent
				.setValue(this.plugin.settings.terminalApp)
				.onChange(async (value: string) => {
					this.plugin.settings.terminalApp = value;
					await this.plugin.saveSettings();
					this.display(); // Refresh to show/hide custom command field
				});
		});

		// Custom command input (only show if custom is selected)
		if (this.plugin.settings.terminalApp === 'custom') {
			new Setting(containerEl)
				.setName('Custom command')
				.setDesc('Use {{cwd}} for working directory and {{claude}} for Claude path')
				.addTextArea(text => text
					.setPlaceholder('Example: cmd /c "start cmd /k \\"cd /d {{cwd}} && {{claude}}\\""')
					.setValue(this.plugin.settings.customCommand)
					.onChange(async (value) => {
						this.plugin.settings.customCommand = value;
						await this.plugin.saveSettings();
					}));
		}

		// Terminal delay setting
		new Setting(containerEl)
			.setName('Terminal activation delay')
			.setDesc('Delay in milliseconds before sending commands (for VS Code, Cursor)')
			.addText(text => text
				.setPlaceholder('1500')
				.setValue(String(this.plugin.settings.terminalDelay || DEFAULT_SETTINGS.terminalDelay))
				.onChange(async (value) => {
					const numValue = parseInt(value);
					if (!isNaN(numValue) && numValue >= 500 && numValue <= 10000) {
						this.plugin.settings.terminalDelay = numValue;
						await this.plugin.saveSettings();
					}
				}));

		// Keyboard shortcut
		new Setting(containerEl)
			.setName('Keyboard shortcut')
			.setDesc('Set a keyboard shortcut (e.g., Ctrl+Shift+C)')
			.addText(text => text
				.setPlaceholder('Ctrl+Shift+C')
				.setValue(this.plugin.settings.keyboardShortcut)
				.onChange(async (value) => {
					this.plugin.settings.keyboardShortcut = value;
					await this.plugin.saveSettings();
					new Notice('Restart Obsidian to apply the new keyboard shortcut');
				}));

		// Folder preference
		new Setting(containerEl)
			.setName('Always open vault root')
			.setDesc('When enabled, always opens Claude Code in the vault root. When disabled, opens in the current note\'s parent folder.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.alwaysOpenVaultRoot || false)
				.onChange(async (value) => {
					this.plugin.settings.alwaysOpenVaultRoot = value;
					await this.plugin.saveSettings();
				}));

		// Model selection
		new Setting(containerEl)
			.setName('Claude model')
			.setDesc('Select which Claude model to use')
			.addDropdown(dropdown => dropdown
				.addOption('default', 'Default (Auto-select)')
				.addOption('claude-opus-4-20250514', 'Claude Opus 4')
				.addOption('claude-sonnet-4-20250514', 'Claude Sonnet 4')
				.addOption('opus', 'Opus (alias)')
				.addOption('sonnet', 'Sonnet (alias)')
				.setValue(this.plugin.settings.claudeModel || 'default')
				.onChange(async (value) => {
					this.plugin.settings.claudeModel = value;
					await this.plugin.saveSettings();
				}));

		// Continue last session
		new Setting(containerEl)
			.setName('Continue last session')
			.setDesc('Automatically resume your most recent Claude conversation')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.continueLastSession || false)
				.onChange(async (value) => {
					this.plugin.settings.continueLastSession = value;
					await this.plugin.saveSettings();
				}));

		// Permission mode
		const permissionSetting = new Setting(containerEl)
			.setName('Permission mode')
			.setDesc('Base permission behavior')
			.addDropdown(dropdown => dropdown
				.addOption('default', 'Default - Ask for each operation')
				.addOption('acceptEdits', 'Accept Edits - Auto-approve file edits')
				.addOption('bypassPermissions', 'Bypass Permissions - Skip all checks')
				.addOption('plan', 'Plan Mode - Planning only')
				.addOption('custom', 'Custom - Select specific tools')
				.setValue(this.plugin.settings.permissionMode || 'default')
				.onChange(async (value: 'acceptEdits' | 'bypassPermissions' | 'plan' | 'default' | 'custom') => {
					const previousMode = this.plugin.settings.permissionMode;
					this.plugin.settings.permissionMode = value;

					// Update tool permissions based on permission mode
					if (!this.plugin.settings.allowedTools) {
						this.plugin.settings.allowedTools = [];
					}

					switch (value) {
						case 'acceptEdits':
							// Accept Edits mode should enable edit-related tools
							const editTools = ['Edit', 'MultiEdit', 'Write', 'NotebookEdit'];
							this.plugin.settings.allowedTools = editTools;
							break;

						case 'bypassPermissions':
							// Bypass mode enables all tools
							this.plugin.settings.allowedTools = ['Bash', 'Edit', 'Write', 'MultiEdit', 'WebFetch', 'WebSearch', 'NotebookEdit'];
							this.plugin.settings.dangerouslySkipPermissions = false; // Use mode instead of flag
							break;

						case 'plan':
							// Plan mode disables all tools
							this.plugin.settings.allowedTools = [];
							break;

						case 'default':
							// Default mode - reset to empty (user must explicitly choose)
							this.plugin.settings.allowedTools = [];
							this.plugin.settings.dangerouslySkipPermissions = false;
							break;

						case 'custom':
							// Custom mode - keep existing selections
							break;
					}

					await this.plugin.saveSettings();

					// Only refresh the UI if switching to/from custom mode
					if ((previousMode === 'custom' && value !== 'custom') ||
						(previousMode !== 'custom' && value === 'custom')) {
						this.display(); // Refresh UI to show/hide tool permissions
					}
				}));

		// Tool permissions - show as separate section when custom mode is selected  
		if (this.plugin.settings.permissionMode === 'custom') {
			const tools = [
				{ id: 'Bash', name: 'Bash', desc: 'Run shell commands' },
				{ id: 'Edit', name: 'Edit', desc: 'Edit existing files' },
				{ id: 'Write', name: 'Write', desc: 'Create new files' },
				{ id: 'MultiEdit', name: 'Multi Edit', desc: 'Make multiple edits' },
				{ id: 'WebFetch', name: 'Web Fetch', desc: 'Fetch web content' },
				{ id: 'WebSearch', name: 'Web Search', desc: 'Search the web' },
				{ id: 'NotebookEdit', name: 'Notebook Edit', desc: 'Edit Jupyter notebooks' }
			];

			// Create a container for the two-column grid
			const toolsContainer = containerEl.createDiv('claude-tools-container');
			toolsContainer.style.display = 'grid';
			toolsContainer.style.gridTemplateColumns = '1fr 1fr';
			toolsContainer.style.gap = '10px';
			toolsContainer.style.marginBottom = '20px';

			tools.forEach(tool => {
				const toolSetting = new Setting(toolsContainer)
					.setName(tool.name)
					.setDesc(tool.desc)
					.addToggle(toggle => {
						const isAllowed = this.plugin.settings.allowedTools?.includes(tool.id) || false;
						toggle.setValue(isAllowed)
							.onChange(async (value) => {
								if (!this.plugin.settings.allowedTools) {
									this.plugin.settings.allowedTools = [];
								}

								if (value) {
									// Add to allowed tools if not already there
									if (!this.plugin.settings.allowedTools.includes(tool.id)) {
										this.plugin.settings.allowedTools.push(tool.id);
									}
									// Remove from denied tools if present
									if (this.plugin.settings.deniedTools?.includes(tool.id)) {
										this.plugin.settings.deniedTools = this.plugin.settings.deniedTools.filter(t => t !== tool.id);
									}
								} else {
									// Remove from allowed tools
									this.plugin.settings.allowedTools = this.plugin.settings.allowedTools.filter(t => t !== tool.id);
								}

								await this.plugin.saveSettings();
							});
					});
			});
		}

		// Dangerous skip permissions toggle
		new Setting(containerEl)
			.setName('Skip all permissions (dangerous)')
			.setDesc('⚠️ Bypasses all permission prompts - use with extreme caution')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.dangerouslySkipPermissions || false)
				.onChange(async (value) => {
					this.plugin.settings.dangerouslySkipPermissions = value;
					await this.plugin.saveSettings();
				}));

		// Debug mode toggle
		new Setting(containerEl)
			.setName('Show debug information')
			.setDesc('Display detailed terminal app detection results')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showDebugInfo || false)
				.onChange(async (value) => {
					this.plugin.settings.showDebugInfo = value;
					await this.plugin.saveSettings();
					this.display(); // Refresh to show/hide debug info
				}));

		// Instructions
		containerEl.createEl('h3', { text: 'How it works' });
		const instructionsEl = containerEl.createEl('div', { cls: 'setting-item-description' });
		instructionsEl.createEl('p', {
			text: 'This plugin opens Claude Code in the folder of your currently active note.'
		});
		instructionsEl.createEl('p', {
			text: 'For example, if you\'re viewing a note in the "References" folder, Claude Code will open with that folder as the working directory.'
		});

		// Troubleshooting section
		containerEl.createEl('h3', { text: 'Troubleshooting' });
		const troubleEl = containerEl.createEl('div', { cls: 'setting-item-description' });
		troubleEl.createEl('p', { text: 'If you experience issues:' });
		const ul = troubleEl.createEl('ul');
		ul.createEl('li', { text: 'For VS Code/Cursor: Increase the terminal delay if commands aren\'t being sent' });
		ul.createEl('li', { text: 'For Windows Terminal: Make sure it\'s installed from Microsoft Store or GitHub' });
		ul.createEl('li', { text: 'For PowerShell: Ensure execution policy allows scripts' });
		ul.createEl('li', { text: 'Enable debug mode to see which apps are detected' });
	}

	async checkInstalledTerminalApps(): Promise<Record<string, string>> {
		const availableApps: Record<string, string> = {};

		for (const [key, config] of Object.entries(TERMINAL_APPS)) {
			// Always include cmd and powershell as they're built-in on Windows
			if ((key === 'cmd' || key === 'powershell') && Platform.isWin) {
				availableApps[key] = config.name;
			} else {
				// Check if the app is installed
				const isInstalled = await this.plugin.checkTerminalAppInstalled(config.executableName);
				if (isInstalled) {
					availableApps[key] = config.name;
				}
			}
		}

		return availableApps;
	}

	async checkAndDisplayClaudeStatus(containerEl: HTMLElement) {
		const statusEl = containerEl.createDiv('claude-code-status');
		statusEl.createEl('h3', { text: 'Claude Code Status' });

		// Get current path
		const currentPath = this.plugin.settings.useCustomClaudePath
			? this.plugin.settings.claudeCodePath
			: await this.plugin.detectClaudePath() || 'claude';

		// Check if the current path is valid
		const isInstalled = await this.plugin.verifyClaudePath(currentPath);

		// Simple status display
		const statusText = statusEl.createEl('p', {
			cls: isInstalled ? 'claude-status-success' : 'claude-status-error'
		});

		if (isInstalled) {
			statusText.createEl('span', { text: '✅ Claude Code is installed and available' });
		} else {
			statusText.createEl('span', { text: '❌ Claude Code not found' });
			const helpEl = statusEl.createEl('p', { cls: 'claude-help-text' });
			helpEl.createEl('a', {
				text: 'Install Claude Code',
				href: 'https://docs.anthropic.com/en/docs/claude-code/quickstart'
			});
		}

		// Add debug information if enabled
		if (this.plugin.settings.showDebugInfo) {
			const debugEl = containerEl.createDiv('claude-debug-info');
			debugEl.createEl('h4', { text: 'Debug Information' });

			// Clear terminal app cache to get fresh results
			terminalAppCache.clear();

			// Check each terminal app
			for (const [key, config] of Object.entries(TERMINAL_APPS)) {
				const isInstalled = await this.plugin.checkTerminalAppInstalled(config.executableName);
				const status = isInstalled ? '✓' : '✗';
				debugEl.createEl('p', {
					text: `${status} ${config.name} (${config.executableName})`,
					cls: isInstalled ? 'debug-success' : 'debug-fail'
				});
			}

			// Show current settings
			debugEl.createEl('h4', { text: 'Current Settings' });
			debugEl.createEl('p', {
				text: `Selected Terminal: ${this.plugin.settings.terminalApp}`,
				cls: 'debug-info'
			});
			debugEl.createEl('p', {
				text: `Terminal Delay: ${this.plugin.settings.terminalDelay || DEFAULT_SETTINGS.terminalDelay}ms`,
				cls: 'debug-info'
			});
		}
	}
}
