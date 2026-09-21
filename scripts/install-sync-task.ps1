# Регистрирует в планировщике Windows задачу, которая раскладывает свежий релиз
# моста по проектам из bridge-deploy.config.json (scripts/sync-release.js):
# при входе в систему и затем каждые 30 минут. Без нового релиза задача ничего
# не трогает. Повторный запуск установщика перезаписывает задачу.
#
#   powershell -ExecutionPolicy Bypass -File scripts\install-sync-task.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\install-sync-task.ps1 -Remove

param([switch]$Remove)

$TaskName = 'PlaygamaBridgeReleaseSync'

if ($Remove) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Output "Задача $TaskName удалена"
    return
}

$launcher = Join-Path $PSScriptRoot 'sync-release-hidden.vbs'
$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$launcher`""
$atLogon = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$every = New-ScheduledTaskTrigger -Once -At (Get-Date) `
    -RepetitionInterval (New-TimeSpan -Minutes 30)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopIfGoingOnBatteries `
    -AllowStartIfOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 10)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger @($atLogon, $every) `
    -Settings $settings -Description 'Раскладывает последний релиз EdikN/bridge по локальным проектам' `
    -Force | Out-Null
Write-Output "Задача $TaskName зарегистрирована: при входе и каждые 30 минут"
