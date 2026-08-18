import { AuthLayout } from "../../../components/templates/auth-layout";
import { VerifyReportResult } from "../../../components/organisms/verify-report-result";

export default async function VerifyReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  return (
    <AuthLayout>
      <VerifyReportResult token={token} />
    </AuthLayout>
  );
}
