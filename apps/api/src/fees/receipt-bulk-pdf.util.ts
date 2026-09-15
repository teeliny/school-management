import PDFDocument from "pdfkit";

// Same brand colors as apps/worker's report-card-pdf.util.ts/receipt-pdf.util.ts
// and this app's own timetable-pdf.util.ts — apps/api and apps/worker don't
// share a PDF-rendering module, so these are deliberately duplicated per file.
const NAVY = "#001B3A";
const MUTED = "#6b7280";
const BORDER = "#d8dce3";
const DUPLICATE_RED = "#b91c1c";

export interface SchoolContactInfo {
  name: string;
  address: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
}

export interface BulkReceiptPdfEntry {
  receiptNumber: string;
  serialNumber: string | null;
  issuedAt: Date;
  studentName: string;
  admissionNumber: string;
  termName: string;
  amount: number;
  method: string;
  paidAt: Date | null;
  outstandingBalanceAfter: number;
  recordedByName: string | null;
  // Whether this receipt has already been printed via this flow before now
  // (PaymentService.buildBulkReceiptsPdf decides this by checking
  // Receipt.printedAt before marking it) — a true value stamps the slip
  // "DUPLICATE COPY" instead of letting it pass for a fresh original.
  isReprint: boolean;
  printCount: number;
}

// pdfkit's standard 14 base fonts (Helvetica included) use WinAnsiEncoding,
// which has no glyph for the Naira sign (₦, U+20A6) — `Intl.NumberFormat`
// with `style: "currency", currency: "NGN"` renders that symbol, which then
// shows up as a garbled placeholder character in the PDF (confirmed
// directly: a plain doc.text() of that string renders "¦85,000.00", not
// "₦85,000.00"). "NGN " as a plain-ASCII prefix sidesteps the missing glyph
// entirely rather than requiring an embedded Unicode font just for one
// symbol — same fix as apps/worker's receipt-pdf.util.ts.
const NAIRA_AMOUNT = new Intl.NumberFormat("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function formatNaira(amount: number): string {
  return `NGN ${NAIRA_AMOUNT.format(amount)}`;
}

const PAGE_MARGIN = 24;
const SLOTS_PER_PAGE = 3;
// Blank space between slips, with the dashed cut line running through its
// middle — without this, a slip's own border sat flush against the next
// slip's border, so a scissor cut along the line (never perfectly straight
// in practice) would nick whichever neighbor it drifted toward.
const SLOT_GAP = 16;

/**
 * Diagonal, low-opacity school-name watermark confined to one receipt slot's
 * own rectangle (not the whole page) — since a printed sheet gets cut into 3
 * separate slips along the dashed lines, a page-spanning watermark (like
 * apps/api's own timetable-pdf.util.ts or apps/worker's report-card/receipt
 * PDFs) would only land on whichever third it happened to cross, leaving the
 * other slips unmarked once separated. Clipping to the slot's rect keeps
 * every cut slip watermarked on its own.
 */
function drawSlotWatermark(doc: PDFKit.PDFDocument, schoolName: string, x: number, y: number, width: number, height: number): void {
  doc.save();
  doc.rect(x, y, width, height).clip();
  doc.rotate(-30, { origin: [x + width / 2, y + height / 2] });
  doc
    .font("Helvetica-Bold")
    .fontSize(26)
    .fillColor(NAVY)
    .opacity(0.07)
    .text(schoolName.toUpperCase(), x - width / 2, y + height / 2 - 12, { width: width * 2, align: "center" });
  doc.opacity(1);
  doc.restore();
  // restore() undoes the clip/rotate/opacity graphics state, but not pdfkit's
  // own text-flow cursor (doc.x/doc.y) — same gotcha as every other
  // watermark helper in this codebase (see timetable-pdf.util.ts's
  // drawWatermark comment). Every caller positions its own content with
  // explicit x/y afterward, so no reset is needed here, but this is why one
  // would be needed if that ever changed.
}

function labelValue(doc: PDFKit.PDFDocument, x: number, y: number, width: number, label: string, value: string): number {
  doc.font("Helvetica-Bold").fontSize(7.5).fillColor(MUTED).text(`${label}: `, x, y, { continued: true, width });
  doc.font("Helvetica").fontSize(7.5).fillColor("black").text(value);
  return doc.y;
}

/**
 * Renders each entry as a signable receipt slip, 3 to an A4 portrait page
 * (a school printing these physically cuts along the dashed lines into 3
 * slips) — each slip carries the full school header/contacts, its own
 * watermark, and a blank line for the Bursar's signature, mirroring how a
 * paper receipt book works. Deliberately a distinct layout from apps/worker's
 * renderReceiptPdf (one full-page receipt, auto-generated per payment,
 * digital record) — this is the Bursar's on-demand "print and sign these"
 * batch action.
 */
export function renderBulkReceiptsPdf(entries: BulkReceiptPdfEntry[], school: SchoolContactInfo): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", layout: "portrait", margin: PAGE_MARGIN });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const contentWidth = doc.page.width - PAGE_MARGIN * 2;
    const contentHeight = doc.page.height - PAGE_MARGIN * 2;
    const slotHeight = (contentHeight - SLOT_GAP * (SLOTS_PER_PAGE - 1)) / SLOTS_PER_PAGE;

    entries.forEach((entry, index) => {
      const slotIndexOnPage = index % SLOTS_PER_PAGE;
      if (index > 0 && slotIndexOnPage === 0) doc.addPage();

      const slotX = PAGE_MARGIN;
      const slotY = PAGE_MARGIN + slotIndexOnPage * (slotHeight + SLOT_GAP);
      const pad = 10;

      drawSlotWatermark(doc, school.name, slotX, slotY, contentWidth, slotHeight);

      doc.rect(slotX, slotY, contentWidth, slotHeight).strokeColor(BORDER).lineWidth(0.75).stroke();

      // Cut line runs through the middle of the gap below this slip, not
      // its border — not drawn below the last slot on a page (nothing to
      // separate it from) or below the very last entry overall (e.g. a
      // final page with only 1 of 3 slots filled) — there's nothing below
      // it there either, just blank page.
      if (slotIndexOnPage < SLOTS_PER_PAGE - 1 && index + 1 < entries.length) {
        const cutLineY = slotY + slotHeight + SLOT_GAP / 2;
        doc
          .dash(3, { space: 2 })
          .moveTo(slotX, cutLineY)
          .lineTo(slotX + contentWidth, cutLineY)
          .strokeColor(MUTED)
          .lineWidth(0.5)
          .stroke();
        doc.undash();
      }

      const innerX = slotX + pad;
      const innerWidth = contentWidth - pad * 2;
      let y = slotY + pad;

      // Header: school identity on the left, receipt identifiers on the right.
      const headerRightWidth = 170;
      const headerLeftWidth = innerWidth - headerRightWidth - 10;
      doc.font("Helvetica-Bold").fontSize(11).fillColor(NAVY).text(school.name.toUpperCase(), innerX, y, { width: headerLeftWidth });
      let leftY = doc.y;
      if (school.address) {
        doc.font("Helvetica").fontSize(7).fillColor(MUTED).text(school.address, innerX, leftY + 1, { width: headerLeftWidth });
        leftY = doc.y;
      }
      const contactLine = [school.contactEmail, school.contactPhone].filter(Boolean).join("   ·   ");
      if (contactLine) {
        doc.font("Helvetica").fontSize(7).fillColor(MUTED).text(contactLine, innerX, leftY + 1, { width: headerLeftWidth });
      }

      const rightX = innerX + headerLeftWidth + 10;
      doc.font("Helvetica-Bold").fontSize(9).fillColor(NAVY).text("PAYMENT RECEIPT", rightX, y, { width: headerRightWidth, align: "right" });
      doc
        .font("Helvetica")
        .fontSize(7)
        .fillColor(MUTED)
        .text(`No: ${entry.receiptNumber}`, rightX, doc.y + 1, { width: headerRightWidth, align: "right" });
      if (entry.serialNumber) {
        doc.text(`Serial: ${entry.serialNumber}`, rightX, doc.y + 1, { width: headerRightWidth, align: "right" });
      }
      doc.text(`Issued: ${entry.issuedAt.toDateString()}`, rightX, doc.y + 1, { width: headerRightWidth, align: "right" });

      y = Math.max(leftY, doc.y) + 6;
      doc.moveTo(innerX, y).lineTo(innerX + innerWidth, y).strokeColor(BORDER).lineWidth(0.5).stroke();
      y += 6;

      // Body — two columns of label/value pairs.
      const colWidth = (innerWidth - 12) / 2;
      const col2X = innerX + colWidth + 12;
      const bodyTop = y;
      let colY = labelValue(doc, innerX, y, colWidth, "Student", `${entry.studentName} (${entry.admissionNumber})`);
      colY = labelValue(doc, innerX, colY + 2, colWidth, "Term", entry.termName);
      colY = labelValue(doc, innerX, colY + 2, colWidth, "Method", entry.method);

      let col2Y = labelValue(doc, col2X, bodyTop, colWidth, "Amount Paid", formatNaira(entry.amount));
      if (entry.paidAt) col2Y = labelValue(doc, col2X, col2Y + 2, colWidth, "Paid On", entry.paidAt.toDateString());
      if (entry.recordedByName) col2Y = labelValue(doc, col2X, col2Y + 2, colWidth, "Recorded By", entry.recordedByName);

      y = Math.max(colY, col2Y) + 4;

      // Outstanding balance — highlighted, since this is the figure the
      // parent most needs off a physical slip.
      doc
        .font("Helvetica-Bold")
        .fontSize(8.5)
        .fillColor(NAVY)
        .text(`Balance Remaining: ${formatNaira(entry.outstandingBalanceAfter)}`, innerX, y, { width: innerWidth });
      y = doc.y + 8;

      // Signature line — pinned to the bottom of the slip rather than
      // flowing immediately after the balance line, so it lands in the same
      // place on every slip regardless of how much body text there was.
      const signatureY = slotY + slotHeight - pad - 14;
      const signatureLineY = Math.max(y, signatureY);
      const sigWidth = innerWidth * 0.55;
      doc
        .moveTo(innerX, signatureLineY)
        .lineTo(innerX + sigWidth, signatureLineY)
        .strokeColor(BORDER)
        .lineWidth(0.5)
        .stroke();
      doc.font("Helvetica").fontSize(6.5).fillColor(MUTED).text("Bursar's Signature", innerX, signatureLineY + 2, { width: sigWidth });
      doc
        .font("Helvetica")
        .fontSize(6.5)
        .fillColor(MUTED)
        .text("Date", innerX + sigWidth + 10, signatureLineY + 2, { width: innerWidth - sigWidth - 10 });
      doc
        .moveTo(innerX + sigWidth + 10, signatureLineY)
        .lineTo(innerX + innerWidth, signatureLineY)
        .strokeColor(BORDER)
        .lineWidth(0.5)
        .stroke();

      // Duplicate stamp — drawn last so it sits on top of everything else on
      // this slip, same clip-to-slot reasoning as the watermark above.
      // Centered on the slip's own vertical middle (below the header block,
      // above the signature line) rather than nearer the top — the header's
      // right-aligned "PAYMENT RECEIPT"/receipt-number block otherwise sits
      // exactly where a higher-placed stamp's rotated text swings up into.
      if (entry.isReprint) {
        doc.save();
        doc.rect(slotX, slotY, contentWidth, slotHeight).clip();
        const stampCenterY = slotY + slotHeight * 0.58;
        doc.rotate(-14, { origin: [slotX + contentWidth * 0.5, stampCenterY] });
        doc
          .font("Helvetica-Bold")
          .fontSize(19)
          .fillColor(DUPLICATE_RED)
          .opacity(0.7)
          .text("DUPLICATE COPY", slotX + contentWidth * 0.15, stampCenterY - 12, { width: contentWidth * 0.7, align: "center" });
        doc.opacity(1);
        doc.restore();
        doc
          .font("Helvetica")
          .fontSize(6)
          .fillColor(DUPLICATE_RED)
          .text(`Reprint #${entry.printCount}`, slotX + contentWidth - 90, slotY + pad, { width: 80, align: "right" });
      }
    });

    if (entries.length === 0) {
      doc.font("Helvetica").fontSize(11).fillColor(MUTED).text("No receipts selected.", { align: "center" });
    }

    doc.end();
  });
}
