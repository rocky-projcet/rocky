# Rocky Windows install

Release tag: `v0.1.0`

The preferred release shape is a single Windows setup executable:

```text
Rocky-Setup-v0.1.0.exe
```

It installs Rocky as a per-user app under `%LOCALAPPDATA%\Programs\Rocky` by
default, does not require administrator rights, and keeps Rocky runtime state
under the current user's profile by default.

The setup executable uses a source-free app payload. The installed folder
contains compiled backend JavaScript, built web assets, launchers, icons, and
runtime dependencies. It intentionally excludes TypeScript source, tests, local
agent instructions, and development configuration.

## Requirements

- Windows 10 or newer
- PowerShell 5.1 or newer
- Internet access during install
- Codex account login/authentication before Codex-backed runs are used

## Install and run

Run the setup executable:

```cmd
Rocky-Setup-v0.1.0.exe
```

The setup executable is built with Inno Setup and shows a normal Windows setup
wizard while it runs. Inno writes setup logs under `%TEMP%\Setup Log*.txt`.

Advanced users can also run the extracted app payload directly:

```cmd
Install-Rocky-Windows.cmd
```

The installer:

1. Checks Node.js 22 or newer.
2. Installs a portable Node.js runtime under Rocky when Node.js 22+ is missing.
3. Installs or updates the Codex CLI under Rocky's app-managed npm prefix.
4. Copies Rocky into `%LOCALAPPDATA%\Programs\Rocky`, unless `-InstallDir` is set.
5. Uses bundled backend npm dependencies when installed through the setup executable.
6. Creates installed app and Start Menu shortcuts with Rocky icons when Windows allows it.
7. Registers a per-user uninstall entry when Windows allows it.
8. Starts the Rocky API on `127.0.0.1:3000`.
9. Starts the Rocky web UI on `127.0.0.1:4173`.
10. Opens the web UI in the default browser.

The installer does not automate Codex login. If Codex-backed runs need login,
authenticate Codex separately after install.

To install without starting Rocky:

```cmd
Install-Rocky-Windows.cmd -NoStart
```

To start later:

```cmd
Start-Rocky-Windows.cmd
```

The installer also creates `Rocky.lnk` in the installed app folder with the
Rocky icon.

To stop the background API and web preview processes:

```cmd
Stop-Rocky-Windows.cmd
```

To uninstall the installed app:

```cmd
Uninstall-Rocky-Windows.cmd
```

The installer also creates `Uninstall Rocky.lnk` with a matching uninstall
badge icon.

To remove saved Rocky state during uninstall:

```cmd
Uninstall-Rocky-Windows.cmd -RemoveState
```

## Build the release artifacts

From the repository root:

```cmd
npm run release:windows
npm run release:windows:installer
```

These create:

```text
releases\v0.1.0\rocky-v0.1.0-windows.zip
releases\v0.1.0\rocky-v0.1.0-windows-app.zip
releases\v0.1.0\Rocky-Setup-v0.1.0.exe
```

The `rocky-v0.1.0-windows.zip` bundle is the developer-oriented fallback. The
setup executable and `rocky-v0.1.0-windows-app.zip` use the source-free app
payload and skip target-machine `npm ci` and build steps.

`npm run release:windows:installer` requires Inno Setup 6. If `ISCC.exe` is not
on `PATH`, pass it explicitly:

```cmd
npm run release:windows:installer -- -InnoCompilerPath "C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
```
