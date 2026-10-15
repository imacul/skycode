param()
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class SkyDesktopNative {
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr handle);
 [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr handle);
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr handle, int command);
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr handle);
}
'@
function OutJson($value){[Console]::Out.WriteLine(($value | ConvertTo-Json -Compress -Depth 9))}
function Foreground {
 $handle=[SkyDesktopNative]::GetForegroundWindow()
 if($handle -eq [IntPtr]::Zero){throw 'No foreground window.'}
 $element=[System.Windows.Automation.AutomationElement]::FromHandle($handle)
 if(!$element){throw 'Foreground application is inaccessible.'}
 return $element
}
function CheckSafety($window){
 $name=[string]$window.Current.Name
 $pidValue=[int]$window.Current.ProcessId
 $proc=Get-Process -Id $pidValue -ErrorAction SilentlyContinue
 if(!$proc){throw 'Foreground process disappeared.'}
 if($proc.ProcessName -match '^(?i:logonui|consent|credentialuibroker|bitwarden|keepass|1password|lastpass)$'){
  throw 'Protected authentication window.'
 }
 if($name -match '(?i)\b(password|passcode|pin|authenticator|recovery phrase|seed phrase)\b'){
  throw 'Protected credential surface.'
 }
}
function Observe($window,[int]$max=40){
 CheckSafety $window
 $p=$window.Current
 $nodes=@()
 $all=$window.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
 for($i=0;$i -lt [Math]::Min($all.Count,$max);$i++){
  try {
   $c=$all.Item($i).Current
   if($c.IsOffscreen){continue}
   $name=[string]$c.Name
   if($c.IsPassword -or $name -match '(?i)\b(password|passcode|pin|otp|authenticator|secret|token|sign.in)\b'){continue}
   $nodes+=@{id=($i.ToString());name=$name;role=[string]$c.ControlType.ProgrammaticName;automationId=[string]$c.AutomationId;enabled=[bool]$c.IsEnabled}
  }catch{continue}
 }
 return @{title=[string]$p.Name;processId=[int]$p.ProcessId;windowHandle=[string]$p.NativeWindowHandle;nodes=$nodes}
}
function FindWindow($selector){
 if(!$selector -or !$selector.title -or !$selector.processId){throw 'Exact window title and process ID required. Enumerate windows first.'}
 $windows=[System.Windows.Automation.AutomationElement]::RootElement.FindAll(
  [System.Windows.Automation.TreeScope]::Children,[System.Windows.Automation.Condition]::TrueCondition)
 $matches=@()
 foreach($window in $windows){
  try{
   CheckSafety $window
   $c=$window.Current
   if([string]$c.Name -cne [string]$selector.title -or [int]$c.ProcessId -ne [int]$selector.processId){continue}
   $handle=[IntPtr]$c.NativeWindowHandle
   if($handle -eq [IntPtr]::Zero){continue}
   if($selector.windowHandle -and [string]$handle -ne [string]$selector.windowHandle){continue}
   $matches+=,$window
  }catch{continue}
 }
 if($matches.Count -ne 1){throw "Window selector must match one accessible, permitted window; matches: $($matches.Count)."}
 return $matches[0]
}
function FocusWindow($window){
 CheckSafety $window
 $handle=[IntPtr]$window.Current.NativeWindowHandle
 if($handle -eq [IntPtr]::Zero){throw 'Window lacks a native handle.'}
 if([SkyDesktopNative]::IsIconic($handle)){
  [SkyDesktopNative]::ShowWindow($handle,9) | Out-Null
  Start-Sleep -Milliseconds 250
 }
 if([SkyDesktopNative]::GetForegroundWindow() -ne $handle){
  [SkyDesktopNative]::SetForegroundWindow($handle) | Out-Null
  Start-Sleep -Milliseconds 350
 }
 if([SkyDesktopNative]::GetForegroundWindow() -ne $handle){throw 'Windows declined foreground activation. No keys or UI actions were sent.'}
 return (Foreground)
}
function FindTarget($window,$step){
 $all=$window.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
 $matches=@()
 for($i=0;$i -lt $all.Count;$i++){
  $item=$all.Item($i)
  try {
   $c=$item.Current
   if(!$c.IsEnabled -or $c.IsOffscreen -or $c.IsPassword){continue}
   if([string]$c.Name -match '(?i)\b(password|passcode|pin|otp|authenticator|secret|token|sign.in)\b'){continue}
   if($step.automationId -and $c.AutomationId -ceq [string]$step.automationId){$matches+=,$item}
   elseif($step.name -and $c.Name -ceq [string]$step.name){$matches+=,$item}
  }catch{continue}
 }
 if($matches.Count -ne 1){throw "Target must match exactly one accessible element; matches: $($matches.Count)."}
 return $matches[0]
}
function RunStep($step){
 $window=Foreground
 CheckSafety $window
 if(!$step.expectedTitle -or !$step.expectedProcessId){throw 'Expected window identity required.'}
 if($window.Current.Name -cne [string]$step.expectedTitle -or
    $window.Current.ProcessId -ne [int]$step.expectedProcessId){
  throw 'Foreground window identity changed; action stopped.'
 }
 $kind=[string]$step.kind
 if($kind -eq 'keypress'){
  $allowed=@('^s','^o','^n','^f','^a','^c','^v','{ESC}','{ENTER}','{TAB}','+{TAB}','{UP}','{DOWN}','{LEFT}','{RIGHT}')
  if($allowed -cnotcontains [string]$step.keys){throw 'Shortcut is outside the approved keyboard allowlist.'}
  [System.Windows.Forms.SendKeys]::SendWait([string]$step.keys)
 }else{
  $target=FindTarget $window $step
  if($kind -eq 'invoke'){
   $pattern=$target.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
   $pattern.Invoke()
  }elseif($kind -eq 'focus'){
   $target.SetFocus()
  }elseif($kind -eq 'set_value'){
   $value=[string]$step.value
   if($value.Length -gt 3000){throw 'Text input exceeds 3000 characters.'}
   $pattern=$target.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
   if($pattern.Current.IsReadOnly){throw 'Read-only field.'}
   $pattern.SetValue($value)
  }elseif($kind -eq 'scroll'){
   $direction=[string]$step.direction
   if($direction -ne 'up' -and $direction -ne 'down'){throw 'Scroll direction must be up or down.'}
   $pattern=$target.GetCurrentPattern([System.Windows.Automation.ScrollPattern]::Pattern)
   if(!$pattern.Current.VerticallyScrollable){throw 'Element does not support vertical scrolling.'}
   $amount=[System.Windows.Automation.ScrollAmount]::SmallIncrement
   if($direction -eq 'up'){$amount=[System.Windows.Automation.ScrollAmount]::SmallDecrement}
   $pattern.ScrollVertical($amount)
  }else{throw 'Unsupported desktop action.'}
 }
 Start-Sleep -Milliseconds 100
 $after=Foreground
 CheckSafety $after
 return @{kind=$kind;after=Observe $after 12}
}
try{
 $request=[Console]::In.ReadToEnd() | ConvertFrom-Json
 if($request.action -eq 'observe'){
  $view=Observe (Foreground) 40
  OutJson @{ok=$true;action='observe';window=$view}
  exit 0
 }
 if($request.action -eq 'observe_window'){
  $target=FindWindow $request.selector
  OutJson @{ok=$true;action='observe_window';window=(Observe $target 40)}
  exit 0
 }
 if($request.action -eq 'focus_window'){
  $target=FindWindow $request.selector
  $foreground=FocusWindow $target
  OutJson @{ok=$true;action='focus_window';focused=$true;window=(Observe $foreground 24)}
  exit 0
 }
 if($request.action -eq 'list_windows'){
  $items=@()
  $all=[System.Windows.Automation.AutomationElement]::RootElement.FindAll(
   [System.Windows.Automation.TreeScope]::Children,[System.Windows.Automation.Condition]::TrueCondition)
  $active=[SkyDesktopNative]::GetForegroundWindow()
  foreach($window in $all){
   if($items.Count -ge 50){break}
   try{
    CheckSafety $window
    $c=$window.Current
    $handle=[IntPtr]$c.NativeWindowHandle
    if($handle -eq [IntPtr]::Zero -or [string]::IsNullOrWhiteSpace([string]$c.Name)){continue}
    $proc=Get-Process -Id $c.ProcessId -ErrorAction SilentlyContinue
    if(!$proc){continue}
    $system=($proc.ProcessName -match '^(?i:shellexperiencehost|startmenuexperiencehost|searchhost|textinputhost)$' -or ($proc.ProcessName -ieq 'explorer' -and [string]$c.Name -match '^(?i:Program Manager)$'))
    $visibility=if($system){'system-ui'}elseif([SkyDesktopNative]::IsIconic($handle)){'minimized'}elseif([SkyDesktopNative]::IsWindowVisible($handle)){'visible'}else{'background'}
    $items+=@{title=[string]$c.Name;processName=[string]$proc.ProcessName;processId=[int]$c.ProcessId;
      focused=($handle -eq $active);visibility=$visibility;windowHandle=[string]$handle}
   }catch{continue}
  }
  OutJson @{ok=$true;action='list_windows';windows=$items;complete=$false}
  exit 0
 }
 if($request.action -eq 'act'){
  $out=RunStep $request.step
  OutJson @{ok=$true;action='act';result=$out;postObserved=$true}
  exit 0
 }
 if($request.action -eq 'batch'){
  if(!$request.steps -or $request.steps.Count -gt 8){throw 'Batch must have 1 to 8 steps.'}
  $results=@()
  foreach($step in $request.steps){
   $results+=,(RunStep $step)
  }
  OutJson @{ok=$true;action='batch';stepsCompleted=$results.Count;results=$results;postObserved=$true}
  exit 0
 }
 throw 'Unsupported computer request.'
}catch{
 OutJson @{ok=$false;error=$_.Exception.Message}
 exit 1
}
