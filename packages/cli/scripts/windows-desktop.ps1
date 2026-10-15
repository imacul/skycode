param()
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class SkyCodeWin32 {
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int command);
}
'@
function Say($result) { [Console]::Out.WriteLine(($result | ConvertTo-Json -Depth 8 -Compress)) }
function Find-DocumentWindow([string]$filename, [int]$milliseconds=15000) {
 $end = [DateTime]::UtcNow.AddMilliseconds($milliseconds)
 $name = [IO.Path]::GetFileName($filename)
 $stem = [IO.Path]::GetFileNameWithoutExtension($name)
 $needle = [Regex]::Escape($stem)
 while ([DateTime]::UtcNow -lt $end) {
  $windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
   [System.Windows.Automation.TreeScope]::Children,
   [System.Windows.Automation.Condition]::TrueCondition)
  foreach ($window in $windows) {
   try {
    $processId = [int]$window.Current.ProcessId
    if ($processId -le 0) {continue}
    $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if (!$process -or $process.ProcessName -notmatch '^notepad$') {continue}
    # Modern Windows Notepad can reuse an existing process and show each
    # document as a tab. The process returned by Start-Process is not reliably
    # the process hosting the document, and the foreground may be PowerShell.
    $title = [string]$window.Current.Name
    $nameMatch = $title -match "(?i)$needle"
    if (!$nameMatch) {
     $tabs = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants,
      [System.Windows.Automation.PropertyCondition]::new(
       [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
       [System.Windows.Automation.ControlType]::TabItem))
     foreach ($tab in $tabs) {
      if ([string]$tab.Current.Name -match "(?i)$needle") { $nameMatch = $true; break }
     }
    }
    if ($nameMatch) {return $window}
   } catch { continue }
  }
  Start-Sleep -Milliseconds 250
 }
 throw "Could not find a Notepad window or tab matching the requested document. Saved file remains verified on disk."
}
function Observe-Window($window, [int]$limit=60) {
 $nodes = @()
 $all = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
 for ($i=0; $i -lt [Math]::Min($all.Count, $limit); $i++) {
  $el=$all.Item($i);$p=$el.Current
  $nodes+=@{ name=[string]$p.Name;role=[string]$p.ControlType.ProgrammaticName;automationId=[string]$p.AutomationId;enabled=[bool]$p.IsEnabled;offscreen=[bool]$p.IsOffscreen }
 }
 return @{title=[string]$window.Current.Name; processId=[int]$window.Current.ProcessId; nodes=$nodes}
}
function Assert-SafeForeground($window) {
 $hwnd=[IntPtr]([int]$window.Current.NativeWindowHandle)
 if ($hwnd -eq [IntPtr]::Zero) { throw "Window has no native handle." }
 [SkyCodeWin32]::ShowWindow($hwnd, 9) | Out-Null
 if (![SkyCodeWin32]::SetForegroundWindow($hwnd)) { throw "Unable to focus the target window." }
 Start-Sleep -Milliseconds 250
 if ([SkyCodeWin32]::GetForegroundWindow() -ne $hwnd) { throw "Focus changed; refusing to type." }
}
function Find-Edit($window) {
 # Notepad versions expose the editor as either Edit or Document.
 $items=$window.FindAll([System.Windows.Automation.TreeScope]::Descendants,
  [System.Windows.Automation.Condition]::TrueCondition)
 foreach ($item in $items) {
  try {
   $role=$item.Current.ControlType
   if (($role -eq [System.Windows.Automation.ControlType]::Edit -or
        $role -eq [System.Windows.Automation.ControlType]::Document) -and
       $item.Current.IsEnabled -and !$item.Current.IsOffscreen) {
    try {$null=$item.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern);return $item} catch {}
    try {$null=$item.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern);return $item} catch {}
   }
  } catch { continue }
 }
 return $null
}
function Verify-Text($window,$expected) {
 $edit=Find-Edit $window
 if (!$edit) {return @{verified=$false;reason="Notepad edit element not exposed by UI Automation."}}
 $value=$null
 try {
  $pattern=$edit.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
  $value=[string]$pattern.Current.Value
 } catch {}
 if ($null -eq $value) {
  try {$pattern=$edit.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern); $value=[string]$pattern.DocumentRange.GetText(-1)} catch {}
 }
 if ($null -eq $value) {return @{verified=$false;reason="Editor text is not readable through accessibility."}}
 $normalize = { param([string]$s) (($s -replace "`r`n","`n").TrimEnd([char[]]@([char]13,[char]10))) }
 return @{verified=((& $normalize $value) -eq (& $normalize $expected));reason="Compared visible editor text to expected document."}
}
try {
 $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
 if ($request.action -eq 'snapshot') {
  $hwnd=[SkyCodeWin32]::GetForegroundWindow()
  if ($hwnd -eq [IntPtr]::Zero) { throw "No foreground window." }
  $window=[System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
  $obs=Observe-Window $window
  if ([string]$window.Current.Name -match '(?i)password|credential|sign in|log in|authenticator|bank') {throw "Sensitive window blocked."}
  Say @{ok=$true;action='snapshot';window=$obs}; exit 0
 }
 if ($request.action -eq 'close_document') {
  $name = [string]$request.filename
  if (![regex]::IsMatch($name, '^[A-Za-z0-9_][A-Za-z0-9_ .-]{0,100}[.]txt
 $path=[IO.Path]::GetFullPath([string]$request.path)
 $content=[string]$request.content
 if (!$path.EndsWith('.txt',[StringComparison]::OrdinalIgnoreCase)) {throw "Only .txt files are permitted."}
 if ([IO.File]::Exists($path)) {throw "File exists; overwrite is not allowed."}
 [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($path)) | Out-Null
 # Stage the document via .NET, not by simulating an unverified GUI paste.
 [IO.File]::WriteAllText($path, $content, (New-Object System.Text.UTF8Encoding($false)))
 $onDisk=[IO.File]::ReadAllText($path)
 if ($onDisk -cne $content) {throw "Disk read-back does not match."}
 $proc=Start-Process -FilePath 'notepad.exe' -ArgumentList ('"' + $path + '"') -PassThru
 Start-Sleep -Milliseconds 800
 try {
  $window=Find-DocumentWindow $path
  $observed=Observe-Window $window 30
  $visible=Verify-Text $window $content
  Say @{ok=$true;action='notepad_document';path=$path;diskVerified=$true;notepadOpened=$true;editorVerified=$visible.verified;editorVerification=$visible.reason;window=$observed};exit 0
 } catch {
  Say @{ok=$true;action='notepad_document';path=$path;diskVerified=$true;notepadOpened=$false;editorVerified=$false;windowError=$_.Exception.Message};exit 0
 }
} catch {
 Say @{ok=$false;error=$_.Exception.Message}
 exit 1
}
) -or $name.Contains('..')) {throw 'Invalid file name.'}
  $window = Find-DocumentWindow $name 3500
  Assert-SafeForeground $window
  [System.Windows.Forms.SendKeys]::SendWait('^w')
  Start-Sleep -Milliseconds 400
  $closed = $false
  try {$unused = Find-DocumentWindow $name 1200}
  catch {
   if ($_.Exception.Message.StartsWith('Could not find a Notepad window')) {$closed = $true}
   else {throw}
  }
  Say @{ok=$true;action='close_document';filename=$name;closed=$closed;verified=$closed}
  exit 0
 }
 if ($request.action -ne 'notepad_document') {throw "Unsupported desktop operation."}
 $path=[IO.Path]::GetFullPath([string]$request.path)
 $content=[string]$request.content
 if (!$path.EndsWith('.txt',[StringComparison]::OrdinalIgnoreCase)) {throw "Only .txt files are permitted."}
 if ([IO.File]::Exists($path)) {throw "File exists; overwrite is not allowed."}
 [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($path)) | Out-Null
 # Stage the document via .NET, not by simulating an unverified GUI paste.
 [IO.File]::WriteAllText($path, $content, (New-Object System.Text.UTF8Encoding($false)))
 $onDisk=[IO.File]::ReadAllText($path)
 if ($onDisk -cne $content) {throw "Disk read-back does not match."}
 $proc=Start-Process -FilePath 'notepad.exe' -ArgumentList ('"' + $path + '"') -PassThru
 Start-Sleep -Milliseconds 800
 try {
  $window=Find-DocumentWindow $path
  $observed=Observe-Window $window 30
  $visible=Verify-Text $window $content
  Say @{ok=$true;action='notepad_document';path=$path;diskVerified=$true;notepadOpened=$true;editorVerified=$visible.verified;editorVerification=$visible.reason;window=$observed};exit 0
 } catch {
  Say @{ok=$true;action='notepad_document';path=$path;diskVerified=$true;notepadOpened=$false;editorVerified=$false;windowError=$_.Exception.Message};exit 0
 }
} catch {
 Say @{ok=$false;error=$_.Exception.Message}
 exit 1
}
