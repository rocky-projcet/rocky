# Rocky Windows install

Release tag: `v0.1.0`

This release shape is a Windows PowerShell installer bundle. It installs Rocky
as a per-user app under `%LOCALAPPDATA%\Programs\Rocky` by default, does not
require administrator rights, and keeps Rocky runtime state under the current
user's profile by default.

## Requirements

- Windows 10 or newer
- PowerShell 5.1 or newer
- Internet access during install
- Codex account login/authentication before Codex-backed runs are used

## Install and run

From the extracted release folder:

```cmd
Install-Rocky-Windows.cmd
```

The installer:

1. Checks Node.js 22 or newer.
2. Installs a portable Node.js runtime under Rocky when Node.js 22+ is missing.
3. Installs or updates the Codex CLI under Rocky's app-managed npm prefix.
4. Copies Rocky into `%LOCALAPPDATA%\Programs\Rocky`, unless `-InstallDir` is set.
5. Runs `npm ci` in the backend package.
6. Runs `npm ci` in `web`.
7. Builds the backend and web UI.
8. Creates installed app and Start Menu shortcuts with Rocky icons when Windows allows it.
9. Registers a per-user uninstall entry when Windows allows it.
10. Starts the Rocky API on `127.0.0.1:3000`.
11. Starts the Rocky web UI on `127.0.0.1:4173`.
12. Opens the web UI in the default browser.

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

## Build the release zip

From the repository root:

```cmd
npm run release:windows
```

This creates:

```text
releases\v0.1.0\rocky-v0.1.0-windows.zip
```

The zip includes the source, Windows launchers, generated Windows icons, and
generated `dist` and `web/dist` outputs. The install step still runs `npm ci`
so dependencies match the checked-in lockfiles on the target machine.
