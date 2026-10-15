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
    if($handle -eq [IntPtr]::Zero -or !([string]$c.Name).Trim()){continue}
    $proc=Get-Process -Id $c.ProcessId -ErrorAction SilentlyContinue
    if(!$proc){continue}
    $system=$proc.ProcessName -match '^(?i:explorer|shellexperiencehost|startmenuexperiencehost|searchhost|textinputhost)$'
    $visibility=if($system){'system-ui'}elseif([SkyDesktopNative]::IsIconic($handle)){'minimized'}elseif([SkyDesktopNative]::IsWindowVisible($handle)){'visible'}else{'background'}
    $items+=@{title=[string]$c.Name;processName=[string]$proc.ProcessName;processId=[int]$c.ProcessId;
      focused=($handle -eq $active);visibility=$visibility}
   }catch{continue}
  }
  OutJson @{ok=$true;action='list_windows';windows=$items;complete=$false}
  exit 0
 }
 if($request.action -eq 'act'){
  $out=RunStep $request.step
  OutJson @{ok=$true;action='act';result=$out;verified=$true}
  exit 0
 }
 if($request.action -eq 'batch'){
  if(!$request.steps -or $request.steps.Count -gt 8){throw 'Batch must have 1 to 8 steps.'}
  $results=@()
  foreach($step in $request.steps){
   $results+=,(RunStep $step)
  }
  OutJson @{ok=$true;action='batch';stepsCompleted=$results.Count;results=$results;verified=$true}
  exit 0
 }
 throw 'Unsupported computer request.'
}catch{
 OutJson @{ok=$false;error=$_.Exception.Message}
 exit 1
}
