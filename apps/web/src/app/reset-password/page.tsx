import { Suspense } from "react";
import { AuthLayout } from "../../components/templates/auth-layout";
import { ResetPasswordForm } from "../../components/organisms/reset-password-form";

export default function ResetPasswordPage() {
  return (
    <AuthLayout>
      <Suspense fallback={null}>
        <ResetPasswordForm />
      </Suspense>
    </AuthLayout>
  );
}
