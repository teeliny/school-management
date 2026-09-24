import PDFDocument from "pdfkit";

export interface ReceiptPdfData {
  receiptNumber: string;
  // Audit-facing per-AcademicSession sequential serial (e.g.
  // "2025/2026-00001") — null for a receipt issued before this field
  // existed. See the Receipt model's own schema comment.
  serialNumber: string | null;
  issuedAt: Date;
  schoolName: string;
  schoolAddress: string | null;
  studentName: string;
  admissionNumber: string;
  termName: string;
  academicSessionName: string;
  amount: number;
  method: string;
  paidAt: Date | null;
  outstandingBalanceAfter: number;
  recordedByName: string | null;
}

// Same brand colors as report-card-pdf.util.ts (CLAUDE.md's web theming
// notes) for visual consistency, but deliberately no school-logo fetch — a
// receipt is a lighter-weight document than a report card, so the
// network-fetch-with-graceful-degradation logic in
// report-card.processor.ts's fetchSchoolHeaderMeta isn't duplicated here.
const NAVY = "#001B3A";
const MUTED = "#6b7280";
const BAND = "#f4f5f7";

// pdfkit's standard 14 base fonts (Helvetica included) use WinAnsiEncoding,
// which has no glyph for the Naira sign (₦, U+20A6) — `toLocaleString(...,
// { style: "currency", currency: "NGN" })` silently renders as a garbled
// placeholder character in every PDF built on these fonts (confirmed
// directly: a plain doc.text() of that string renders "¦85,000.00", not
// "₦85,000.00"). "NGN " as a plain-ASCII prefix sidesteps the missing glyph
// entirely rather than requiring an embedded Unicode font just for one
// symbol.
const NAIRA_AMOUNT = new Intl.NumberFormat("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function formatNaira(amount: number): string {
  return `NGN ${NAIRA_AMOUNT.format(amount)}`;
}

/**
 * Faint, diagonal, full-page school-name watermark, drawn first so every
 * later element paints over it. Same treatment on every PDF this system
 * produces — see apps/api/timetable-pdf.util.ts and this app's own
 * report-card-pdf.util.ts (duplicated, not shared, same as this file's own
 * color constants above).
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
  // whatever nonsensical position that rotated draw computed. Reset
  // explicitly rather than let that leak through as a huge blank gap before
  // the real content, which otherwise starts its own flow assuming a plain
  // top-of-page cursor.
  doc.x = doc.page.margins.left;
  doc.y = doc.page.margins.top;
}

function contentWidth(doc: PDFKit.PDFDocument): number {
  return doc.page.width - doc.page.margins.left - doc.page.margins.right;
}

function labelValueRow(doc: PDFKit.PDFDocument, label: string, value: string): void {
  doc.font("Helvetica-Bold").fontSize(10).text(`${label}: `, { continued: true });
  doc.font("Helvetica").text(value);
}

export function renderReceiptPdf(data: ReceiptPdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.on("pageAdded", () => drawWatermark(doc, data.schoolName));
    drawWatermark(doc, data.schoolName);

    doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(15).text(data.schoolName, { align: "center" });
    if (data.schoolAddress) {
      doc.fillColor(MUTED).font("Helvetica").fontSize(9).text(data.schoolAddress, { align: "center" });
    }
    doc.moveDown(0.5);

    const left = doc.page.margins.left;
    const width = contentWidth(doc);
    doc.moveTo(left, doc.y).lineTo(left + width, doc.y).lineWidth(1.25).strokeColor(NAVY).stroke();
    doc.moveDown(0.6);

    doc.fillColor(NAVY).font("Times-Bold").fontSize(19).text("PAYMENT RECEIPT", { align: "center" });
    doc.fillColor(MUTED).font("Helvetica").fontSize(8).text(`Issued: ${data.issuedAt.toDateString()}`, { align: "center" });
    doc.moveDown(1);

    doc.fillColor("black");
    labelValueRow(doc, "Receipt Number", data.receiptNumber);
    if (data.serialNumber) labelValueRow(doc, "Serial No.", data.serialNumber);
    labelValueRow(doc, "Student", `${data.studentName} (${data.admissionNumber})`);
    labelValueRow(doc, "Session", data.academicSessionName);
    labelValueRow(doc, "Term", data.termName);
    labelValueRow(doc, "Payment Method", data.method);
    if (data.paidAt) labelValueRow(doc, "Paid On", data.paidAt.toDateString());
    if (data.recordedByName) labelValueRow(doc, "Recorded By", data.recordedByName);
    doc.moveDown(0.8);

    const boxY = doc.y;
    doc.save().fillColor(BAND).rect(left, boxY, width, 44).fill().restore();
    doc
      .fillColor(NAVY)
      .font("Helvetica-Bold")
      .fontSize(12)
      .text(`Amount Paid: ${formatNaira(data.amount)}`, left + 10, boxY + 8);
    doc
      .fillColor(MUTED)
      .font("Helvetica")
      .fontSize(9.5)
      .text(`Outstanding balance after this payment: ${formatNaira(data.outstandingBalanceAfter)}`, left + 10, boxY + 26);
    doc.y = boxY + 44 + 12;
    doc.fillColor("black").font("Helvetica").fontSize(10);

    doc.end();
  });
}
