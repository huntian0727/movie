; Keep original application identity stable. Test builds override it explicitly.
; The generated list contains only files from this exact candidate package.
!include "${PROJECT_DIR}\.tmp\release-engineering\owned-files.nsh"
!if "${APP_ID}" == "com.local.video.manager.unsignedtest"
  ; Separate default install root as well as registration/executable/cache identity.
  !define /redef APP_FILENAME "拉面影视-unsigned-test-build"
  !define /redef APP_INSTALLER_STORE_FILE "local-video-manager-unsigned-test-updater\installer.exe"
!endif
!if "${APP_ID}" == "com.local.video.manager.community"
  ; Public unsigned sharing is a NEW isolated identity, never a legacy production upgrade.
  !define /redef APP_FILENAME "拉面影视-免费分享版"
  !define /redef APP_INSTALLER_STORE_FILE "local-video-manager-community-updater\installer.exe"
!endif

!macro movieAbort MESSAGE
  DetailPrint "${MESSAGE}"
  SetErrorLevel 1
  Abort "${MESSAGE}"
!macroend

!macro movieRejectReparse TARGET
  System::Call 'kernel32::GetFileAttributesW(w "${TARGET}") i.r8'
  ${If} $8 != -1
    IntOp $9 $8 & 0x400
    ${If} $9 != 0
      !insertmacro movieAbort "Unsafe reparse path; no recursive removal is permitted."
    ${EndIf}
  ${EndIf}
!macroend

; Do not store raw /D in INSTDIR: NSIS sanitizes that special variable before
; customInit, which can silently remove slash/ADS characters from user input.
!ifndef BUILD_UNINSTALLER
  Var movieRawInstallTarget
  Var movieRegisteredInstallLocation
  Var movieRegisteredMachineLocation
  Var movieRegisteredUninstallString
  Var movieRegisteredMachineUninstallString
  Var movieRegisteredCompatUninstallString
  Var movieRegisteredMachineCompatUninstallString
!endif

!macro movieValidatePathSyntax TARGET
  ${If} ${TARGET} == ""
    !insertmacro movieAbort "An explicit application installation directory is required."
  ${EndIf}
  ; PathIsRelative alone also accepts drive-relative/root-relative paths. Only
  ; ordinary fully-qualified drive paths or UNC server/share/child paths are safe.
  StrCpy $R4 "${TARGET}" 1
  StrCpy $R5 "${TARGET}" 2 1
  StrCpy $R0 "0"
  ${If} $R5 == ":\"
    System::Call 'shlwapi::StrSpnW(w "$R4", w "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz") i.r8'
    ${If} $8 != 1
      !insertmacro movieAbort "A fully-qualified ordinary drive path is required."
    ${EndIf}
    StrCpy $R3 "3"
  ${Else}
    StrCpy $R4 "${TARGET}" 2
    ${If} $R4 != "\\"
      !insertmacro movieAbort "A fully-qualified drive or UNC path is required."
    ${EndIf}
    StrCpy $R0 "1"
    StrCpy $R3 "2"
  ${EndIf}
  StrLen $R1 "${TARGET}"
  ${If} $R1 >= 260
    !insertmacro movieAbort "The installation path exceeds the supported Win32 path length."
  ${EndIf}
  StrCpy $R2 "0"
  StrCpy $R5 ""
  ${Do}
    StrCpy $R4 "${TARGET}" 1 $R3
    ${If} $R4 == "\"
    ${OrIf} $R4 == ""
      ${If} $R5 == ""
      ${OrIf} $R5 == "."
      ${OrIf} $R5 == ".."
        !insertmacro movieAbort "Empty or traversal installation path components are unsafe."
      ${EndIf}
      StrCpy $R4 "$R5" 1 -1
      ${If} $R4 == "."
      ${OrIf} $R4 == " "
        !insertmacro movieAbort "Installation components must not end in a dot or space."
      ${EndIf}
      ; Reserved Win32 device names cannot denote ordinary directory components.
      System::Call 'shlwapi::StrCSpnW(w "$R5", w ".") i.r8'
      StrCpy $R4 "$R5" $8
      ${If} $R4 == "CON"
      ${OrIf} $R4 == "PRN"
      ${OrIf} $R4 == "AUX"
      ${OrIf} $R4 == "NUL"
      ${OrIf} $R4 == "CONIN$$"
      ${OrIf} $R4 == "CONOUT$$"
      ${OrIf} $R4 == "COM1"
      ${OrIf} $R4 == "COM2"
      ${OrIf} $R4 == "COM3"
      ${OrIf} $R4 == "COM4"
      ${OrIf} $R4 == "COM5"
      ${OrIf} $R4 == "COM6"
      ${OrIf} $R4 == "COM7"
      ${OrIf} $R4 == "COM8"
      ${OrIf} $R4 == "COM9"
      ${OrIf} $R4 == "COM¹"
      ${OrIf} $R4 == "COM²"
      ${OrIf} $R4 == "COM³"
      ${OrIf} $R4 == "LPT1"
      ${OrIf} $R4 == "LPT2"
      ${OrIf} $R4 == "LPT3"
      ${OrIf} $R4 == "LPT4"
      ${OrIf} $R4 == "LPT5"
      ${OrIf} $R4 == "LPT6"
      ${OrIf} $R4 == "LPT7"
      ${OrIf} $R4 == "LPT8"
      ${OrIf} $R4 == "LPT9"
      ${OrIf} $R4 == "LPT¹"
      ${OrIf} $R4 == "LPT²"
      ${OrIf} $R4 == "LPT³"
        !insertmacro movieAbort "A Win32 device name cannot be an installation directory."
      ${EndIf}
      IntOp $R2 $R2 + 1
      StrCpy $R5 ""
      ${If} $R3 == $R1
        ${ExitDo}
      ${EndIf}
    ${Else}
      System::Call 'kernel32::GetStringTypeW(i 1, w "$R4", i 1, *i .r8) i.r9'
      ${If} $9 == 0
        !insertmacro movieAbort "The installation path character cannot be classified safely."
      ${EndIf}
      IntOp $8 $8 & 0x20
      ${If} $8 != 0
        !insertmacro movieAbort "The installation path contains a control character."
      ${EndIf}
      ${If} $R4 == "/"
      ${OrIf} $R4 == ":"
      ${OrIf} $R4 == "?"
      ${OrIf} $R4 == "*"
      ${OrIf} $R4 == "$\""
      ${OrIf} $R4 == "<"
      ${OrIf} $R4 == ">"
      ${OrIf} $R4 == "|"
      ${OrIf} $R4 == "$\r"
      ${OrIf} $R4 == "$\n"
      ${OrIf} $R4 == "$\t"
        !insertmacro movieAbort "The installation path contains an unsafe Win32 character."
      ${EndIf}
      StrCpy $R5 "$R5$R4"
    ${EndIf}
    IntOp $R3 $R3 + 1
  ${Loop}
  ${If} $R0 == "1"
  ${AndIf} $R2 < 3
    !insertmacro movieAbort "A UNC installation requires server, share, and a child directory."
  ${EndIf}
!macroend

!macro movieCheckDirectoryPath TARGET
  !insertmacro movieValidatePathSyntax "${TARGET}"
  System::Call 'shlwapi::PathIsRelativeW(w "${TARGET}") i.r8'
  ${If} $8 != 0
    !insertmacro movieAbort "A relative application installation directory is unsafe."
  ${EndIf}
  System::Call 'shlwapi::PathIsRootW(w "${TARGET}") i.r8'
  ${If} $8 != 0
    !insertmacro movieAbort "A drive or share root cannot be an application installation directory."
  ${EndIf}
  ; Check the root and every ancestor; never follow junctions outside the app.
  StrCpy $R6 "${TARGET}"
  ${Do}
    !insertmacro movieRejectReparse "$R6"
    ${GetParent} "$R6" $R7
    ${If} $R7 == ""
    ${OrIf} $R7 == $R6
      ${ExitDo}
    ${EndIf}
    StrCpy $R6 $R7
  ${Loop}
!macroend

!macro movieCheckRoot
  !insertmacro movieCheckDirectoryPath "$INSTDIR"
!macroend

!macro movieRequireMarker TARGET
  !insertmacro movieRejectReparse "${TARGET}\.movie-install-safety.ini"
  ReadINIStr $R8 "${TARGET}\.movie-install-safety.ini" "Safety" "appId"
  ReadINIStr $R9 "${TARGET}\.movie-install-safety.ini" "Safety" "safeUninstaller"
  ${If} $R8 != "${APP_ID}"
  ${OrIf} $R9 != "1"
    !insertmacro movieAbort "Legacy or unrelated installation blocked. Back up user data and request a reviewed migration."
  ${EndIf}
!macroend

!macro movieRequireMarkerIfPopulated TARGET
  ; IfFileExists "directory\*.*" tests directory existence, even when empty.
  ; electron-builder's .onInit SetOutPath can create the empty target before
  ; customInit. Enumerate real entries, ignoring dot entries, instead.
  System::Call 'kernel32::GetFileAttributesW(w "${TARGET}") i.r8 ?e'
  Pop $9
  ${If} $8 == -1
    ${If} $9 != 2
    ${AndIf} $9 != 3
      !insertmacro movieAbort "The application installation directory cannot be inspected safely."
    ${EndIf}
  ${Else}
    IntOp $9 $8 & 0x10
    ${If} $9 == 0
      !insertmacro movieAbort "The application installation target is not a directory."
    ${EndIf}
    StrCpy $R2 "0"
    ; Capture GetLastError inside the same System call. Calling the plugin later
    ; after NSIS FindNext can clobber ERROR_NO_MORE_FILES while loading it.
    ; WIN32_FIND_DATAW is 592 bytes; cFileName starts at byte offset 44.
    System::Alloc 592
    Pop $R4
    ${If} $R4 == 0
      !insertmacro movieAbort "The application directory enumeration buffer could not be allocated."
    ${EndIf}
    System::Call 'kernel32::FindFirstFileW(w "${TARGET}\*", p R4) p.R0 ?e'
    Pop $9
    ${If} $R0 == -1
      System::Free $R4
      ${If} $9 != 2
        !insertmacro movieAbort "The application directory contents cannot be inspected safely."
      ${EndIf}
    ${Else}
      ${Do}
        IntOp $R5 $R4 + 44
        System::Call '*$R5(&w260 .R1)'
        ${If} $R1 != "."
        ${AndIf} $R1 != ".."
          StrCpy $R2 "1"
          ${ExitDo}
        ${EndIf}
        System::Call 'kernel32::FindNextFileW(p R0, p R4) i.r8 ?e'
        Pop $9
        ${If} $8 == 0
          ${If} $9 != 18
            System::Call 'kernel32::FindClose(p R0)'
            System::Free $R4
            !insertmacro movieAbort "The application directory enumeration failed safely."
          ${EndIf}
          ${ExitDo}
        ${EndIf}
      ${Loop}
      System::Call 'kernel32::FindClose(p R0) i.r8'
      System::Free $R4
      ${If} $8 == 0
        !insertmacro movieAbort "The application directory enumeration handle could not be closed."
      ${EndIf}
    ${EndIf}
    ClearErrors
    ${If} $R2 == "1"
      !insertmacro movieRequireMarker "${TARGET}"
    ${EndIf}
  ${EndIf}
!macroend

!macro movieCheckRegisteredUninstaller COMMAND
  ${If} ${COMMAND} != ""
    ${If} $movieRegisteredInstallLocation == ""
      !insertmacro movieAbort "An orphaned legacy uninstall command requires a reviewed migration."
    ${EndIf}
    ; Match only the fixed executable inside the already validated marked root.
    ; Never reproduce stock's fallback that infers a directory from the command.
    ${If} ${COMMAND} != '$\"$movieRegisteredInstallLocation\${UNINSTALL_FILENAME}$\" /currentuser'
      !insertmacro movieAbort "The registered uninstall command does not match the safe application directory."
    ${EndIf}
    !insertmacro movieRejectReparse "$movieRegisteredInstallLocation\${UNINSTALL_FILENAME}"
    System::Call 'kernel32::GetFileAttributesW(w "$movieRegisteredInstallLocation\${UNINSTALL_FILENAME}") i.r8'
    ${If} $8 == -1
      !insertmacro movieAbort "The registered safe uninstaller is missing or inaccessible."
    ${EndIf}
    IntOp $9 $8 & 0x10
    ${If} $9 != 0
      !insertmacro movieAbort "The registered safe uninstaller is not an ordinary file."
    ${EndIf}
  ${EndIf}
!macroend

!macro movieCheckRegistrationView VIEW
  ; Collect in one view, then immediately restore the caller's view before any
  ; checks may Abort. Neither the original install target nor scratch inputs change.
  SetRegView ${VIEW}
  ReadRegStr $movieRegisteredInstallLocation HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  ReadRegStr $movieRegisteredMachineLocation HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
  ReadRegStr $movieRegisteredUninstallString HKCU "${UNINSTALL_REGISTRY_KEY}" UninstallString
  ReadRegStr $movieRegisteredMachineUninstallString HKLM "${UNINSTALL_REGISTRY_KEY}" UninstallString
  StrCpy $movieRegisteredCompatUninstallString ""
  StrCpy $movieRegisteredMachineCompatUninstallString ""
  !ifdef UNINSTALL_REGISTRY_KEY_2
    ReadRegStr $movieRegisteredCompatUninstallString HKCU "${UNINSTALL_REGISTRY_KEY_2}" UninstallString
    ReadRegStr $movieRegisteredMachineCompatUninstallString HKLM "${UNINSTALL_REGISTRY_KEY_2}" UninstallString
  !endif
  SetRegView lastused
  ${If} $movieRegisteredMachineLocation != ""
  ${OrIf} $movieRegisteredMachineUninstallString != ""
  ${OrIf} $movieRegisteredMachineCompatUninstallString != ""
    !insertmacro movieAbort "Per-machine legacy installation requires a separately reviewed migration."
  ${EndIf}
  ${If} $movieRegisteredInstallLocation != ""
    !insertmacro movieCheckDirectoryPath "$movieRegisteredInstallLocation"
    !insertmacro movieRequireMarker "$movieRegisteredInstallLocation"
  ${EndIf}
  !insertmacro movieCheckRegisteredUninstaller "$movieRegisteredUninstallString"
  !insertmacro movieCheckRegisteredUninstaller "$movieRegisteredCompatUninstallString"
!macroend

!macro movieCheckRegisteredInstallations
  !insertmacro movieCheckRegistrationView 32
  !insertmacro movieCheckRegistrationView 64
!macroend

!macro movieValidateInstallTarget
  ${If} $installMode == "all"
    !insertmacro movieAbort "This installer supports a current-user installation only."
  ${EndIf}
  ${GetParameters} $R6
  ClearErrors
  ${GetOptions} $R6 "--delete-app-data" $R7
  ${IfNot} ${Errors}
    !insertmacro movieAbort "Deleting user application data is unsupported by this installer."
  ${EndIf}
  !insertmacro movieCheckRoot
  ; Check every command stock can execute, including compatibility keys and
  ; orphaned uninstall entries, in both registry views before old-uninstaller use.
  !insertmacro movieCheckRegisteredInstallations
  !insertmacro movieRequireMarkerIfPopulated "$INSTDIR"
  !insertmacro moviePreflightOwnedFiles
!macroend

!macro customInit
  ; initMultiUser has already resolved /D and current-user identity. Keep this
  ; early guard; later UI/silent final-target guards repeat all checks.
  !ifmacrodef GetDParameter
    !insertmacro GetDParameter $movieRawInstallTarget
    ${If} $movieRawInstallTarget != ""
      !insertmacro movieValidatePathSyntax "$movieRawInstallTarget"
    ${EndIf}
  !endif
  !insertmacro movieValidateInstallTarget
!macroend

!macro customHeader
  !ifndef BUILD_UNINSTALLER
    Function .onVerifyInstDir
      !insertmacro movieValidateInstallTarget
    FunctionEnd
    ; Declared before electron-builder's install section: runs in silent mode too.
    ; Recheck the final target before old-uninstaller execution or file extraction.
    Section "-MovieSafetyPreflight"
      !insertmacro movieValidateInstallTarget
    SectionEnd
  !endif
!macroend

!macro customInstall
  WriteINIStr "$INSTDIR\.movie-install-safety.ini" "Safety" "appId" "${APP_ID}"
  WriteINIStr "$INSTDIR\.movie-install-safety.ini" "Safety" "safeUninstaller" "1"
!macroend

!macro customUnInit
  ${If} $installMode == "all"
    !insertmacro movieAbort "This uninstaller supports a current-user installation only."
  ${EndIf}
  ${GetParameters} $R6
  ClearErrors
  ${GetOptions} $R6 "--delete-app-data" $R7
  ${IfNot} ${Errors}
    !insertmacro movieAbort "Deleting user application data is unsupported by this uninstaller."
  ${EndIf}
  !insertmacro movieCheckRoot
  !insertmacro movieRequireMarker "$INSTDIR"
!macroend

!macro moviePreflightFile TARGET
  !insertmacro movieRejectReparse "${TARGET}"
  ${If} ${FileExists} "${TARGET}"
    ; DELETE permission and sharing preflight catches ordinary locks before removals.
    System::Call 'kernel32::CreateFileW(w "${TARGET}", i 0x10000, i 7, p 0, i 3, i 0, p 0) p.r8'
    ${If} $8 == -1
      !insertmacro movieAbort "An application file is locked or inaccessible; removal aborted."
    ${EndIf}
    System::Call 'kernel32::CloseHandle(p r8)'
  ${EndIf}
!macroend

!macro movieDeleteOwnedFile TARGET
  !insertmacro movieRejectReparse "${TARGET}"
  ${If} ${FileExists} "${TARGET}"
    ClearErrors
    Delete "${TARGET}"
    ${If} ${Errors}
      !insertmacro movieAbort "An application file could not be removed; user files are preserved."
    ${EndIf}
  ${EndIf}
!macroend

!macro customRemoveFiles
  !insertmacro movieCheckRoot
  !insertmacro moviePreflightOwnedFiles
  !insertmacro movieRemoveOwnedFiles
  Delete "$INSTDIR\.movie-install-safety.ini"
  Delete "$INSTDIR\${UNINSTALL_FILENAME}"
  ; Unknown video/SQLite/other files keep their directories intact.
  RMDir "$INSTDIR"
!macroend

!macro customInstallMode
  ; Hide the all-users choice for assisted installations and uninstallations.
  StrCpy $isForceCurrentInstall "1"
!macroend
