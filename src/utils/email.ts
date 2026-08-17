import { Resend } from "resend";
import { env } from "../config/env.js";

// const resend = env.resendApiKey ? new Resend(env.resendApiKey) : null;
const resend = new Resend("re_jBPEYLNU_PJZBVipQtk191Q16LmdY8As7");

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
  const html = `
    <h1>Verify your email</h1>
    <p>Your verification code is: <strong>${otp}</strong></p>
    <p>This code expires in ${env.otpExpiresInMinutes} minutes.</p>
  `;
  return sendEmail({ to, subject: "Verify your email - Used Stuff", html });
};

export const sendPasswordResetEmail = async (to: string, resetToken: string) => {
  const html = `
    <h1>Reset your password</h1>
    <p>Your password reset code is: <strong>${resetToken}</strong></p>
    <p>This code expires in ${env.resetTokenExpiresInMinutes} minutes.</p>
  `;
  return sendEmail({ to, subject: "Reset your password - Used Stuff", html });
};
