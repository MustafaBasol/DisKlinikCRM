using NoraMedi.Bridge.Core.Ipc;
using NoraMedi.Bridge.Manager.Models;
using NoraMedi.Bridge.Manager.Tests.TestSupport;
using NoraMedi.Bridge.Manager.ViewModels;

namespace NoraMedi.Bridge.Manager.Tests;

public class PairingViewModelTests
{
    [Theory]
    [InlineData("12345678", "12345678")]
    [InlineData("1234-5678", "12345678")]
    [InlineData("1234 5678", "12345678")]
    [InlineData("abc12345678xyz", "12345678")] // non-digits dropped, then truncated to 8
    [InlineData("1234", "1234")]
    [InlineData("", "")]
    public void SetInput_StripsNonDigitsAndCapsLength(string typed, string expectedRawDigits)
    {
        var vm = new PairingViewModel(new FakeBridgePipeClientService());

        vm.SetInput(typed);

        Assert.Equal(expectedRawDigits, vm.RawDigits);
    }

    [Fact]
    public void IsCodeComplete_FalseUntilExactlyEightDigits()
    {
        var vm = new PairingViewModel(new FakeBridgePipeClientService());

        vm.SetInput("1234567");
        Assert.False(vm.IsCodeComplete);

        vm.SetInput("12345678");
        Assert.True(vm.IsCodeComplete);
    }

    [Fact]
    public void DisplayText_GroupsDigitsInFours()
    {
        var vm = new PairingViewModel(new FakeBridgePipeClientService());

        vm.SetInput("12345678");

        Assert.Equal("1234 5678", vm.DisplayText);
    }

    [Fact]
    public void SubmitCommand_Disabled_WhenCodeIncomplete()
    {
        var vm = new PairingViewModel(new FakeBridgePipeClientService());

        vm.SetInput("1234");

        Assert.False(vm.SubmitCommand.CanExecute(null));
    }

    [Fact]
    public async Task SubmitAsync_Success_RaisesPairingSucceededAndSetsMessage()
    {
        var fake = new FakeBridgePipeClientService
        {
            NextProvisionWithPairingCode = PipeCallResult<ProvisionWithPairingCodeResponse>.Ok(
                new ProvisionWithPairingCodeResponse(true, "agent-1", "Demo Clinic", 2, null)),
        };
        var vm = new PairingViewModel(fake);
        vm.SetInput("12345678");
        var succeeded = false;
        vm.PairingSucceeded += (_, _) => succeeded = true;

        await vm.SubmitAsync();

        Assert.True(succeeded);
        Assert.True(vm.IsSuccess);
        Assert.Equal("12345678", fake.LastPairingCode);
    }

    [Fact]
    public async Task SubmitAsync_BackendRejectsCode_SetsFailureWithoutThrowing()
    {
        var fake = new FakeBridgePipeClientService
        {
            NextProvisionWithPairingCode = PipeCallResult<ProvisionWithPairingCodeResponse>.Ok(
                new ProvisionWithPairingCodeResponse(false, null, null, null, "invalid or expired code", PairingErrorCategory.InvalidOrExpiredCode, "corr-1")),
        };
        var vm = new PairingViewModel(fake);
        vm.SetInput("12345678");

        await vm.SubmitAsync();

        Assert.False(vm.IsSuccess);
        Assert.Equal(StatusLabels.Pairing_InvalidOrExpiredCode, vm.ResultMessage);
    }

    [Theory]
    [InlineData(PairingErrorCategory.InvalidOrExpiredCode)]
    [InlineData(PairingErrorCategory.RateLimited)]
    [InlineData(PairingErrorCategory.InvalidRequest)]
    [InlineData(PairingErrorCategory.ServerError)]
    [InlineData(PairingErrorCategory.NetworkFailure)]
    [InlineData(PairingErrorCategory.FeatureDisabled)]
    public async Task SubmitAsync_DistinctPairingErrorCategories_ProduceDistinctMessages(PairingErrorCategory category)
    {
        var fake = new FakeBridgePipeClientService
        {
            NextProvisionWithPairingCode = PipeCallResult<ProvisionWithPairingCodeResponse>.Ok(
                new ProvisionWithPairingCodeResponse(false, null, null, null, "failed", category, "corr-1")),
        };
        var vm = new PairingViewModel(fake);
        vm.SetInput("12345678");

        await vm.SubmitAsync();

        Assert.False(vm.IsSuccess);
        Assert.NotEqual(StatusLabels.ConnectionRequired, vm.ResultMessage);
        Assert.False(string.IsNullOrWhiteSpace(vm.ResultMessage));
    }

    [Fact]
    public async Task SubmitAsync_InvalidCodeVsNetworkFailure_ProduceDifferentMessages()
    {
        var invalidCodeFake = new FakeBridgePipeClientService
        {
            NextProvisionWithPairingCode = PipeCallResult<ProvisionWithPairingCodeResponse>.Ok(
                new ProvisionWithPairingCodeResponse(false, null, null, null, "failed", PairingErrorCategory.InvalidOrExpiredCode, "corr-1")),
        };
        var networkFailureFake = new FakeBridgePipeClientService
        {
            NextProvisionWithPairingCode = PipeCallResult<ProvisionWithPairingCodeResponse>.Ok(
                new ProvisionWithPairingCodeResponse(false, null, null, null, "failed", PairingErrorCategory.NetworkFailure, "corr-2")),
        };
        var vm1 = new PairingViewModel(invalidCodeFake);
        vm1.SetInput("12345678");
        var vm2 = new PairingViewModel(networkFailureFake);
        vm2.SetInput("12345678");

        await vm1.SubmitAsync();
        await vm2.SubmitAsync();

        Assert.NotEqual(vm1.ResultMessage, vm2.ResultMessage);
    }

    [Fact]
    public async Task SubmitAsync_Unauthorized_RaisesUnauthorizedDetected()
    {
        var fake = new FakeBridgePipeClientService
        {
            NextProvisionWithPairingCode = PipeCallResult<ProvisionWithPairingCodeResponse>.Fail(ManagerErrorKind.Unauthorized),
        };
        var vm = new PairingViewModel(fake);
        vm.SetInput("12345678");
        var raised = false;
        vm.UnauthorizedDetected += (_, _) => raised = true;

        await vm.SubmitAsync();

        Assert.True(raised);
        Assert.Equal(StatusLabels.ActionRequired, vm.ResultMessage);
    }

    [Fact]
    public async Task SubmitAsync_NeverSendsAnythingOtherThanCodeAndDisplayName()
    {
        var fake = new FakeBridgePipeClientService
        {
            NextProvisionWithPairingCode = PipeCallResult<ProvisionWithPairingCodeResponse>.Ok(
                new ProvisionWithPairingCodeResponse(true, "agent-1", "Demo Clinic", 0, null)),
        };
        var vm = new PairingViewModel(fake) { ComputerDisplayName = "Front Desk PC" };
        vm.SetInput("87654321");

        await vm.SubmitAsync();

        Assert.Equal(1, fake.ProvisionWithPairingCodeCallCount);
        Assert.Equal("87654321", fake.LastPairingCode);
    }
}
