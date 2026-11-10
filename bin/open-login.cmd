@echo off
rem Opens the Claude login page for a login started from bb (Claude Switcher).
rem `claude auth login` runs this as %BROWSER% with the consent URL, quoted,
rem as its only argument. Windows: a private Chrome window, so the login does
rem not reuse the browser's Claude session (CLAUDE_SWITCHER_PRIVATE other than
rem 1 opens the default browser instead); without Chrome, the default browser.
rem The URL carries & ^ and %%XX: it is only ever expanded inside quotes or
rem with delayed expansion, never parsed as part of a command.
setlocal DisableDelayedExpansion
set "url=%~1"
if not defined url goto notHttps
if /i not "%url:~0,8%"=="https://" goto notHttps

set "chrome="
if defined CLAUDE_SWITCHER_PRIVATE if not "%CLAUDE_SWITCHER_PRIVATE%"=="1" goto open
rem CLAUDE_SWITCHER_CHROME names a Chrome elsewhere; if it is not there, the
rem default browser. Otherwise the per-user install first, then the system one.
if defined CLAUDE_SWITCHER_CHROME (
  if exist "%CLAUDE_SWITCHER_CHROME%" set "chrome=%CLAUDE_SWITCHER_CHROME%"
  goto open
)
for %%P in ("%LocalAppData%" "%ProgramFiles%" "%ProgramFiles(x86)%") do (
  if not defined chrome if exist "%%~P\Google\Chrome\Application\chrome.exe" set "chrome=%%~P\Google\Chrome\Application\chrome.exe"
)

:open
setlocal EnableDelayedExpansion
if defined chrome (
  if "!CLAUDE_SWITCHER_DRY_RUN!"=="1" (echo(chrome-incognito !chrome! !url!& exit /b 0)
  start "" "!chrome!" --incognito "!url!"
  exit /b 0
)
if "!CLAUDE_SWITCHER_DRY_RUN!"=="1" (echo(default !url!& exit /b 0)
start "" "!url!"
exit /b 0

:notHttps
echo open-login: not an https URL 1>&2
exit /b 1
