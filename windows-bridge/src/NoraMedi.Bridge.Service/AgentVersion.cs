using System.Reflection;

namespace NoraMedi.Bridge.Service;

public static class AgentVersion
{
    public static string Current { get; } =
        Assembly.GetExecutingAssembly().GetName().Version?.ToString(3) ?? "0.0.0";
}
