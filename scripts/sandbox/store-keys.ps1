# Stores the sandbox app keys where the desktop app reads them (Credential Manager, same entry the
# approval window's dialog writes): target "paypal.sandbox.TheTable.AgenticWallet", blob = JSON [id, secret].
# Values come from scripts/sandbox/.env.sandbox and are never printed.
$ErrorActionPreference = 'Stop'
$envFile = 'C:\Users\kazda\kiro\paypal\scripts\sandbox\.env.sandbox'
$v = @{}
Get-Content -LiteralPath $envFile | ForEach-Object {
  if ($_ -match '^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$' -and -not $_.TrimStart().StartsWith('#')) { $v[$Matches[1]] = $Matches[2].Trim('"', "'") }
}
$id = $v['PAYPAL_SANDBOX_CLIENT_ID']; $sec = $v['PAYPAL_SANDBOX_SECRET']
if (-not $id -or -not $sec) { throw 'client id or secret missing in .env.sandbox' }
$json = ConvertTo-Json -Compress -InputObject @($id, $sec)
$bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class Cred {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct CREDENTIAL { public uint Flags; public uint Type; public string TargetName; public string Comment; public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten; public uint CredentialBlobSize; public IntPtr CredentialBlob; public uint Persist; public uint AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName; }
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] public static extern bool CredWrite(ref CREDENTIAL c, uint flags);
  public static void Write(string target, string user, byte[] blob) {
    var c = new CREDENTIAL { Type = 1, TargetName = target, UserName = user, Persist = 2, CredentialBlobSize = (uint)blob.Length, CredentialBlob = Marshal.AllocHGlobal(blob.Length) };
    Marshal.Copy(blob, 0, c.CredentialBlob, blob.Length);
    if (!CredWrite(ref c, 0)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    Marshal.FreeHGlobal(c.CredentialBlob);
  }
}
'@
[Cred]::Write('paypal.sandbox.TheTable.AgenticWallet', 'paypal.sandbox', $bytes)
Write-Output "stored $($bytes.Length) bytes under paypal.sandbox.TheTable.AgenticWallet"
