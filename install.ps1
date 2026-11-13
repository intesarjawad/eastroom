# East Room's installer for Windows. It is short: read it before you run it.
#
#   irm https://raw.githubusercontent.com/intesarjawad/eastroom/main/install.ps1 | iex
#
# It asks for no administrator rights and writes only inside your own user folder:
#   1. uv, if you do not have it. uv fetches Python and keeps East Room apart from everything else.
#   2. East Room itself, with PDF support.
#   3. An East Room entry in the Start menu.
# Run the same line again to update. To take it all away again:
#
#   $env:EASTROOM_UNINSTALL = 1; irm https://raw.githubusercontent.com/intesarjawad/eastroom/main/install.ps1 | iex
#
# Your books live in the .eastroom folder of your user folder and are never touched by either.

& {
  $ErrorActionPreference = 'Stop'
  $source = if ($env:EASTROOM_SOURCE) { $env:EASTROOM_SOURCE } else { 'https://github.com/intesarjawad/eastroom/archive/refs/heads/main.tar.gz' }
  $entry = Join-Path ([Environment]::GetFolderPath('Programs')) 'East Room.lnk'

  function Stop-Install($what, $next) {
    Write-Host "`nEast Room was not installed: $what" -ForegroundColor Red
    Write-Host "Next step: $next"
    throw 'East Room was not installed.'
  }

  if ($env:EASTROOM_UNINSTALL) {
    Remove-Item Env:EASTROOM_UNINSTALL
    Remove-Item $entry -ErrorAction SilentlyContinue
    if (Get-Command uv -ErrorAction SilentlyContinue) { cmd /c 'uv tool uninstall eastroom >nul 2>&1' }
    Write-Host "East Room is removed. Your books are still in $HOME\.eastroom: delete that folder to remove them too."
    return
  }

  if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    Write-Host 'Getting uv, the tool that installs East Room and its Python...'
    try { Invoke-RestMethod https://astral.sh/uv/install.ps1 | Invoke-Expression }
    catch { Stop-Install 'uv could not be downloaded.' 'Check your internet connection, then run this line again.' }
    $env:Path = "$HOME\.local\bin;$env:Path"
    if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
      Stop-Install 'uv was downloaded but cannot be found.' 'Close this window, open PowerShell again, and run this line again.'
    }
  }

  Write-Host 'Installing East Room...'
  uv tool install --quiet --force --python 3.13 "eastroom[pdf] @ $source"
  if ($LASTEXITCODE -ne 0) {
    Stop-Install 'the download or the setup failed (the lines above say where).' 'Check your internet connection and run this line again. If it fails the same way, send those lines to https://github.com/intesarjawad/eastroom/issues'
  }
  # so that "eastroom" also works when typed in a new window. Through cmd, because Windows PowerShell
  # treats a note that a program writes to its error stream as a failure once that stream is redirected.
  cmd /c 'uv tool update-shell >nul 2>&1'
  # East Room was called Devour at first: that command and its Start menu entry go. Its books are taken over at the first start.
  cmd /c 'uv tool uninstall devour-reader >nul 2>&1'
  Remove-Item (Join-Path ([Environment]::GetFolderPath('Programs')) 'Devour.lnk') -ErrorAction SilentlyContinue

  $bin = Join-Path (uv tool dir --bin) 'eastroom.exe'
  if (-not (Test-Path $bin)) {
    Stop-Install "the eastroom command is not where uv said it would be ($bin)." 'Send this line to https://github.com/intesarjawad/eastroom/issues'
  }
  $python = Join-Path (uv tool dir) 'eastroom\Scripts\python.exe'
  # no double quotes inside: Windows PowerShell drops them on the way to a program
  $web = Join-Path (& $python -c 'import eastroom, os; print(os.path.dirname(eastroom.__file__))') 'web'

  # the Start menu entry starts East Room and shows it in the browser; pressed again, it shows the one that runs
  $shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($entry)
  $shortcut.TargetPath = $bin
  $shortcut.IconLocation = Join-Path $web 'favicon.ico'
  $shortcut.Description = "Read whole books in the author's own words"
  $shortcut.WindowStyle = 7   # its window starts minimised; closing that window stops East Room
  $shortcut.Save()

  Write-Host "`nEast Room is installed. It is opening in your browser now."
  Write-Host 'Next time: press the Windows key, type East Room, and press Enter.'
  Write-Host 'To add a book, drop its file on the page.'
  if (-not $env:EASTROOM_NO_OPEN) { Start-Process $bin -WindowStyle Minimized }
}
