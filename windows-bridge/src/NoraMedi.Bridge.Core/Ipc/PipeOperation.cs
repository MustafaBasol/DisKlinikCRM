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
}
