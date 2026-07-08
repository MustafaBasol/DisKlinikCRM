using System.Text;
using NoraMedi.Bridge.Core.Security;

namespace NoraMedi.Bridge.Core.Tests.Security;

public class DpapiCredentialStoreTests : IDisposable
{
    private readonly string _root = Directory.CreateTempSubdirectory("nmb-cred-").FullName;
    private string CredentialPath => Path.Combine(_root, "credential.bin");

    [Fact]
    public void Save_ThenTryRead_RoundTripsPlaintext()
    {
        var store = new DpapiCredentialStore(CredentialPath);
        store.Save("nmb_super_secret_token");

        Assert.Equal("nmb_super_secret_token", store.TryRead());
    }

    [Fact]
    public void OnDiskBytes_AreNeverThePlaintextCredential()
    {
        var store = new DpapiCredentialStore(CredentialPath);
        const string secret = "nmb_super_secret_token";
        store.Save(secret);

        var raw = File.ReadAllBytes(CredentialPath);
        var rawAsText = Encoding.UTF8.GetString(raw);
        Assert.DoesNotContain(secret, rawAsText, StringComparison.Ordinal);
    }

    [Fact]
    public void TryRead_MissingFile_ReturnsNullWithoutThrowing()
    {
        var store = new DpapiCredentialStore(CredentialPath);
        Assert.Null(store.TryRead());
        Assert.False(store.Exists);
    }

    [Fact]
    public void TryRead_CorruptedBlob_ReturnsNullWithoutThrowing()
    {
        var store = new DpapiCredentialStore(CredentialPath);
        store.Save("nmb_token");
        // Simulate corruption/tampering/revocation of the encrypted blob.
        var bytes = File.ReadAllBytes(CredentialPath);
        bytes[^1] ^= 0xFF;
        File.WriteAllBytes(CredentialPath, bytes);

        Assert.Null(store.TryRead());
    }

    [Fact]
    public void Fingerprint_ChangesWhenCredentialRotates()
    {
        var store = new DpapiCredentialStore(CredentialPath);
        store.Save("nmb_token_v1");
        var fingerprint1 = store.Fingerprint();

        store.Save("nmb_token_v2");
        var fingerprint2 = store.Fingerprint();

        Assert.NotNull(fingerprint1);
        Assert.NotNull(fingerprint2);
        Assert.NotEqual(fingerprint1, fingerprint2);
    }

    [Fact]
    public void Fingerprint_MissingFile_ReturnsNull()
    {
        var store = new DpapiCredentialStore(CredentialPath);
        Assert.Null(store.Fingerprint());
    }

    [Fact]
    public void Delete_RemovesCredentialFile()
    {
        var store = new DpapiCredentialStore(CredentialPath);
        store.Save("nmb_token");
        Assert.True(store.Exists);

        store.Delete();
        Assert.False(store.Exists);
        Assert.Null(store.TryRead());
    }

    [Fact]
    public void Entropy_MismatchedEntropy_FailsToDecrypt()
    {
        var storeA = new DpapiCredentialStore(CredentialPath, "entropy-a"u8.ToArray());
        storeA.Save("nmb_token");

        var storeB = new DpapiCredentialStore(CredentialPath, "entropy-b"u8.ToArray());
        Assert.Null(storeB.TryRead());
    }

    public void Dispose()
    {
        if (Directory.Exists(_root)) Directory.Delete(_root, recursive: true);
    }
}
