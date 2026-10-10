# Prints one JSON line per second describing the Yandex Music media session.
# The cover that Yandex Music hands to Windows is saved once per track to a temp file ("thumb").
param([string]$ThumbDir = (Join-Path $env:TEMP 'ym-presence-thumbs'))
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IInputStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
$asStream = ([System.IO.WindowsRuntimeStreamExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsStreamForRead' -and $_.GetParameters().Count -eq 1 })[0]
function Await($op, $type) {
  $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result
}
# "Yandex" in Latin and Cyrillic, built from code points so the file stays ASCII.
$ru = -join ([char[]](0x42F, 0x43D, 0x434, 0x435, 0x43A, 0x441))
$pattern = "yandex|$ru"
New-Item -ItemType Directory -Force -Path $ThumbDir | Out-Null

function Save-Thumb($props, $key) {
  if (-not $props.Thumbnail) { return $null }
  $ras = Await ($props.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
  $stream = $asStream.Invoke($null, @($ras))
  $ms = New-Object System.IO.MemoryStream
  $stream.CopyTo($ms); $stream.Dispose()
  if ($ms.Length -lt 500) { return $null }  # placeholder, cover not ready yet
  $ext = if ($ras.ContentType -match 'png') { 'png' } else { 'jpg' }
  $sha = [System.Security.Cryptography.SHA1]::Create()
  $name = (($sha.ComputeHash($ms.ToArray()) | ForEach-Object { $_.ToString('x2') }) -join '')
  $path = Join-Path $ThumbDir "$name.$ext"
  if (-not (Test-Path $path)) { [System.IO.File]::WriteAllBytes($path, $ms.ToArray()) }
  return $path
}

$mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
$lastKey = ''; $thumb = $null; $tries = 0
while ($true) {
  $out = $null; $ids = @()
  try {
    $sessions = $mgr.GetSessions()
    $s = $sessions | Where-Object { $_.SourceAppUserModelId -match $pattern } | Select-Object -First 1
    $ids = @($sessions | ForEach-Object { $_.SourceAppUserModelId })
    if ($s) {
      $p = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
      $i = $s.GetPlaybackInfo(); $t = $s.GetTimelineProperties()
      # Windows only refreshes Position on events; extrapolate while playing.
      $pos = $t.Position.TotalSeconds
      if ($i.PlaybackStatus.ToString() -eq 'Playing') {
        $pos += ([DateTimeOffset]::UtcNow - $t.LastUpdatedTime).TotalSeconds
        if ($pos -gt $t.EndTime.TotalSeconds) { $pos = $t.EndTime.TotalSeconds }
      }
      $key = "$($p.Artist)|$($p.Title)"
      if ($key -ne $lastKey) { $lastKey = $key; $thumb = $null; $tries = 0 }
      if (-not $thumb -and $tries -lt 6) {
        $tries++
        try { $thumb = Save-Thumb $p $key } catch { $thumb = $null }
      }
      $out = [ordered]@{
        sessions = $ids; app = $s.SourceAppUserModelId; title = $p.Title; artist = $p.Artist; album = $p.AlbumTitle
        status = $i.PlaybackStatus.ToString(); thumb = $thumb
        position = [math]::Round($pos, 1); duration = [math]::Round($t.EndTime.TotalSeconds, 1)
      }
    }
  } catch { $out = @{ error = $_.Exception.Message } }
  if ($null -eq $out) { $out = @{ none = $true; sessions = @($ids) } }
  [Console]::Out.WriteLine(($out | ConvertTo-Json -Compress)); [Console]::Out.Flush()
  Start-Sleep -Milliseconds 1000
}
