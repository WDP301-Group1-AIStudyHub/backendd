import nodemailer, { Transporter } from "nodemailer";

let transporter: Transporter | null = null;

const getMissingSmtpVariables = (): string[] =>
  ["SMTP_HOST", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"].filter(
    (name) => !process.env[name]?.trim(),
  );

const escapeHtml = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[character] || character,
  );

const getTransporter = (): Transporter | null => {
  if (getMissingSmtpVariables().length > 0) {
    return null;
  }

  const host = process.env.SMTP_HOST;

  if (transporter) {
    return transporter;
  }

  const port = Number.parseInt(process.env.SMTP_PORT || "587", 10);

  transporter = nodemailer.createTransport({
    host: host!,
    port,
    secure: port === 465,
    auth: {
      user: process.env.SMTP_USER!,
      pass: process.env.SMTP_PASS!,
    },
  });

  return transporter;
};

export interface DocumentShareEmailPayload {
  to: string;
  recipientName: string;
  senderName: string;
  documentTitle: string;
  permission: "VIEW" | "EDIT";
  documentUrl: string;
  mobileUrl?: string;
  isInvitation?: boolean;
  isPermissionUpdate?: boolean;
}

export const sendDocumentShareEmail = async ({
  documentTitle,
  documentUrl,
  isInvitation = false,
  isPermissionUpdate = false,
  permission,
  recipientName,
  senderName,
  to,
}: DocumentShareEmailPayload): Promise<void> => {
  const mailer = getTransporter();
  const from = process.env.SMTP_FROM;

  if (!mailer || !from) {
    console.warn("[email] SMTP is not configured; skipping document share email", {
      missing: getMissingSmtpVariables(),
      to,
      documentTitle,
    });
    return;
  }

  const permissionLabel = permission === "EDIT" ? "Biên tập viên" : "Người xem";
  const permissionDescription =
    permission === "EDIT"
      ? "Xem, tải xuống, chỉnh sửa thông tin tài liệu và tải lên phiên bản mới."
      : "Xem và tải xuống tài liệu.";
  const safeSenderName = escapeHtml(senderName);
  const safeDocumentTitle = escapeHtml(documentTitle);
  const safeDocumentUrl = escapeHtml(documentUrl);
  const safePermissionLabel = escapeHtml(permissionLabel);
  const safePermissionDescription = escapeHtml(permissionDescription);
  const greeting = recipientName.trim()
    ? `Xin chào ${recipientName},`
    : "Xin chào,";
  const safeGreeting = escapeHtml(greeting);
  const actionLabel = isInvitation ? "Đăng ký để xem tài liệu" : "Mở tài liệu";
  const subject = isPermissionUpdate
    ? `Quyền truy cập tài liệu đã được cập nhật: ${documentTitle}`
    : `${senderName} đã chia sẻ tài liệu với bạn`;
  const intro = isPermissionUpdate
    ? `${senderName} đã cập nhật quyền truy cập của bạn đối với tài liệu "${documentTitle}".`
    : `${senderName} đã chia sẻ tài liệu "${documentTitle}" với bạn.`;
  const safeIntro = escapeHtml(intro);

  await mailer.sendMail({
    from,
    to,
    subject,
    text: [
      greeting,
      "",
      intro,
      `Quyền truy cập: ${permissionLabel}`,
      permissionDescription,
      "",
      isInvitation
        ? "Lời mời có hiệu lực trong 7 ngày. Hãy đăng ký bằng đúng địa chỉ email nhận thư này."
        : "Bạn có thể truy cập tài liệu bằng liên kết bên dưới.",
      "",
      `${actionLabel}: ${documentUrl}`,
      "",
      "Nếu bạn không nhận ra người gửi, bạn có thể bỏ qua email này.",
    ].join("\n"),
    html: `<!doctype html>
<html lang="vi">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${escapeHtml(subject)}</title>
  </head>
  <body style="margin:0;background:#f3f6f4;color:#1f2937;font-family:Arial,Helvetica,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${safeSenderName} đã chia sẻ ${safeDocumentTitle} với bạn.</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f6f4;padding:32px 12px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border:1px solid #dce5df;border-radius:8px;overflow:hidden;">
          <tr>
            <td style="background:#173f35;padding:24px 32px;color:#ffffff;">
              <div style="font-size:12px;font-weight:700;letter-spacing:0;text-transform:uppercase;color:#b9d7ca;">AI Study Hub</div>
              <div style="margin-top:8px;font-size:22px;font-weight:700;line-height:1.35;">Tài liệu được chia sẻ với bạn</div>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <p style="margin:0 0 18px;font-size:16px;line-height:1.6;">${safeGreeting}</p>
              <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#4b5563;">${safeIntro}</p>

              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:24px;border:1px solid #dce5df;border-radius:8px;background:#f8faf9;">
                <tr><td style="padding:20px;">
                  <div style="font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;">Tài liệu</div>
                  <div style="margin-top:6px;font-size:18px;font-weight:700;line-height:1.4;color:#173f35;">${safeDocumentTitle}</div>
                  <div style="margin-top:16px;">
                    <span style="display:inline-block;border-radius:999px;background:#e0eee8;color:#175441;padding:6px 10px;font-size:12px;font-weight:700;">${safePermissionLabel}</span>
                  </div>
                  <p style="margin:12px 0 0;font-size:14px;line-height:1.6;color:#4b5563;">${safePermissionDescription}</p>
                </td></tr>
              </table>

              ${isInvitation ? '<p style="margin:0 0 20px;font-size:13px;line-height:1.6;color:#64748b;">Lời mời có hiệu lực trong <strong>7 ngày</strong>. Vui lòng đăng ký bằng đúng địa chỉ email nhận thư này.</p>' : ""}

              <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 24px;">
                <tr><td style="border-radius:6px;background:#1f6b52;">
                  <a href="${safeDocumentUrl}" style="display:inline-block;padding:13px 22px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;">${actionLabel}</a>
                </td></tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="border-top:1px solid #e5ebe7;background:#f8faf9;padding:20px 32px;font-size:12px;line-height:1.6;color:#64748b;">
              Email này được gửi tự động từ AI Study Hub. Nếu bạn không nhận ra ${safeSenderName}, bạn có thể bỏ qua email này.
            </td>
          </tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`,
  });
};
