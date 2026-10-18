@echo off
rem DSH Tavern testing build: double-click to install into the official DeepSeek Harness desktop.
rem Runs the same one-line PowerShell installer as the README. Percent signs are doubled for cmd.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$env:DSH_TAVERN_HOST='desktop'; $tavernInstaller=[Text.Encoding]::UTF8.GetString((New-Object Net.WebClient).DownloadData('https://raw.githubusercontent.com/flizzywine/dsh-tavern/0.2.1%%E7%%89%%88%%E6%%9C%%AC/install.ps1')); Invoke-Expression $tavernInstaller"
echo.
pause
