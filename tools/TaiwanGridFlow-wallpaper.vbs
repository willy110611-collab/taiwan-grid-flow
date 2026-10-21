' Taiwan Grid Flow - start wallpaper server hidden (no window)
Set sh = CreateObject("WScript.Shell")
sh.Run """" & sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\TaiwanGridFlow\tools\wallpaper-server.bat""", 0, False
