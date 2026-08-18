import PDFDocument from "pdfkit";

export interface ReceiptPdfData {
  receiptNumber: string;
  issuedAt: Date;
  schoolName: string;
  schoolAddress: string | null;
  studentName: string;
  admissionNumber: string;
  termName: string;
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
    labelValueRow(doc, "Student", `${data.studentName} (${data.admissionNumber})`);
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
      .text(`Amount Paid: ${data.amount.toLocaleString("en-NG", { style: "currency", currency: "NGN" })}`, left + 10, boxY + 8);
    doc
      .fillColor(MUTED)
      .font("Helvetica")
      .fontSize(9.5)
      .text(
        `Outstanding balance after this payment: ${data.outstandingBalanceAfter.toLocaleString("en-NG", { style: "currency", currency: "NGN" })}`,
        left + 10,
        boxY + 26,
      );
    doc.y = boxY + 44 + 12;
    doc.fillColor("black").font("Helvetica").fontSize(10);

    doc.end();
  });
}
