using NoraMedi.Bridge.Core.Ipc;
using NoraMedi.Bridge.Manager.Models;
using NoraMedi.Bridge.Manager.Tests.TestSupport;
using NoraMedi.Bridge.Manager.ViewModels;

namespace NoraMedi.Bridge.Manager.Tests;

public class QueueViewModelTests
{
    [Fact]
    public async Task RefreshAsync_MapsAllFourCounts()
    {
        var fake = new FakeBridgePipeClientService
        {
            NextQueueSummary = PipeCallResult<QueueSummaryResponse>.Ok(new QueueSummaryResponse(3, 1, 2, 40)),
        };
        var vm = new QueueViewModel(fake);

        await vm.RefreshAsync();

        Assert.Equal(3, vm.Pending);
        Assert.Equal(1, vm.Processing);
        Assert.Equal(2, vm.Failed);
        Assert.Equal(40, vm.Completed);
    }

    [Fact]
    public async Task RefreshAsync_Failure_SetsPlainLabel()
    {
        var fake = new FakeBridgePipeClientService
        {
            NextQueueSummary = PipeCallResult<QueueSummaryResponse>.Fail(ManagerErrorKind.ServiceUnavailable),
        };
        var vm = new QueueViewModel(fake);

        await vm.RefreshAsync();

        Assert.Equal(StatusLabels.ServiceUnavailable, vm.StatusMessage);
    }

    [Fact]
    public void RetryCommand_Disabled_WhenIngestKeyEmpty()
    {
        var vm = new QueueViewModel(new FakeBridgePipeClientService());

        Assert.False(vm.RetryCommand.CanExecute(null));

        vm.RetryIngestKey = "ingest-123";

        Assert.True(vm.RetryCommand.CanExecute(null));
    }

    [Fact]
    public async Task RetryAsync_Success_RefreshesQueueAndReportsSuccess()
    {
        var fake = new FakeBridgePipeClientService
        {
            NextRetryFailedItem = PipeCallResult<RetryFailedItemResponse>.Ok(new RetryFailedItemResponse(true, null)),
            NextQueueSummary = PipeCallResult<QueueSummaryResponse>.Ok(new QueueSummaryResponse(0, 1, 0, 41)),
        };
        var vm = new QueueViewModel(fake) { RetryIngestKey = "ingest-abc" };

        await vm.RetryAsync();

        Assert.True(vm.RetrySucceeded);
        Assert.Equal("ingest-abc", fake.LastRetryIngestKey);
        Assert.Equal(1, fake.GetQueueSummaryCallCount);
        Assert.Equal(1, vm.Processing);
    }

    [Fact]
    public async Task RetryAsync_NotFound_DoesNotRefreshAndSetsConnectionRequired()
    {
        var fake = new FakeBridgePipeClientService
        {
            NextRetryFailedItem = PipeCallResult<RetryFailedItemResponse>.Fail(ManagerErrorKind.NotFound),
        };
        var vm = new QueueViewModel(fake) { RetryIngestKey = "missing-key" };

        await vm.RetryAsync();

        Assert.False(vm.RetrySucceeded);
        Assert.Equal(StatusLabels.ConnectionRequired, vm.RetryMessage);
        Assert.Equal(0, fake.GetQueueSummaryCallCount);
    }

    [Fact]
    public async Task RetryAsync_Unauthorized_RaisesUnauthorizedDetected()
    {
        var fake = new FakeBridgePipeClientService
        {
            NextRetryFailedItem = PipeCallResult<RetryFailedItemResponse>.Fail(ManagerErrorKind.Unauthorized),
        };
        var vm = new QueueViewModel(fake) { RetryIngestKey = "ingest-abc" };
        var raised = false;
        vm.UnauthorizedDetected += (_, _) => raised = true;

        await vm.RetryAsync();

        Assert.True(raised);
    }
}
