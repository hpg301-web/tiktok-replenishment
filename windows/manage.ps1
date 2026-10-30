param([ValidateSet('Start','Stop','EnableStartup','DisableStartup','Network','Firewall')][string]$Action='Start', [switch]$Quiet)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
$root = Split-Path $PSScriptRoot -Parent
$port = 5173
$url = "http://127.0.0.1:$port/_stockpilot/health"
$state = Join-Path $root '.stockpilot'
$launcher = Join-Path $root 'Start.vbs'
$link = Join-Path ([Environment]::GetFolderPath('Startup')) 'StockPilot.lnk'
function Notify([string]$text) { if (!$Quiet) { [void][System.Windows.Forms.MessageBox]::Show($text,'StockPilot') } }
function Health { try { return Invoke-RestMethod $url -TimeoutSec 2 } catch { return $null } }
try {
  if ($Action -eq 'EnableStartup') {
    $shortcut=(New-Object -ComObject WScript.Shell).CreateShortcut($link)
    $shortcut.TargetPath=Join-Path $env:WINDIR 'System32\wscript.exe'
    $shortcut.Arguments='"'+$launcher+'" /quiet'
    $shortcut.WorkingDirectory=$root
    $shortcut.Description='StockPilot local server'
    $shortcut.Save()
    Notify '已设置当前用户登录 Windows 后自动启动。请保持项目文件夹位置不变；主机需开机且该用户需登录。'
    exit
  }
  if ($Action -eq 'DisableStartup') {
    if (Test-Path $link) {
      $saved=(New-Object -ComObject WScript.Shell).CreateShortcut($link)
      if (!$saved.Arguments.Contains($launcher)) { throw '发现其他安装的启动项，未删除。' }
      Remove-Item $link
    }
    Notify '已取消登录后自动启动；正在运行的服务不受影响。'
    exit
  }
  if ($Action -eq 'Firewall') {
    $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
    $admin=([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if (!$admin) {
      Start-Process powershell.exe -Verb RunAs -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -File "'+$PSCommandPath+'" -Action Firewall')
      exit
    }
    $node=(Get-Command node.exe -ErrorAction Stop).Source
    if (!(Get-NetFirewallRule -DisplayName 'StockPilot Local Team' -ErrorAction SilentlyContinue)) {
      New-NetFirewallRule -DisplayName 'StockPilot Local Team' -Direction Inbound -Action Allow -Protocol TCP -LocalPort $port -Profile Private -RemoteAddress LocalSubnet -Program $node | Out-Null
    }
    Notify '已允许同一局域网访问；仅限 Windows 专用网络。若公司网络属于域网络，请联系 IT 配置访问，不要关闭防火墙。'
    exit
  }
  if ($Action -eq 'Network') {
    $h=Health
    if (!$h -or $h.app -ne 'stockpilot-local') { throw '请先双击 Start.vbs 启动本软件。' }
    $addresses=$h.addresses -join "`r`n"
    $text="同事在同一公司局域网的浏览器输入以下地址（通常选择 192.168 开头的地址）：`r`n`r`n$addresses`r`n`r`n主机需要开机且不能休眠。所有人使用同一份数据，页面每5秒同步一次。"
    $text | Set-Content -Encoding UTF8 (Join-Path $root 'LAN-addresses.txt')
    $code=Get-Content (Join-Path $state 'access-code.txt') -Raw
    Notify ($text+"`r`n`r`n团队访问口令："+$code.Trim())
    exit
  }
  if ($Action -eq 'Stop') {
    $record=Join-Path $state 'process.json'
    if (!(Test-Path $record)) { Notify '没有本安装启动的服务记录，无需停止。'; exit }
    $saved=Get-Content $record -Raw | ConvertFrom-Json
    $h=Health
    if (!$h -or $h.app -ne 'stockpilot-local' -or $h.pid -ne $saved.pid -or $h.instance -ne $saved.instance) { throw '运行信息不匹配或服务已停止，未终止任何进程。' }
    $process=Get-CimInstance Win32_Process -Filter "ProcessId = $($saved.pid)"
    $server=Join-Path $root 'scripts\serve.mjs'
    if (!$process -or $process.Name -ne 'node.exe' -or !$process.CommandLine.Contains($server)) { throw '进程身份不匹配，未停止其他程序。' }
    Stop-Process -Id $saved.pid
    Remove-Item $record
    Notify '已停止 StockPilot；同事访问也会停止。主机上保存的团队数据不会删除。'
    exit
  }
  $existing=Health
  if ($existing -and $existing.app -eq 'stockpilot-local') {
    $running=Get-CimInstance Win32_Process -Filter "ProcessId = $($existing.pid)"
    if (!$running -or !$running.CommandLine.Contains((Join-Path $root 'scripts\serve.mjs'))) { throw '另一个安装位置正在使用此端口。请停止旧安装后再启动此文件夹。' }
    if (!$Quiet) { Start-Process "http://localhost:$port/" }
    exit
  }
  $listener=[System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Any,$port)
  try { $listener.Start() } catch { throw "端口 $port 已被占用。请先关闭原来运行 npm run dev 的黑色窗口，再重新双击 Start.vbs。" } finally { $listener.Stop() }
  $node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
  if (!$node) {
    $candidate=Join-Path $env:ProgramFiles 'nodejs\node.exe'
    if (Test-Path $candidate) { $node=$candidate }
  }
  if (!$node) { throw '未找到 Node.js。请先安装 Node.js 24 LTS，再重新启动。' }
  if (!(Test-Path (Join-Path $root 'dist\index.html'))) { throw '缺少部署文件。请下载 StockPilot-Windows.zip 部署包并完整解压，而不是只下载启动脚本。' }
  New-Item -ItemType Directory -Force $state | Out-Null
  $process=Start-Process -FilePath $node -ArgumentList @(('"'+(Join-Path $root 'scripts\serve.mjs')+'"')) -WorkingDirectory $root -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $state 'server.log') -RedirectStandardError (Join-Path $state 'error.log')
  $h=$null
  for ($n=0;$n -lt 40;$n++) {
    Start-Sleep -Milliseconds 250
    $h=Health
    if ($h -and $h.app -eq 'stockpilot-local' -and $h.pid -eq $process.Id) { break }
    $h=$null
    if ($process.HasExited) { break }
  }
  if (!$h) { throw "启动失败，请检查 $state\error.log；未停止其他进程。" }
  @{pid=$process.Id;instance=$h.instance} | ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $state 'process.json')
  if (!$Quiet) {
    Start-Process "http://localhost:$port/"
    $code=Get-Content (Join-Path $state 'access-code.txt') -Raw
    Notify ("团队服务已启动。登录口令："+$code.Trim()+"`r`n`r`n同事访问地址请双击 LAN-address.vbs。请妥善保存口令，不要发到公开仓库。")
  }
} catch {
  [void][System.Windows.Forms.MessageBox]::Show($_.Exception.Message,'StockPilot - 操作未完成',[System.Windows.Forms.MessageBoxButtons]::OK,[System.Windows.Forms.MessageBoxIcon]::Error)
  exit 1
}
