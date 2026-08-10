using System.Diagnostics;

namespace Opencode.Contained;

/// <summary>
/// Thin launcher for the packaged opencode fork. The package carries a
/// self-contained binary compiled by Bun, so there is no runtime to locate.
/// </summary>
internal static class Program
{
    private static int Main(string[] args)
    {
        string binaryName = OperatingSystem.IsWindows() ? "opencode.exe" : "opencode";
        string binary = Path.Combine(AppContext.BaseDirectory, "payload", binaryName);

        if (!File.Exists(binary))
        {
            Console.Error.WriteLine($"opencode-fork: packaged binary is missing (expected {binary}).");
            return 1;
        }

        if (!OperatingSystem.IsWindows() && !TryEnsureExecutable(binary, out string? chmodFailure))
        {
            Console.Error.WriteLine($"opencode-fork: {chmodFailure}");
            return 1;
        }

        var startInfo = new ProcessStartInfo(binary) { UseShellExecute = false };
        foreach (string arg in args)
        {
            startInfo.ArgumentList.Add(arg);
        }

        using Process? process = Process.Start(startInfo);
        if (process is null)
        {
            Console.Error.WriteLine($"opencode-fork: failed to start {binary}.");
            return 1;
        }

        // The child shares this console, so it receives Ctrl+C itself. Keep the
        // launcher alive so it can still report the child's exit code.
        Console.CancelKeyPress += (_, eventArgs) => eventArgs.Cancel = true;

        process.WaitForExit();
        return process.ExitCode;
    }

    /// <summary>
    /// NuGet packages do not carry unix file modes, so the extracted binary
    /// arrives without its executable bit. Restore it before the first run.
    /// </summary>
    private static bool TryEnsureExecutable(string binary, out string? failure)
    {
        failure = null;

        // Also tells the platform-compatibility analyzer that the unix-only
        // calls below are unreachable on Windows.
        if (OperatingSystem.IsWindows())
        {
            return true;
        }

        try
        {
            UnixFileMode mode = File.GetUnixFileMode(binary);
            UnixFileMode executable = UnixFileMode.UserExecute | UnixFileMode.GroupExecute | UnixFileMode.OtherExecute;
            if ((mode & executable) != executable)
            {
                File.SetUnixFileMode(binary, mode | executable);
            }

            return true;
        }
        catch (Exception exception)
        {
            failure = $"could not make {binary} executable: {exception.Message}";
            return false;
        }
    }
}
