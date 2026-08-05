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

// Brand colors (see CLAUDE.md's web theming notes) reused here for visual
// consistency between the web app and the printed report — navy for
// headings/rules, a neutral gray for secondary text and table banding.
const NAVY = "#001B3A";
const MUTED = "#6b7280";
const BORDER = "#d8dce3";
const BAND = "#f4f5f7";

function contentWidth(doc: PDFKit.PDFDocument): number {
  return doc.page.width - doc.page.margins.left - doc.page.margins.right;
}

/**
 * Table header row builder — bold font is only typed on a per-cell
 * `CellOptions`, not on `rowStyles`/`defaultStyle` (the installed
 * @types/pdfkit predates pdfkit 0.19's table API), so header cells set it
 * explicitly rather than through the row-level style function.
 */
function headerRow(labels: string[]): { text: string; font: { src: string } }[] {
  return labels.map((text) => ({ text, font: { src: "Helvetica-Bold" } }));
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
      doc.image(meta.logoBuffer, { fit: [64, 64], align: "center" });
    } catch {
      // Malformed/unsupported image bytes — skip the logo, don't fail the
      // whole report over a decorative header element.
    }
  }

  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(15).text(meta.schoolName, { align: "center" });
  if (meta.schoolAddress) {
    doc.fillColor(MUTED).font("Helvetica").fontSize(9).text(meta.schoolAddress, { align: "center" });
  }
  doc.moveDown(0.5);

  const left = doc.page.margins.left;
  const width = contentWidth(doc);
  doc.moveTo(left, doc.y).lineTo(left + width, doc.y).lineWidth(1.25).strokeColor(NAVY).stroke();
  doc.moveDown(0.12);
  doc.moveTo(left, doc.y).lineTo(left + width, doc.y).lineWidth(0.5).strokeColor(NAVY).stroke();
  doc.moveDown(0.6);

  doc.fillColor(NAVY).font("Times-Bold").fontSize(19).text(title, { align: "center" });
  doc.fillColor(MUTED).font("Helvetica").fontSize(8).text(`Generated: ${meta.generatedAt.toDateString()}`, { align: "center" });
  doc.moveDown(0.7);

  doc.fillColor("black").fontSize(10.5);
  doc.font("Helvetica-Bold").text("Student: ", { continued: true });
  doc.font("Helvetica").text(`${meta.studentName} (${meta.admissionNumber})`);
  doc.font("Helvetica-Bold").text("Term: ", { continued: true });
  doc.font("Helvetica").text(meta.termName);
  doc.moveDown(0.7);

  doc.fillColor("black").font("Helvetica").fontSize(10);
}

/** Section title with a navy rule beneath it, replacing plain underlined text. */
function sectionHeader(doc: PDFKit.PDFDocument, label: string): void {
  if (doc.y > doc.page.height - doc.page.margins.bottom - 60) doc.addPage();
  doc.moveDown(0.4);
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(12).text(label);
  const left = doc.page.margins.left;
  const width = contentWidth(doc);
  const y = doc.y + 2;
  doc.moveTo(left, y).lineTo(left + width, y).lineWidth(0.75).strokeColor(NAVY).stroke();
  doc.y = y + 8;
  doc.fillColor("black").font("Helvetica").fontSize(10);
}

/** Muted italic placeholder for a section with no data yet — used instead of
 * rendering a bare header with nothing under it. */
function emptyPlaceholder(doc: PDFKit.PDFDocument, message: string): void {
  doc.fillColor(MUTED).font("Helvetica-Oblique").fontSize(9.5).text(message);
  doc.fillColor("black").font("Helvetica").fontSize(10);
  doc.moveDown(0.3);
}

/** Tinted, padded box for the two free-text comments. */
function commentBox(doc: PDFKit.PDFDocument, comment: string | null): void {
  const left = doc.page.margins.left;
  const width = contentWidth(doc);
  const text = comment ?? "No comment recorded yet.";
  const inset = 10;
  doc.font(comment ? "Helvetica" : "Helvetica-Oblique").fontSize(10);
  const textHeight = doc.heightOfString(text, { width: width - inset * 2 });
  const boxHeight = textHeight + inset * 2;
  const boxY = doc.y;
  doc.save().fillColor(BAND).rect(left, boxY, width, boxHeight).fill().restore();
  doc.fillColor(comment ? "black" : MUTED).text(text, left + inset, boxY + inset, { width: width - inset * 2 });
  doc.y = boxY + boxHeight + 12;
  doc.fillColor("black").font("Helvetica").fontSize(10);
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

    sectionHeader(doc, "Subject Scores");
    if (snapshot.subjects.length === 0) {
      emptyPlaceholder(doc, "No subject scores recorded yet.");
    } else {
      doc.font("Helvetica").fontSize(9.5);
      doc.table({
        columnStyles: [{ width: "*", minWidth: 120 }, { width: 90 }, { width: 60 }, { width: 90 }],
        defaultStyle: { padding: 6, border: { bottom: 0.5 }, borderColor: BORDER },
        rowStyles: (i) => (i === 0 ? { backgroundColor: NAVY, textColor: "white" } : i % 2 === 0 ? { backgroundColor: BAND } : {}),
        data: [
          headerRow(["Subject", "Score", "Grade", "Remark"]),
          ...snapshot.subjects.map((subject) => [
            { text: subject.subjectName, font: { src: "Helvetica-Bold" } },
            { text: subject.score === null ? "-" : `${subject.score} / ${subject.maxScore}`, align: "center" as const },
            { text: subject.grade ?? "-", align: "center" as const },
            { text: subject.remark ?? "-" },
          ]),
        ],
      });
      doc.moveDown(0.6);
    }

    sectionHeader(doc, "Overall");
    const overallPercentage = snapshot.overallPercentage === null ? "-" : `${snapshot.overallPercentage.toFixed(1)}%`;
    const left = doc.page.margins.left;
    const width = contentWidth(doc);
    const boxY = doc.y;
    doc.save().fillColor(BAND).rect(left, boxY, width, 26).fill().restore();
    doc
      .fillColor(NAVY)
      .font("Helvetica-Bold")
      .fontSize(10)
      .text(`Overall percentage: ${overallPercentage}    Overall grade: ${snapshot.overallGrade ?? "-"}`, left + 10, boxY + 8);
    doc.fillColor("black").font("Helvetica").fontSize(10);
    doc.y = boxY + 26 + 10;

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

    sectionHeader(doc, "Subject Results");
    if (content.subjects.length === 0) {
      emptyPlaceholder(doc, "No subject results recorded yet — scores haven't been finalized for this term.");
    } else {
      doc.font("Helvetica").fontSize(8.5);
      doc.table({
        columnStyles: [
          { width: "*", minWidth: 85 },
          { width: "*", minWidth: 130 },
          { width: 45 },
          { width: 40 },
          { width: 65 },
          { width: 40 },
        ],
        defaultStyle: { padding: 5, border: { bottom: 0.5 }, borderColor: BORDER },
        rowStyles: (i) => (i === 0 ? { backgroundColor: NAVY, textColor: "white" } : i % 2 === 0 ? { backgroundColor: BAND } : {}),
        data: [
          headerRow(["Subject", "Breakdown", "Total", "Grade", "Remark", "Pos."]),
          ...content.subjects.map((subject) => {
            const breakdown = subject.components.map((c) => `${c.name}: ${c.score ?? "-"}/${c.maxScore}`).join("   ");
            const priorLine =
              subject.priorTerms.length > 0
                ? subject.priorTerms.map((t) => `${t.termName}: ${t.total ?? "-"}`).join("   ")
                : null;
            return [
              { text: subject.subjectName, font: { src: "Helvetica-Bold" } },
              { text: priorLine ? `${breakdown}\n${priorLine}` : breakdown, textColor: MUTED },
              { text: String(subject.totalScore), align: "center" as const },
              { text: subject.grade ?? "-", align: "center" as const },
              { text: subject.remark ?? "-" },
              { text: subject.position ? String(subject.position) : "-", align: "center" as const },
            ];
          }),
        ],
      });
      doc.moveDown(0.6);
    }

    sectionHeader(doc, content.isAnnual ? "Annual Summary" : "Term Summary");
    {
      const overallAverage = content.overallAverage === null ? "-" : content.overallAverage.toFixed(1);
      const left = doc.page.margins.left;
      const width = contentWidth(doc);
      const boxY = doc.y;
      const summaryLine = [
        `Average: ${overallAverage}`,
        `Grade: ${content.overallGrade ?? "-"}`,
        content.overallRemark ? `Remark: ${content.overallRemark}` : null,
      ]
        .filter(Boolean)
        .join("     ");
      doc.save().fillColor(BAND).rect(left, boxY, width, 26).fill().restore();
      doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(10).text(summaryLine, left + 10, boxY + 8);
      doc.fillColor("black").font("Helvetica").fontSize(10);
      doc.y = boxY + 26 + 10;
    }

    sectionHeader(doc, "Psychomotor Skills");
    if (content.psychomotorSkills.length === 0) {
      emptyPlaceholder(doc, "No psychomotor skill ratings recorded yet.");
    } else {
      renderSkillTable(doc, content.psychomotorSkills);
    }

    sectionHeader(doc, "Affective/Cognitive Skills");
    if (content.affectiveCognitiveSkills.length === 0) {
      emptyPlaceholder(doc, "No affective/cognitive skill ratings recorded yet.");
    } else {
      renderSkillTable(doc, content.affectiveCognitiveSkills);
    }

    sectionHeader(doc, "Class Teacher's Comment");
    commentBox(doc, content.classTeacherComment);

    sectionHeader(doc, "Principal's Comment");
    commentBox(doc, content.principalComment);

    doc.end();
  });
}

function renderSkillTable(doc: PDFKit.PDFDocument, skills: { name: string; rating: string }[]): void {
  doc.font("Helvetica").fontSize(9.5);
  doc.table({
    columnStyles: [{ width: "*", minWidth: 200 }, { width: 120 }],
    defaultStyle: { padding: 5, border: { bottom: 0.5 }, borderColor: BORDER },
    rowStyles: (i) => (i === 0 ? { backgroundColor: NAVY, textColor: "white" } : i % 2 === 0 ? { backgroundColor: BAND } : {}),
    data: [headerRow(["Skill", "Rating"]), ...skills.map((skill) => [skill.name, { text: skill.rating, align: "center" as const }])],
  });
  doc.moveDown(0.6);
}
