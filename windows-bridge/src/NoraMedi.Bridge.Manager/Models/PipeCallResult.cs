namespace NoraMedi.Bridge.Manager.Models;

/// <summary>
/// Result of one IPC call from the Manager's point of view: either a typed
/// value, or a normalized error kind plus the raw code for an optional
/// "details" expander. Never exposes exception stack traces to callers.
/// </summary>
public sealed class PipeCallResult<T>
{
    private PipeCallResult(bool success, T? value, ManagerErrorKind errorKind, string? rawErrorCode)
    {
        Success = success;
        Value = value;
        ErrorKind = errorKind;
        RawErrorCode = rawErrorCode;
    }

    public bool Success { get; }

    public T? Value { get; }

    public ManagerErrorKind ErrorKind { get; }

    /// <summary>The raw backend error code (e.g. "unauthorized"), for a support/diagnostics "details" view only — never shown by default.</summary>
    public string? RawErrorCode { get; }

    public static PipeCallResult<T> Ok(T value) => new(true, value, default, null);

    public static PipeCallResult<T> Fail(ManagerErrorKind kind, string? rawErrorCode = null) =>
        new(false, default, kind, rawErrorCode);
}
