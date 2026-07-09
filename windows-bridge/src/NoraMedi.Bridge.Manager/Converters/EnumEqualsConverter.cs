using System.Globalization;
using System.Windows;
using System.Windows.Data;

namespace NoraMedi.Bridge.Manager.Converters;

/// <summary>
/// Converts an enum value to <see cref="Visibility"/> by comparing it (as a
/// string) against the converter parameter — lets XAML show/hide a panel
/// per <c>AppState</c> case without a converter per state.
/// </summary>
public sealed class EnumEqualsConverter : IValueConverter
{
    public object Convert(object? value, Type targetType, object parameter, CultureInfo culture)
    {
        if (value is null || parameter is null)
        {
            return Visibility.Collapsed;
        }

        var expected = parameter.ToString();
        var matches = string.Equals(value.ToString(), expected, StringComparison.Ordinal);
        return matches ? Visibility.Visible : Visibility.Collapsed;
    }

    public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture) =>
        throw new NotSupportedException();
}
