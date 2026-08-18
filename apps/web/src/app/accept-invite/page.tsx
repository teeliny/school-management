import { Suspense } from "react";
import { AuthLayout } from "../../components/templates/auth-layout";
import { AcceptInviteForm } from "../../components/organisms/accept-invite-form";

export default function AcceptInvitePage() {
  return (
    <AuthLayout>
      <Suspense fallback={null}>
        <AcceptInviteForm />
      </Suspense>
    </AuthLayout>
  );
}
