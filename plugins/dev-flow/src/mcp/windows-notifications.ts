import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export const WINDOWS_NOTIFICATION_APP_ID = "io.github.wxy_hh.dev_flow";
const shortcutName = "Dev Flow 通知.lnk";

export type NotificationCommandExecutor = (file: string, args: string[]) => Promise<unknown>;
export type NotificationPathExists = (file: string) => Promise<boolean>;

export interface WindowsNotificationOptions {
  platform?: NodeJS.Platform;
  environment?: NodeJS.ProcessEnv;
  execute?: NotificationCommandExecutor;
  exists?: NotificationPathExists;
  nodeExecutable?: string;
}

export type WindowsNotificationSetupResult =
  | { status: "enabled"; appId: string; shortcutPath: string }
  | { status: "unsupported"; platform: NodeJS.Platform }
  | { status: "unavailable"; reason: string }
  | { status: "failed"; appId: string; shortcutPath: string; reason: string; recoveryHint: string };

function platformOf(options: WindowsNotificationOptions): NodeJS.Platform {
  return options.platform ?? process.platform;
}

function environmentOf(options: WindowsNotificationOptions): NodeJS.ProcessEnv {
  return options.environment ?? process.env;
}

function shortcutPathOf(environment: NodeJS.ProcessEnv): string | undefined {
  const appData = environment.APPDATA;
  return appData ? path.win32.join(appData, "Microsoft", "Windows", "Start Menu", "Programs", shortcutName) : undefined;
}

async function command(file: string, args: string[]): Promise<unknown> {
  return run(file, args);
}

async function pathExists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function powerShellLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function encodedPowerShell(script: string): string[] {
  return ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")];
}

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

function registrationScript(shortcutPath: string, nodeExecutable: string): string {
  return `
$ErrorActionPreference = 'Stop'
$shortcutPath = ${powerShellLiteral(shortcutPath)}
$nodeExecutable = ${powerShellLiteral(nodeExecutable)}
$nodeArguments = '-e "process.exit(0)"'
$workingDirectory = ${powerShellLiteral(path.win32.dirname(shortcutPath))}
$appId = ${powerShellLiteral(WINDOWS_NOTIFICATION_APP_ID)}
$source = @'
using System;
using System.IO;
using System.Runtime.InteropServices;

namespace DevFlowNotifications {
  [StructLayout(LayoutKind.Sequential, Pack = 4)]
  public struct PropertyKey {
    public Guid FormatId;
    public uint PropertyId;
    public PropertyKey(string formatId, uint propertyId) { FormatId = new Guid(formatId); PropertyId = propertyId; }
  }

  [StructLayout(LayoutKind.Explicit)]
  public struct PropVariant {
    [FieldOffset(0)] public ushort VarType;
    [FieldOffset(8)] public IntPtr PointerValue;
    [FieldOffset(8)] public short BoolValue;
    public static PropVariant FromString(string value) {
      return new PropVariant { VarType = 31, PointerValue = Marshal.StringToCoTaskMemUni(value) };
    }
    public static PropVariant FromBool(bool value) {
      return new PropVariant { VarType = 11, BoolValue = value ? (short)-1 : (short)0 };
    }
    public void Clear() { PropVariantClear(ref this); }
    [DllImport("ole32.dll")] private static extern int PropVariantClear(ref PropVariant value);
  }

  [ComImport, Guid("000214F9-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  internal interface IShellLinkW {
    void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] System.Text.StringBuilder file, int maxPath, IntPtr findData, uint flags);
    void GetIDList(out IntPtr itemIdList);
    void SetIDList(IntPtr itemIdList);
    void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] System.Text.StringBuilder name, int maxPath);
    void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string name);
    void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] System.Text.StringBuilder directory, int maxPath);
    void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string directory);
    void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] System.Text.StringBuilder arguments, int maxPath);
    void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string arguments);
    void GetHotkey(out ushort hotkey);
    void SetHotkey(ushort hotkey);
    void GetShowCmd(out int showCommand);
    void SetShowCmd(int showCommand);
    void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] System.Text.StringBuilder iconPath, int maxPath, out int iconIndex);
    void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string iconPath, int iconIndex);
    void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string relativePath, uint reserved);
    void Resolve(IntPtr owner, uint flags);
    void SetPath([MarshalAs(UnmanagedType.LPWStr)] string file);
  }

  [ComImport, Guid("0000010B-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  internal interface IPersistFile {
    void GetClassID(out Guid classId);
    [PreserveSig] int IsDirty();
    void Load([MarshalAs(UnmanagedType.LPWStr)] string fileName, uint mode);
    void Save([MarshalAs(UnmanagedType.LPWStr)] string fileName, bool remember);
    void SaveCompleted([MarshalAs(UnmanagedType.LPWStr)] string fileName);
    void GetCurFile(out IntPtr fileName);
  }

  [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  internal interface IPropertyStore {
    void GetCount(out uint count);
    void GetAt(uint index, out PropertyKey key);
    void GetValue(ref PropertyKey key, out PropVariant value);
    void SetValue(ref PropertyKey key, ref PropVariant value);
    void Commit();
  }

  [ComImport, Guid("00021401-0000-0000-C000-000000000046")]
  internal class ShellLink { }

  public static class ShortcutInstaller {
    // System.AppUserModel.ID and System.AppUserModel.PreventPinning.
    private static readonly PropertyKey AppUserModelId = new PropertyKey("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3", 5);
    private static readonly PropertyKey PreventPinning = new PropertyKey("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3", 9);

    public static void CreateOrUpdate(string shortcutPath, string executablePath, string arguments, string workingDirectory, string appId) {
      Directory.CreateDirectory(Path.GetDirectoryName(shortcutPath));
      var link = (IShellLinkW)new ShellLink();
      try {
        link.SetPath(executablePath);
        link.SetArguments(arguments);
        link.SetWorkingDirectory(workingDirectory);
        link.SetDescription("Dev Flow 本地通知身份");
        link.SetIconLocation(executablePath, 0);
        link.SetShowCmd(0);
        var properties = (IPropertyStore)link;
        var appIdValue = PropVariant.FromString(appId);
        var preventPinningValue = PropVariant.FromBool(true);
        try {
          properties.SetValue(ref PreventPinning, ref preventPinningValue);
          properties.SetValue(ref AppUserModelId, ref appIdValue);
          properties.Commit();
        } finally {
          appIdValue.Clear();
          preventPinningValue.Clear();
        }
        ((IPersistFile)link).Save(shortcutPath, true);
      } finally {
        Marshal.FinalReleaseComObject(link);
      }
    }
  }
}
'@
Add-Type -TypeDefinition $source -ErrorAction Stop
[DevFlowNotifications.ShortcutInstaller]::CreateOrUpdate($shortcutPath, $nodeExecutable, $nodeArguments, $workingDirectory, $appId)
`;
}

function toastScript(title: string, body: string): string {
  const xml = `<toast><visual><binding template="ToastGeneric"><text>${xmlEscape(title)}</text><text>${xmlEscape(body)}</text></binding></visual><audio src="ms-winsoundevent:Notification.Default"/></toast>`;
  return `
$ErrorActionPreference = 'Stop'
$null = [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
$null = [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml(${powerShellLiteral(xml)})
$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier(${powerShellLiteral(WINDOWS_NOTIFICATION_APP_ID)}).Show($toast)
`;
}

/** Explicitly creates the current user's Windows Toast registration; no feature state is changed. */
export async function enableWindowsNotifications(options: WindowsNotificationOptions = {}): Promise<WindowsNotificationSetupResult> {
  const platform = platformOf(options);
  if (platform !== "win32") return { status: "unsupported", platform };
  const shortcutPath = shortcutPathOf(environmentOf(options));
  if (!shortcutPath) {
    return { status: "unavailable", reason: "APPDATA is unavailable; run this from an interactive Windows desktop session." };
  }
  try {
    await (options.execute ?? command)("powershell.exe", encodedPowerShell(registrationScript(shortcutPath, options.nodeExecutable ?? process.execPath)));
    return { status: "enabled", appId: WINDOWS_NOTIFICATION_APP_ID, shortcutPath };
  } catch (error) {
    return {
      status: "failed",
      appId: WINDOWS_NOTIFICATION_APP_ID,
      shortcutPath,
      reason: error instanceof Error ? error.message : String(error),
      recoveryHint: "Check that Windows PowerShell is available, then retry dev_flow_enable_windows_notifications.",
    };
  }
}

/** Sends a best-effort Windows Toast only after explicit setup created the per-user shortcut. */
export async function emitWindowsToast(title: string, body: string, options: WindowsNotificationOptions = {}): Promise<void> {
  if (platformOf(options) !== "win32") return;
  const shortcutPath = shortcutPathOf(environmentOf(options));
  if (!shortcutPath) return;
  try {
    if (!await (options.exists ?? pathExists)(shortcutPath)) return;
    await (options.execute ?? command)("powershell.exe", encodedPowerShell(toastScript(title, body)));
  } catch {
    // A missing notification service, disabled permission, or PowerShell policy is advisory only.
  }
}
