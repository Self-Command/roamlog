import type { Metadata } from "next";

import { AuthPageFrame } from "@/components/auth/auth-shell";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export const metadata: Metadata = {
  title: "重置密码",
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  return (
    <AuthPageFrame
      eyebrow="设置新密码"
      title="设置新密码"
      description="重置链接通常只能使用一次。请输入并确认你的新密码。"
      footer={
        <p className="text-center text-xs text-muted">
          需要新的链接？{" "}
          <a href="/forgot-password" className="text-ink underline-offset-4 hover:underline">
            重新发送
          </a>
        </p>
      }
    >
      <ResetPasswordForm token={token} />
    </AuthPageFrame>
  );
}
