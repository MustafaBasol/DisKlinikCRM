const BRAND_NAME = 'NoraMedi';
const BRAND_COLOR = '#2563eb';

function baseLayout(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;">
          <tr>
            <td style="background:${BRAND_COLOR};padding:24px 32px;">
              <span style="color:#ffffff;font-size:20px;font-weight:bold;">${BRAND_NAME}</span>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              ${body}
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px 24px;border-top:1px solid #e2e8f0;">
              <p style="margin:0;font-size:12px;color:#94a3b8;">
                This email was sent by ${BRAND_NAME}. If you did not request this, you can safely ignore it.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function buildPasswordResetEmail(opts: {
  firstName: string;
  resetUrl: string;
  expiryMinutes: number;
}): { subject: string; html: string; text: string } {
  const subject = `${BRAND_NAME} — Password Reset Request`;

  const html = baseLayout(
    'Reset Your Password',
    `<h2 style="margin:0 0 16px;font-size:22px;color:#1e293b;">Reset Your Password</h2>
    <p style="margin:0 0 12px;font-size:15px;color:#475569;">Hi ${opts.firstName},</p>
    <p style="margin:0 0 24px;font-size:15px;color:#475569;">
      We received a request to reset your password. Click the button below to choose a new one.
      This link is valid for <strong>${opts.expiryMinutes} minutes</strong>.
    </p>
    <p style="margin:0 0 28px;">
      <a href="${opts.resetUrl}"
         style="display:inline-block;background:${BRAND_COLOR};color:#ffffff;text-decoration:none;
                padding:13px 28px;border-radius:8px;font-size:15px;font-weight:bold;">
        Reset Password
      </a>
    </p>
    <p style="margin:0 0 8px;font-size:13px;color:#64748b;">
      Or copy and paste this link into your browser:
    </p>
    <p style="margin:0;font-size:13px;color:#2563eb;word-break:break-all;">${opts.resetUrl}</p>`,
  );

  const text = [
    `Reset Your Password — ${BRAND_NAME}`,
    '',
    `Hi ${opts.firstName},`,
    '',
    `We received a request to reset your password. Use the link below (valid for ${opts.expiryMinutes} minutes):`,
    '',
    opts.resetUrl,
    '',
    'If you did not request a password reset, you can safely ignore this email.',
  ].join('\n');

  return { subject, html, text };
}

export function buildEmailVerificationEmail(opts: {
  firstName: string;
  verifyUrl: string;
}): { subject: string; html: string; text: string } {
  const subject = `${BRAND_NAME} — E-posta Adresinizi Doğrulayın / Verify Your Email`;

  const html = baseLayout(
    'Verify Your Email',
    `<h2 style="margin:0 0 16px;font-size:22px;color:#1e293b;">E-posta Doğrulama / Email Verification</h2>
    <p style="margin:0 0 12px;font-size:15px;color:#475569;">Merhaba / Hi ${opts.firstName},</p>
    <p style="margin:0 0 24px;font-size:15px;color:#475569;">
      ${BRAND_NAME} hesabınızı etkinleştirmek için e-posta adresinizi doğrulayın.
      Bu bağlantı <strong>24 saat</strong> geçerlidir.<br/><br/>
      Please verify your email address to activate your ${BRAND_NAME} account.
      This link is valid for <strong>24 hours</strong>.
    </p>
    <p style="margin:0 0 28px;">
      <a href="${opts.verifyUrl}"
         style="display:inline-block;background:${BRAND_COLOR};color:#ffffff;text-decoration:none;
                padding:13px 28px;border-radius:8px;font-size:15px;font-weight:bold;">
        E-postayı Doğrula / Verify Email
      </a>
    </p>
    <p style="margin:0 0 8px;font-size:13px;color:#64748b;">
      Veya bu bağlantıyı tarayıcınıza yapıştırın / Or copy and paste this link into your browser:
    </p>
    <p style="margin:0;font-size:13px;color:#2563eb;word-break:break-all;">${opts.verifyUrl}</p>`,
  );

  const text = [
    `E-posta Doğrulama — ${BRAND_NAME}`,
    '',
    `Merhaba / Hi ${opts.firstName},`,
    '',
    `${BRAND_NAME} hesabınızı etkinleştirmek için aşağıdaki bağlantıya tıklayın (24 saat geçerli):`,
    `Please click the link below to verify your email (valid for 24 hours):`,
    '',
    opts.verifyUrl,
    '',
    'Bu e-postayı siz istemediyseniz, güvenle görmezden gelebilirsiniz.',
    'If you did not register, you can safely ignore this email.',
  ].join('\n');

  return { subject, html, text };
}

export function buildTestEmail(opts: { to: string }): { subject: string; html: string; text: string } {
  const subject = `${BRAND_NAME} — SMTP Test`;

  const html = baseLayout(
    'SMTP Test',
    `<h2 style="margin:0 0 16px;font-size:22px;color:#1e293b;">SMTP Configuration Test</h2>
    <p style="margin:0 0 12px;font-size:15px;color:#475569;">
      This is a test email from <strong>${BRAND_NAME}</strong> to verify your SMTP configuration is working correctly.
    </p>
    <p style="margin:0;font-size:15px;color:#475569;">
      If you received this email, your SMTP settings are correctly configured.
    </p>`,
  );

  const text = [
    `SMTP Test — ${BRAND_NAME}`,
    '',
    `This is a test email sent to ${opts.to} to verify SMTP configuration.`,
    'If you received this, your SMTP settings are working correctly.',
  ].join('\n');

  return { subject, html, text };
}
