@echo off
:: [LOG: 20260521_1610]
echo ===============================================
echo     GitHub Auto Upload Tool
echo ===============================================
echo.

REM 1. Get commit message
set /p commit_msg="Enter upload message (default: Update): "
if "%commit_msg%"=="" set commit_msg=Update

REM 2. Execute Git commands
echo.
echo -----------------------------------------------
echo [1/3] Adding modified files...
git add .

echo.
echo [2/3] Creating commit record...
git commit -m "%commit_msg%"

echo.
echo [3/3] Uploading to GitHub (master)...
git push origin master

echo.
echo ===============================================
echo     Upload Successfully Completed!
echo ===============================================
pause
