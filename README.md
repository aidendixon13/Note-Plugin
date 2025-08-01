# Open in Claude Code (Windows)

A Windows-optimized Obsidian plugin that allows you to quickly open Claude Code in the current note's folder with a single click or keyboard shortcut.

## Features

- 🚀 **One-click access**: Open Claude Code directly from Obsidian's ribbon or command palette
- 📁 **Smart folder detection**: Automatically uses the current note's folder as the working directory
- ⌨️ **Keyboard shortcuts**: Configure your preferred keyboard shortcut
- 🖥️ **Windows terminal support**: Choose from Command Prompt, PowerShell, Windows Terminal, VS Code, or Cursor
- 🔍 **Installation check**: Automatically detects if Claude Code is installed
- ⚙️ **Advanced Claude CLI options**: Full support for Claude's command-line interface features
- 💻 **Windows desktop only**: Built specifically for Windows environments

## How it works

When you trigger the plugin (via ribbon icon, command palette, or keyboard shortcut), it:

1. Detects the folder of your currently active note
2. Opens your preferred terminal application or code editor
3. Navigates to that folder
4. Launches Claude Code with your configured options

For example:
- If you're viewing `References/Brown butter nectarine tart.md`, Claude Code opens in the `References/` folder
- If you're viewing a note in the vault root, Claude Code opens in the vault root directory

## Installation

### Prerequisites

1. **Windows 10/11** - This plugin is designed specifically for Windows
2. **Claude Code** must be installed on your system
3. **Terminal/Editor** - At least one supported terminal or code editor

### From Obsidian Community Plugins

(Coming soon)

### Manual Installation

1. Download the latest release from the releases page
2. Extract the files to your vault's `.obsidian/plugins/open-in-claude-code-windows/` folder
3. Reload Obsidian
4. Enable the plugin in Settings → Community plugins

## Configuration

### Settings

Access the settings via Settings → Plugin Options → Open in Claude Code (Windows)

#### Basic Settings
- **Claude Code path**: Auto-detects or specify custom path to Claude executable
- **Custom vault path**: Override auto-detected vault path (useful if Obsidian detects wrong location)
- **Terminal application**: Choose from:
  - Command Prompt (built-in)
  - PowerShell (built-in)
  - Windows Terminal
  - VS Code
  - Cursor
  - Custom Command
- **Keyboard shortcut**: Set your preferred shortcut (default: Ctrl+Shift+C)
- **Always open vault root**: Toggle between current note's folder vs vault root

#### Claude CLI Options
- **Model selection**: Choose between Claude models (Opus 4, Sonnet 4, etc.)
- **Permission modes**: 
  - Default (ask for each operation)
  - Accept Edits (auto-approve file edits)
  - Bypass Permissions (skip all checks)
  - Plan Mode (planning only)
  - Custom (select specific tools)
- **Continue last session**: Resume previous conversations
- **Additional directories**: Include extra project directories
- **Verbose mode**: Enable detailed output

### Terminal-Specific Configuration

#### Command Prompt / PowerShell
- Built-in Windows terminals, no additional setup required
- Commands open in new windows with proper working directory

#### Windows Terminal
- Install from Microsoft Store or GitHub
- Plugin will auto-detect installation
- Opens in new tab with current directory

#### VS Code / Cursor
- Plugin opens the folder in the editor
- Automatically opens integrated terminal after a configurable delay
- Uses PowerShell automation to send commands

#### Custom Command
Use template variables:
- `{{cwd}}` - Current working directory
- `{{claude}}` - Full Claude command with options

Example: `cmd /c "start cmd /k \"cd /d {{cwd}} && {{claude}}\""`

## Troubleshooting

### Claude Code not found
1. Install Claude Code: https://docs.anthropic.com/en/docs/claude-code/quickstart
2. Verify it's accessible: Run `claude` in Command Prompt
3. Use custom path in settings if installed in non-standard location

### Wrong vault path or folder
- **Enable custom vault path**: If plugin opens in wrong directory, use the "Custom vault path" setting
- **Example**: Set to `C:\Note Vault\Aiden's Vault` for your specific vault location
- **Test button**: Use the "Test" button to verify your path is accessible

### Terminal doesn't open
- **Windows Terminal**: Install from Microsoft Store
- **VS Code/Cursor**: Increase terminal delay in settings if commands aren't sent
- **PowerShell**: Ensure execution policy allows scripts: `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser`

### Permission issues
- Run Obsidian as administrator if needed
- Check Windows Defender/antivirus settings
- Enable debug mode to see detection results

### VS Code/Cursor automation fails
- Increase the terminal delay (default 1500ms, try 2500-3000ms)
- Ensure the editor has focus when the command runs
- Check Windows focus assist settings

## Development

To build the plugin:

```bash
# Install dependencies
npm install

# Development build with auto-reload
npm run dev

# Production build
npm run build
```

## Platform Support

This plugin is **Windows desktop-only**:
- ✅ Windows 10/11 (fully supported)
- ❌ macOS (use the original macOS version)
- ❌ Linux (not supported)
- ❌ Mobile devices (not supported)

## Differences from macOS Version

This Windows version includes:
- PowerShell automation instead of AppleScript
- Windows-specific terminal applications
- Windows file path handling
- `where` command for executable detection
- Windows-specific installation paths
- SendKeys automation for VS Code/Cursor

## License

MIT
