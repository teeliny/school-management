import PDFDocument from "pdfkit";
import type { FullTermContent, MidTermSnapshot } from "./report-card-content.util";

export interface ReportCardMeta {
  studentName: string;
  admissionNumber: string;
  termName: string;
  schoolName: string;
  schoolAddress: string | null;
  generatedAt: Date;
  // Already-fetched image bytes (report-card.processor.ts resolves
  // SchoolProfile.logoUrl over the network before rendering) — null when
  // there's no logo configured or it couldn't be fetched, in which case the
  // header just omits it rather than failing report generation.
  logoBuffer: Buffer | null;
}

/**
 * Shared header (logo/school name+address/generated date/student+term) for
 * both report types, per PRD §3.6. Kept as a plain function taking the doc
 * rather than a class — pdfkit's own API is already a mutable-builder
 * pattern, no need for a second one on top.
 */
function renderHeader(doc: PDFKit.PDFDocument, meta: ReportCardMeta, title: string): void {
  if (meta.logoBuffer) {
    try {
      doc.image(meta.logoBuffer, { fit: [80, 80], align: "center" });
    } catch {
      // Malformed/unsupported image bytes — skip the logo, don't fail the
      // whole report over a decorative header element.
    }
  }

  doc.fontSize(14).text(meta.schoolName, { align: "center" });
  if (meta.schoolAddress) {
    doc.fontSize(9).text(meta.schoolAddress, { align: "center" });
  }
  doc.moveDown();
  doc.fontSize(18).text(title, { align: "center" });
  doc.fontSize(8).text(`Generated: ${meta.generatedAt.toDateString()}`, { align: "center" });
  doc.moveDown();
  doc.fontSize(11);
  doc.text(`Student: ${meta.studentName} (${meta.admissionNumber})`);
  doc.text(`Term: ${meta.termName}`);
  doc.moveDown();
}

/**
 * Rendering only — the actual content is assembled by
 * buildMidTermSnapshot/report-card-content.util.ts, which is what's
 * unit-tested. Visual layout here isn't meaningfully assertable in a unit
 * test, so it's exercised via the manual smoke check instead.
 */
export function renderMidTermPdf(snapshot: MidTermSnapshot, meta: ReportCardMeta): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    renderHeader(doc, meta, "Mid-Term Report");

    doc.fontSize(10);
    for (const subject of snapshot.subjects) {
      const score = subject.score === null ? "-" : `${subject.score} / ${subject.maxScore}`;
      const grade = subject.grade ? ` — ${subject.grade} (${subject.remark ?? "-"})` : "";
      doc.text(`${subject.subjectName}: ${score}${grade}`);
    }
    doc.moveDown();

    const overallPercentage = snapshot.overallPercentage === null ? "-" : `${snapshot.overallPercentage.toFixed(1)}%`;
    doc.fontSize(11);
    doc.text(`Overall percentage: ${overallPercentage}`);
    doc.text(`Overall grade: ${snapshot.overallGrade ?? "-"}`);

    doc.end();
  });
}

/**
 * Full-term report — final SubjectTermResult totals/grades/positions, both
 * skill categories, and the two required comments. Rendering only, same
 * "not meaningfully unit-testable" note as renderMidTermPdf; content
 * assembly (buildFullTermContent) is what's tested. Note attendance (days
 * present / school-days-opened) is deliberately absent — deferred to
 * Phase 5 per PRD §3.6/§3.7, not built here.
 */
export function renderFullTermPdf(content: FullTermContent, meta: ReportCardMeta): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    renderHeader(doc, meta, "Term Report Card");

    doc.fontSize(13).text("Subject Results", { underline: true });
    doc.fontSize(10);
    for (const subject of content.subjects) {
      const breakdown = subject.components.map((c) => `${c.name} ${c.score ?? "-"}/${c.maxScore}`).join(", ");
      const priorTerms =
        subject.priorTerms.length > 0
          ? ` [${subject.priorTerms.map((t) => `${t.termName}: ${t.total ?? "-"}`).join(", ")}]`
          : "";
      const position = subject.position ? ` (Position: ${subject.position})` : "";
      const remark = subject.remark ? ` — ${subject.remark}` : "";
      doc.text(
        `${subject.subjectName}: ${breakdown} → Total ${subject.totalScore}${priorTerms} — ${subject.grade ?? "-"}${remark}${position}`,
      );
    }
    doc.moveDown();

    const overallLabel = content.isAnnual ? "Annual overall" : "Overall";
    const overallAverage = content.overallAverage === null ? "-" : content.overallAverage.toFixed(1);
    doc.fontSize(11);
    doc.text(`${overallLabel} average: ${overallAverage}`);
    doc.text(`${overallLabel} grade: ${content.overallGrade ?? "-"}`);
    if (content.overallRemark) {
      doc.text(`${overallLabel} remark: ${content.overallRemark}`);
    }
    doc.moveDown();

    doc.fontSize(13).text("Psychomotor Skills", { underline: true });
    doc.fontSize(10);
    for (const skill of content.psychomotorSkills) {
      doc.text(`${skill.name}: ${skill.rating}`);
    }
    doc.moveDown();

    doc.fontSize(13).text("Affective/Cognitive Skills", { underline: true });
    doc.fontSize(10);
    for (const skill of content.affectiveCognitiveSkills) {
      doc.text(`${skill.name}: ${skill.rating}`);
    }
    doc.moveDown();

    doc.fontSize(13).text("Class Teacher's Comment", { underline: true });
    doc.fontSize(10).text(content.classTeacherComment ?? "—");
    doc.moveDown();

    doc.fontSize(13).text("Principal's Comment", { underline: true });
    doc.fontSize(10).text(content.principalComment ?? "—");

    doc.end();
  });
}
