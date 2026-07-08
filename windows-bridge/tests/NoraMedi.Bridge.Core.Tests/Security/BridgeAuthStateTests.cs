using NoraMedi.Bridge.Core.Security;

namespace NoraMedi.Bridge.Core.Tests.Security;

public class BridgeAuthStateTests : IDisposable
{
    private readonly string _root = Directory.CreateTempSubdirectory("nmb-authstate-").FullName;
    private DpapiCredentialStore NewStore() => new(Path.Combine(_root, "credential.bin"));

    [Fact]
    public void NewState_StartsValid()
    {
        var state = new BridgeAuthState(NewStore());
        Assert.True(state.IsValid);
    }

    [Fact]
    public void MarkInvalid_ThenMarkValid_RestoresValidity()
    {
        var store = NewStore();
        store.Save("nmb_token");
        var state = new BridgeAuthState(store);

        state.MarkInvalid();
        Assert.False(state.IsValid);

        state.MarkValid();
        Assert.True(state.IsValid);
    }

    [Fact]
    public void CredentialChangedSinceInvalidated_FalseWhileValid()
    {
        var store = NewStore();
        store.Save("nmb_token");
        var state = new BridgeAuthState(store);

        Assert.False(state.CredentialChangedSinceInvalidated());
    }

    [Fact]
    public void CredentialChangedSinceInvalidated_FalseUntilCredentialFileChanges()
    {
        var store = NewStore();
        store.Save("nmb_token_v1");
        var state = new BridgeAuthState(store);

        state.MarkInvalid();
        Assert.False(state.CredentialChangedSinceInvalidated());
    }

    [Fact]
    public void CredentialChangedSinceInvalidated_TrueAfterOperatorRotatesCredential()
    {
        var store = NewStore();
        store.Save("nmb_token_v1_revoked");
        var state = new BridgeAuthState(store);
        state.MarkInvalid();

        // Operator revokes+re-pairs: a new credential is written to the same path.
        store.Save("nmb_token_v2_fresh");

        Assert.True(state.CredentialChangedSinceInvalidated());
    }

    [Fact]
    public void TryGetCredential_ReflectsCurrentStore()
    {
        var store = NewStore();
        store.Save("nmb_token");
        var state = new BridgeAuthState(store);

        Assert.Equal("nmb_token", state.TryGetCredential());
    }

    public void Dispose()
    {
        if (Directory.Exists(_root)) Directory.Delete(_root, recursive: true);
    }
}
