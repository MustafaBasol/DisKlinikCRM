namespace NoraMedi.Bridge.Core.Ipc;

/// <summary>The fixed set of operations the Named Pipe IPC surface exposes to the (future) Manager app.</summary>
public enum PipeOperation
{
    GetServiceStatus,
    GetBindings,
    ValidateFolder,
    AddOrUpdateFolderBinding,
    RemoveFolderBinding,
    TestConnection,
    GetQueueSummary,
    RetryFailedItem,
    ExportDiagnostics,
    CheckForUpdates,

    /// <summary>
    /// Redeems a pairing code for a credential. Deliberately NOT called
    /// "ProvisionCredential" — no credential of any kind (plaintext or
    /// DPAPI-protected) ever travels over this pipe; only the short-lived,
    /// single-use pairing code does. See docs/security.md.
    /// </summary>
    ProvisionWithPairingCode,

    /// <summary>
    /// Returns the set of devices/bindings already registered for this
    /// clinic on the NoraMedi backend (fetched during pairing/bootstrap),
    /// so the Manager can offer a pick-a-device selector instead of making
    /// a non-technical user type a raw device ID. Read-only, same trust
    /// tier as <see cref="GetBindings"/> — not privileged, and requires the
    /// feature to be enabled/paired to mean anything (unlike
    /// GetServiceStatus/CheckForUpdates it is NOT answered while disabled).
    /// </summary>
    GetAvailableServerBindings,
}
