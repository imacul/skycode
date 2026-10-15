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
 [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
 [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
 [DllImport("user32.dll")] public static extern bool GetCursorPos(out SkyPoint point);
}
[StructLayout(LayoutKind.Sequential)]
public struct SkyPoint { public int X; public int Y; }
[StructLayout(LayoutKind.Sequential)]
public struct SkyKeyboardInput {
 public ushort vk;
 public ushort scan;
 public uint flags;
 public uint time;
 public UIntPtr extraInfo;
}
[StructLayout(LayoutKind.Explicit)]
public struct SkyInputUnion {
 [FieldOffset(0)] public SkyKeyboardInput keyboard;
}
[StructLayout(LayoutKind.Sequential)]
public struct SkyInput {
 public uint type;
 public SkyInputUnion data;
}
public static class SkyKeyboardNative {
 [DllImport("user32.dll", SetLastError=true)] public static extern uint SendInput(uint count, [In] SkyInput[] inputs, int size);
 public static uint SendUnicode(char ch) {
  var down=new SkyInput { type=1, data=new SkyInputUnion { keyboard=new SkyKeyboardInput { scan=ch, flags=0x0004 } } };
  var up=new SkyInput { type=1, data=new SkyInputUnion { keyboard=new SkyKeyboardInput { scan=ch, flags=0x0004 | 0x0002 } } };
  return SendInput(2, new [] {down,up}, Marshal.SizeOf(typeof(SkyInput)));
 }
}
public static class SkyMouseFlags {
 public const uint LEFT_DOWN = 0x0002;
 public const uint LEFT_UP = 0x0004;
 public const uint RIGHT_DOWN = 0x0008;
 public const uint RIGHT_UP = 0x0010;
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
function VerifyText($window,[string]$expectedText){
 CheckSafety $window
 if([string]::IsNullOrEmpty($expectedText) -or $expectedText.Length -gt 1000){throw 'Verification text must contain 1 to 1000 characters.'}
 $all=$window.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
 $searched=0
 $readable=0
 for($i=0;$i -lt [Math]::Min($all.Count,3000);$i++){
  try{
   $item=$all.Item($i)
   $c=$item.Current
   if($c.IsPassword -or !$c.IsEnabled){continue}
   $name=[string]$c.Name
   if($name -match '(?i)\b(password|passcode|pin|otp|authenticator|secret|token|sign.in)\b'){continue}
   if($c.ControlType -ne [System.Windows.Automation.ControlType]::Edit -and
      $c.ControlType -ne [System.Windows.Automation.ControlType]::Document){continue}
   $searched++
   $pattern=$null
   $observed=$null
   if($item.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$pattern)){
    $observed=[string]$pattern.Current.Value
   }elseif($item.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern,[ref]$pattern)){
    $observed=[string]$pattern.DocumentRange.GetText(12000)
   }else{continue}
   $readable++
   if($observed.Contains($expectedText)){
    return @{verified=$true;reason='Expected text was found in a readable non-sensitive editor.';editorsChecked=$searched}
   }
  }catch{continue}
 }
 if($readable -eq 0){
  return @{verified=$false;reason='No readable editor text was exposed by UI Automation; typing outcome is unverified.';editorsChecked=$searched}
 }
 return @{verified=$false;reason='Expected text was not found in readable editor content.';editorsChecked=$searched}
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
function GetSafePoint($window,$target){
 CheckSafety $window
 $bounds=$target.Current.BoundingRectangle
 $windowBounds=$window.Current.BoundingRectangle
 if($bounds.IsEmpty -or $windowBounds.IsEmpty -or $bounds.Width -lt 2 -or $bounds.Height -lt 2){throw 'Target has no usable screen bounds.'}
 $x=[int][Math]::Floor($bounds.Left+$bounds.Width/2)
 $y=[int][Math]::Floor($bounds.Top+$bounds.Height/2)
 if($x -lt $windowBounds.Left -or $x -gt $windowBounds.Right -or
    $y -lt $windowBounds.Top -or $y -gt $windowBounds.Bottom){throw 'Control center lies outside the selected window.'}
 $screen=[System.Windows.Forms.Screen]::AllScreens | Where-Object {$_.Bounds.Contains([System.Drawing.Point]::new($x,$y))} | Select-Object -First 1
 if(!$screen){throw 'Control center is outside all connected monitors.'}
 $topAtPoint=[System.Windows.Automation.AutomationElement]::FromPoint([System.Windows.Point]::new($x,$y))
 if(!$topAtPoint){throw 'Cannot inspect the intended click position.'}
 # Reject points occupied by another application's window or an overlay.
 $cursorElement=$topAtPoint
 $belongs=$false
 for($j=0;$j -lt 35 -and $cursorElement;$j++){
  $current=$cursorElement.Current
  if([IntPtr]$current.NativeWindowHandle -eq [IntPtr]$window.Current.NativeWindowHandle -and
     [int]$current.ProcessId -eq [int]$window.Current.ProcessId){$belongs=$true;break}
  if($cursorElement -eq $target -or $cursorElement -eq $window){$belongs=$true;break}
  $cursorElement=[System.Windows.Automation.TreeWalker]::RawViewWalker.GetParent($cursorElement)
 }
 if(!$belongs){throw 'Another element covers the target center; refusing pointer action.'}
 return @{x=$x;y=$y}
}
function MouseAction($window,$target,[string]$kind){
 $point=GetSafePoint $window $target
 if([SkyDesktopNative]::GetForegroundWindow() -ne [IntPtr]$window.Current.NativeWindowHandle){throw 'Focus changed before pointer operation.'}
 if(![SkyDesktopNative]::SetCursorPos([int]$point.x,[int]$point.y)){throw 'Windows rejected pointer positioning.'}
 if($kind -eq 'move'){return $point}
 $down=if($kind -eq 'right_click'){[SkyMouseFlags]::RIGHT_DOWN}else{[SkyMouseFlags]::LEFT_DOWN}
 $up=if($kind -eq 'right_click'){[SkyMouseFlags]::RIGHT_UP}else{[SkyMouseFlags]::LEFT_UP}
 $times=if($kind -eq 'double_click'){2}else{1}
 for($k=0;$k -lt $times;$k++){
  if([SkyDesktopNative]::GetForegroundWindow() -ne [IntPtr]$window.Current.NativeWindowHandle){throw 'Foreground changed before pointer click.'}
  [SkyDesktopNative]::mouse_event($down,0,0,0,[UIntPtr]::Zero)
  [SkyDesktopNative]::mouse_event($up,0,0,0,[UIntPtr]::Zero)
  if($k -eq 0 -and $times -eq 2){Start-Sleep -Milliseconds 75}
 }
 return $point
}
function SendLiteralText([string]$value,$window){
 if($value.Length -gt 1000){throw 'Text exceeds per-action typing budget.'}
 $handle=[IntPtr]$window.Current.NativeWindowHandle
 $sent=0
 foreach($char in $value.ToCharArray()){
  if([SkyDesktopNative]::GetForegroundWindow() -ne $handle){throw "Focus changed during typing after $sent characters."}
  if([SkyKeyboardNative]::SendUnicode($char) -ne 2){
   throw "Windows SendInput failed after $sent characters (possibly input integrity/UIPI restriction)."
  }
  $sent++
 }
 return $sent
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
  $allowed=@('^s','^o','^n','^f','^a','^c','^v','{ESC}','{ENTER}','{TAB}','+{TAB}','{UP}','{DOWN}','{LEFT}','{RIGHT}','{BACKSPACE}','{DELETE}','{HOME}','{END}')
  if($allowed -cnotcontains [string]$step.keys){throw 'Shortcut is outside the approved keyboard allowlist.'}
  [System.Windows.Forms.SendKeys]::SendWait([string]$step.keys)
 }else{
  $target=FindTarget $window $step
  if($kind -eq 'move' -or $kind -eq 'click' -or $kind -eq 'right_click' -or $kind -eq 'double_click'){
   $position=MouseAction $window $target $kind
  }elseif($kind -eq 'type'){
   $role=$target.Current.ControlType
   if($role -ne [System.Windows.Automation.ControlType]::Edit -and
      $role -ne [System.Windows.Automation.ControlType]::Document){throw 'Typing requires an accessible Edit or Document control.'}
   $target.SetFocus()
   if([SkyDesktopNative]::GetForegroundWindow() -ne [IntPtr]$window.Current.NativeWindowHandle){throw 'Focus changed before typing.'}
   $sent=SendLiteralText ([string]$step.value) $window
   Start-Sleep -Milliseconds 200
   $readback=VerifyText $window ([string]$step.value)
   # Input has already been sent. Never throw just because UIA cannot read back
   # editor content: retries could duplicate text in the document.
   $typeEvidence=@{charactersSent=$sent;textVerified=[bool]$readback.verified;verificationReason=[string]$readback.reason}
  }elseif($kind -eq 'invoke'){
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
 if($kind -eq 'type'){return @{kind=$kind;after=Observe $after 12;input=$typeEvidence}}
 return @{kind=$kind;after=Observe $after 12}
}
try{
 $request=[Console]::In.ReadToEnd() | ConvertFrom-Json
 if($request.action -eq 'observe'){
  $view=Observe (Foreground) 40
  OutJson @{ok=$true;action='observe';window=$view}
  exit 0
 }
 if($request.action -eq 'verify_text'){
  $window=Foreground
  if(!$request.expectedTitle -or !$request.expectedProcessId){throw 'Expected foreground identity required.'}
  if($window.Current.Name -cne [string]$request.expectedTitle -or
     $window.Current.ProcessId -ne [int]$request.expectedProcessId){throw 'Foreground identity changed before verification.'}
  $result=VerifyText $window ([string]$request.expectedText)
  OutJson @{ok=$true;action='verify_text';result=$result}
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
