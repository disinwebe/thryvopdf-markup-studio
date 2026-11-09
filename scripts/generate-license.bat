@echo off
setlocal DisableDelayedExpansion
set "PMS_LICENSE_PRIVATE_KEY=C:\Users\Tito\ThryvoLicenseKeys\thryvo-private.pem"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js 18 or newer, then try again.
  goto :failure
)
if not exist "%~dp0license-vendor.cjs" (
  echo License issuer was not found. Keep this batch file in the repository scripts folder.
  goto :failure
)
if not exist "%~dp0license-issuer-prompt.cjs" (
  echo License prompt was not found. Keep this batch file in the repository scripts folder.
  goto :failure
)
if not exist "%PMS_LICENSE_PRIVATE_KEY%" (
  echo The signing key was not found at the configured path. No license was created.
  goto :failure
)

node "%~dp0license-issuer-prompt.cjs" "%~dp0license-vendor.cjs"
if errorlevel 1 goto :failure
echo.
echo Finished. Deliver the license file securely to the device owner.
pause
exit /b 0

:failure
echo.
echo License generation did not complete.
pause
exit /b 1
