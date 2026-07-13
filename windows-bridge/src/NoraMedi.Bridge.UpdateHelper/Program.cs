using System.Text.Json;
using NoraMedi.Bridge.Core.Updates;

// NoraMedi.Bridge.UpdateHelper — the narrow, purpose-built process the
// Service launches to hand off a self-update (see
// docs/update-architecture.md "Self-update handoff"). Accepts exactly one
// argument: the path to an immutable instruction file the Service just
// wrote. Re-validates the staged installer's hash and publisher signature
// itself (defense in depth), runs the one fixed silent-install command,
// waits for the NoraMediBridge service to come back to Running, and writes
// a bounded, redacted result file for the Service to read back. Does not
// remain resident after writing its result.

var jsonOptions = new JsonSerializerOptions(JsonSerializerDefaults.Web);

if (args.Length != 1 || string.IsNullOrWhiteSpace(args[0]))
{
    return 1;
}

var instructionPath = args[0];
string? resultDirectory = null;

try
{
    resultDirectory = Path.GetDirectoryName(Path.GetFullPath(instructionPath));

    UpdateHelperInstruction? instruction;
    try
    {
        var json = File.ReadAllText(instructionPath);
        instruction = JsonSerializer.Deserialize<UpdateHelperInstruction>(json, jsonOptions);
    }
    catch (Exception ex) when (ex is IOException or JsonException or UnauthorizedAccessException)
    {
        WriteResult(resultDirectory, new UpdateHelperResult("InstallFailed", nameof(UpdateErrorCategory.CorruptState), null, false, DateTimeOffset.UtcNow), jsonOptions);
        return 1;
    }

    if (instruction is null)
    {
        WriteResult(resultDirectory, new UpdateHelperResult("InstallFailed", nameof(UpdateErrorCategory.CorruptState), null, false, DateTimeOffset.UtcNow), jsonOptions);
        return 1;
    }

    var runner = new UpdateHelperRunner(new ProcessSilentInstallerRunner(), new WindowsServiceStateProvider());
    var result = await runner.RunAsync(instruction, TimeSpan.FromSeconds(180), TimeSpan.FromSeconds(120), CancellationToken.None);

    WriteResult(resultDirectory, result, jsonOptions);
    return result.Outcome == "InstallFailed" ? 1 : 0;
}
catch (Exception)
{
    // Absolute last resort: never exit silently without a result the
    // Service can read back — an unhandled exception here must still
    // produce a truthful "failed" state rather than leaving the Service
    // waiting on a helper result that will never arrive.
    if (resultDirectory is not null)
    {
        WriteResult(resultDirectory, new UpdateHelperResult("InstallFailed", nameof(UpdateErrorCategory.Unknown), null, false, DateTimeOffset.UtcNow), jsonOptions);
    }
    return 1;
}

static void WriteResult(string? directory, UpdateHelperResult result, JsonSerializerOptions jsonOptions)
{
    if (directory is null) return;
    try
    {
        Directory.CreateDirectory(directory);
        var path = Path.Combine(directory, $"helper-result-{DateTimeOffset.UtcNow:yyyyMMddHHmmssfff}.json");
        var tmp = path + ".tmp";
        File.WriteAllText(tmp, JsonSerializer.Serialize(result, jsonOptions));
        File.Move(tmp, path, overwrite: true);
    }
    catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
    {
        // Nothing further to do — the Service's next reconciliation pass will
        // eventually see this as an Interrupted state if no result ever appears.
    }
}
