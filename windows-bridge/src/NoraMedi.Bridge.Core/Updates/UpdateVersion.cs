namespace NoraMedi.Bridge.Core.Updates;

/// <summary>
/// Parses and compares the x.y.z[.w] version strings used throughout the
/// update path. Anti-downgrade and Windows Installer's `ProductVersion`
/// field-range rules both live here, in one place, so
/// <see cref="UpdateVersion.IsValidMsiProductVersion"/> is the single source
/// of truth both the update-check comparison and any future installer
/// tooling can rely on.
/// </summary>
public readonly record struct UpdateVersion(int Major, int Minor, int Build, int Revision)
{
    /// <summary>
    /// Parses a 2-4 field numeric version string ("0.4.7", "0.4.7.0"). Any
    /// non-numeric field, negative number, leading/trailing dot, or empty
    /// segment fails to parse — malformed input must never silently become
    /// "0.0.0.0" or throw uncaught inside a background loop.
    /// </summary>
    public static bool TryParse(string? value, out UpdateVersion version)
    {
        version = default;
        if (string.IsNullOrWhiteSpace(value)) return false;

        var parts = value.Split('.');
        if (parts.Length is < 2 or > 4) return false;

        var fields = new int[4];
        for (var i = 0; i < parts.Length; i++)
        {
            if (!int.TryParse(parts[i], System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out var n))
            {
                return false;
            }
            if (n < 0) return false;
            fields[i] = n;
        }

        version = new UpdateVersion(fields[0], fields[1], fields[2], fields[3]);
        return true;
    }

    /// <summary>
    /// Windows Installer's `ProductVersion` field constraints: exactly three
    /// fields, Major 0-255, Minor 0-255, Build 0-65535 (the fourth field, if
    /// present anywhere else in this codebase, is never significant to MSI
    /// upgrade detection and must not be relied on for it).
    /// </summary>
    public static bool IsValidMsiProductVersion(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return false;
        var parts = value.Split('.');
        if (parts.Length != 3) return false;

        return TryParseField(parts[0], 255) && TryParseField(parts[1], 255) && TryParseField(parts[2], 65535);

        static bool TryParseField(string s, int max) =>
            int.TryParse(s, System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out var n)
            && n >= 0 && n <= max;
    }

    public int CompareTo(UpdateVersion other)
    {
        var c = Major.CompareTo(other.Major);
        if (c != 0) return c;
        c = Minor.CompareTo(other.Minor);
        if (c != 0) return c;
        c = Build.CompareTo(other.Build);
        if (c != 0) return c;
        return Revision.CompareTo(other.Revision);
    }

    public static bool operator >(UpdateVersion a, UpdateVersion b) => a.CompareTo(b) > 0;
    public static bool operator <(UpdateVersion a, UpdateVersion b) => a.CompareTo(b) < 0;
    public static bool operator >=(UpdateVersion a, UpdateVersion b) => a.CompareTo(b) >= 0;
    public static bool operator <=(UpdateVersion a, UpdateVersion b) => a.CompareTo(b) <= 0;

    public override string ToString() => $"{Major}.{Minor}.{Build}.{Revision}";

    /// <summary>
    /// True only when <paramref name="offered"/> is strictly newer than
    /// <paramref name="installed"/> — an equal or older offered version is
    /// never installed as an "update" (anti-downgrade, and equal-version
    /// re-installs are pointless churn on a LocalSystem service).
    /// </summary>
    public static bool IsUpgrade(UpdateVersion installed, UpdateVersion offered) => offered > installed;
}
