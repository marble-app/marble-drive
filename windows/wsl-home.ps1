# Keep the PC's Ubuntu (WSL2) running, so the drive at home there stays up
# with no window open (docs/HOSTING.md, "A drive at home on the Mac or the PC").
#
#   powershell -ExecutionPolicy Bypass -File wsl-home.ps1 [-Distro Ubuntu] [-NoSleep] [-Remove]
#
# WSL stops a distro soon after its last program ends, and systemd's services
# with it. This registers a task, "Marble Drive (WSL)", that starts at your
# sign-in (and looks again every 5 minutes) and holds one program open in the
# distro (sleep), so systemd and the
# drive's services (linux/systemd/home.sh, tunnel.sh) keep running. After a
# reboot (a Windows update), the drive is back once you sign in.
#
# -NoSleep also stops the PC from sleeping while it is plugged in: a sleeping
# PC is a drive out of reach (bryan.marbledrive.app says so).
# -Remove takes the task away again.
param(
  [string]$Distro = "Ubuntu",
  [switch]$NoSleep,
  [switch]$Remove
)
$ErrorActionPreference = "Stop"
$TaskName = "Marble Drive (WSL)"

if ($Remove) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "Removed the task '$TaskName'. Ubuntu stops a while after its last window closes."
  exit 0
}

$names = (wsl.exe --list --quiet) -replace "`0", "" | Where-Object { $_.Trim() -ne "" } | ForEach-Object { $_.Trim() }
if ($names -notcontains $Distro) {
  throw "No WSL distro named '$Distro' (found: $($names -join ', ')). Pass -Distro <name>."
}

# conhost --headless runs wsl.exe with no window to close by mistake.
$action = New-ScheduledTaskAction -Execute "conhost.exe" -Argument "--headless wsl.exe -d $Distro --exec /bin/sleep infinity"
# At sign-in, and every 5 minutes after: a keeper that ended (a wsl --shutdown,
# a WSL update) is started again; one still running is left alone (IgnoreNew).
$atLogOn = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$atLogOn.Repetition = (New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 5)).Repetition
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $atLogOn -Settings $settings `
  -Description "Keeps WSL ($Distro) running for Marble Drive. Remove: wsl-home.ps1 -Remove" -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName
Write-Host "Registered and started '$TaskName': $Distro stays up from each sign-in."

if ($NoSleep) {
  powercfg /change standby-timeout-ac 0
  powercfg /change hibernate-timeout-ac 0
  Write-Host "This PC no longer sleeps while plugged in (the screen may still turn off)."
} else {
  Write-Host "Note: if this PC sleeps, the drive is out of reach. Run again with -NoSleep to stop that while plugged in."
}
