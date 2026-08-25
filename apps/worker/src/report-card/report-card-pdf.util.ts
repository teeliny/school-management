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
  gender: string | null;
  className: string;
  sessionName: string;
  // Primary guardian's name (falls back to the earliest-linked guardian if
  // none is flagged primary) — null only when the student has no guardian
  // on file at all.
  parentName: string | null;
  // Same "fetch over network, degrade to null on failure" contract as
  // logoBuffer, sourced from User.avatarUrl.
  photoBuffer: Buffer | null;
  // PNG bytes of a QR code encoding this report's verification URL — null
  // only if QR generation itself failed, in which case it's omitted rather
  // than failing the whole report.
  qrCodeBuffer: Buffer | null;
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

// Printed report cards show whole-number scores (Nigerian report-card
// convention — no decimal point anywhere on the printed card); the
// broadsheet (apps/api/src/assessments/broadsheet.ts, apps/web's
// /broadsheet page) is the one place that keeps 2-decimal precision, for
// staff who need the finer-grained number. Rounding only happens here, at
// render time — grades are already computed upstream from the unrounded
// value, so this can't shift a score across a grade boundary.
function formatScore(score: number | null): string {
  return score === null ? "-" : String(Math.round(score));
}

/**
 * Table header row builder — bold font is only typed on a per-cell
 * `CellOptions`, not on `rowStyles`/`defaultStyle` (the installed
 * @types/pdfkit predates pdfkit 0.19's table API), so header cells set it
 * explicitly rather than through the row-level style function.
 */
function headerRow(labels: string[]): { text: string; font: { src: string } }[] {
  return labels.map((text) => ({ text: text.toUpperCase(), font: { src: "Helvetica-Bold" } }));
}

// Logo/photo badge size in the header's top corners — same size for both so
// the two sides read as a matched pair.
const HEADER_BADGE_SIZE = 44;

/**
 * Generic schoolhouse glyph drawn with plain vector primitives (no external
 * asset, no network/data: URI) — stands in for the school crest in the
 * header's top-left corner until a real SchoolProfile.logoUrl is uploaded.
 */
function renderLogoPlaceholder(doc: PDFKit.PDFDocument, x: number, y: number, size: number): void {
  doc.save();
  doc.fillColor(BAND).rect(x, y, size, size).fill();
  doc.lineWidth(1).strokeColor(BORDER).rect(x, y, size, size).stroke();

  const pad = size * 0.2;
  const roofTop = y + pad;
  const bodyTop = y + size * 0.45;
  const bodyBottom = y + size - pad;
  const cx = x + size / 2;

  doc.fillColor(NAVY);
  doc.moveTo(cx, roofTop).lineTo(x + size - pad, bodyTop).lineTo(x + pad, bodyTop).closePath().fill();
  doc.rect(x + pad, bodyTop, size - pad * 2, bodyBottom - bodyTop).fill();

  const doorWidth = size * 0.18;
  doc.fillColor(BAND).rect(cx - doorWidth / 2, bodyBottom - size * 0.3, doorWidth, size * 0.3).fill();

  doc.restore();
}

/**
 * Generic person-silhouette glyph drawn with plain vector primitives — stands
 * in for the student's photo in the header's top-right corner when the
 * student has no avatarUrl on file (or it couldn't be fetched), same
 * degrade-quietly contract as `renderLogoPlaceholder`.
 */
function renderPhotoPlaceholder(doc: PDFKit.PDFDocument, x: number, y: number, size: number): void {
  doc.save();
  doc.fillColor(BAND).rect(x, y, size, size).fill();
  doc.lineWidth(1).strokeColor(BORDER).rect(x, y, size, size).stroke();

  const cx = x + size / 2;
  const headRadius = size * 0.16;
  const headCy = y + size * 0.36;

  doc.fillColor(BORDER);
  doc.circle(cx, headCy, headRadius).fill();

  const shoulderTop = y + size * 0.58;
  const shoulderWidth = size * 0.62;
  const shoulderBottom = y + size - size * 0.12;
  doc
    .moveTo(cx - shoulderWidth / 2, shoulderBottom)
    .quadraticCurveTo(cx - shoulderWidth / 2, shoulderTop, cx, shoulderTop)
    .quadraticCurveTo(cx + shoulderWidth / 2, shoulderTop, cx + shoulderWidth / 2, shoulderBottom)
    .closePath()
    .fill();

  doc.restore();
}

/**
 * Compact "label / value" grid for the student's basic info (Student,
 * Gender, Class, Session, Term, Parent/Guardian) — laid out `columns` per
 * row (3, by default) instead of one field per line, so six fields take two
 * rows instead of six. Row height is driven by whichever cell in the row
 * wraps to the most lines, so a long student name doesn't clip a neighbor.
 */
function renderInfoGrid(doc: PDFKit.PDFDocument, fields: [string, string][], columns = 3): void {
  const left = doc.page.margins.left;
  const width = contentWidth(doc);
  const colWidth = width / columns;
  const cellGutter = 10;

  let rowY = doc.y;
  let rowHeight = 0;

  fields.forEach(([label, value], i) => {
    const col = i % columns;
    if (col === 0 && i !== 0) {
      rowY += rowHeight + 3;
      rowHeight = 0;
    }
    const x = left + col * colWidth;
    doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(7.5).text(label.toUpperCase(), x, rowY, { width: colWidth - cellGutter });
    doc.fillColor("black").font("Helvetica").fontSize(9.5).text(value, x, doc.y, { width: colWidth - cellGutter });
    rowHeight = Math.max(rowHeight, doc.y - rowY);
  });

  doc.x = left;
  doc.y = rowY + rowHeight + 4;
}

/**
 * Shared header (logo/school name+address/generated date/student+term) for
 * both report types, per PRD §3.6. Kept as a plain function taking the doc
 * rather than a class — pdfkit's own API is already a mutable-builder
 * pattern, no need for a second one on top.
 *
 * Layout: the school logo sits top-left and the student photo top-right —
 * mirror images of each other — with the school name/address centered
 * between them. Both badges are placed at an absolute x/y rather than
 * flowed, so neither disturbs the centered text block; the divider rule
 * below is positioned relative to whichever of the three (name/address
 * text, logo, photo) ends up tallest.
 */
function renderHeader(doc: PDFKit.PDFDocument, meta: ReportCardMeta, title: string): void {
  const headerTop = doc.y;
  const left = doc.page.margins.left;
  const width = contentWidth(doc);
  const badge = HEADER_BADGE_SIZE;

  if (meta.logoBuffer) {
    try {
      doc.image(meta.logoBuffer, left, headerTop, { fit: [badge, badge] });
    } catch {
      // Malformed/unsupported image bytes — fall back to the placeholder
      // rather than leaving the corner blank.
      renderLogoPlaceholder(doc, left, headerTop, badge);
    }
  } else {
    renderLogoPlaceholder(doc, left, headerTop, badge);
  }

  const photoX = left + width - badge;
  if (meta.photoBuffer) {
    try {
      doc.image(meta.photoBuffer, photoX, headerTop, { fit: [badge, badge] });
    } catch {
      // Malformed/unsupported image bytes — fall back to the placeholder
      // rather than leaving the corner blank.
      renderPhotoPlaceholder(doc, photoX, headerTop, badge);
    }
  } else {
    renderPhotoPlaceholder(doc, photoX, headerTop, badge);
  }
  const photoBottom = headerTop + badge;

  const textGutter = badge + 12;
  const textX = left + textGutter;
  const textWidth = width - textGutter * 2;
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(14).text(meta.schoolName, textX, headerTop, { width: textWidth, align: "center" });
  if (meta.schoolAddress) {
    doc.fillColor(MUTED).font("Helvetica").fontSize(8.5).text(meta.schoolAddress, textX, doc.y + 1, { width: textWidth, align: "center" });
  }

  doc.x = left;
  doc.y = Math.max(doc.y, headerTop + badge, photoBottom) + 8;

  doc.moveTo(left, doc.y).lineTo(left + width, doc.y).lineWidth(1.25).strokeColor(NAVY).stroke();
  doc.moveDown(0.1);
  doc.moveTo(left, doc.y).lineTo(left + width, doc.y).lineWidth(0.5).strokeColor(NAVY).stroke();
  doc.moveDown(0.25);

  doc.fillColor(NAVY).font("Times-Bold").fontSize(14.5).text(title, { align: "center" });
  doc.fillColor(MUTED).font("Helvetica").fontSize(7.5).text(`Generated: ${meta.generatedAt.toDateString()}`, { align: "center" });
  doc.moveDown(0.3);

  renderInfoGrid(doc, [
    ["Student", `${meta.studentName} (${meta.admissionNumber})`],
    ["Gender", meta.gender ?? "-"],
    ["Class", meta.className],
    ["Session", meta.sessionName],
    ["Term", meta.termName],
    ["Parent/Guardian", meta.parentName ?? "-"],
  ]);

  doc.fillColor("black").font("Helvetica").fontSize(10);
}

/**
 * QR code + caption, placed bottom-right of wherever the document's flow
 * currently is (i.e. after everything else has rendered) — an authenticity
 * signature a parent/employer can scan to confirm the report card is
 * genuine (GET /term-report-cards/verify/:token, apps/api). Absent
 * (qrCodeBuffer null) if generation failed upstream; that degrades
 * silently rather than blocking the report, same contract as the logo.
 */
function renderVerificationQr(doc: PDFKit.PDFDocument, qrCodeBuffer: Buffer | null): void {
  if (!qrCodeBuffer) return;
  const size = 42;
  if (doc.y > doc.page.height - doc.page.margins.bottom - size - 10) doc.addPage();

  const left = doc.page.margins.left;
  const width = contentWidth(doc);
  const x = left + width - size;
  const y = doc.y + 3;
  try {
    doc.image(qrCodeBuffer, x, y, { fit: [size, size] });
    doc.fillColor(MUTED).font("Helvetica").fontSize(6.5).text("Scan to verify", x, y + size + 2, { width: size, align: "center" });
  } catch {
    // Malformed QR bytes — skip rather than fail the report.
  }
}

/** Section title with a navy rule beneath it, replacing plain underlined text. */
function sectionHeader(doc: PDFKit.PDFDocument, label: string): void {
  if (doc.y > doc.page.height - doc.page.margins.bottom - 50) doc.addPage();
  doc.moveDown(0.15);
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(10).text(label);
  const left = doc.page.margins.left;
  const width = contentWidth(doc);
  const y = doc.y + 1;
  doc.moveTo(left, y).lineTo(left + width, y).lineWidth(0.75).strokeColor(NAVY).stroke();
  doc.y = y + 4;
  doc.fillColor("black").font("Helvetica").fontSize(9.5);
}

/**
 * One or more labeled stat boxes side by side (Term/Annual Summary +
 * Attendance) — a single row instead of two full sectionHeader+box blocks
 * stacked, so the pairing that used to cost ~2 section heights now costs
 * one. Falls back to a single full-width box when there's only one entry
 * (e.g. no attendance data for this term).
 */
function renderStatBoxRow(doc: PDFKit.PDFDocument, boxes: { label: string; text: string }[]): void {
  if (doc.y > doc.page.height - doc.page.margins.bottom - 50) doc.addPage();
  const left = doc.page.margins.left;
  const gap = 16;
  const colWidth = boxes.length === 1 ? contentWidth(doc) : (contentWidth(doc) - gap * (boxes.length - 1)) / boxes.length;
  const startY = doc.y + 2;
  const boxHeight = 20;
  let maxBottom = startY;

  boxes.forEach((box, i) => {
    const x = left + i * (colWidth + gap);
    const boxY = columnHeader(doc, box.label, x, colWidth, startY);
    doc.save().fillColor(BAND).rect(x, boxY, colWidth, boxHeight).fill().restore();
    doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(8.5).text(box.text, x + 7, boxY + 5.5, { width: colWidth - 14 });
    maxBottom = Math.max(maxBottom, boxY + boxHeight);
  });

  doc.fillColor("black").font("Helvetica").fontSize(9.5);
  doc.x = left;
  doc.y = maxBottom + 5;
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
  const inset = 6;
  doc.font(comment ? "Helvetica" : "Helvetica-Oblique").fontSize(9);
  const textHeight = doc.heightOfString(text, { width: width - inset * 2 });
  const boxHeight = textHeight + inset * 2;
  const boxY = doc.y;
  doc.save().fillColor(BAND).rect(left, boxY, width, boxHeight).fill().restore();
  doc.fillColor(comment ? "black" : MUTED).text(text, left + inset, boxY + inset, { width: width - inset * 2 });
  doc.y = boxY + boxHeight + 4;
  doc.fillColor("black").font("Helvetica").fontSize(9.5);
}

/**
 * Rendering only — the actual content is assembled by
 * buildMidTermSnapshot/report-card-content.util.ts, which is what's
 * unit-tested. Visual layout here isn't meaningfully assertable in a unit
 * test, so it's exercised via the manual smoke check instead.
 */
export function renderMidTermPdf(snapshot: MidTermSnapshot, meta: ReportCardMeta): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40 });
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
      // Every subject row in a mid-term snapshot shares the same maxScore
      // (sourced from a single MID_TERM AssessmentComponent per term/class
      // group, see buildMidTermSnapshot) — safe to show once in the header
      // rather than repeating it on every score cell.
      const scoreHeader = `Score / ${snapshot.subjects[0]!.maxScore}`;
      doc.table({
        columnStyles: [{ width: "*", minWidth: 120 }, { width: 90 }, { width: 60 }, { width: 90 }],
        defaultStyle: { padding: 6, border: { bottom: 0.5 }, borderColor: BORDER },
        rowStyles: (i) => (i === 0 ? { backgroundColor: NAVY, textColor: "white" } : i % 2 === 0 ? { backgroundColor: BAND } : {}),
        data: [
          headerRow(["Subject", scoreHeader, "Grade", "Remark"]),
          ...snapshot.subjects.map((subject) => [
            { text: subject.subjectName, font: { src: "Helvetica-Bold" } },
            { text: formatScore(subject.score), align: "center" as const },
            { text: subject.grade ?? "-", align: "center" as const },
            { text: subject.remark ?? "-" },
          ]),
        ],
      });
      doc.moveDown(0.6);
    }

    const overallPercentage = snapshot.overallPercentage === null ? "-" : `${Math.round(snapshot.overallPercentage)}%`;
    renderStatBoxRow(doc, [
      { label: "Overall", text: `Overall percentage: ${overallPercentage}    Overall grade: ${snapshot.overallGrade ?? "-"}` },
    ]);

    renderVerificationQr(doc, meta.qrCodeBuffer);

    doc.end();
  });
}

/**
 * Full-term report — final SubjectTermResult totals/grades/positions, both
 * skill categories, the two required comments, and (PRD §3.6/§3.7) an
 * attendance line — "days present / school-days-opened" — when the caller
 * supplies it. Rendering only, same "not meaningfully unit-testable" note as
 * renderMidTermPdf; content assembly (buildFullTermContent) is what's
 * tested.
 */
export function renderFullTermPdf(content: FullTermContent, meta: ReportCardMeta): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // Narrower side margins than renderMidTermPdf's uniform 40 — the subject
    // table here carries per-component columns plus prior-term columns
    // (dynamic per term, see below) and, on the annual term, an average
    // column; the extra ~30pt of width is needed to fit all of that in
    // portrait without the table becoming illegibly cramped.
    const doc = new PDFDocument({ margins: { top: 40, bottom: 40, left: 25, right: 25 } });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    renderHeader(doc, meta, "Term Report Card");

    sectionHeader(doc, "Subject Results");
    if (content.subjects.length === 0) {
      emptyPlaceholder(doc, "No subject results recorded yet — scores haven't been finalized for this term.");
    } else {
      doc.font("Helvetica").fontSize(8);

      // Prior-term total columns, one per earlier term in the session
      // (empty on the session's first term, per FullTermSubjectResultInput's
      // own doc comment) — every subject shares the same list of prior
      // term names, sourced from the first subject here. Shown most-recent
      // first (reversed), so they read right-to-left away from this term's
      // own Total column: e.g. on the 3rd term, "Total | 2nd Term | 1st
      // Term". The annual-average column only exists on the session's last
      // term (content.isAnnual), grouped right after the prior-term totals.
      const priorTermNames = content.subjects[0] ? [...content.subjects[0].priorTerms].reverse().map((t) => t.termName) : [];

      doc.table({
        columnStyles: [
          { width: "*", minWidth: 65 },
          // Wide enough for the header ("1ST TEST / 10") to wrap by whole
          // word rather than mid-word — the data cells themselves are just
          // a bare number now, so this column is header-width-driven, not
          // data-width-driven.
          ...content.components.map(() => ({ width: 40 })),
          { width: 40 },
          ...priorTermNames.map(() => ({ width: 34 })),
          ...(content.isAnnual ? [{ width: 34 }] : []),
          { width: 24 },
          { width: 26 },
          { width: 26 },
          { width: 36 },
          { width: "*", minWidth: 55 },
        ],
        defaultStyle: { padding: 3, border: { bottom: 0.5 }, borderColor: BORDER },
        rowStyles: (i) => (i === 0 ? { backgroundColor: NAVY, textColor: "white" } : i % 2 === 0 ? { backgroundColor: BAND } : {}),
        data: [
          headerRow([
            "Subject",
            ...content.components.map((c) => `${c.name} / ${c.maxScore}`),
            `Total / ${content.totalObtainable}`,
            ...priorTermNames,
            ...(content.isAnnual ? ["Avg"] : []),
            "Min",
            "Max",
            "Pos.",
            "Grade",
            "Remark",
          ]),
          ...content.subjects.map((subject) => {
            const priorCells = [...subject.priorTerms].reverse().map((t) => ({
              text: formatScore(t.total),
              align: "center" as const,
              textColor: MUTED,
            }));
            const avgCell = content.isAnnual
              ? [{ text: formatScore(subject.annualAverage), align: "center" as const, font: { src: "Helvetica-Bold" } }]
              : [];
            return [
              { text: subject.subjectName, font: { src: "Helvetica-Bold" } },
              ...subject.components.map((c) => ({
                text: formatScore(c.score),
                align: "center" as const,
                textColor: MUTED,
              })),
              { text: formatScore(subject.totalScore), align: "center" as const },
              ...priorCells,
              ...avgCell,
              { text: formatScore(subject.classLowScore), align: "center" as const },
              { text: formatScore(subject.classHighScore), align: "center" as const },
              { text: subject.position ? String(subject.position) : "-", align: "center" as const },
              { text: subject.grade ?? "-", align: "center" as const },
              { text: subject.remark ?? "-" },
            ];
          }),
        ],
      });
      doc.moveDown(0.3);
    }

    // Term/Annual Summary and Attendance (PRD §3.6/§3.7 — "days present /
    // school-days-opened this term") share one row of stat boxes rather than
    // two stacked sectionHeader+box blocks. Attendance is omitted (rather
    // than shown as "-") when the caller had no attendance data to offer,
    // same degrade-quietly contract as the logo/photo/QR images — the
    // summary box then simply takes the full row width.
    {
      const overallAverage = formatScore(content.overallAverage);
      const summaryLine = [
        `Average: ${overallAverage}`,
        `Grade: ${content.overallGrade ?? "-"}`,
        content.overallRemark ? `Remark: ${content.overallRemark}` : null,
      ]
        .filter(Boolean)
        .join("     ");
      const boxes = [{ label: content.isAnnual ? "Annual Summary" : "Term Summary", text: summaryLine }];
      if (content.attendance) {
        const percentageText = content.attendance.percentage === null ? "-" : `${content.attendance.percentage}%`;
        boxes.push({
          label: "Attendance",
          text: `Days present: ${content.attendance.daysPresent} / ${content.attendance.schoolDaysOpened}     Attendance: ${percentageText}`,
        });
      }
      renderStatBoxRow(doc, boxes);
    }

    renderSkillSectionsSideBySide(doc, content.psychomotorSkills, content.affectiveCognitiveSkills);

    sectionHeader(doc, "Class Teacher's Comment");
    commentBox(doc, content.classTeacherComment);

    sectionHeader(doc, "Principal's Comment");
    commentBox(doc, content.principalComment);

    renderVerificationQr(doc, meta.qrCodeBuffer);

    doc.end();
  });
}

// SkillRatingValue is an UPPER_SNAKE_CASE Prisma enum (e.g. "VERY_GOOD") —
// this is the one place that turns it into report-facing text ("VERY GOOD").
function humanizeRating(rating: string): string {
  return rating.replace(/_/g, " ");
}

/** Small title + rule scoped to one column's x/width, not the full page —
 * the full-width `sectionHeader` can't be reused for a side-by-side layout
 * since it always spans margin-to-margin. Returns the y position right
 * below the rule, where that column's content should start. */
function columnHeader(doc: PDFKit.PDFDocument, label: string, x: number, width: number, y: number): number {
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(9.5).text(label, x, y, { width });
  const ruleY = doc.y + 1;
  doc.moveTo(x, ruleY).lineTo(x + width, ruleY).lineWidth(0.75).strokeColor(NAVY).stroke();
  doc.fillColor("black").font("Helvetica").fontSize(9.5);
  return ruleY + 4;
}

function renderSkillTable(
  doc: PDFKit.PDFDocument,
  skills: { name: string; rating: string }[],
  position: { x: number; y: number },
  width: number,
): void {
  doc.font("Helvetica").fontSize(8);
  doc.table({
    position,
    maxWidth: width,
    columnStyles: [{ width: "*", minWidth: width - 66 }, { width: 66 }],
    defaultStyle: { padding: 2.5, border: { bottom: 0.5 }, borderColor: BORDER },
    rowStyles: (i) => (i === 0 ? { backgroundColor: NAVY, textColor: "white" } : i % 2 === 0 ? { backgroundColor: BAND } : {}),
    data: [
      headerRow(["Skill", "Rating"]),
      ...skills.map((skill) => [skill.name, { text: humanizeRating(skill.rating), align: "center" as const }]),
    ],
  });
}

/**
 * Psychomotor and Affective/Cognitive skills side by side (two columns)
 * rather than stacked — both categories together are short enough that
 * stacking them was pushing the report past a single page for no reason.
 * Each column gets its own scoped title; a shared page-break check runs
 * once up front since both columns need to land on the same page together.
 */
function renderSkillSectionsSideBySide(
  doc: PDFKit.PDFDocument,
  psychomotorSkills: { name: string; rating: string }[],
  affectiveCognitiveSkills: { name: string; rating: string }[],
): void {
  if (doc.y > doc.page.height - doc.page.margins.bottom - 130) doc.addPage();

  const left = doc.page.margins.left;
  const gap = 16;
  const colWidth = (contentWidth(doc) - gap) / 2;
  const rightX = left + colWidth + gap;
  const startY = doc.y + 3;

  const psychTableY = columnHeader(doc, "Psychomotor Skills", left, colWidth, startY);
  const affTableY = columnHeader(doc, "Affective/Cognitive Skills", rightX, colWidth, startY);
  const tableY = Math.max(psychTableY, affTableY);

  if (psychomotorSkills.length === 0) {
    doc.fillColor(MUTED).font("Helvetica-Oblique").fontSize(9).text("No ratings recorded yet.", left, tableY, { width: colWidth });
  } else {
    renderSkillTable(doc, psychomotorSkills, { x: left, y: tableY }, colWidth);
  }
  const afterPsychY = doc.y;

  if (affectiveCognitiveSkills.length === 0) {
    doc
      .fillColor(MUTED)
      .font("Helvetica-Oblique")
      .fontSize(9)
      .text("No ratings recorded yet.", rightX, tableY, { width: colWidth });
  } else {
    renderSkillTable(doc, affectiveCognitiveSkills, { x: rightX, y: tableY }, colWidth);
  }
  const afterAffY = doc.y;

  doc.fillColor("black").font("Helvetica").fontSize(10);
  doc.x = left;
  doc.y = Math.max(afterPsychY, afterAffY) + 10;
}
