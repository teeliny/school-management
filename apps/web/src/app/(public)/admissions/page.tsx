import { Check } from "lucide-react";
import { PageHero } from "../../../components/molecules/page-hero";
import { SectionHeading } from "../../../components/molecules/section-heading";
import { Card, CardHeader } from "../../../components/molecules/card";
import { AdmissionInquiryForm } from "../../../components/organisms/admission-inquiry-form";
import { siteContent } from "../../../lib/site-content";

export default function AdmissionsPage() {
  return (
    <>
      <PageHero eyebrow="Admissions" title="Join our community" subtitle="Here's how admission works, what you'll need, and how to start." />

      <section className="mx-auto max-w-6xl px-5 py-12">
        <SectionHeading eyebrow="Process" title="Four simple steps" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {siteContent.admissionsSteps.map((step, i) => (
            <Card key={step.name} className="relative">
              <div className="font-mono text-[11px] text-muted">Step {i + 1}</div>
              <div className="font-display mt-1 text-[15px] font-semibold">{step.name}</div>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">{step.description}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader title="What you'll need" sub="Required for a completed application" />
            <ul className="space-y-2.5">
              {siteContent.admissionRequirements.map((req) => (
                <li key={req} className="flex items-start gap-2 text-[13px] leading-relaxed">
                  <Check className="mt-0.5 h-4 w-4 flex-none text-success" strokeWidth={2} />
                  <span>{req}</span>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <CardHeader title="Key dates" sub="Typical admissions calendar" />
            <table className="w-full text-[13px]">
              <tbody>
                {siteContent.keyDates.map((date) => (
                  <tr key={date.label} className="border-b border-border/60 last:border-none">
                    <td className="py-2.5 text-muted">{date.label}</td>
                    <td className="py-2.5 text-right font-mono">{date.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-12">
        <SectionHeading eyebrow="Get started" title="Submit an admission inquiry" subtitle="Tell us a bit about your child and we'll reach out to guide you through the next steps." />
        <Card className="max-w-2xl">
          <AdmissionInquiryForm />
        </Card>
      </section>
    </>
  );
}
