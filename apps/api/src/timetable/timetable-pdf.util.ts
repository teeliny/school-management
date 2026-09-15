import PDFDocument from "pdfkit";
import type { DayOfWeek } from "@prisma/client";
import { DAYS_OF_WEEK } from "@school/types";

// Same brand colors as apps/worker's report-card-pdf.util.ts, for a
// consistent look between every PDF this system produces.
const NAVY = "#001B3A";
const MUTED = "#6b7280";
const BORDER = "#d8dce3";

const DAY_LABELS: Record<DayOfWeek, string> = {
  MONDAY: "Monday",
  TUESDAY: "Tuesday",
  WEDNESDAY: "Wednesday",
  THURSDAY: "Thursday",
  FRIDAY: "Friday",
};

export interface TimetablePdfSlot {
  dayOfWeek: DayOfWeek;
  startTime: string;
  endTime: string;
  // Rendered top-to-bottom inside the slot's cell — [subject, teacherOrClassArm]
  // for a class view, [subject, classArm] for a per-teacher view.
  lines: string[];
}

interface Column {
  startTime: string;
  endTime: string;
}

function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number) as [number, number];
  return h * 60 + m;
}

/** Every distinct (startTime, endTime) pair actually used by `rows`, sorted chronologically — this school's real period grid, with no SchedulingConstraint lookup needed. */
function buildColumns(rows: TimetablePdfSlot[]): Column[] {
  const seen = new Map<string, Column>();
  for (const row of rows) {
    const key = `${row.startTime}-${row.endTime}`;
    if (!seen.has(key)) seen.set(key, { startTime: row.startTime, endTime: row.endTime });
  }
  return [...seen.values()].sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));
}

function sameColumns(a: Column[], b: Column[]): boolean {
  return a.length === b.length && a.every((col, i) => col.startTime === b[i]!.startTime && col.endTime === b[i]!.endTime);
}

/**
 * Faint, diagonal, full-page school-name watermark — drawn first (so every
 * later element paints over it) and re-drawn on every subsequent page via
 * the "pageAdded" event, since a multi-page document (not applicable to this
 * single-page timetable today, but shared by convention with the other two
 * PDF generators) would otherwise only watermark its first page. Same
 * watermark treatment on every PDF this system produces — see
 * apps/worker/report-card-pdf.util.ts and receipt-pdf.util.ts's own copies
 * of this helper (duplicated, not shared, same as this file's own color
 * constants above — apps/api and apps/worker don't share a PDF-rendering
 * module).
 */
function drawWatermark(doc: PDFKit.PDFDocument, schoolName: string): void {
  doc.save();
  doc.rotate(-45, { origin: [doc.page.width / 2, doc.page.height / 2] });
  doc
    .font("Helvetica-Bold")
    .fontSize(54)
    .fillColor(NAVY)
    .opacity(0.06)
    .text(schoolName.toUpperCase(), 0, doc.page.height / 2 - 30, { width: doc.page.width, align: "center" });
  doc.opacity(1);
  doc.restore();
  // save()/restore() only cover the PDF graphics state (transform, color,
  // line style) — pdfkit's own text-flow cursor (doc.x/doc.y) lives outside
  // that stack, so the watermark's rotated-coordinate text() call left it at
  // whatever nonsensical position that rotated draw computed. Every caller
  // draws its own content starting from a plain top-of-page flow right
  // after this, so reset explicitly rather than let that leak through as a
  // huge, seemingly-random blank gap before the real content.
  doc.x = doc.page.margins.left;
  doc.y = doc.page.margins.top;
}


/**
 * Renders a Day x Period grid as a single A4-landscape page, filling the
 * full page — mirrors the on-screen TimetableGrid's own design (explicit
 * period-range column headers; Friday gets its own heading row, inserted
 * right below Thursday's, whenever its periods actually run different
 * times/durations than the rest of the week) rather than a continuous
 * proportional timeline. Column boundaries come from the real distinct
 * (startTime, endTime) pairs already present in `slots`, not a
 * SchedulingConstraint/PeriodStructure lookup — this still needs no such
 * lookup, just derives "the period grid" from the data itself instead of
 * from a school's period-length configuration. Deliberately just the grid —
 * no subject/period-count summary (that's an on-screen-only aid, per the
 * request this was built for).
 */
export function renderTimetablePdf(
  title: string,
  subtitle: string,
  slots: TimetablePdfSlot[],
  schoolName: string,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 24 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.on("pageAdded", () => drawWatermark(doc, schoolName));
    drawWatermark(doc, schoolName);

    doc.font("Helvetica-Bold").fontSize(16).fillColor(NAVY).text(title.toUpperCase(), { align: "center" });
    doc.font("Helvetica").fontSize(10).fillColor(MUTED).text(subtitle.toUpperCase(), { align: "center" });
    doc.moveDown(0.6);

    const daysPresent = DAYS_OF_WEEK.filter((day) => slots.some((s) => s.dayOfWeek === day));
    const days = daysPresent.length > 0 ? daysPresent : DAYS_OF_WEEK;

    if (slots.length === 0) {
      doc.font("Helvetica").fontSize(11).fillColor(MUTED).text("NO APPROVED PERIODS YET.", { align: "center" });
      doc.end();
      return;
    }

    const weekdaySlots = slots.filter((s) => s.dayOfWeek !== "FRIDAY");
    const fridaySlots = slots.filter((s) => s.dayOfWeek === "FRIDAY");
    const columns = buildColumns(weekdaySlots.length > 0 ? weekdaySlots : slots);
    const fridayColumns = buildColumns(fridaySlots);
    // Only worth a second heading row when Friday's grid actually differs —
    // a school running the same period times every day shouldn't get a
    // redundant duplicate header.
    const fridayNeedsOwnRow = fridayColumns.length > 0 && !sameColumns(fridayColumns, columns.slice(0, fridayColumns.length));
    const columnCount = Math.max(columns.length, fridayColumns.length, 1);

    const dayLabelWidth = 76;
    const contentLeft = doc.page.margins.left;
    const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const gridLeft = contentLeft + dayLabelWidth;
    const gridWidth = contentWidth - dayLabelWidth;
    const columnWidth = gridWidth / columnCount;

    const headerRowHeight = 18;
    const headerRowCount = 1 + (fridayNeedsOwnRow ? 1 : 0);
    const gridTop = doc.y;
    const gridBottom = doc.page.height - doc.page.margins.bottom;
    const dayRowHeight = (gridBottom - gridTop - headerRowHeight * headerRowCount) / days.length;

    function drawColumnHeaderRow(y: number, cols: Column[], label: string | null): void {
      // No solid background fill here — an opaque rect over the header
      // strip would blot out the watermark underneath it, same reasoning
      // as the per-slot cells below.
      doc.rect(gridLeft, y, gridWidth, headerRowHeight).strokeColor(BORDER).lineWidth(0.75).stroke();
      if (label) {
        doc
          .font("Helvetica-Bold")
          .fontSize(8)
          .fillColor(NAVY)
          .text(label.toUpperCase(), contentLeft, y + headerRowHeight / 2 - 4, { width: dayLabelWidth - 8 });
      }
      for (const [i, col] of cols.entries()) {
        const x = gridLeft + i * columnWidth;
        doc
          .font("Helvetica-Bold")
          .fontSize(7.5)
          .fillColor(MUTED)
          .text(`${col.startTime}–${col.endTime}`, x + 2, y + headerRowHeight / 2 - 4, { width: columnWidth - 4, align: "center" });
      }
    }

    // Shared Mon-Thu (or every day, if Friday matches) period-range header.
    drawColumnHeaderRow(gridTop, columns, null);
    let y = gridTop + headerRowHeight;

    doc.rect(gridLeft, y, gridWidth, gridBottom - y).strokeColor(BORDER).lineWidth(0.75).stroke();

    for (const day of days) {
      if (day === "FRIDAY" && fridayNeedsOwnRow) {
        drawColumnHeaderRow(y, fridayColumns, "Fri times");
        y += headerRowHeight;
      }

      if (y > gridTop + headerRowHeight) {
        doc
          .moveTo(gridLeft, y)
          .lineTo(gridLeft + gridWidth, y)
          .strokeColor(BORDER)
          .lineWidth(0.75)
          .stroke();
      }

      doc
        .font("Helvetica-Bold")
        .fontSize(9.5)
        .fillColor(NAVY)
        .text(DAY_LABELS[day].toUpperCase(), contentLeft, y + dayRowHeight / 2 - 5, { width: dayLabelWidth - 8 });

      const dayColumns = day === "FRIDAY" ? fridayColumns : columns;
      const daySlots = slots.filter((s) => s.dayOfWeek === day);

      for (const slot of daySlots) {
        const columnIndex = dayColumns.findIndex((c) => c.startTime === slot.startTime && c.endTime === slot.endTime);
        if (columnIndex === -1) continue; // shouldn't happen — dayColumns is built from these same slots
        const x = gridLeft + columnIndex * columnWidth;
        const cellPad = 2;

        // No solid background fill — an opaque rect here would blot out
        // the watermark underneath it, and a filled cell for nearly every
        // period on the page is most of the page, which is exactly the
        // "watermark is covered for most part" problem this replaces.
        // Border only, same as the header strip above.
        doc
          .rect(x + cellPad, y + cellPad, columnWidth - cellPad * 2, dayRowHeight - cellPad * 2)
          .strokeColor(BORDER)
          .lineWidth(0.5)
          .stroke();

        // The subject name is shown in FULL, never truncated — it wraps
        // onto as many lines as it needs. The teacher/class-arm name below
        // it is positioned dynamically, measured off the subject's own
        // actual rendered height (doc.heightOfString), rather than a fixed
        // per-line offset — a fixed offset is what previously caused the
        // second line to overlap the first whenever a long subject name
        // (e.g. "Christian Religious Studies") wrapped onto more than one
        // visual line.
        const textX = x + cellPad + 3;
        const textWidth = Math.max(4, columnWidth - cellPad * 2 - 6);
        const cellInnerBottom = y + dayRowHeight - cellPad - 2;
        const [subjectText, secondLineText] = slot.lines;

        doc.font("Helvetica-Bold").fontSize(7.5);
        const subjectUpper = (subjectText ?? "").toUpperCase();
        const subjectTop = y + cellPad + 3;
        const subjectHeight = doc.heightOfString(subjectUpper, { width: textWidth });
        doc.fillColor(NAVY).text(subjectUpper, textX, subjectTop, { width: textWidth });

        if (secondLineText) {
          const secondLineTop = subjectTop + subjectHeight + 2;
          if (secondLineTop < cellInnerBottom) {
            doc
              .font("Helvetica")
              .fontSize(6.5)
              .fillColor(MUTED)
              .text(secondLineText.toUpperCase(), textX, secondLineTop, { width: textWidth });
          }
        }
      }

      y += dayRowHeight;
    }

    doc.end();
  });
}
