using System.Windows;
using System.Windows.Controls;
using NoraMedi.Bridge.Manager.ViewModels;

namespace NoraMedi.Bridge.Manager.Views;

public partial class MainWindow : Window
{
    private readonly MainViewModel _viewModel;

    public MainWindow(MainViewModel viewModel)
    {
        InitializeComponent();
        _viewModel = viewModel;
        DataContext = _viewModel;
    }

    /// <summary>
    /// Feeds every keystroke/paste through <see cref="PairingViewModel.SetInput"/>,
    /// which strips non-digits and caps the length — this is what makes
    /// "reject non-digit input" and "auto-group digits" work without a
    /// masked-input control.
    /// </summary>
    private void PairingCodeBox_TextChanged(object sender, TextChangedEventArgs e)
    {
        if (sender is not TextBox textBox)
        {
            return;
        }

        var caretAtEnd = textBox.CaretIndex >= textBox.Text.Length;
        _viewModel.Pairing.SetInput(textBox.Text);

        if (textBox.Text != _viewModel.Pairing.DisplayText)
        {
            textBox.Text = _viewModel.Pairing.DisplayText;
            textBox.CaretIndex = caretAtEnd ? textBox.Text.Length : Math.Min(textBox.CaretIndex, textBox.Text.Length);
        }
    }
}
