# The Windows installer of the desktop app (NSIS 3), built by build.sh next to this file:
# mindsift-desktop-windows-amd64-setup.exe.
#
# - Per user, no administrator rights: %LOCALAPPDATA%\Programs\MindSift, Start menu entry, optional
#   desktop shortcut, uninstaller in "Apps & features" (HKCU uninstall key app.mindsift.MindSift).
# - A newer (or older) version installs over the one there, into its folder, keeping the desktop
#   shortcut choice; the app has to be closed first (also from the tray), the installer asks.
# - The user data (%APPDATA%\MindSift: instances, desktop.json, the webview's storage) is never touched,
#   neither by installing nor by uninstalling; the uninstaller removes only the files it installed.
# - No WebView2 bootstrapper: the runtime is part of Windows 10 and 11, which the installer requires.
#   (Wails' own template, internal/commands/build_assets/windows/nsis in Wails v3.1.0, runs Microsoft's
#   bootstrapper when the EdgeUpdate key is missing, and its uninstaller deletes %APPDATA%\<exe name>, the
#   default webview folder; neither applies here.)
# - Unsigned for now; signing would go into !finalize and !uninstfinalize.
#
# Defines from build.sh: VERSION (the app's version without "v", e.g. 1.2.0 or 1.2.0-dev) and
# VERSION_NUMERIC (1.2.0). The staged folder holds MindSift.exe, LICENSE.txt, THIRD_PARTY_LICENSES.txt
# and app.ico next to this file.

Unicode true
ManifestDPIAware true
SetCompressor /SOLID lzma
RequestExecutionLevel user

!ifndef VERSION
  !error "VERSION must be defined (-DVERSION=1.2.0)"
!endif
!ifndef VERSION_NUMERIC
  !error "VERSION_NUMERIC must be defined (-DVERSION_NUMERIC=1.2.0)"
!endif

!define PRODUCT "MindSift"
!define EXE "MindSift.exe"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\app.mindsift.MindSift"

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "WinVer.nsh"
!include "x64.nsh"

Name "${PRODUCT}"
OutFile "mindsift-desktop-windows-amd64-setup.exe"
InstallDir "$LOCALAPPDATA\Programs\${PRODUCT}"
BrandingText "${PRODUCT} ${VERSION}"
ShowInstDetails nevershow
ShowUninstDetails nevershow

VIProductVersion "${VERSION_NUMERIC}.0"
VIFileVersion "${VERSION_NUMERIC}.0"
VIAddVersionKey /LANG=0 "ProductName" "${PRODUCT}"
VIAddVersionKey /LANG=0 "FileDescription" "${PRODUCT} Setup"
VIAddVersionKey /LANG=0 "CompanyName" "${PRODUCT}"
VIAddVersionKey /LANG=0 "LegalCopyright" "${PRODUCT}"
VIAddVersionKey /LANG=0 "ProductVersion" "${VERSION}"
VIAddVersionKey /LANG=0 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=0 "OriginalFilename" "mindsift-desktop-windows-amd64-setup.exe"

!define MUI_ICON "app.ico"
!define MUI_UNICON "app.ico"
!define MUI_ABORTWARNING

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_COMPONENTS
# An installed version is updated where it is, so its folder is not asked again
!define MUI_PAGE_CUSTOMFUNCTION_PRE SkipDirectoryOnUpdate
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\${EXE}"
!insertmacro MUI_PAGE_FINISH

!define MUI_UNCONFIRMPAGE_TEXT_TOP "$(DataKept)"
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

# The app's languages; Windows' display language picks one, English for all others (the first)
!insertmacro MUI_LANGUAGE "English"
!insertmacro MUI_LANGUAGE "German"
!insertmacro MUI_LANGUAGE "French"
!insertmacro MUI_LANGUAGE "Spanish"
!insertmacro MUI_LANGUAGE "Italian"

LangString DesktopShortcut ${LANG_ENGLISH} "Desktop shortcut"
LangString DesktopShortcut ${LANG_GERMAN} "Verknüpfung auf dem Desktop"
LangString DesktopShortcut ${LANG_FRENCH} "Raccourci sur le bureau"
LangString DesktopShortcut ${LANG_SPANISH} "Acceso directo en el escritorio"
LangString DesktopShortcut ${LANG_ITALIAN} "Collegamento sul desktop"

LangString AppRunning ${LANG_ENGLISH} "MindSift is still running. Quit it (also in the tray: Quit) and click Retry."
LangString AppRunning ${LANG_GERMAN} "MindSift läuft noch. Bitte beenden (auch im Infobereich: Beenden) und dann Wiederholen klicken."
LangString AppRunning ${LANG_FRENCH} "MindSift est encore ouvert. Quittez-le (aussi dans la zone de notification : Quitter) puis cliquez sur Réessayer."
LangString AppRunning ${LANG_SPANISH} "MindSift sigue abierto. Ciérrelo (también en el área de notificación: Salir) y pulse Reintentar."
LangString AppRunning ${LANG_ITALIAN} "MindSift è ancora aperto. Chiudilo (anche nell'area di notifica: Esci) e fai clic su Riprova."

LangString NeedsWindows10 ${LANG_ENGLISH} "MindSift needs 64-bit Windows 10 or 11."
LangString NeedsWindows10 ${LANG_GERMAN} "MindSift braucht Windows 10 oder 11 (64 Bit)."
LangString NeedsWindows10 ${LANG_FRENCH} "MindSift nécessite Windows 10 ou 11 (64 bits)."
LangString NeedsWindows10 ${LANG_SPANISH} "MindSift necesita Windows 10 u 11 (64 bits)."
LangString NeedsWindows10 ${LANG_ITALIAN} "MindSift richiede Windows 10 o 11 (64 bit)."

LangString DataKept ${LANG_ENGLISH} "Your notes, tasks and settings in %APPDATA%\MindSift are kept."
LangString DataKept ${LANG_GERMAN} "Deine Notizen, Aufgaben und Einstellungen in %APPDATA%\MindSift bleiben erhalten."
LangString DataKept ${LANG_FRENCH} "Vos notes, tâches et paramètres dans %APPDATA%\MindSift sont conservés."
LangString DataKept ${LANG_SPANISH} "Sus notas, tareas y ajustes en %APPDATA%\MindSift se conservan."
LangString DataKept ${LANG_ITALIAN} "Le tue note, attività e impostazioni in %APPDATA%\MindSift vengono conservate."

# Deleting the program fails while it runs (Windows locks a running exe), which tells that it is open.
# Silent runs give up instead of asking.
!macro RequireClosed
  ${DoWhile} ${FileExists} "$INSTDIR\${EXE}"
    Delete "$INSTDIR\${EXE}"
    ${If} ${FileExists} "$INSTDIR\${EXE}"
    ${AndIf} ${Cmd} `MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(AppRunning)" /SD IDCANCEL IDCANCEL`
      SetErrorLevel 3
      Abort
    ${EndIf}
  ${Loop}
!macroend

Var Installed

Section "${PRODUCT}" SEC_APP
  SectionIn RO
  SetShellVarContext current
  SetOutPath "$INSTDIR"
  !insertmacro RequireClosed
  File "${EXE}"
  File "LICENSE.txt"
  File "THIRD_PARTY_LICENSES.txt"
  WriteUninstaller "$INSTDIR\uninstall.exe"
  CreateShortcut "$SMPROGRAMS\${PRODUCT}.lnk" "$INSTDIR\${EXE}"

  SetRegView 64
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayName" "${PRODUCT}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINST_KEY}" "Publisher" "${PRODUCT}"
  WriteRegStr HKCU "${UNINST_KEY}" "URLInfoAbout" "https://mindsift.app"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\${EXE},0"
  WriteRegStr HKCU "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "UninstallString" '"$INSTDIR\uninstall.exe"'
  WriteRegStr HKCU "${UNINST_KEY}" "QuietUninstallString" '"$INSTDIR\uninstall.exe" /S'
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  WriteRegDWORD HKCU "${UNINST_KEY}" "EstimatedSize" $0
SectionEnd

Section /o "$(DesktopShortcut)" SEC_DESKTOP
  SetShellVarContext current
  CreateShortcut "$DESKTOP\${PRODUCT}.lnk" "$INSTDIR\${EXE}"
SectionEnd

Section "-RemoveDesktopShortcut"
  # Unticked on an update: a shortcut of the version before goes
  SetShellVarContext current
  ${IfNot} ${SectionIsSelected} ${SEC_DESKTOP}
    Delete "$DESKTOP\${PRODUCT}.lnk"
  ${EndIf}
SectionEnd

Function .onInit
  ${IfNot} ${AtLeastWin10}
  ${OrIfNot} ${RunningX64}
    MessageBox MB_OK|MB_ICONSTOP "$(NeedsWindows10)" /SD IDOK
    SetErrorLevel 4
    Quit
  ${EndIf}
  SetShellVarContext current
  # An installed version: its folder (unless /D= named another) and its desktop shortcut choice
  SetRegView 64
  ReadRegStr $0 HKCU "${UNINST_KEY}" "InstallLocation"
  SetRegView lastused
  ${If} $0 != ""
  ${AndIf} ${FileExists} "$0\${EXE}"
    StrCpy $Installed 1
    ${If} $INSTDIR == "$LOCALAPPDATA\Programs\${PRODUCT}"
      StrCpy $INSTDIR $0
    ${EndIf}
    ${If} ${FileExists} "$DESKTOP\${PRODUCT}.lnk"
      !insertmacro SelectSection ${SEC_DESKTOP}
    ${EndIf}
  ${EndIf}
FunctionEnd

Function SkipDirectoryOnUpdate
  ${If} $Installed == 1
    Abort
  ${EndIf}
FunctionEnd

Section "Uninstall"
  SetShellVarContext current
  !insertmacro RequireClosed
  # Only what the installer put there; the folder goes only when nothing else is left in it
  Delete "$INSTDIR\LICENSE.txt"
  Delete "$INSTDIR\THIRD_PARTY_LICENSES.txt"
  # The uninstaller runs as a copy in %TEMP%; the original may still be exiting for a moment
  StrCpy $0 0
  ${Do}
    Delete "$INSTDIR\uninstall.exe"
    ${IfNot} ${FileExists} "$INSTDIR\uninstall.exe"
    ${OrIf} $0 >= 10
      ${Break}
    ${EndIf}
    IntOp $0 $0 + 1
    Sleep 300
  ${Loop}
  RMDir "$INSTDIR"
  Delete "$SMPROGRAMS\${PRODUCT}.lnk"
  Delete "$DESKTOP\${PRODUCT}.lnk"
  SetRegView 64
  DeleteRegKey HKCU "${UNINST_KEY}"
  # What the app registered for its system notifications (Wails' notification service, see desktop/README.md):
  # the AppUserModelID with its COM activator, and the notification categories. A portable exe registers
  # them again when it runs.
  ReadRegStr $1 HKCU "Software\Classes\AppUserModelId\${PRODUCT}" "CustomActivator"
  ${If} $1 != ""
    DeleteRegKey HKCU "Software\Classes\CLSID\$1"
  ${EndIf}
  DeleteRegKey HKCU "Software\Classes\AppUserModelId\${PRODUCT}"
  DeleteRegKey HKCU "Software\${PRODUCT}\NotificationCategories"
  DeleteRegKey /ifempty HKCU "Software\${PRODUCT}"
SectionEnd

Function un.onInit
  SetShellVarContext current
FunctionEnd
