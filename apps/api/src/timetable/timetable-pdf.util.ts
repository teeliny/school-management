import PDFDocument from "pdfkit";
import type { DayOfWeek } from "@prisma/client";
import { DAYS_OF_WEEK } from "@school/types";

// Same brand colors as apps/worker's report-card-pdf.util.ts, for a
// consistent look between every PDF this system produces.
const NAVY = "#001B3A";
const MUTED = "#6b7280";
const BORDER = "#d8dce3";
// Distinct from NAVY specifically so a fixed whole-school activity block
// (Sports, Extra-Curricular, Fellowship, ...) never reads as just another
// academic subject at a glance — paired with an italic font and a dashed
// cell border (see the per-slot rendering below) rather than a solid one.
const ACTIVITY_COLOR = "#92400e";

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
  // A fixed, non-subject, whole-school block (Sports, Extra-Curricular,
  // Fellowship, ...) — sourced from CLASS_TIMETABLE's SPECIAL_PERIODS/
  // FRIDAY_TRAILING_ACTIVITY_* SchedulingConstraint entries rather than a
  // real TimetableSlot row, since one never gets created for these (the
  // whole point is blocking the AI solver from scheduling a real subject
  // there). Styled distinctly below so it's never mistaken for one.
  isActivity?: boolean;
  // The gap between two periods (long break / short break) — derived from
  // the group's PeriodStructure (TimetableSlotService.buildBreakSlots), never
  // a real TimetableSlot. Only needs to exist once per column (tagged MONDAY
  // for weekdays, FRIDAY for Friday's own), since a break column renders
  // "BREAK" in every day's cell regardless of which day's slot created it.
  isBreak?: boolean;
}

interface Column {
  startTime: string;
  endTime: string;
  isBreak: boolean;
}

// A break column is drawn at this fraction of a period column's width, same
// idea as the on-screen grid's narrower Break column.
const BREAK_COLUMN_WEIGHT = 0.45;

function columnWeight(col: Column): number {
  return col.isBreak ? BREAK_COLUMN_WEIGHT : 1;
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
    const existing = seen.get(key);
    if (!existing) seen.set(key, { startTime: row.startTime, endTime: row.endTime, isBreak: row.isBreak === true });
    else if (row.isBreak) existing.isBreak = true;
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

    // Every weekday is shown even when a whole day has zero periods — a
    // teacher with a completely free Wednesday should still see an empty
    // WEDNESDAY row with its normal bordered periods (uniform display),
    // rather than that row silently vanishing from the grid.
    const days = DAYS_OF_WEEK;

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

    const dayLabelWidth = 76;
    const contentLeft = doc.page.margins.left;
    const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const gridLeft = contentLeft + dayLabelWidth;
    const gridWidth = contentWidth - dayLabelWidth;
    // Columns are laid out left-to-right by weight (break columns narrower
    // than period columns) against one shared unit width, so a Friday row
    // with fewer columns stops short rather than stretching its cells wider
    // than every other day's.
    const totalWeight = (cols: Column[]): number => cols.reduce((sum, col) => sum + columnWeight(col), 0);
    const unitWidth = gridWidth / Math.max(totalWeight(columns), totalWeight(fridayColumns), 1);
    function layoutColumns(cols: Column[]): { x: number; width: number }[] {
      let x = gridLeft;
      return cols.map((col) => {
        const width = columnWeight(col) * unitWidth;
        const cell = { x, width };
        x += width;
        return cell;
      });
    }
    const columnLayout = layoutColumns(columns);
    const fridayColumnLayout = layoutColumns(fridayColumns);

    const headerRowHeight = 18;
    const headerRowCount = 1 + (fridayNeedsOwnRow ? 1 : 0);
    const gridTop = doc.y;
    // The grid no longer stretches to fill the entire remaining page —
    // on a typical timetable (a couple of short lines of text per cell)
    // that left every row awkwardly tall, with content stranded near the
    // top of a mostly-empty box. 75% of the available height keeps rows a
    // sensible, consistent size regardless of how few periods there are.
    const GRID_HEIGHT_FRACTION = 0.75;
    const availableHeight = doc.page.height - doc.page.margins.bottom - gridTop;
    const gridBottom = gridTop + availableHeight * GRID_HEIGHT_FRACTION;
    const dayRowHeight = (gridBottom - gridTop - headerRowHeight * headerRowCount) / days.length;

    function drawColumnHeaderRow(y: number, cols: Column[], layout: { x: number; width: number }[], label: string | null): void {
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
        const { x, width } = layout[i]!;
        // A break column is too narrow for "10:40–11:10" on one line, so its
        // start/end are stacked in a smaller font instead of letting pdfkit
        // wrap it wherever it likes (which spilled onto the header border).
        if (col.isBreak) {
          doc
            .font("Helvetica-Bold")
            .fontSize(5.5)
            .fillColor(MUTED)
            .text(`${col.startTime}\n${col.endTime}`, x + 1, y + headerRowHeight / 2 - 6, { width: width - 2, align: "center", lineGap: 0 });
          continue;
        }
        doc
          .font("Helvetica-Bold")
          .fontSize(7.5)
          .fillColor(MUTED)
          .text(`${col.startTime}–${col.endTime}`, x + 2, y + headerRowHeight / 2 - 4, { width: width - 4, align: "center" });
      }
    }

    // Shared Mon-Thu (or every day, if Friday matches) period-range header.
    drawColumnHeaderRow(gridTop, columns, columnLayout, null);
    let y = gridTop + headerRowHeight;

    doc.rect(gridLeft, y, gridWidth, gridBottom - y).strokeColor(BORDER).lineWidth(0.75).stroke();

    for (const day of days) {
      if (day === "FRIDAY" && fridayNeedsOwnRow) {
        drawColumnHeaderRow(y, fridayColumns, fridayColumnLayout, "Fri times");
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

      // Falls back to the shared Mon-Thu columns whenever this day has no
      // slots of its own to derive a column set from — e.g. a teacher with
      // zero Friday periods would otherwise get 0 fridayColumns and render
      // that whole row with no cells at all, rather than the empty-but-
      // bordered periods every other day gets.
      const useFridayColumns = day === "FRIDAY" && fridayColumns.length > 0;
      const dayColumns = useFridayColumns ? fridayColumns : columns;
      const dayLayout = useFridayColumns ? fridayColumnLayout : columnLayout;
      const daySlots = slots.filter((s) => s.dayOfWeek === day);

      // Every period column gets its own bordered cell, occupied or not —
      // previously only columns with an actual slot were drawn, so a free
      // period looked like a gap in the grid rather than an empty period.
      for (const [columnIndex, col] of dayColumns.entries()) {
        const { x, width: columnWidth } = dayLayout[columnIndex]!;
        const cellPad = 2;

        // Break columns: a dotted cell with "BREAK" written vertically (the
        // column is too narrow for it horizontally), on every day's row.
        if (col.isBreak) {
          doc.dash(1, { space: 1.5 });
          doc
            .rect(x + cellPad, y + cellPad, columnWidth - cellPad * 2, dayRowHeight - cellPad * 2)
            .strokeColor(BORDER)
            .lineWidth(0.5)
            .stroke();
          doc.undash();
          const centerX = x + columnWidth / 2;
          const centerY = y + dayRowHeight / 2;
          doc.save();
          doc.rotate(-90, { origin: [centerX, centerY] });
          doc
            .font("Helvetica-Bold")
            .fontSize(7.5)
            .fillColor(MUTED)
            .text("BREAK", centerX - 30, centerY - 3.5, { width: 60, align: "center", characterSpacing: 1.5, lineBreak: false });
          doc.restore();
          continue;
        }

        // No solid background fill — an opaque rect here would blot out
        // the watermark underneath it, and a filled cell for nearly every
        // period on the page is most of the page, which is exactly the
        // "watermark is covered for most part" problem this replaces.
        // Border only, same as the header strip above.
        const slot = daySlots.find((s) => s.startTime === col.startTime && s.endTime === col.endTime);

        // A fixed activity block (Sports, Fellowship, ...) gets a dashed
        // border instead of solid, so it reads as "not a real class" even
        // before the text is legible — same reasoning as its distinct
        // color/italic text below.
        if (slot?.isActivity) doc.dash(2.5, { space: 1.5 });
        doc
          .rect(x + cellPad, y + cellPad, columnWidth - cellPad * 2, dayRowHeight - cellPad * 2)
          .strokeColor(BORDER)
          .lineWidth(0.5)
          .stroke();
        if (slot?.isActivity) doc.undash();

        // No slot, or a filler placeholder with nothing to show (used to
        // force an otherwise-empty configured period to still get its own
        // column/border — see TimetableSlotService.buildFullGridFillerSlots)
        // — either way, the border above is all this cell gets.
        if (!slot || !slot.lines[0]) continue;

        // The subject name is shown in FULL, never truncated — it wraps
        // onto as many lines as it needs. Both lines are measured up front
        // (rather than drawn as soon as they're computed) so their combined
        // height can be centered inside the cell, instead of the fixed
        // "start 3pt from the top" anchor that left short content stranded
        // near the top of a much taller cell.
        const textX = x + cellPad + 3;
        const textWidth = Math.max(4, columnWidth - cellPad * 2 - 6);
        const cellInnerTop = y + cellPad;
        const cellInnerHeight = dayRowHeight - cellPad * 2;
        const [subjectText, secondLineText] = slot.lines;

        const subjectFont = slot.isActivity ? "Helvetica-BoldOblique" : "Helvetica-Bold";
        const subjectColor = slot.isActivity ? ACTIVITY_COLOR : NAVY;
        doc.font(subjectFont).fontSize(7.5);
        const subjectUpper = (subjectText ?? "").toUpperCase();
        const subjectHeight = doc.heightOfString(subjectUpper, { width: textWidth });

        const secondLineUpper = secondLineText ? secondLineText.toUpperCase() : null;
        let secondLineHeight = 0;
        if (secondLineUpper) {
          doc.font(slot.isActivity ? "Helvetica-Oblique" : "Helvetica").fontSize(6.5);
          secondLineHeight = doc.heightOfString(secondLineUpper, { width: textWidth });
        }
        const lineGap = secondLineUpper ? 2 : 0;
        const totalContentHeight = subjectHeight + lineGap + secondLineHeight;
        const contentTop = cellInnerTop + Math.max(0, (cellInnerHeight - totalContentHeight) / 2);

        doc.font(subjectFont).fontSize(7.5).fillColor(subjectColor).text(subjectUpper, textX, contentTop, { width: textWidth });

        if (secondLineUpper) {
          doc
            .font(slot.isActivity ? "Helvetica-Oblique" : "Helvetica")
            .fontSize(6.5)
            .fillColor(MUTED)
            .text(secondLineUpper, textX, contentTop + subjectHeight + lineGap, { width: textWidth });
        }
      }

      y += dayRowHeight;
    }

    doc.end();
  });
}
