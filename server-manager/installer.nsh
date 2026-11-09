!macro customUnInit
  nsExec::ExecToStack '"$SYSDIR\sc.exe" query ThryvoPDFServer'
  Pop $0
  Pop $1
  ${If} $0 == 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "Stop and uninstall the ThryvoPDF Windows service in Server Manager before removing or upgrading this application. Your server data will not be deleted."
    Abort
  ${EndIf}
!macroend
