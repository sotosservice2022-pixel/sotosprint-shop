
Unicode true
SetCompressor /SOLID lzma

!define APP_NAME "AGPRNT Замовлення"
!define APP_DIR "AGPRNT"
!define EXE "AGPRNT.exe"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\AGPRNT"

Name "${APP_NAME}"
OutFile "dist/AGPRNT-Setup-1.0.0.exe"
InstallDir "$LOCALAPPDATA\Programs\${APP_DIR}"
RequestExecutionLevel user
Icon "build/icon.ico"
UninstallIcon "build/icon.ico"
BrandingText "AGPRNT"

Page instfiles
UninstPage uninstConfirm
UninstPage instfiles

Section "Install"
  SetOutPath "$INSTDIR"
  File /r "dist/win-unpacked/*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateShortcut "$SMPROGRAMS\${APP_NAME}.lnk" "$INSTDIR\${EXE}"
  CreateShortcut "$DESKTOP\${APP_NAME}.lnk" "$INSTDIR\${EXE}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayName" "${APP_NAME}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\${EXE}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayVersion" "1.0.0"
  WriteRegStr HKCU "${UNINST_KEY}" "Publisher" "AGPRNT"
  WriteRegStr HKCU "${UNINST_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1
SectionEnd

Function .onInstSuccess
  Exec '"$INSTDIR\${EXE}"'
FunctionEnd

Section "Uninstall"
  Delete "$SMPROGRAMS\${APP_NAME}.lnk"
  Delete "$DESKTOP\${APP_NAME}.lnk"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "${UNINST_KEY}"
SectionEnd
