import nodemailer from 'nodemailer';

/**
 * EmailService — sends emails using SMTP configured in system_config.
 * Config keys: smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from
 */

let transporter: nodemailer.Transporter | null = null;

async function getTransporter(): Promise<nodemailer.Transporter> {
  if (transporter) return transporter;

  // SMTP config from env (system-level, not tenant-specific)
  const host = process.env.SMTP_HOST || '';
  const port = parseInt(process.env.SMTP_PORT || '587');
  const user = process.env.SMTP_USER || '';
  const pass = process.env.SMTP_PASS || '';

  if (!host || !user) {
    throw new Error('SMTP not configured. Set smtp_host, smtp_user, smtp_pass in system_config or .env');
  }

  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  return transporter;
}

export async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  try {
    const transport = await getTransporter();
    const from = process.env.SMTP_FROM || 'TMC AI <noreply@tmc.com>';

    await transport.sendMail({ from, to, subject, html });
    console.log(`[Email] Sent to ${to}: "${subject}"`);
    return true;
  } catch (err: any) {
    console.error(`[Email] Failed to send to ${to}:`, err.message);
    return false;
  }
}

/**
 * Reset transporter (call after SMTP config changes)
 */
export function resetTransporter(): void {
  transporter = null;
}
