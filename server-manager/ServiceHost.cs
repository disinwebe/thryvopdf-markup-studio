using System;
using System.Diagnostics;
using System.IO;
using System.ServiceProcess;
using System.Text;
using System.Text.RegularExpressions;
using System.Security.AccessControl;
using System.Security.Principal;
using Microsoft.Win32;

internal static class Program {
    const string Name = "ThryvoPDFServer";
    static string Decode(string text) { return Encoding.UTF8.GetString(Convert.FromBase64String(text)); }
    static string Encode(string text) { return Convert.ToBase64String(Encoding.UTF8.GetBytes(text)); }
    static string Quote(string text) {
        return "\"" + Regex.Replace(text, @"(\\*)(""|$)", m => new string('\\', m.Groups[1].Length * 2 + (m.Groups[2].Value == "\"" ? 1 : 0)) + m.Groups[2].Value) + "\"";
    }
    static int Sc(string arguments) {
        var p = Process.Start(new ProcessStartInfo(Path.Combine(Environment.SystemDirectory, "sc.exe"), arguments) {
            UseShellExecute = false, CreateNoWindow = true
        });
        p.WaitForExit();
        return p.ExitCode;
    }
    static string ExistingImage() {
        using (var key = Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Services\" + Name))
            return key == null ? null : Convert.ToString(key.GetValue("ImagePath"));
    }
    static bool Owned(string image, string self) {
        return image != null && image.StartsWith(Quote(self) + " service ", StringComparison.OrdinalIgnoreCase);
    }
    static int Manage(string[] a) {
        if (a.Length != 5) return 2;
        string action = a[1], data = Decode(a[2]), app = Decode(a[4]);
        int port;
        string self = Process.GetCurrentProcess().MainModule.FileName;
        if (!int.TryParse(a[3], out port) || port < 1 || port > 65535 || !Path.IsPathRooted(data) || !Path.IsPathRooted(app)) return 2;
        string expectedApp = Path.GetFullPath(Path.Combine(Path.GetDirectoryName(self), "..", "ThryvoPDF Server Manager.exe"));
        if (!String.Equals(Path.GetFullPath(app), expectedApp, StringComparison.OrdinalIgnoreCase)) return 2;
        string existing = ExistingImage();
        if (existing != null && !Owned(existing, self)) return 3;
        if (action == "install") {
            if (existing != null) return 4;
            string fullData = Path.GetFullPath(data).TrimEnd(Path.DirectorySeparatorChar);
            if (fullData.Length <= Path.GetPathRoot(fullData).Length ||
                fullData.StartsWith(Environment.GetFolderPath(Environment.SpecialFolder.Windows) + "\\", StringComparison.OrdinalIgnoreCase) ||
                fullData.StartsWith(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles) + "\\", StringComparison.OrdinalIgnoreCase)) return 2;
            var folder = Directory.CreateDirectory(fullData);
            var acl = folder.GetAccessControl();
            acl.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier("S-1-5-19"), FileSystemRights.Modify,
                InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, AccessControlType.Allow));
            folder.SetAccessControl(acl);
            string image = Quote(self) + " service " + port + " " + Encode(data) + " " + Encode(app);
            return Sc("create " + Name + " binPath= " + Quote(image) + " start= auto obj= \"NT AUTHORITY\\LocalService\" DisplayName= \"ThryvoPDF Server\"");
        }
        if (existing == null) return 5;
        if (action == "uninstall") {
            using (var svc = new ServiceController(Name)) {
                if (svc.Status != ServiceControllerStatus.Stopped) {
                    if (svc.Status != ServiceControllerStatus.StopPending) svc.Stop();
                    svc.WaitForStatus(ServiceControllerStatus.Stopped, TimeSpan.FromSeconds(30));
                }
            }
            return Sc("delete " + Name);
        }
        using (var svc = new ServiceController(Name)) {
            if (action == "stop" || action == "restart") {
                if (svc.Status != ServiceControllerStatus.Stopped) {
                    if (svc.Status != ServiceControllerStatus.StopPending) svc.Stop();
                    svc.WaitForStatus(ServiceControllerStatus.Stopped, TimeSpan.FromSeconds(30));
                }
            }
            if (action == "start" || action == "restart") {
                svc.Refresh();
                if (svc.Status != ServiceControllerStatus.Running) {
                    svc.Start();
                    svc.WaitForStatus(ServiceControllerStatus.Running, TimeSpan.FromSeconds(30));
                }
            } else if (action != "stop") return 2;
        }
        return 0;
    }
    static int Main(string[] a) {
        try {
            if (a.Length > 0 && a[0] == "manage") return Manage(a);
            if (a.Length == 4 && a[0] == "service") {
                ServiceBase.Run(new Host(a[1], Decode(a[2]), Decode(a[3])));
                return 0;
            }
            return 2;
        } catch { return 1; }
    }
}

internal sealed class Host : ServiceBase {
    readonly string port, data, app;
    Process child;
    bool stopping;
    public Host(string port, string data, string app) {
        this.port = port; this.data = data; this.app = app;
        ServiceName = "ThryvoPDFServer"; CanStop = true; AutoLog = true;
    }
    void Log(string text) {
        try { File.AppendAllText(Path.Combine(data, "service.log"), DateTime.UtcNow.ToString("o") + " " + text + Environment.NewLine); }
        catch { }
    }
    protected override void OnStart(string[] args) {
        Directory.CreateDirectory(data);
        string passwordFile = Path.Combine(data, "ADMIN-INITIAL-PASSWORD.txt");
        if (File.Exists(passwordFile) && (File.GetAttributes(passwordFile) & FileAttributes.ReparsePoint) != 0)
            throw new Exception("Initial password file must not be a link.");
        var passwordAcl = new FileSecurity();
        passwordAcl.SetAccessRuleProtection(true, false);
        passwordAcl.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier("S-1-5-19"), FileSystemRights.FullControl, AccessControlType.Allow));
        passwordAcl.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier("S-1-5-18"), FileSystemRights.FullControl, AccessControlType.Allow));
        passwordAcl.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier("S-1-5-32-544"), FileSystemRights.FullControl, AccessControlType.Allow));
        if (File.Exists(passwordFile)) File.SetAccessControl(passwordFile, passwordAcl);
        else using (File.Create(passwordFile, 4096, FileOptions.None, passwordAcl)) { }
        string script = Path.Combine(Path.GetDirectoryName(app), "resources", "app.asar", "server-manager", "service-entry.cjs");
        var info = new ProcessStartInfo(app, "\"" + script + "\"") {
            UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true
        };
        info.EnvironmentVariables["ELECTRON_RUN_AS_NODE"] = "1";
        info.EnvironmentVariables["PMS_SERVICE_PORT"] = port;
        info.EnvironmentVariables["PMS_SERVICE_DATA"] = data;
        info.EnvironmentVariables.Remove("PMS_ADMIN_PASSWORD");
        child = new Process { StartInfo = info, EnableRaisingEvents = true };
        child.Exited += delegate {
            if (!stopping) {
                Log("Server process exited unexpectedly (exit code " + child.ExitCode + ").");
                ExitCode = 1;
                Stop();
            }
        };
        if (!child.Start()) throw new Exception("Could not start server process.");
        Log("Server process started; use the manager health check to confirm readiness.");
    }
    protected override void OnStop() {
        stopping = true;
        if (child != null && !child.HasExited) {
            try { child.StandardInput.WriteLine("stop"); child.StandardInput.Flush(); }
            catch (IOException) { }
            if (!child.WaitForExit(10000)) { child.Kill(); child.WaitForExit(); }
        }
        Log("Server stopped.");
    }
}
