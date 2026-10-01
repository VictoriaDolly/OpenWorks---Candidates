# Local preview server (development only — not deployed).
# Serves ./public on http://localhost:5173 the same way Vercel does:
# folders resolve to index.html and anything outside public/ is unreachable.
param([int]$Port = 5173)
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\public')).Path
$types = @{
  '.html'='text/html; charset=utf-8'; '.js'='text/javascript; charset=utf-8'; '.css'='text/css; charset=utf-8'
  '.json'='application/json'; '.png'='image/png'; '.ico'='image/x-icon'; '.svg'='image/svg+xml'
  '.pdf'='application/pdf'; '.webmanifest'='application/manifest+json'; '.txt'='text/plain'
}
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Serving $root at http://localhost:$Port/"
while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $res = $ctx.Response
  try {
    $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
    $base = $root
    # Dev-only helpers (e.g. the Supabase simulator) live in tools/ and are served under /__dev/
    if ($rel.StartsWith('__dev/')) { $base = $PSScriptRoot; $rel = $rel.Substring(6) }
    $path = [IO.Path]::GetFullPath((Join-Path $base $rel))
    if (-not $path.StartsWith($base)) { throw 'outside root' }
    if (Test-Path $path -PathType Container) {
      if (-not $ctx.Request.Url.AbsolutePath.EndsWith('/')) {
        $res.StatusCode = 308; $res.RedirectLocation = $ctx.Request.Url.AbsolutePath + '/' + $ctx.Request.Url.Query
        $res.Close(); continue
      }
      $path = Join-Path $path 'index.html'
    }
    if (Test-Path $path -PathType Leaf) {
      $bytes = [IO.File]::ReadAllBytes($path)
      $ext = [IO.Path]::GetExtension($path).ToLower()
      # Test mode (cookie ow_mock=1): point config.js at the in-browser Supabase simulator.
      if ($ctx.Request.Cookies['ow_mock'] -and $base -eq $root -and ($rel -eq 'js/config.js' -or $ext -eq '.html')) {
        $text = [Text.Encoding]::UTF8.GetString($bytes)
        if ($rel -eq 'js/config.js') {
          $text = $text.Replace("SUPABASE_URL = '';", "SUPABASE_URL = 'https://mock.supabase.co';").Replace("SUPABASE_ANON_KEY = '';", "SUPABASE_ANON_KEY = 'mock-anon-key';")
        } elseif ($ext -eq '.html') {
          $text = $text.Replace('<script type="module"', '<script type="module" src="/__dev/mock-supabase.js"></script><script type="module"')
        }
        $bytes = [Text.Encoding]::UTF8.GetBytes($text)
      }
      $res.ContentType = $(if ($types[$ext]) { $types[$ext] } else { 'application/octet-stream' })
      $res.Headers.Add('Cache-Control', 'no-store')
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $res.StatusCode = 404
      $msg = [Text.Encoding]::UTF8.GetBytes('404 Not Found')
      $res.OutputStream.Write($msg, 0, $msg.Length)
    }
  } catch {
    $res.StatusCode = 404
  }
  $res.Close()
}
