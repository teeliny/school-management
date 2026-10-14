import PDFDocument from "pdfkit";
import type { ExamColumn } from "@school/types";
import { drawWatermark } from "../timetable/timetable-pdf.util";

// Same palette as timetable-pdf.util.ts / the worker's report-card PDF.
const NAVY = "#001B3A";
const MUTED = "#6b7280";
const BORDER = "#d8dce3";

/** "Monday, 12 October 2026" — exam dates are stored as UTC midnight. */
export function formatPdfExamDate(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function collect(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}

function drawTitle(doc: PDFKit.PDFDocument, title: string, subtitle: string) {
  doc.font("Helvetica-Bold").fontSize(16).fillColor(NAVY).text(title.toUpperCase(), { align: "center" });
  doc.font("Helvetica").fontSize(10).fillColor(MUTED).text(subtitle.toUpperCase(), { align: "center" });
  doc.moveDown(0.6);
}

export interface ExamGridPage {
  // Heading above the grid (e.g. the exam date on a whole-sitting page).
  heading?: string;
  rowLabels: string[];
  // Papers per [row][column index] — each entry rendered as one line.
  cells: string[][][];
}

/**
 * Exam timetable as one A4-landscape grid per page: a single class's
 * Date x Slot grid, or (whole sitting) one page per exam date with
 * Class x Slot. Columns come from buildExamColumns (@school/types), the
 * same layout as the on-screen grids, so slot/break columns line up.
 */
export function renderExamTimetablePdf(
  title: string,
  subtitle: string,
  columns: ExamColumn[],
  pages: ExamGridPage[],
  schoolName: string,
): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 24 });
  const done = collect(doc);
  doc.on("pageAdded", () => drawWatermark(doc, schoolName));
  drawWatermark(doc, schoolName);

  if (pages.length === 0 || columns.length === 0) {
    drawTitle(doc, title, subtitle);
    doc.font("Helvetica").fontSize(11).fillColor(MUTED).text("NO APPROVED EXAM TIMETABLE YET.", { align: "center" });
    doc.end();
    return done;
  }

  pages.forEach((page, pageIndex) => {
    if (pageIndex > 0) doc.addPage();
    drawTitle(doc, title, subtitle);
    if (page.heading) {
      doc.font("Helvetica-Bold").fontSize(11).fillColor(NAVY).text(page.heading.toUpperCase(), { align: "left" });
      doc.moveDown(0.3);
    }
    drawGrid(doc, columns, page);
  });

  doc.end();
  return done;
}

function drawGrid(doc: PDFKit.PDFDocument, columns: ExamColumn[], page: ExamGridPage) {
  const labelWidth = 96;
  const left = doc.page.margins.left;
  const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const gridLeft = left + labelWidth;
  const gridWidth = contentWidth - labelWidth;
  // Break columns narrower than paper columns, same as the class timetable PDF.
  const weight = (col: ExamColumn) => (col.kind === "break" ? 0.45 : 1);
  const unit = gridWidth / columns.reduce((sum, col) => sum + weight(col), 0);
  let x = gridLeft;
  const layout = columns.map((col) => {
    const cell = { x, width: weight(col) * unit };
    x += cell.width;
    return cell;
  });

  const headerHeight = 18;
  const top = doc.y;
  const available = doc.page.height - doc.page.margins.bottom - top - headerHeight;
  // Capped so a 4-row grid doesn't stretch into page-tall rows.
  const rowHeight = Math.min(64, available / Math.max(page.rowLabels.length, 1));

  doc.rect(gridLeft, top, gridWidth, headerHeight).strokeColor(BORDER).lineWidth(0.75).stroke();
  columns.forEach((col, i) => {
    const { x: cx, width } = layout[i]!;
    if (col.kind === "break") {
      doc
        .font("Helvetica-Bold")
        .fontSize(5.5)
        .fillColor(MUTED)
        .text(`${col.startTime}\n${col.endTime}`, cx + 1, top + headerHeight / 2 - 6, { width: width - 2, align: "center", lineGap: 0 });
    } else {
      doc
        .font("Helvetica-Bold")
        .fontSize(7.5)
        .fillColor(MUTED)
        .text(`${col.startTime}–${col.endTime}`, cx + 2, top + headerHeight / 2 - 4, { width: width - 4, align: "center" });
    }
  });

  let y = top + headerHeight;
  page.rowLabels.forEach((label, rowIndex) => {
    doc.font("Helvetica-Bold").fontSize(8.5);
    const labelHeight = doc.heightOfString(label.toUpperCase(), { width: labelWidth - 8 });
    doc.fillColor(NAVY).text(label.toUpperCase(), left, y + Math.max(2, (rowHeight - labelHeight) / 2), { width: labelWidth - 8 });

    columns.forEach((col, i) => {
      const { x: cx, width } = layout[i]!;
      const pad = 2;
      if (col.kind === "break") {
        doc.dash(1, { space: 1.5 });
        doc.rect(cx + pad, y + pad, width - pad * 2, rowHeight - pad * 2).strokeColor(BORDER).lineWidth(0.5).stroke();
        doc.undash();
        return;
      }
      doc.rect(cx + pad, y + pad, width - pad * 2, rowHeight - pad * 2).strokeColor(BORDER).lineWidth(0.5).stroke();
      const lines = page.cells[rowIndex]?.[i] ?? [];
      if (lines.length === 0) return;
      const text = lines.map((l) => l.toUpperCase()).join("\n");
      const textWidth = Math.max(4, width - pad * 2 - 6);
      doc.font("Helvetica-Bold").fontSize(7);
      const height = doc.heightOfString(text, { width: textWidth });
      doc
        .fillColor(NAVY)
        .text(text, cx + pad + 3, y + pad + Math.max(1, (rowHeight - pad * 2 - height) / 2), { width: textWidth, height: rowHeight - pad * 2 });
    });
    y += rowHeight;
  });
  doc.x = doc.page.margins.left;
}

export interface InvigilationPdfDay {
  date: string; // YYYY-MM-DD
  // Mixed-hall duty — names only, no classes.
  hall: string[];
  // Per-class duty — one row per class arm sitting that day.
  classes: { classArm: string; lead: string; assistant: string | null }[];
}

/**
 * Invigilation roster as a flowing A4-portrait document grouped per exam
 * day — same shape as the on-screen roster: hall invigilators for a mixed
 * hall, a Class / Invigilator table for per-class sittings.
 */
export function renderInvigilationRosterPdf(
  title: string,
  subtitle: string,
  days: InvigilationPdfDay[],
  schoolName: string,
): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 36 });
  const done = collect(doc);
  doc.on("pageAdded", () => drawWatermark(doc, schoolName));
  drawWatermark(doc, schoolName);
  drawTitle(doc, title, subtitle);

  if (days.length === 0) {
    doc.font("Helvetica").fontSize(11).fillColor(MUTED).text("NO APPROVED INVIGILATION ROSTER YET.", { align: "center" });
    doc.end();
    return done;
  }

  const left = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const bottom = () => doc.page.height - doc.page.margins.bottom;
  const rowHeight = 18;
  const ensureSpace = (needed: number) => {
    if (doc.y + needed > bottom()) doc.addPage();
  };
  const hasAssistants = days.some((d) => d.classes.some((c) => c.assistant));
  const colWidths = hasAssistants ? [width * 0.34, width * 0.33, width * 0.33] : [width * 0.4, width * 0.6];
  const headers = hasAssistants ? ["Class", "Lead", "Assistant"] : ["Class", "Invigilator"];

  const drawRow = (cells: string[], header: boolean) => {
    ensureSpace(rowHeight);
    const y = doc.y;
    let x = left;
    cells.forEach((cell, i) => {
      doc
        .font(header ? "Helvetica-Bold" : i === 0 ? "Helvetica-Bold" : "Helvetica")
        .fontSize(header ? 7.5 : 9)
        .fillColor(header ? MUTED : NAVY)
        .text(header ? cell.toUpperCase() : cell, x + 4, y + 5, { width: colWidths[i]! - 8, lineBreak: false });
      x += colWidths[i]!;
    });
    doc
      .moveTo(left, y + rowHeight)
      .lineTo(left + width, y + rowHeight)
      .strokeColor(BORDER)
      .lineWidth(0.5)
      .stroke();
    doc.x = left;
    doc.y = y + rowHeight;
  };

  for (const day of days) {
    // Keep a day's heading with at least its first couple of lines.
    ensureSpace(24 + rowHeight * 3);
    doc.moveDown(0.4);
    const headingY = doc.y;
    doc.font("Helvetica-Bold").fontSize(11.5).fillColor(NAVY).text(formatPdfExamDate(day.date).toUpperCase(), left, headingY, { width });
    doc
      .moveTo(left, doc.y + 2)
      .lineTo(left + width, doc.y + 2)
      .strokeColor(NAVY)
      .lineWidth(0.75)
      .stroke();
    doc.y += 6;

    if (day.hall.length > 0) {
      doc.font("Helvetica").fontSize(8).fillColor(MUTED).text("EXAM HALL INVIGILATORS", left, doc.y, { width });
      doc.moveDown(0.2);
      day.hall.forEach((name, i) => {
        ensureSpace(14);
        doc.font("Helvetica").fontSize(9.5).fillColor(NAVY).text(`${i + 1}.  ${name}`, left + 4, doc.y, { width: width - 4 });
      });
      doc.moveDown(0.4);
    }

    if (day.classes.length > 0) {
      drawRow(headers, true);
      for (const row of day.classes) {
        drawRow(hasAssistants ? [row.classArm, row.lead, row.assistant ?? "—"] : [row.classArm, row.lead], false);
      }
      doc.moveDown(0.4);
    }
  }

  doc.end();
  return done;
}

/** "JSS 1A" -> "jss-1a" for a Content-Disposition filename. */
export function pdfFileSlug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "download";
}
