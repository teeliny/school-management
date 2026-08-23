import { FlaskConical, Landmark, BookOpen } from "lucide-react";
import { PageHero } from "../../../components/molecules/page-hero";
import { SectionHeading } from "../../../components/molecules/section-heading";
import { Card } from "../../../components/molecules/card";
import { PlaceholderImage } from "../../../components/molecules/placeholder-image";
import { CrestBadge } from "../../../components/atoms/crest-badge";
import { siteContent } from "../../../lib/site-content";

const FACILITIES = [
  { icon: Landmark, label: "Assembly Hall" },
  { icon: BookOpen, label: "Library" },
  { icon: FlaskConical, label: "Science Laboratory" },
];

export default function AboutPage() {
  return (
    <>
      <PageHero eyebrow="About us" title={`About ${siteContent.schoolName}`} subtitle="Our story, our values, and the people who lead us." />

      <section className="mx-auto max-w-6xl px-5 py-12">
        <SectionHeading eyebrow="Our story" title="How we started" />
        <p className="max-w-3xl text-[14px] leading-relaxed text-muted">{siteContent.history}</p>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <div className="text-[10.5px] uppercase tracking-wide text-muted">Our Vision</div>
            <p className="mt-2 text-[14px] leading-relaxed">{siteContent.vision}</p>
          </Card>
          <Card>
            <div className="text-[10.5px] uppercase tracking-wide text-muted">Our Mission</div>
            <p className="mt-2 text-[14px] leading-relaxed">{siteContent.mission}</p>
          </Card>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-12">
        <SectionHeading eyebrow="What we stand for" title="Our core values" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {siteContent.coreValues.map((value) => (
            <Card key={value.name}>
              <div className="font-display text-[15px] font-semibold">{value.name}</div>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">{value.description}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-12">
        <SectionHeading eyebrow="Leadership" title="A note from our leadership" />
        <Card className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <CrestBadge letter={siteContent.crestLetter} variant="solid" size="lg" className="flex-none" />
          <div>
            <p className="text-[14px] leading-relaxed">{siteContent.leadership.message}</p>
            <div className="mt-3 text-[12.5px] font-medium">{siteContent.leadership.name}</div>
            <div className="text-[11.5px] text-muted">{siteContent.leadership.title}</div>
          </div>
        </Card>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-12">
        <SectionHeading eyebrow="Campus" title="Our facilities" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {FACILITIES.map((item) => (
            <PlaceholderImage key={item.label} icon={item.icon} label={item.label} />
          ))}
        </div>
      </section>
    </>
  );
}
