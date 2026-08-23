import Link from "next/link";
import { FlaskConical, Monitor, BookOpen, Landmark, Presentation, Trophy, Award, ShieldCheck, Users, Sparkles } from "lucide-react";
import { Button } from "../../components/atoms/button";
import { Card } from "../../components/molecules/card";
import { SectionHeading } from "../../components/molecules/section-heading";
import { PlaceholderImage } from "../../components/molecules/placeholder-image";
import { siteContent } from "../../lib/site-content";

const CAMPUS_GALLERY = [
  { icon: FlaskConical, label: "Science Laboratory" },
  { icon: Monitor, label: "ICT Laboratory" },
  { icon: BookOpen, label: "Library" },
  { icon: Landmark, label: "Assembly Hall" },
  { icon: Presentation, label: "Classroom" },
  { icon: Trophy, label: "Sports Field" },
];

const VALUE_PROPS = [
  { icon: Award, title: "Qualified Educators", description: "Every classroom is led by a trained, credentialed teacher." },
  { icon: ShieldCheck, title: "Safe Environment", description: "A secure, well-supervised campus families can trust." },
  { icon: Sparkles, title: "Modern Facilities", description: "Purpose-built labs, library, and ICT resources support hands-on learning." },
  { icon: Users, title: "Holistic Development", description: "Academics alongside sports, arts, and leadership opportunities." },
];

export default function HomePage() {
  return (
    <>
      <section className="border-b border-border bg-card-inset">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:py-24">
          <div className="text-[10.5px] uppercase tracking-wide text-muted">{siteContent.schoolName}</div>
          <h1 className="font-display mt-3 max-w-2xl text-4xl font-semibold leading-tight sm:text-5xl">
            {siteContent.tagline}
          </h1>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild>
              <Link href="/admissions">Apply Now</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/academics">Explore Academics</Link>
            </Button>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-10">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            { value: siteContent.foundedYear, label: "Founded" },
            { value: siteContent.studentCount, label: "Students" },
            { value: siteContent.staffCount, label: "Staff" },
            { value: siteContent.classLevels, label: "Class levels" },
          ].map((stat) => (
            <Card key={stat.label} className="text-center">
              <div className="font-display text-2xl font-semibold">{stat.value}</div>
              <div className="mt-1 text-[11px] uppercase tracking-wide text-muted">{stat.label}</div>
            </Card>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-10">
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

      <section className="mx-auto max-w-6xl px-5 py-10">
        <SectionHeading eyebrow="Campus" title="Life on campus" subtitle="A look at the spaces where learning happens every day." />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {CAMPUS_GALLERY.map((item) => (
            <PlaceholderImage key={item.label} icon={item.icon} label={item.label} />
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-10">
        <SectionHeading eyebrow="Why us" title="Why families choose us" align="center" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {VALUE_PROPS.map((item) => (
            <Card key={item.title} className="text-center">
              <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <item.icon className="h-5 w-5" strokeWidth={1.75} />
              </div>
              <div className="font-display mt-3 text-[14px] font-semibold">{item.title}</div>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">{item.description}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-14">
        <Card className="flex flex-col items-center gap-4 border-primary bg-primary py-12 text-center text-primary-foreground">
          <h2 className="font-display text-2xl font-semibold sm:text-3xl">Ready to join our community?</h2>
          <p className="max-w-xl text-[13.5px] leading-relaxed text-[rgb(var(--primary-foreground)/0.85)]">
            Start your child&apos;s admission inquiry today — our team will guide you through every step.
          </p>
          <Button
            asChild
            variant="outline"
            className="border-primary-foreground bg-transparent text-primary-foreground hover:bg-[rgb(var(--primary-foreground)/0.1)] hover:text-primary-foreground"
          >
            <Link href="/admissions">Start an inquiry</Link>
          </Button>
        </Card>
      </section>
    </>
  );
}
