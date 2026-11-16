!ifndef BUILD_UNINSTALLER
Var RestartStatusJob
!endif

!macro ShowRestartBanner
  !define /ifndef DSH_DISPLAY_NAME_EN "DeepSeek Harness"
  !define /ifndef DSH_DISPLAY_NAME_ZH "DeepSeek Harness"
  Push $0
  ${If} ${Errors}
    StrCpy $0 1
  ${Else}
    StrCpy $0 0
  ${EndIf}
  Push $1
  Push $2
  Push $3
  StrCpy $1 0
  StrCpy $2 "$(INSTALLER_UPDATE_WAIT)"
  StrCpy $3 "${DSH_DISPLAY_NAME_EN}"
  !ifdef LANG_SIMPCHINESE
    ${If} $LANGUAGE == ${LANG_SIMPCHINESE}
      StrCpy $3 "${DSH_DISPLAY_NAME_ZH}"
    ${EndIf}
  !endif
  System::Call '$PLUGINSDIR\window-frame.dll::InstallerStartRestartStatus(w "$EXEPATH", w "$InstallerTheme", i $LANGUAGE, w r3, w r2) p.r1 ?c'
  StrCpy $RestartStatusJob $1
  Pop $3
  Pop $2
  Pop $1
  ${If} $0 == 1
    SetErrors
  ${Else}
    ClearErrors
  ${EndIf}
  Pop $0
!macroend
