!macro NSIS_HOOK_PREINSTALL
  DetailPrint "Preparing a clean Fetchr installation..."

  nsExec::ExecToLog 'cmd /c taskkill /F /T /IM fetchr.exe 2>nul'
  nsExec::ExecToLog 'cmd /c taskkill /F /T /IM "Fetchr.exe" 2>nul'
  nsExec::ExecToLog 'cmd /c taskkill /F /T /IM stream-cutter.exe 2>nul'
  nsExec::ExecToLog 'cmd /c taskkill /F /T /IM "Stream Cutter.exe" 2>nul'

  IfFileExists "$LOCALAPPDATA\Fetchr\uninstall.exe" 0 +2
    ExecWait '"$LOCALAPPDATA\Fetchr\uninstall.exe" /S'
  IfFileExists "$LOCALAPPDATA\Stream Cutter\uninstall.exe" 0 +2
    ExecWait '"$LOCALAPPDATA\Stream Cutter\uninstall.exe" /S'
  IfFileExists "$LOCALAPPDATA\StreamCutter\uninstall.exe" 0 +2
    ExecWait '"$LOCALAPPDATA\StreamCutter\uninstall.exe" /S'
  IfFileExists "$LOCALAPPDATA\stream-cutter\uninstall.exe" 0 +2
    ExecWait '"$LOCALAPPDATA\stream-cutter\uninstall.exe" /S'
  IfFileExists "$LOCALAPPDATA\Programs\Fetchr\uninstall.exe" 0 +2
    ExecWait '"$LOCALAPPDATA\Programs\Fetchr\uninstall.exe" /S'
  IfFileExists "$LOCALAPPDATA\Programs\Stream Cutter\uninstall.exe" 0 +2
    ExecWait '"$LOCALAPPDATA\Programs\Stream Cutter\uninstall.exe" /S'

  RMDir /r "$LOCALAPPDATA\Fetchr"
  RMDir /r "$LOCALAPPDATA\Stream Cutter"
  RMDir /r "$LOCALAPPDATA\StreamCutter"
  RMDir /r "$LOCALAPPDATA\stream-cutter"
  RMDir /r "$LOCALAPPDATA\Programs\Fetchr"
  RMDir /r "$LOCALAPPDATA\Programs\Stream Cutter"
  RMDir /r "$LOCALAPPDATA\Programs\StreamCutter"
  RMDir /r "$LOCALAPPDATA\Programs\stream-cutter"

  Delete "$DESKTOP\Fetchr.lnk"
  Delete "$DESKTOP\Stream Cutter.lnk"
  Delete "$SMPROGRAMS\Fetchr.lnk"
  Delete "$SMPROGRAMS\Stream Cutter.lnk"
  RMDir /r "$SMPROGRAMS\Fetchr"
  RMDir /r "$SMPROGRAMS\Stream Cutter"
!macroend
