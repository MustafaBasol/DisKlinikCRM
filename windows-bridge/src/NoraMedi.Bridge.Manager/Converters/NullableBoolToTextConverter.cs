using System.Globalization;
using System.Windows.Data;

namespace NoraMedi.Bridge.Manager.Converters;

/// <summary>Renders a nullable bool (folder validation outcome) as a short status glyph/text; parameter format: "true|false|null".</summary>
public sealed class NullableBoolToTextConverter : IValueConverter
{
    public object Convert(object? value, Type targetType, object parameter, CultureInfo culture)
    {
        var options = (parameter as string)?.Split('|') ?? ["Yes", "No", ""];
        return value switch
        {
            true => options[0],
            false => options.Length > 1 ? options[1] : "No",
            _ => options.Length > 2 ? options[2] : string.Empty,
        };
    }

    public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture) =>
        throw new NotSupportedException();
}
