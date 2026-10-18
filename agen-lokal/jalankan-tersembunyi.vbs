' Menjalankan start.bat tanpa jendela terlihat (untuk dimasukkan ke folder Startup Windows).
Set sh = CreateObject("WScript.Shell")
dir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir
sh.Run "cmd /c """ & dir & "\start.bat""", 0, False
