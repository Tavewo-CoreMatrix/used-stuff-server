import { Resend } from "resend";
import { env } from "../config/env.js";

const resend = env.resendApiKey ? new Resend(env.resendApiKey) : null;

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });

const createAccountEmail = ({
  preheader,
  heading,
  message,
  code,
  expirationMinutes,
  safetyNote,
}: {
  preheader: string;
  heading: string;
  message: string;
  code: string;
  expirationMinutes: number;
  safetyNote: string;
}) => `
  <!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <meta name="color-scheme" content="light">
      <title>${heading}</title>
    </head>
    <body style="margin:0;padding:0;background-color:#F5F5F4;font-family:Arial,Helvetica,sans-serif;color:#1F2937;">
      <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
        ${preheader}
      </div>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#F5F5F4;">
        <tr>
          <td align="center" style="padding:40px 16px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;background-color:#FFFFFF;border:1px solid #E5E7EB;border-radius:12px;overflow:hidden;">
              <tr>
                <td style="height:6px;background-color:#CC5500;font-size:0;line-height:0;">&nbsp;</td>
              </tr>
              <tr>
                <td style="padding:32px 36px 12px;">
                  <p style="margin:0 0 24px;color:#CC5500;font-size:14px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">Used Stuff</p>
                  <h1 style="margin:0 0 12px;color:#111827;font-size:26px;line-height:1.3;">${heading}</h1>
                  <p style="margin:0;color:#4B5563;font-size:16px;line-height:1.6;">${message}</p>
                </td>
              </tr>
              <tr>
                <td style="padding:16px 36px 8px;">
                  <div style="padding:20px 16px;background-color:#FFF7ED;border:1px solid #FED7AA;border-radius:8px;text-align:center;">
                    <p style="margin:0 0 8px;color:#9A3412;font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;">Your security code</p>
                    <p style="margin:0;color:#7C2D12;font-size:30px;font-weight:700;letter-spacing:6px;line-height:1.4;overflow-wrap:anywhere;">${escapeHtml(code)}</p>
                  </div>
                </td>
              </tr>
              <tr>
                <td style="padding:16px 36px 32px;">
                  <p style="margin:0 0 16px;color:#4B5563;font-size:14px;line-height:1.6;">This code expires in <strong>${expirationMinutes} minutes</strong>.</p>
                  <p style="margin:0;color:#6B7280;font-size:13px;line-height:1.6;">${safetyNote}</p>
                </td>
              </tr>
              <tr>
                <td style="padding:20px 36px;background-color:#F9FAFB;border-top:1px solid #E5E7EB;">
                  <p style="margin:0;color:#6B7280;font-size:12px;line-height:1.6;">This is an automated message from Used Stuff. Please do not reply to this email.</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
  </html>
`;

export const sendEmail = async ({
  to,
  subject,
  html,
}: {
  to: string;
  subject: string;
  html: string;
}) => {
  if (!resend) {
    console.warn("Resend API key not configured. Logging email instead:");
    console.warn(`To: ${to}\nSubject: ${subject}\nHTML: ${html}`);
    return;
  }

  try {
    const { data, error } = await resend.emails.send({
      from: env.emailFrom,
      to,
      subject,
      html,
    });

    if (error) {
      console.error("Failed to send email:", error);
      throw new Error("Failed to send email");
    }

    return data;
  } catch (error) {
    console.error("Error sending email:", error);
    throw new Error("Error sending email");
  }
};

export const sendOtpEmail = async (to: string, otp: string) => {
  const html = createAccountEmail({
    preheader: "Use this code to verify your Used Stuff account.",
    heading: "Verify your email",
    message: "Enter the security code below to verify your email address and finish setting up your account.",
    code: otp,
    expirationMinutes: env.otpExpiresInMinutes,
    safetyNote: "If you did not create a Used Stuff account, you can safely ignore this email.",
  });
  return sendEmail({ to, subject: "Verify your email - Used Stuff", html });
};

export const sendPasswordResetEmail = async (to: string, resetToken: string) => {
  const html = createAccountEmail({
    preheader: "Use this code to reset your Used Stuff password.",
    heading: "Reset your password",
    message: "We received a request to reset your password. Enter the security code below to continue.",
    code: resetToken,
    expirationMinutes: env.resetTokenExpiresInMinutes,
    safetyNote: "If you did not request a password reset, you can safely ignore this email. Your password will not change.",
  });
  return sendEmail({ to, subject: "Reset your password - Used Stuff", html });
};
