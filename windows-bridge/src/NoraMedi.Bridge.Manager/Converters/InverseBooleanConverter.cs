using System.Globalization;
using System.Windows.Data;

namespace NoraMedi.Bridge.Manager.Converters;

/// <summary>
/// Negates a bool, returning a bool — for binding a boolean-typed dependency
/// property (IsEnabled, IsChecked, ...) to the logical inverse of a
/// bool view-model property (e.g. "IsEnabled while NOT busy"). Deliberately
/// distinct from <see cref="EnumEqualsConverter"/>, whose Convert always
/// returns a <see cref="System.Windows.Visibility"/> value and therefore
/// must never be bound to a bool-typed target — that is a converter/target
/// type mismatch that misbehaves or throws at runtime.
/// </summary>
public sealed class InverseBooleanConverter : IValueConverter
{
    public object Convert(object? value, Type targetType, object parameter, CultureInfo culture) =>
        value is bool b && !b;

    public object ConvertBack(object? value, Type targetType, object parameter, CultureInfo culture) =>
        value is bool b && !b;
}
