import PDFDocument from "pdfkit";
import type { SchoolContactInfo } from "./receipt-bulk-pdf.util";

// Same brand colors as receipt-bulk-pdf.util.ts/timetable-pdf.util.ts —
// deliberately duplicated per file, see the comment there.
const NAVY = "#001B3A";
const MUTED = "#6b7280";
const BORDER = "#d8dce3";
const ZEBRA = "#f4f5f7";

export interface OutstandingBalancePdfRow {
  studentName: string;
  admissionNumber: string;
  className: string | null;
  amount: number;
  parentPhone: string | null;
}

// "NGN " prefix instead of ₦ — pdfkit's base fonts have no glyph for it,
// see receipt-bulk-pdf.util.ts's formatNaira comment.
const NAIRA_AMOUNT = new Intl.NumberFormat("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function formatNaira(amount: number): string {
  return `NGN ${NAIRA_AMOUNT.format(amount)}`;
}

const PAGE_MARGIN = 36;
const ROW_PADDING = 5;
const FONT_SIZE = 9.5;

/**
 * A4 portrait list of overdue students (S/N, student, class, overdue amount,
 * parent phone) — rows arrive already filtered and sorted by
 * OutstandingBalanceService.buildExportPdf; this only lays them out,
 * repeating the column header on every page and closing with a grand total.
 */
export function renderOutstandingBalancesPdf(
  rows: OutstandingBalancePdfRow[],
  school: SchoolContactInfo,
  subtitle: string,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", layout: "portrait", margin: PAGE_MARGIN });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const contentWidth = doc.page.width - PAGE_MARGIN * 2;
    const pageBottom = doc.page.height - PAGE_MARGIN;
    const columns = [
      { label: "S/N", width: 32, align: "left" as const },
      { label: "Student", width: 0, align: "left" as const },
      { label: "Class", width: 95, align: "left" as const },
      { label: "Amount", width: 100, align: "right" as const },
      { label: "Parent Phone", width: 95, align: "left" as const },
    ];
    columns[1]!.width = contentWidth - columns.reduce((sum, col) => sum + col.width, 0);

    function drawRow(cells: string[], y: number, opts: { bold?: boolean; color?: string; fill?: string } = {}): number {
      doc.font(opts.bold ? "Helvetica-Bold" : "Helvetica").fontSize(FONT_SIZE);
      const height =
        Math.max(...cells.map((cell, i) => doc.heightOfString(cell, { width: columns[i]!.width - ROW_PADDING * 2 }))) + ROW_PADDING * 2;
      if (opts.fill) doc.rect(PAGE_MARGIN, y, contentWidth, height).fill(opts.fill);
      let x = PAGE_MARGIN;
      cells.forEach((cell, i) => {
        const col = columns[i]!;
        doc
          .fillColor(opts.color ?? "black")
          .text(cell, x + ROW_PADDING, y + ROW_PADDING, { width: col.width - ROW_PADDING * 2, align: col.align });
        x += col.width;
      });
      doc.moveTo(PAGE_MARGIN, y + height).lineTo(PAGE_MARGIN + contentWidth, y + height).strokeColor(BORDER).lineWidth(0.5).stroke();
      return y + height;
    }

    function measureRow(cells: string[], bold = false): number {
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(FONT_SIZE);
      return Math.max(...cells.map((cell, i) => doc.heightOfString(cell, { width: columns[i]!.width - ROW_PADDING * 2 }))) + ROW_PADDING * 2;
    }

    const drawHeader = (y: number) =>
      drawRow(
        columns.map((col) => col.label.toUpperCase()),
        y,
        { bold: true, color: NAVY },
      );

    // Letterhead — first page only.
    doc.font("Helvetica-Bold").fontSize(15).fillColor(NAVY).text(school.name.toUpperCase(), PAGE_MARGIN, PAGE_MARGIN, { width: contentWidth });
    if (school.address) doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(school.address, { width: contentWidth });
    const contactLine = [school.contactEmail, school.contactPhone].filter(Boolean).join("   ·   ");
    if (contactLine) doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(contactLine, { width: contentWidth });
    doc.moveDown(0.6);
    doc.font("Helvetica-Bold").fontSize(12.5).fillColor(NAVY).text("OUTSTANDING BALANCES", { width: contentWidth });
    doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(subtitle, { width: contentWidth });
    let y = doc.y + 8;

    y = drawHeader(y);
    rows.forEach((row, index) => {
      const cells = [
        String(index + 1),
        `${row.studentName} (${row.admissionNumber})`,
        row.className ?? "—",
        formatNaira(row.amount),
        row.parentPhone ?? "—",
      ];
      if (y + measureRow(cells) > pageBottom) {
        doc.addPage();
        y = drawHeader(PAGE_MARGIN);
      }
      y = drawRow(cells, y, index % 2 === 1 ? { fill: ZEBRA } : {});
    });

    if (rows.length === 0) {
      doc.font("Helvetica").fontSize(10).fillColor(MUTED).text("No overdue balances.", PAGE_MARGIN, y + 10, { width: contentWidth, align: "center" });
    } else {
      const totalCells = ["", `Total (${rows.length} student${rows.length === 1 ? "" : "s"})`, "", formatNaira(rows.reduce((sum, row) => sum + row.amount, 0)), ""];
      if (y + measureRow(totalCells, true) > pageBottom) {
        doc.addPage();
        y = PAGE_MARGIN;
      }
      drawRow(totalCells, y, { bold: true, color: NAVY });
    }

    doc.end();
  });
}
