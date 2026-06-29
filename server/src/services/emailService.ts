import nodemailer from 'nodemailer';

function isMailEnabled(): boolean {
  return process.env.MAIL_ENABLED === 'true';
}

function createTransporter() {
  const host = process.env.SMTP_HOST || 'localhost';
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const secure = process.env.SMTP_SECURE === 'true';
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user && pass ? { user, pass } : undefined,
  });
}

export interface SendMailOptions {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface SendMailResult {
  sent: boolean;
  reason?: string;
}

export async function sendMail(options: SendMailOptions): Promise<SendMailResult> {
  if (!isMailEnabled()) {
    return { sent: false, reason: 'MAIL_ENABLED is false — email not sent' };
  }

  const from = process.env.SMTP_FROM || 'NoraMedi <no-reply@noramedi.com>';
  const replyTo = process.env.SMTP_REPLY_TO;

  const transporter = createTransporter();

  await transporter.sendMail({
    from,
    to: options.to,
    subject: options.subject,
    html: options.html,
    text: options.text,
    ...(replyTo ? { replyTo } : {}),
  });

  return { sent: true };
}
