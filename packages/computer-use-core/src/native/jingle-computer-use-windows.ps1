# Jingle-owned Windows computer-use backend.
# Reads one JSON request from stdin and writes one JSON response.

$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2.0
$JingleComputerUseEnvironment = "windows-win32"
$JingleComputerUseProtocolVersion = 1
$JingleComputerUseUtf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = $JingleComputerUseUtf8
[Console]::OutputEncoding = $JingleComputerUseUtf8

function New-ProbeResponse {
    return [pscustomobject]@{
        environment = $JingleComputerUseEnvironment
        platform = "windows"
        protocolVersion = $JingleComputerUseProtocolVersion
        capabilities = @(
            [pscustomobject]@{ action = "activate"; background = "unavailable"; foreground = "unavailable"; route = "unavailable" },
            [pscustomobject]@{ action = "press"; background = "unavailable"; foreground = "unavailable"; route = "uia_action" },
            [pscustomobject]@{ action = "set_value"; background = "unavailable"; foreground = "unavailable"; route = "uia_value" },
            [pscustomobject]@{ action = "type_text"; background = "unavailable"; foreground = "unavailable"; route = "uia_value" },
            [pscustomobject]@{ action = "keypress"; background = "unavailable"; foreground = "unavailable"; route = "uia_unavailable" },
            [pscustomobject]@{ action = "scroll"; background = "unavailable"; foreground = "unavailable"; route = "uia_unavailable" }
        )
    }
}

function Write-NativeFailure {
    param([object]$Failure)
    [Console]::Error.WriteLine((ConvertTo-Json -Compress -InputObject ([ordered]@{
        code = "native_failed"
        message = $Failure.Exception.Message
    })))
}

function Write-NativeResult {
    param([object]$Result)
    if ($null -eq $Result) {
        [Console]::Out.WriteLine("null")
        return
    }
    [Console]::Out.WriteLine((ConvertTo-Json -InputObject $Result -Compress -Depth 24))
}

function Get-OptionalProperty {
    param([object]$Object, [string]$Name)
    if ($null -eq $Object) { return $null }
    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) { return $null }
    return $property.Value
}

function Assert-OperationProtocol {
    param([object]$Envelope)
    $environmentProperty = $Envelope.PSObject.Properties["environment"]
    $protocolVersionProperty = $Envelope.PSObject.Properties["protocolVersion"]
    if ($null -eq $environmentProperty -or $null -eq $protocolVersionProperty) {
        throw "Computer-use request belongs to another environment or protocol."
    }
    $rawEnvironment = $environmentProperty.Value
    $rawProtocolVersion = $protocolVersionProperty.Value
    $protocolIsInteger = $rawProtocolVersion -is [int] -or $rawProtocolVersion -is [long]
    if ($rawEnvironment -isnot [string] -or
        $rawEnvironment -cne $JingleComputerUseEnvironment -or
        -not $protocolIsInteger -or
        $rawProtocolVersion -ne $JingleComputerUseProtocolVersion) {
        throw "Computer-use request belongs to another environment or protocol."
    }
}

function New-OperationResponse {
    param([string]$Method, [object]$Result)
    return [pscustomobject]@{
        environment = $JingleComputerUseEnvironment
        method = $Method
        protocolVersion = $JingleComputerUseProtocolVersion
        result = $Result
    }
}

try {
    if ($args.Count -gt 0) { throw "Computer Use requests must use stdin." }
    $json = [Console]::In.ReadToEnd()
    if (-not $json) { throw "A JSON request is required." }
    $envelope = $json | ConvertFrom-Json
    $methodProperty = $envelope.PSObject.Properties["method"]
    if ($null -eq $methodProperty) { throw "Computer-use method must be a string." }
    $method = $methodProperty.Value
    if ($method -isnot [string]) { throw "Computer-use method must be a string." }
} catch {
    Write-NativeFailure $_
    exit 1
}

try {
    switch -CaseSensitive ($method) {
        "probe" {
            Assert-OperationProtocol $envelope
            Write-NativeResult (New-ProbeResponse)
            exit 0
        }
        "execute" {
            Assert-OperationProtocol $envelope
            $base = Get-OptionalProperty (Get-OptionalProperty $envelope "request") "base"
            $baseStateId = [string](Get-OptionalProperty $base "stateId")
            Write-NativeResult (New-OperationResponse "execute" ([pscustomobject]@{
                baseStateId = $baseStateId
                outcome = "unavailable"
                steps = @()
            }))
            exit 0
        }
        "dispose_session" {
            Write-NativeResult $null
            exit 0
        }
        "identify" {}
        "observe" {}
        default { throw "Unsupported computer-use method: $method" }
    }
} catch {
    Write-NativeFailure $_
    exit 1
}

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class JingleComputerUseWin32 {
    public delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
    [DllImport("user32.dll")]
    public static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int count);

    public static IntPtr[] TopLevelWindows() {
        var result = new List<IntPtr>();
        EnumWindows((hwnd, unused) => {
            if (IsWindowVisible(hwnd)) result.Add(hwnd);
            return true;
        }, IntPtr.Zero);
        return result.ToArray();
    }

    public static uint ProcessId(IntPtr hwnd) {
        uint processId;
        GetWindowThreadProcessId(hwnd, out processId);
        return processId;
    }

    public static string WindowTitle(IntPtr hwnd) {
        var text = new StringBuilder(1024);
        GetWindowText(hwnd, text, text.Capacity);
        return text.ToString();
    }
}
"@ | Out-Null

$script:MaxElements = 750
$script:MaxDepth = 12

function Convert-ToIntPtr {
    param([object]$Value)
    if ($null -eq $Value) { return [IntPtr]::Zero }
    $text = [string]$Value
    $number = [Int64]0
    if ($text.StartsWith("0x", [StringComparison]::OrdinalIgnoreCase)) {
        $number = [Convert]::ToInt64($text.Substring(2), 16)
    } elseif (-not [Int64]::TryParse($text, [ref]$number)) {
        return [IntPtr]::Zero
    }
    return [IntPtr]::new($number)
}

function Get-ProcessGeneration {
    param([int]$ProcessId)
    $process = [Diagnostics.Process]::GetProcessById($ProcessId)
    return $process.StartTime.ToUniversalTime().Ticks.ToString([Globalization.CultureInfo]::InvariantCulture)
}

function Resolve-Window {
    param([object]$Request, [object]$ExpectedIdentity)

    $requestedWindowId = Get-OptionalProperty $Request "windowId"
    if ($null -eq $requestedWindowId -and $null -ne $ExpectedIdentity) {
        $requestedWindowId = Get-OptionalProperty $ExpectedIdentity "nativeId"
    }
    $requestedPid = 0
    if ($null -ne $ExpectedIdentity) {
        $expectedPid = Get-OptionalProperty $ExpectedIdentity "pid"
        if ($null -ne $expectedPid) { $requestedPid = [int]$expectedPid }
    }

    $applicationId = [string](Get-OptionalProperty $Request "applicationId")
    $applicationName = [string](Get-OptionalProperty $Request "applicationName")
    $candidates = @()
    if ($null -ne $requestedWindowId) {
        $hwnd = Convert-ToIntPtr $requestedWindowId
        if ($hwnd -ne [IntPtr]::Zero -and [JingleComputerUseWin32]::IsWindow($hwnd)) {
            $candidates = @($hwnd)
        }
    } else {
        $candidates = [JingleComputerUseWin32]::TopLevelWindows()
    }

    $resolvedWindows = New-Object Collections.Generic.List[object]
    foreach ($hwnd in $candidates) {
        $pid = [int][JingleComputerUseWin32]::ProcessId($hwnd)
        if ($pid -le 0 -or ($requestedPid -gt 0 -and $pid -ne $requestedPid)) { continue }
        try { $process = [Diagnostics.Process]::GetProcessById($pid) } catch { continue }
        try {
            $executablePath = [IO.Path]::GetFullPath($process.MainModule.FileName)
        } catch { continue }
        if (-not $executablePath) { continue }
        $stableApplicationId = "win32-exe:$($executablePath.ToLowerInvariant())"
        if ($applicationId -and $stableApplicationId -ne $applicationId.ToLowerInvariant()) { continue }
        if ($applicationName -and
            $process.ProcessName.IndexOf($applicationName, [StringComparison]::OrdinalIgnoreCase) -lt 0 -and
            [JingleComputerUseWin32]::WindowTitle($hwnd).IndexOf($applicationName, [StringComparison]::OrdinalIgnoreCase) -lt 0) { continue }

        $generation = Get-ProcessGeneration $pid
        if ($null -ne $ExpectedIdentity) {
            $expectedGeneration = [string](Get-OptionalProperty $ExpectedIdentity "generation")
            if ($expectedGeneration -and $generation -ne $expectedGeneration) { continue }
        }
        $resolvedWindows.Add([pscustomobject]@{
            Hwnd = $hwnd
            NativeId = $hwnd.ToInt64().ToString([Globalization.CultureInfo]::InvariantCulture)
            Pid = $pid
            Process = $process
            ApplicationId = $stableApplicationId
            Generation = $generation
        })
    }
    if ($resolvedWindows.Count -eq 1) { return $resolvedWindows[0] }
    return $null
}

function New-TargetIdentity {
    param([object]$Window)
    return [pscustomobject]@{
        application = [pscustomobject]@{
            id = $Window.ApplicationId
            name = $Window.Process.ProcessName
        }
        resourceKey = "windows:$($Window.Pid):$($Window.Generation):$($Window.NativeId)"
        window = [pscustomobject]@{
            generation = $Window.Generation
            nativeId = $Window.NativeId
            pid = $Window.Pid
            platform = "windows"
        }
    }
}

function Assert-ExactTargetIdentity {
    param([object]$Expected, [object]$Actual)
    $expectedApplication = Get-OptionalProperty $Expected "application"
    $expectedWindow = Get-OptionalProperty $Expected "window"
    if ($null -eq $expectedApplication -or $null -eq $expectedWindow -or
        [string](Get-OptionalProperty $Expected "resourceKey") -cne [string]$Actual.resourceKey -or
        [string](Get-OptionalProperty $expectedApplication "id") -cne [string]$Actual.application.id -or
        [string](Get-OptionalProperty $expectedApplication "name") -cne [string]$Actual.application.name -or
        [string](Get-OptionalProperty $expectedWindow "generation") -cne [string]$Actual.window.generation -or
        [string](Get-OptionalProperty $expectedWindow "nativeId") -cne [string]$Actual.window.nativeId -or
        [int](Get-OptionalProperty $expectedWindow "pid") -ne [int]$Actual.window.pid -or
        [string](Get-OptionalProperty $expectedWindow "platform") -cne [string]$Actual.window.platform) {
        throw "Target application, window, or resource identity changed before observation."
    }
}

function Get-Pattern {
    param(
        [Windows.Automation.AutomationElement]$Element,
        [Windows.Automation.AutomationPattern]$Pattern
    )
    $result = $null
    if ($Element.TryGetCurrentPattern($Pattern, [ref]$result)) { return $result }
    return $null
}

function Get-ElementRef {
    param([Windows.Automation.AutomationElement]$Element, [string]$NativeId)
    $runtimeId = $Element.GetRuntimeId()
    return "win:${NativeId}:$([string]::Join('.', [string[]]$runtimeId))"
}

function Get-ElementActions {
    param([Windows.Automation.AutomationElement]$Element)
    $actions = New-Object Collections.Generic.List[string]
    if ($null -ne (Get-Pattern $Element ([Windows.Automation.InvokePattern]::Pattern)) -or
        $null -ne (Get-Pattern $Element ([Windows.Automation.TogglePattern]::Pattern)) -or
        $null -ne (Get-Pattern $Element ([Windows.Automation.SelectionItemPattern]::Pattern))) {
        $actions.Add("press")
    }
    $valuePattern = Get-Pattern $Element ([Windows.Automation.ValuePattern]::Pattern)
    if ($null -ne $valuePattern -and -not $valuePattern.Current.IsReadOnly) {
        $actions.Add("set_value")
        $actions.Add("type_text")
    }
    return [string[]]$actions
}

function Get-ElementRecord {
    param([Windows.Automation.AutomationElement]$Element, [string]$NativeId, [int]$Index)
    $value = $null
    $valuePattern = Get-Pattern $Element ([Windows.Automation.ValuePattern]::Pattern)
    if ($null -ne $valuePattern) { $value = $valuePattern.Current.Value }
    $record = [ordered]@{
        actions = @(Get-ElementActions $Element)
        index = $Index
        ref = Get-ElementRef $Element $NativeId
        role = $Element.Current.ControlType.ProgrammaticName.Replace("ControlType.", "")
    }
    if ($Element.Current.Name) { $record.title = $Element.Current.Name }
    if ($Element.Current.AutomationId) { $record.identifier = $Element.Current.AutomationId }
    if ($Element.Current.HelpText) { $record.description = $Element.Current.HelpText }
    if ($null -ne $value) { $record.value = [string]$value }
    return [pscustomobject]$record
}

function Get-BoundedTree {
    param([Windows.Automation.AutomationElement]$Root, [string]$NativeId)
    $walker = [Windows.Automation.TreeWalker]::ControlViewWalker
    $queue = New-Object Collections.Generic.Queue[object]
    $queue.Enqueue([pscustomobject]@{ Element = $Root; Depth = 0 })
    $records = New-Object Collections.Generic.List[object]
    $sourceTruncated = $false
    while ($queue.Count -gt 0 -and $records.Count -lt $script:MaxElements) {
        $entry = $queue.Dequeue()
        $element = [Windows.Automation.AutomationElement]$entry.Element
        try {
            $record = Get-ElementRecord $element $NativeId $records.Count
            $records.Add($record)
            if ([int]$entry.Depth -ge $script:MaxDepth) {
                if ($null -ne $walker.GetFirstChild($element)) { $sourceTruncated = $true }
                continue
            }
            $child = $walker.GetFirstChild($element)
            while ($null -ne $child) {
                $queue.Enqueue([pscustomobject]@{ Element = $child; Depth = ([int]$entry.Depth + 1) })
                $child = $walker.GetNextSibling($child)
            }
        } catch [Windows.Automation.ElementNotAvailableException] {
            $sourceTruncated = $true
            continue
        }
    }
    return [pscustomobject]@{
        Records = [object[]]$records
        SourceTruncated = $sourceTruncated -or $queue.Count -gt 0
    }
}

function Invoke-Identify {
    param([object]$Request)
    $window = Resolve-Window $Request $null
    if ($null -eq $window) { throw "No matching Windows top-level window is available." }
    return New-TargetIdentity $window
}

function Invoke-Observe {
    param([object]$Request)
    $target = Get-OptionalProperty $Request "target"
    if ($null -eq $target) { throw "Observe requires an authorized target identity." }
    $application = Get-OptionalProperty $target "application"
    $expectedWindow = Get-OptionalProperty $target "window"
    if ($null -eq $application -or $null -eq $expectedWindow) {
        throw "Observe requires an authorized target identity."
    }
    $selector = [pscustomobject]@{
        applicationId = Get-OptionalProperty $application "id"
        windowId = Get-OptionalProperty $expectedWindow "nativeId"
    }
    $window = Resolve-Window $selector $expectedWindow
    if ($null -eq $window) { throw "The authorized Windows target is stale or unavailable." }
    $identity = New-TargetIdentity $window
    Assert-ExactTargetIdentity $target $identity
    $root = [Windows.Automation.AutomationElement]::FromHandle($window.Hwnd)
    $tree = Get-BoundedTree $root $window.NativeId
    return [pscustomobject]@{
        application = $identity.application
        capturedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        elements = $tree.Records
        resourceKey = $identity.resourceKey
        sourceTruncated = [bool]$tree.SourceTruncated
        window = $identity.window
    }
}

try {
    switch -CaseSensitive ($method) {
        "identify" {
            Assert-OperationProtocol $envelope
            $result = New-OperationResponse "identify" (Invoke-Identify (Get-OptionalProperty $envelope "request"))
        }
        "observe" {
            Assert-OperationProtocol $envelope
            $result = New-OperationResponse "observe" (Invoke-Observe (Get-OptionalProperty $envelope "request"))
        }
        default { throw "Unsupported computer-use method: $method" }
    }
    Write-NativeResult $result
} catch {
    Write-NativeFailure $_
    exit 1
}
