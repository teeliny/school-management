import Link from "next/link";
import { FlaskConical, Monitor, BookOpen } from "lucide-react";
import { Button } from "../../../components/atoms/button";
import { PageHero } from "../../../components/molecules/page-hero";
import { SectionHeading } from "../../../components/molecules/section-heading";
import { Card } from "../../../components/molecules/card";
import { PlaceholderImage } from "../../../components/molecules/placeholder-image";
import { siteContent } from "../../../lib/site-content";

const FACILITIES = [
  { icon: FlaskConical, label: "Science Laboratory" },
  { icon: Monitor, label: "ICT Laboratory" },
  { icon: BookOpen, label: "Library" },
];

export default function AcademicsPage() {
  return (
    <>
      <PageHero
        eyebrow="Academics"
        title="Academic Programs"
        subtitle="A structured, rigorous curriculum from Creche through Senior Secondary."
      />

      <section className="mx-auto max-w-6xl px-5 py-12">
        <SectionHeading eyebrow="Levels offered" title="From early years to graduation" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {siteContent.academicLevels.map((level) => (
            <Card key={level.name}>
              <div className="font-display text-[15px] font-semibold">{level.name}</div>
              <div className="mt-1 font-mono text-[11px] text-muted">{level.ageRange}</div>
              <p className="mt-2 text-[12.5px] leading-relaxed text-muted">{level.description}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <SectionHeading eyebrow="Curriculum" title="Our approach" />
            <p className="text-[13.5px] leading-relaxed text-muted">
              We follow the Nigerian national curriculum, enriched with a strong emphasis on literacy, numeracy, and
              hands-on science from the earliest years — replace this paragraph with the school&apos;s actual
              curriculum philosophy and any accreditation details.
            </p>
          </Card>
          <Card>
            <SectionHeading eyebrow="Senior Secondary" title="Subjects &amp; specializations" />
            <p className="text-[13.5px] leading-relaxed text-muted">
              At Senior Secondary, students choose from Science, Arts, and Commercial tracks, preparing for
              WASSCE/NECO and university admission — replace this paragraph with the school&apos;s actual subject
              combinations.
            </p>
          </Card>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-12">
        <SectionHeading eyebrow="Facilities" title="Where learning happens" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {FACILITIES.map((item) => (
            <PlaceholderImage key={item.label} icon={item.icon} label={item.label} />
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 pb-16">
        <Card className="flex flex-col items-center gap-4 py-10 text-center">
          <h2 className="font-display text-xl font-semibold">Curious how your child would fit in?</h2>
          <Button asChild>
            <Link href="/admissions">Start an admission inquiry</Link>
          </Button>
        </Card>
      </section>
    </>
  );
}
