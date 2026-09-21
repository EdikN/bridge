' Запуск sync-release.js без окна консоли: планировщик Windows иначе мигал бы
' чёрным окном каждые полчаса. Журнал пишется в .deploy-sync.log рядом с репо.
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = root
shell.Run "node """ & root & "\scripts\sync-release.js""", 0, False
