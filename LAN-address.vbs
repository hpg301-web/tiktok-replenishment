Option Explicit
Dim shell, fso, root, command, quiet
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File " & Chr(34) & root & "\windows\manage.ps1" & Chr(34) & " -Action Network"
If WScript.Arguments.Count > 0 Then
  If LCase(WScript.Arguments(0)) = "/quiet" Then command = command & " -Quiet"
End If
shell.Run command, 0, False
