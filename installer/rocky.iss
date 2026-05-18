; Inno Setup installer for Rocky.
; Build from the repository root with:
;   npm run release:windows:installer

#define MyAppName "Rocky"
#define MyAppPublisher "Rocky"
#define MyAppURL "https://github.com/rocky-projcet/rocky"
#define MyAppExeName "Start-Rocky-Windows.cmd"

#if GetEnv("ROCKY_RELEASE_TAG") != ""
  #define ReleaseTag GetEnv("ROCKY_RELEASE_TAG")
#else
  #define ReleaseTag "v0.1.0"
#endif

#if GetEnv("ROCKY_APP_VERSION") != ""
  #define MyAppVersion GetEnv("ROCKY_APP_VERSION")
#else
  #define MyAppVersion "0.1.0"
#endif

#if GetEnv("ROCKY_PAYLOAD_ROOT") != ""
  #define PayloadRoot GetEnv("ROCKY_PAYLOAD_ROOT")
#else
  #define PayloadRoot "..\.tmp\windows-installer\v0.1.0\payload"
#endif

#if GetEnv("ROCKY_OUTPUT_DIR") != ""
  #define OutputDirPath GetEnv("ROCKY_OUTPUT_DIR")
#else
  #define OutputDirPath "..\releases\v0.1.0"
#endif

#if GetEnv("ROCKY_REPO_ROOT") != ""
  #define RepoRoot GetEnv("ROCKY_REPO_ROOT")
#else
  #define RepoRoot ".."
#endif

[Setup]
AppId={{0A66CF77-D0A2-487B-A64E-7733AF546571}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
VersionInfoVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={localappdata}\Programs\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir={#OutputDirPath}
OutputBaseFilename=Rocky-Setup-{#ReleaseTag}
SetupIconFile={#RepoRoot}\assets\windows\rocky.ico
UninstallDisplayIcon={app}\assets\windows\rocky.ico
UninstallDisplayName={#MyAppName}
Compression=lzma2/ultra64
LZMAUseSeparateProcess=yes
SolidCompression=yes
WizardStyle=modern
SetupLogging=yes
CloseApplications=no
RestartApplications=no
RestartIfNeededByRun=no
MinVersion=10.0.10240
SetupMutex=RockySetupMutex

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "{#PayloadRoot}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Rocky"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"; IconFilename: "{app}\assets\windows\rocky.ico"
Name: "{group}\Stop Rocky"; Filename: "{app}\Stop-Rocky-Windows.cmd"; WorkingDir: "{app}"; IconFilename: "{app}\assets\windows\rocky.ico"
Name: "{group}\Uninstall Rocky"; Filename: "{uninstallexe}"; IconFilename: "{app}\assets\windows\rocky-uninstall.ico"

[Run]
Filename: "{app}\Install-Rocky-Windows.cmd"; Parameters: "-InPlace -SkipDependencyInstall -SkipBuild -IncludeBundledDependencies -SkipWindowsShellRegistration -NoStart"; StatusMsg: "Preparing Rocky runtime..."; Flags: runhidden waituntilterminated
Filename: "{app}\{#MyAppExeName}"; Description: "Start Rocky"; Flags: nowait postinstall skipifsilent runhidden

[UninstallRun]
Filename: "{app}\Stop-Rocky-Windows.cmd"; Flags: runhidden waituntilterminated; RunOnceId: "StopRocky"

[UninstallDelete]
Type: filesandordirs; Name: "{app}"
