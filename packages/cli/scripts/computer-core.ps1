param()
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class SkyDesktopNative {
 [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
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
# Align UIA physical bounds, screenshots, and cursor coordinates on scaled displays.
[SkyDesktopNative]::SetProcessDPIAware() | Out-Null
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
function CaptureScreen([string]$scope) {
 # Remove old screenshots created by SkyCode so idle captures do not persist.
 Get-ChildItem -LiteralPath ([System.IO.Path]::GetTempPath()) -Filter 'skycode-window-*.jpg' -File -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -cmatch '^skycode-window-[0-9a-f]{32}\.jpg$' -and $_.LastWriteTimeUtc -lt [DateTime]::UtcNow.AddMinutes(-15) } |
  Remove-Item -Force -ErrorAction SilentlyContinue
 if($scope -ne 'desktop' -and $scope -ne 'window'){throw 'Screenshot scope must be desktop or window.'}
 $window=Foreground
 CheckSafety $window
 $p=$window.Current
 $handle=[IntPtr]$p.NativeWindowHandle
 $screenBounds=[System.Windows.Forms.SystemInformation]::VirtualScreen
 if($scope -eq 'window'){
  if($handle -eq [IntPtr]::Zero -or [SkyDesktopNative]::IsIconic($handle)){throw 'Cannot capture a minimized or invalid window.'}
  $bounds=$p.BoundingRectangle
  if($bounds.IsEmpty -or $bounds.Width -lt 20 -or $bounds.Height -lt 20){throw 'No usable window area to capture.'}
  $left=[int][Math]::Max($bounds.Left,$screenBounds.Left)
  $top=[int][Math]::Max($bounds.Top,$screenBounds.Top)
  $right=[int][Math]::Min($bounds.Right,$screenBounds.Right)
  $bottom=[int][Math]::Min($bounds.Bottom,$screenBounds.Bottom)
 }else{
  # Observe the visible composition of every monitor: wallpaper, desktop icons,
  # taskbar, windows and overlays, not merely the current foreground app bounds.
  $left=[int]$screenBounds.Left
  $top=[int]$screenBounds.Top
  $right=[int]$screenBounds.Right
  $bottom=[int]$screenBounds.Bottom
 }
 $width=$right-$left
 $height=$bottom-$top
 if($width -lt 20 -or $height -lt 20 -or $width -gt 7680 -or $height -gt 4320){throw 'Capture bounds are unavailable or too large.'}
 $bitmap=[System.Drawing.Bitmap]::new($width,$height)
 $graphics=[System.Drawing.Graphics]::FromImage($bitmap)
 try{
  $graphics.CopyFromScreen($left,$top,0,0,[System.Drawing.Size]::new($width,$height))
  $scale=[Math]::Min(1.0,[Math]::Min(1280.0/$width,900.0/$height))
  $outWidth=[int][Math]::Max(1,[Math]::Round($width*$scale))
  $outHeight=[int][Math]::Max(1,[Math]::Round($height*$scale))
  $small=[System.Drawing.Bitmap]::new($outWidth,$outHeight)
  $g=[System.Drawing.Graphics]::FromImage($small)
  try {
   $g.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
   $g.DrawImage($bitmap,0,0,$outWidth,$outHeight)
   $path=Join-Path ([System.IO.Path]::GetTempPath()) ("skycode-window-"+[guid]::NewGuid().ToString('N')+".jpg")
   $codec=[System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object {$_.MimeType -eq 'image/jpeg'} | Select-Object -First 1
   $params=[System.Drawing.Imaging.EncoderParameters]::new(1)
   try {
    $params.Param[0]=[System.Drawing.Imaging.EncoderParameter]::new([System.Drawing.Imaging.Encoder]::Quality,[long]65)
    $small.Save($path,$codec,$params)
   }finally{$params.Dispose()}
  }finally{$g.Dispose();$small.Dispose()}
 }finally{$graphics.Dispose();$bitmap.Dispose()}
 return @{path=$path;scope=$scope;title=[string]$p.Name;processId=[int]$p.ProcessId;windowHandle=[string]$handle;left=$left;top=$top;width=$width;height=$height;imageWidth=$outWidth;imageHeight=$outHeight;format='image/jpeg';capturedAt=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()}
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
   # Discriminators are conjunctive: a supplied automationId, name, or
   # control role must ALL match. Never fall back from a nonmatching ID to name.
   if($step.automationId -and $c.AutomationId -cne [string]$step.automationId){continue}
   if($step.name -and $c.Name -cne [string]$step.name){continue}
   if($step.role -and $c.ControlType.ProgrammaticName -cne [string]$step.role){continue}
   $matches+=,$item
  }catch{continue}
 }
 if($matches.Count -ne 1){
  $sample=@($matches | Select-Object -First 6 | ForEach-Object {
    $c=$_.Current
    @{name=[string]$c.Name;automationId=[string]$c.AutomationId;role=[string]$c.ControlType.ProgrammaticName}
  })
  throw ("Target must match exactly one accessible element; matches: " + $matches.Count + "; candidates: " + ($sample | ConvertTo-Json -Compress -Depth 3) + ". Narrow by exact automationId plus name and/or role; do not repeat an ambiguous action.")
 }
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
 $handle=[IntPtr]$window.Current.NativeWindowHandle
 if([SkyDesktopNative]::GetForegroundWindow() -ne $handle){throw 'Focus changed before pointer operation.'}
 # Use a brief visible cursor movement rather than teleporting to the target.
 $origin=New-Object SkyPoint
 if(![SkyDesktopNative]::GetCursorPos([ref]$origin)){throw 'Cannot read current cursor position.'}
 for($i=1;$i -le 8;$i++){
  if([SkyDesktopNative]::GetForegroundWindow() -ne $handle){throw 'Focus changed while moving the mouse.'}
  $x=[int][Math]::Round($origin.X+($point.x-$origin.X)*$i/8)
  $y=[int][Math]::Round($origin.Y+($point.y-$origin.Y)*$i/8)
  if(![SkyDesktopNative]::SetCursorPos($x,$y)){throw 'Windows rejected pointer positioning.'}
  Start-Sleep -Milliseconds 18
 }
 $cursor=New-Object SkyPoint
 if(![SkyDesktopNative]::GetCursorPos([ref]$cursor)){throw 'Cannot confirm cursor position.'}
 if($cursor.X -ne [int]$point.x -or $cursor.Y -ne [int]$point.y){throw 'Pointer failed to reach target.'}
 if($kind -eq 'move'){return @{x=$cursor.X;y=$cursor.Y;method='physical-mouse';clicksSent=0}}
 $down=if($kind -eq 'right_click'){[SkyMouseFlags]::RIGHT_DOWN}else{[SkyMouseFlags]::LEFT_DOWN}
 $up=if($kind -eq 'right_click'){[SkyMouseFlags]::RIGHT_UP}else{[SkyMouseFlags]::LEFT_UP}
 $times=if($kind -eq 'double_click'){2}else{1}
 $sent=0
 for($k=0;$k -lt $times;$k++){
  if([SkyDesktopNative]::GetForegroundWindow() -ne $handle){throw 'Foreground changed before pointer click.'}
  try{
   [SkyDesktopNative]::mouse_event($down,0,0,0,[UIntPtr]::Zero)
   $sent++
  }finally{
   [SkyDesktopNative]::mouse_event($up,0,0,0,[UIntPtr]::Zero)
  }
  if($k -eq 0 -and $times -eq 2){Start-Sleep -Milliseconds 75}
 }
 return @{x=$cursor.X;y=$cursor.Y;method='physical-mouse';clicksSent=$sent;outcomeVerified=$false}
}
function VisualClick($window,$step){
 $snap=$step.snapshot
 if(!$snap -or !$snap.path -or !$snap.windowHandle){throw 'A recent computer_screenshot result is required for visual clicking.'}
 if($snap.scope -cne 'window'){throw 'Visual click requires a fresh window-scoped screenshot; recapture the target window.'}
 if([string]$snap.title -cne [string]$window.Current.Name -or [int]$snap.processId -ne [int]$window.Current.ProcessId -or [string]$snap.windowHandle -ne [string]$window.Current.NativeWindowHandle){throw 'Screenshot window identity is stale or mismatched.'}
 $filename=[System.IO.Path]::GetFileName([string]$snap.path)
 if($filename -cnotmatch '^skycode-window-[0-9a-f]{32}\.jpg$' -or
    [System.IO.Path]::GetFullPath([string]$snap.path) -cne [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(),$filename)){
  throw 'Invalid screenshot token path.'
 }
 if(!(Test-Path -LiteralPath ([string]$snap.path) -PathType Leaf)){throw 'Screenshot token is missing.'}
 $age=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()-[long]$snap.capturedAt
 if($age -lt 0 -or $age -gt 60000){throw 'Screenshot expired; capture another image.'}
 if([int]$snap.imageWidth -lt 20 -or [int]$snap.imageHeight -lt 20){throw 'Invalid screenshot dimensions.'}
 $ix=[int]$step.x; $iy=[int]$step.y
 if($ix -lt 0 -or $iy -lt 0 -or $ix -ge [int]$snap.imageWidth -or $iy -ge [int]$snap.imageHeight){throw 'Click coordinates are outside screenshot bounds.'}
 $x=[int][Math]::Floor([double]$snap.left+($ix+0.5)*[double]$snap.width/[double]$snap.imageWidth)
 $y=[int][Math]::Floor([double]$snap.top+($iy+0.5)*[double]$snap.height/[double]$snap.imageHeight)
 $rect=$window.Current.BoundingRectangle
 if($x -lt $rect.Left+2 -or $y -lt $rect.Top+2 -or $x -ge $rect.Right-2 -or $y -ge $rect.Bottom-2){throw 'Click is outside the target window.'}
 $element=[System.Windows.Automation.AutomationElement]::FromPoint([System.Windows.Point]::new($x,$y))
 if(!$element){throw 'Cannot inspect the selected screen point.'}
 $belongs=$false
 for($j=0;$j -lt 40 -and $element;$j++){
  try{
   $c=$element.Current
   if($c.IsPassword -or [string]$c.Name -match '(?i)\b(password|passcode|pin|otp|authenticator|secret|token|sign.in)\b'){throw 'Sensitive control; coordinate click denied.'}
   if([IntPtr]$c.NativeWindowHandle -eq [IntPtr]$window.Current.NativeWindowHandle -and [int]$c.ProcessId -eq [int]$window.Current.ProcessId){$belongs=$true;break}
   $element=[System.Windows.Automation.TreeWalker]::RawViewWalker.GetParent($element)
  }catch{throw}
 }
 if(!$belongs){throw 'Click target is covered by another window or is outside the selected application.'}
 if([SkyDesktopNative]::GetForegroundWindow() -ne [IntPtr]$window.Current.NativeWindowHandle){throw 'Foreground changed before visual click.'}
 if(![SkyDesktopNative]::SetCursorPos($x,$y)){throw 'Mouse cursor move was rejected.'}
 $kind=[string]$step.pointerKind
 if(@('click','right_click','double_click') -cnotcontains $kind){throw 'Unsupported visual pointer action.'}
 $down=if($kind -eq 'right_click'){[SkyMouseFlags]::RIGHT_DOWN}else{[SkyMouseFlags]::LEFT_DOWN}
 $up=if($kind -eq 'right_click'){[SkyMouseFlags]::RIGHT_UP}else{[SkyMouseFlags]::LEFT_UP}
 $times=if($kind -eq 'double_click'){2}else{1}
 for($i=0;$i -lt $times;$i++){
  if([SkyDesktopNative]::GetForegroundWindow() -ne [IntPtr]$window.Current.NativeWindowHandle){throw 'Foreground changed before visual click.'}
  try{[SkyDesktopNative]::mouse_event($down,0,0,0,[UIntPtr]::Zero)}
  finally{[SkyDesktopNative]::mouse_event($up,0,0,0,[UIntPtr]::Zero)}
  if($i -eq 0 -and $times -eq 2){Start-Sleep -Milliseconds 75}
 }
 # The screenshot is single-use to prevent blind repeated coordinate actions.
 Remove-Item -LiteralPath ([string]$snap.path) -Force -ErrorAction SilentlyContinue
 return @{kind=$kind;screenX=$x;screenY=$y;eventsSent=$times;outcomeVerified=$false}
}
function DragBetweenControls($window,$source,$destination){
 if($source -eq $destination){throw 'Drag source and destination must be different controls.'}
 # Resolve and hit-test both endpoints before pressing a mouse button.
 $from=GetSafePoint $window $source
 $to=GetSafePoint $window $destination
 $handle=[IntPtr]$window.Current.NativeWindowHandle
 if([SkyDesktopNative]::GetForegroundWindow() -ne $handle){throw 'Focus changed before drag.'}
 if(![SkyDesktopNative]::SetCursorPos([int]$from.x,[int]$from.y)){throw 'Windows rejected drag start position.'}
 $pressed=$false
 try {
  [SkyDesktopNative]::mouse_event([SkyMouseFlags]::LEFT_DOWN,0,0,0,[UIntPtr]::Zero)
  $pressed=$true
  Start-Sleep -Milliseconds 120
  for($i=1;$i -le 12;$i++){
   if([SkyDesktopNative]::GetForegroundWindow() -ne $handle){throw 'Window focus changed during drag; releasing mouse.'}
   $x=[int][Math]::Round($from.x+($to.x-$from.x)*$i/12)
   $y=[int][Math]::Round($from.y+($to.y-$from.y)*$i/12)
   if(![SkyDesktopNative]::SetCursorPos($x,$y)){throw 'Windows rejected drag movement.'}
   Start-Sleep -Milliseconds 22
  }
 }finally{
  if($pressed){[SkyDesktopNative]::mouse_event([SkyMouseFlags]::LEFT_UP,0,0,0,[UIntPtr]::Zero)}
 }
 return @{source=$from;destination=$to;released=$true}
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
 $kind=[string]$step.kind
 if($window.Current.Name -cne [string]$step.expectedTitle -or
    $window.Current.ProcessId -ne [int]$step.expectedProcessId){
  # A different application may have taken focus between model/tool rounds.
  # Recover only for semantic actions and only when an exact target window still exists.
  # Pixel actions are NOT refocused: their screenshot may already be stale.
  if($kind -eq 'visual_click'){throw 'Foreground changed since screenshot; capture another image before clicking.'}
  $candidate=FindWindow ([pscustomobject]@{title=$step.expectedTitle;processId=$step.expectedProcessId;windowHandle=$step.windowHandle})
  $window=FocusWindow $candidate
  if($window.Current.Name -cne [string]$step.expectedTitle -or
     $window.Current.ProcessId -ne [int]$step.expectedProcessId){
   throw 'Target window identity changed after safe refocus; action stopped.'
  }
 }
 if($kind -eq 'visual_click'){
  $visualResult=VisualClick $window $step
  Start-Sleep -Milliseconds 150
  return @{kind=$kind;pointer=$visualResult;postObserved=$true;outcomeVerified=$false;after=Observe (Foreground) 12}
 }
 if($kind -eq 'keypress'){
  $allowed=@('^s','^o','^n','^f','^a','^c','^v','{ESC}','{ENTER}','{TAB}','+{TAB}','{UP}','{DOWN}','{LEFT}','{RIGHT}','{BACKSPACE}','{DELETE}','{HOME}','{END}')
  if($allowed -cnotcontains [string]$step.keys){throw 'Shortcut is outside the approved keyboard allowlist.'}
  [System.Windows.Forms.SendKeys]::SendWait([string]$step.keys)
 }else{
  $target=FindTarget $window $step
  if($kind -eq 'drag'){
   if(!$step.targetName -and !$step.targetAutomationId){throw 'Drag destination requires exact accessible control name or automationId.'}
   $destination=FindTarget $window ([pscustomobject]@{name=$step.targetName;automationId=$step.targetAutomationId})
   $dragResult=DragBetweenControls $window $target $destination
  }elseif($kind -eq 'move' -or $kind -eq 'click' -or $kind -eq 'right_click' -or $kind -eq 'double_click'){
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
 if($kind -eq 'move' -or $kind -eq 'click' -or $kind -eq 'right_click' -or $kind -eq 'double_click'){
  return @{kind=$kind;after=Observe $after 12;pointer=$position;postObserved=$true;outcomeVerified=$false}
 }
 if($kind -eq 'drag'){return @{kind=$kind;after=Observe $after 12;drag=$dragResult;postObserved=$true;outcomeVerified=$false}}
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
 if($request.action -eq 'capture'){
  $scope=if($request.scope){[string]$request.scope}else{'desktop'}
  OutJson @{ok=$true;action='capture';capture=(CaptureScreen $scope)}
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
