using NoraMedi.Bridge.Core.Validation;

namespace NoraMedi.Bridge.Core.Tests.Validation;

public class FileSignatureValidatorTests
{
    [Fact]
    public void DetectContentType_Jpeg_ReturnsImageJpeg()
    {
        byte[] bytes = [0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10];
        Assert.Equal("image/jpeg", FileSignatureValidator.DetectContentType(bytes));
    }

    [Fact]
    public void DetectContentType_Png_ReturnsImagePng()
    {
        byte[] bytes = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00];
        Assert.Equal("image/png", FileSignatureValidator.DetectContentType(bytes));
    }

    [Fact]
    public void DetectContentType_WebP_ReturnsImageWebp()
    {
        byte[] bytes = [(byte)'R', (byte)'I', (byte)'F', (byte)'F', 0, 0, 0, 0, (byte)'W', (byte)'E', (byte)'B', (byte)'P'];
        Assert.Equal("image/webp", FileSignatureValidator.DetectContentType(bytes));
    }

    [Fact]
    public void DetectContentType_DicomPart10_ReturnsApplicationDicom()
    {
        var bytes = new byte[132];
        "DICM"u8.CopyTo(bytes.AsSpan(128));
        Assert.Equal("application/dicom", FileSignatureValidator.DetectContentType(bytes));
    }

    [Fact]
    public void DetectContentType_RawDicomWithoutPreamble_IsRejected()
    {
        // Raw (preamble-less) DICOM is intentionally out of scope for this phase
        // (see docs/47-imaging-bridge-contract.md) — only Part-10 is accepted.
        byte[] bytes = [(byte)'D', (byte)'I', (byte)'C', (byte)'M', 0, 0, 0, 0];
        Assert.Null(FileSignatureValidator.DetectContentType(bytes));
    }

    [Theory]
    [InlineData(new byte[] { 0x25, 0x50, 0x44, 0x46 })] // %PDF
    [InlineData(new byte[] { 0x00, 0x01, 0x02 })]
    [InlineData(new byte[] { })]
    public void DetectContentType_UnsupportedContent_ReturnsNull(byte[] bytes)
    {
        Assert.Null(FileSignatureValidator.DetectContentType(bytes));
    }

    [Theory]
    [InlineData("image/jpeg", ".jpg")]
    [InlineData("image/png", ".png")]
    [InlineData("image/webp", ".webp")]
    [InlineData("application/dicom", ".dcm")]
    public void SafeExtensionFor_KnownContentTypes_MapsToExtension(string contentType, string expectedExtension)
    {
        Assert.Equal(expectedExtension, FileSignatureValidator.SafeExtensionFor(contentType));
    }

    [Fact]
    public void SafeExtensionFor_UnknownContentType_ReturnsNull()
    {
        Assert.Null(FileSignatureValidator.SafeExtensionFor("application/pdf"));
    }
}
