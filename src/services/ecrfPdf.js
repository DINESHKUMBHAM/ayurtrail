const PDFDocument = require('pdfkit');

// Builds the eCRF PDF and pipes it into `stream`. Signed records get a green
// 21 CFR Part 11 attestation banner; unsigned records get a red DRAFT banner.
function renderEcrfPdf(record, stream) {
  const doc = new PDFDocument({ margin: 40 });
  doc.pipe(stream);

  doc.fontSize(18).text('AIIA Clinical Trial Management System', { align: 'center' });
  doc.fontSize(12).text('Electronic Case Report Form (eCRF)', { align: 'center' });
  doc.moveDown();

  if (record.data_hash) {
    doc.rect(35, doc.y, 540, 75).fillAndStroke('#e6f4ea', '#137333');
    doc.fillColor('#137333').fontSize(11).text('VERIFIED 21 CFR PART 11 ELECTRONIC SIGNATURE', 45, doc.y - 65, { bold: true });
    doc.fillColor('#000000').fontSize(9)
      .text(`Signed By: ${record.signer_name} (${record.signer_role})`)
      .text(`Reason: ${record.signature_reason}`)
      .text(`Timestamp: ${record.signed_at}`)
      .text(`SHA-256 Hash: ${record.data_hash}`);
    doc.moveDown(2);
  } else {
    doc.rect(35, doc.y, 540, 35).fillAndStroke('#fff0f0', '#c5221f');
    doc.fillColor('#c5221f').fontSize(11).text('DRAFT RECORD - NOT ELECTRONICALLY SIGNED', 45, doc.y - 25);
    doc.moveDown(2);
  }

  doc.fillColor('#000000').fontSize(12).text(`Record ID: ${record.id}`);
  doc.text(`Patient Code: ${record.patient_code}`);
  doc.text(`Visit Number: ${record.visit_number}`);
  doc.text(`Recorded Date: ${record.created_at}`);
  doc.moveDown();

  doc.fontSize(14).text('Clinical Data Details:');
  doc.fontSize(10).text(`Dosha Assessment Data: ${JSON.stringify(record.dosha_data, null, 2)}`);
  doc.text(`Anupana Details: ${record.anupana_details || 'N/A'}`);

  doc.end();
}

module.exports = { renderEcrfPdf };
