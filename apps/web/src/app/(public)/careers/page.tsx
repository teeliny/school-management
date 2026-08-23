import { Mail, Phone, MapPin, Clock } from "lucide-react";
import { PageHero } from "../../../components/molecules/page-hero";
import { SectionHeading } from "../../../components/molecules/section-heading";
import { Card, CardHeader } from "../../../components/molecules/card";
import { Badge } from "../../../components/atoms/badge";
import { CareerContactInquiryForm } from "../../../components/organisms/career-contact-inquiry-form";
import { siteContent } from "../../../lib/site-content";

export default function CareersPage() {
  return (
    <>
      <PageHero eyebrow="Careers & Contact" title="Work with us, or just say hello" subtitle="Open roles, how to apply, and how to reach us." />

      <section className="mx-auto max-w-6xl px-5 py-12">
        <SectionHeading
          eyebrow="Careers"
          title="Current openings"
          subtitle="Illustrative examples — replace with real open roles, or remove this section when nothing's open."
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {siteContent.openRoles.map((role) => (
            <Card key={role.title}>
              <div className="font-display text-[14.5px] font-semibold">{role.title}</div>
              <Badge variant="info" className="mt-2">
                {role.type}
              </Badge>
            </Card>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-12">
        <SectionHeading eyebrow="Get in touch" title="Send us a message" />
        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <Card>
            <CareerContactInquiryForm />
          </Card>
          <Card>
            <CardHeader title="Contact details" />
            <ul className="space-y-3.5 text-[13px]">
              <li className="flex items-start gap-2.5">
                <MapPin className="mt-0.5 h-4 w-4 flex-none text-muted" strokeWidth={1.75} />
                <span>{siteContent.contact.address}</span>
              </li>
              <li className="flex items-start gap-2.5">
                <Phone className="mt-0.5 h-4 w-4 flex-none text-muted" strokeWidth={1.75} />
                <span className="font-mono">{siteContent.contact.phone}</span>
              </li>
              <li className="flex items-start gap-2.5">
                <Mail className="mt-0.5 h-4 w-4 flex-none text-muted" strokeWidth={1.75} />
                <span className="font-mono">{siteContent.contact.email}</span>
              </li>
              <li className="flex items-start gap-2.5">
                <Clock className="mt-0.5 h-4 w-4 flex-none text-muted" strokeWidth={1.75} />
                <span>{siteContent.contact.officeHours}</span>
              </li>
            </ul>
          </Card>
        </div>
      </section>
    </>
  );
}
