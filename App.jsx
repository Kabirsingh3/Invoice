import React, { useState, useEffect, useRef, useId } from "react";
import { supabase } from "./supabaseClient";
import { jsPDF } from "jspdf";
import "jspdf-autotable";

// ---------------- utils ----------------
function money(n) {
  return (Math.round((n + Number.EPSILON) * 100) / 100).toFixed(2);
}
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function plusDays(iso, days) {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
function computeTotals(items, taxRate) {
  const subtotal = items.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.price) || 0), 0);
  const tax = subtotal * ((Number(taxRate) || 0) / 100);
  return { subtotal, tax, total: subtotal + tax };
}
function nextNumber(company, type) {
  const n = type === "quote" ? company.quote_counter : company.invoice_counter;
  const prefix = type === "quote" ? "QUO" : "INV";
  return prefix + "-" + String(n || 1).padStart(4, "0");
}
function bankDetailsLines(company) {
  const rows = [
    ["Account Holder", company.bank_account_holder],
    ["Bank Name", company.bank_name],
    ["Account Type", company.bank_account_type],
    ["Branch Code", company.bank_branch_code],
    ["Account Number", company.bank_account_number]
  ].filter(([, v]) => v && v.trim());
  return rows.map(([label, v]) => `${label}: ${v}`);
}
function hasBankDetails(company) {
  return bankDetailsLines(company).length > 0;
}
function boltLogoPNG() {
  const canvas = document.createElement("canvas");
  canvas.width = 160;
  canvas.height = 160;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#1B3A6B";
  ctx.beginPath();
  ctx.arc(80, 80, 80, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#FFFFFF";
  ctx.save();
  ctx.translate(34, 32);
  ctx.scale(4, 4);
  const boltPath = new Path2D("M13 2 3 14h9l-1 8 10-12h-9l1-8z");
  ctx.fill(boltPath);
  ctx.restore();
  return canvas.toDataURL("image/png");
}

// ---------------- PDF export ----------------
function downloadPdf(doc, company) {
  const totals = computeTotals(doc.items, doc.tax_enabled ? doc.tax_rate : 0);
  const ACCENT = [30, 58, 95];
  const ACCENT_DARK = [18, 42, 71];
  const GOLD = [156, 122, 46];
  const INK = [20, 26, 36];
  const INK_SOFT = [91, 100, 114];
  const LINE = [219, 223, 217];
  const PAPER_ALT = [228, 231, 225];

  try {
    const pdf = new jsPDF({ unit: "pt", format: "a4" });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const marginX = 48;

    // Header band across the top of the page, echoing the in-app accent bar.
    pdf.setFillColor(...ACCENT);
    pdf.rect(0, 0, pageW * 0.82, 7, "F");
    pdf.setFillColor(...GOLD);
    pdf.rect(pageW * 0.82, 0, pageW * 0.18, 7, "F");

    let y = 46;

    // Logo sits above the company name on the left, so it never collides
    // with the title/number block on the right.
    let nameY = y;
    if (company.logo) {
      try {
        const fmt = company.logo.includes("image/png") ? "PNG" : "JPEG";
        pdf.addImage(company.logo, fmt, marginX, y - 8, 42, 42, undefined, "FAST");
        nameY = y + 50;
      } catch (e) {}
    }

    pdf.setFont("times", "bold");
    pdf.setFontSize(16);
    pdf.setTextColor(...INK);
    pdf.text(company.name || "", marginX, nameY);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9.5);
    pdf.setTextColor(...INK_SOFT);
    const addrLines = pdf.splitTextToSize(
      [company.address, company.email, company.phone].filter(Boolean).join("\n"),
      260
    );
    pdf.text(addrLines, marginX, nameY + 18);

    pdf.setFont("times", "bold");
    pdf.setFontSize(24);
    pdf.setTextColor(...ACCENT);
    pdf.text(doc.type === "quote" ? "Quote" : "Invoice", pageW - marginX, y + 6, { align: "right" });
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9.5);
    pdf.setTextColor(...INK_SOFT);
    pdf.text(`Number: ${doc.number}`, pageW - marginX, y + 26, { align: "right" });
    pdf.text(`Issued: ${fmtDate(doc.issue_date)}`, pageW - marginX, y + 40, { align: "right" });
    pdf.text(
      `${doc.type === "quote" ? "Valid until" : "Due"}: ${fmtDate(doc.due_date)}`,
      pageW - marginX,
      y + 54,
      { align: "right" }
    );

    y = Math.max(nameY + 18 + addrLines.length * 11, y + 74) + 26;

    // Billed-to block gets a soft shaded background, like the in-app sheet.
    const billBoxH = 62;
    pdf.setFillColor(...PAPER_ALT);
    pdf.roundedRect(marginX, y - 16, pageW - marginX * 2, billBoxH, 4, 4, "F");
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8.5);
    pdf.setTextColor(...INK_SOFT);
    pdf.text("BILLED TO", marginX + 14, y);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(11.5);
    pdf.setTextColor(...INK);
    pdf.text(doc.client_name || "", marginX + 14, y + 16);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9.5);
    pdf.setTextColor(...INK_SOFT);
    const clientLines = pdf.splitTextToSize(
      [doc.client_address, doc.client_email].filter(Boolean).join("\n"),
      pageW - marginX * 2 - 28
    );
    pdf.text(clientLines, marginX + 14, y + 30);

    y += billBoxH + 22;
    const body = doc.items.map((it) => [
      it.desc,
      String(it.qty),
      "R" + money(it.price),
      "R" + money(it.qty * it.price)
    ]);

    pdf.autoTable({
      startY: y,
      margin: { left: marginX, right: marginX },
      head: [["Description", "Qty", "Price", "Amount"]],
      body,
      theme: "plain",
      styles: { font: "helvetica", fontSize: 9.5, textColor: INK, cellPadding: { top: 8, bottom: 8, left: 10, right: 10 } },
      headStyles: { fontStyle: "bold", fontSize: 8.5, textColor: [255, 255, 255], fillColor: ACCENT, cellPadding: { top: 8, bottom: 8, left: 10, right: 10 } },
      alternateRowStyles: { fillColor: PAPER_ALT },
      columnStyles: { 1: { halign: "right", cellWidth: 50 }, 2: { halign: "right", cellWidth: 80 }, 3: { halign: "right", cellWidth: 80 } },
      didParseCell: (data) => {
        if (data.section === "body") {
          data.cell.styles.lineColor = LINE;
          data.cell.styles.lineWidth = { bottom: 0.5 };
        }
      }
    });

    let finalY = pdf.lastAutoTable.finalY + 18;
    const boxW = 210;
    const totalsX = pageW - marginX - boxW + 14;
    const totalsRight = pageW - marginX - 14;
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9.5);
    pdf.setTextColor(...INK_SOFT);
    pdf.text("Subtotal", totalsX, finalY);
    pdf.text("R" + money(totals.subtotal), totalsRight, finalY, { align: "right" });
    let afterLinesY = finalY + 16;
    if (doc.tax_enabled) {
      pdf.text(`Tax (${doc.tax_rate}%)`, totalsX, afterLinesY);
      pdf.text("R" + money(totals.tax), totalsRight, afterLinesY, { align: "right" });
      afterLinesY += 16;
    } else {
      afterLinesY += 4;
    }

    // Highlighted total box, echoing the app's filled totals-row.grand style.
    const totalBoxY = afterLinesY + 6;
    const totalBoxH = 32;
    pdf.setFillColor(...ACCENT);
    pdf.roundedRect(pageW - marginX - boxW, totalBoxY, boxW, totalBoxH, 5, 5, "F");
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(12.5);
    pdf.setTextColor(255, 255, 255);
    pdf.text("Total", pageW - marginX - boxW + 14, totalBoxY + 21);
    pdf.text("R" + money(totals.total), totalsRight, totalBoxY + 21, { align: "right" });

    let noteY = totalBoxY + totalBoxH + 34;
    if (hasBankDetails(company)) {
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(9);
      pdf.setTextColor(...INK);
      pdf.text("Banking details", marginX, noteY);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(9);
      pdf.setTextColor(...INK_SOFT);
      const bankLines = bankDetailsLines(company);
      pdf.text(bankLines, marginX, noteY + 13);
      noteY += 13 + bankLines.length * 11 + 14;
    }
    if (doc.notes) {
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(9);
      pdf.setTextColor(...INK);
      pdf.text("Notes", marginX, noteY);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(9);
      pdf.setTextColor(...INK_SOFT);
      const lines = pdf.splitTextToSize(doc.notes, pageW - marginX * 2);
      pdf.text(lines, marginX, noteY + 13);
      noteY += 13 + lines.length * 11 + 14;
    }
    if (doc.terms) {
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(9);
      pdf.setTextColor(...INK);
      pdf.text("Terms", marginX, noteY);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(9);
      pdf.setTextColor(...INK_SOFT);
      const termLines = pdf.splitTextToSize(doc.terms, pageW - marginX * 2);
      pdf.text(termLines, marginX, noteY + 13);
      noteY += 13 + termLines.length * 11 + 14;
    }

    // Footer: thin rule + a quiet closing line, anchored near the bottom of
    // the page (but pulled up if content already runs long).
    const footerY = Math.max(noteY + 16, pageH - 60);
    pdf.setDrawColor(...LINE);
    pdf.setLineWidth(0.75);
    pdf.line(marginX, footerY, pageW - marginX, footerY);
    pdf.setFont("helvetica", "italic");
    pdf.setFontSize(9);
    pdf.setTextColor(...INK_SOFT);
    pdf.text("Thank you for the opportunity to work with you.", pageW / 2, footerY + 18, { align: "center" });

    pdf.save(`${doc.number}.pdf`);
  } catch (err) {
    console.error(err);
    alert("Couldn't generate the PDF. Please try again.");
  }
}

// Loads a job photo and returns a downscaled JPEG data URL for jsPDF.
// Tries the Supabase storage API first (avoids browser cache / CORS problems
// with the public URL), then falls back to fetching the public URL.
async function getPhotoBlob(photo) {
  let firstError = null;
  if (photo.path) {
    try {
      const { data, error } = await supabase.storage.from("job-photos").download(photo.path);
      if (error) throw error;
      if (data && data.size > 0) return data;
    } catch (e) {
      firstError = e;
    }
  }
  if (photo.url) {
    const sep = photo.url.includes("?") ? "&" : "?";
    const res = await fetch(photo.url + sep + "pdf=" + Date.now(), { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.blob();
  }
  throw firstError || new Error("Photo has no path or URL");
}

async function decodeImage(blob) {
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(blob);
      return { source: bmp, w: bmp.width, h: bmp.height };
    } catch (e) {
      // fall through to <img> decoding
    }
  }
  const objectUrl = URL.createObjectURL(blob);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("This photo format can't be read by the browser (" + (blob.type || "unknown") + ")"));
      el.src = objectUrl;
    });
    return { source: img, w: img.naturalWidth, h: img.naturalHeight };
  } finally {
    setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }
}

// ---------------- Photo helpers (HEIC conversion + shrinking) ----------------
// Many Android (Samsung) and iPhone cameras save photos as HEIC, which Chrome
// can't display. We convert HEIC to JPEG in the browser (heic-to library,
// only loaded when a HEIC photo actually appears) and shrink photos before
// upload so they display everywhere and use far less Supabase storage.
function looksHeic(blob, nameOrPath = "") {
  const t = (blob?.type || "").toLowerCase();
  return t.includes("heic") || t.includes("heif") || /\.(heic|heif)(\?|$)/i.test(nameOrPath);
}

async function heicToJpegBlob(blob) {
  const { heicTo } = await import("heic-to");
  return await heicTo({ blob, type: "image/jpeg", quality: 0.85 });
}

async function prepareImageForUpload(file, maxSide = 1600, quality = 0.8) {
  const isImage = (file.type || "").startsWith("image/") || looksHeic(file, file.name);
  if (!isImage) return file; // e.g. PDF receipts are uploaded as-is
  try {
    let blob = file;
    if (looksHeic(file, file.name)) blob = await heicToJpegBlob(file);
    const { source, w: srcW, h: srcH } = await decodeImage(blob);
    const scale = Math.min(1, maxSide / Math.max(srcW, srcH));
    const w = Math.round(srcW * scale);
    const h = Math.round(srcH * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(source, 0, 0, w, h);
    if (source.close) source.close();
    const out = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (!out) return file;
    const base = (file.name || "photo").replace(/\.[^.]+$/, "") || "photo";
    return new File([out], base + ".jpg", { type: "image/jpeg" });
  } catch (e) {
    console.warn("Couldn't convert/shrink image, uploading original:", e);
    return file;
  }
}

// Shows a stored photo/receipt; HEIC files are converted on the fly so they
// display in Chrome.
function StoredImage({ item, style, alt = "" }) {
  const heic = looksHeic({ type: item?.type }, item?.path || item?.url || item?.name || "");
  const [src, setSrc] = useState(heic ? null : item?.url);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!heic) {
      setSrc(item?.url);
      return;
    }
    let objectUrl = null;
    let cancelled = false;
    setSrc(null);
    setFailed(false);
    (async () => {
      try {
        const blob = await getPhotoBlob(item);
        const jpg = await heicToJpegBlob(blob);
        if (cancelled) return;
        objectUrl = URL.createObjectURL(jpg);
        setSrc(objectUrl);
      } catch (e) {
        console.warn("Couldn't display HEIC photo:", e);
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [item?.url, item?.path]);
  if (!src) {
    return (
      <div style={{ ...style, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--paper-alt)", color: "var(--ink-soft)", fontSize: 11, textAlign: "center" }}>
        {failed ? "Can't show" : "Loading…"}
      </div>
    );
  }
  return <img src={src} alt={alt} style={style} />;
}

async function loadImageForPdf(photo, maxSide = 1400) {
  let blob = await getPhotoBlob(photo);
  if (looksHeic(blob, photo.path || photo.url || "")) blob = await heicToJpegBlob(blob);
  let decoded;
  try {
    decoded = await decodeImage(blob);
  } catch (e) {
    // Last try: the file may be HEIC without saying so.
    decoded = await decodeImage(await heicToJpegBlob(blob));
  }
  const { source, w: srcW, h: srcH } = decoded;
  if (!srcW || !srcH) throw new Error("Empty image");
  const scale = Math.min(1, maxSide / Math.max(srcW, srcH));
  const w = Math.round(srcW * scale);
  const h = Math.round(srcH * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(source, 0, 0, w, h);
  if (source.close) source.close();
  return { data: canvas.toDataURL("image/jpeg", 0.8), w, h };
}

// ---------------- Job card PDF export (spares used, no prices) ----------------
async function downloadJobCardPdf(jobCard, company) {
  const ACCENT = [30, 58, 95];
  const GOLD = [156, 122, 46];
  const INK = [20, 26, 36];
  const INK_SOFT = [91, 100, 114];
  const LINE = [219, 223, 217];
  const PAPER_ALT = [228, 231, 225];

  try {
    const pdf = new jsPDF({ unit: "pt", format: "a4" });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const marginX = 48;
    const contentW = pageW - marginX * 2;
    const loggedDate = jobCard.created_at ? jobCard.created_at.slice(0, 10) : "";
    const ref = "JC-" + String(jobCard.id || "").slice(0, 8).toUpperCase();

    pdf.setFillColor(...ACCENT);
    pdf.rect(0, 0, pageW * 0.82, 7, "F");
    pdf.setFillColor(...GOLD);
    pdf.rect(pageW * 0.82, 0, pageW * 0.18, 7, "F");

    let y = 46;
    let nameY = y;
    if (company.logo) {
      try {
        const fmt = company.logo.includes("image/png") ? "PNG" : "JPEG";
        pdf.addImage(company.logo, fmt, marginX, y - 8, 42, 42, undefined, "FAST");
        nameY = y + 50;
      } catch (e) {}
    }

    pdf.setFont("times", "bold");
    pdf.setFontSize(16);
    pdf.setTextColor(...INK);
    pdf.text(company.name || "", marginX, nameY);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9.5);
    pdf.setTextColor(...INK_SOFT);
    const addrLines = pdf.splitTextToSize(
      [company.address, company.email, company.phone].filter(Boolean).join("\n"),
      260
    );
    pdf.text(addrLines, marginX, nameY + 18);

    pdf.setFont("times", "bold");
    pdf.setFontSize(24);
    pdf.setTextColor(...ACCENT);
    pdf.text("Job Card", pageW - marginX, y + 6, { align: "right" });
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9.5);
    pdf.setTextColor(...INK_SOFT);
    pdf.text(`Ref: ${ref}`, pageW - marginX, y + 26, { align: "right" });
    pdf.text(`Date: ${fmtDate(loggedDate)}`, pageW - marginX, y + 40, { align: "right" });
    pdf.text(`Technician: ${jobCard.technician_name || "—"}`, pageW - marginX, y + 54, { align: "right" });

    y = Math.max(nameY + 18 + addrLines.length * 11, y + 74) + 26;

    // Client / site block
    const siteLines = jobCard.site_address ? pdf.splitTextToSize(jobCard.site_address, contentW - 28) : [];
    const boxH = 40 + siteLines.length * 11;
    pdf.setFillColor(...PAPER_ALT);
    pdf.roundedRect(marginX, y - 16, contentW, boxH, 4, 4, "F");
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8.5);
    pdf.setTextColor(...INK_SOFT);
    pdf.text("CLIENT / SITE", marginX + 14, y);
    pdf.setFontSize(11.5);
    pdf.setTextColor(...INK);
    pdf.text(jobCard.client_name || "", marginX + 14, y + 16);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9.5);
    pdf.setTextColor(...INK_SOFT);
    if (siteLines.length) pdf.text(siteLines, marginX + 14, y + 30);
    y += boxH + 14;

    function section(title, text) {
      if (!text) return;
      const lines = pdf.splitTextToSize(text, contentW);
      if (y + 30 + lines.length * 12 > pageH - 60) {
        pdf.addPage();
        y = 60;
      }
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(9);
      pdf.setTextColor(...INK);
      pdf.text(title, marginX, y);
      pdf.setFont("helvetica", "normal");
      pdf.setTextColor(...INK_SOFT);
      pdf.text(lines, marginX, y + 14);
      y += 14 + lines.length * 11 + 16;
    }

    section("Job description", jobCard.description);

    // Spares used — description and quantity only, no prices
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9);
    pdf.setTextColor(...INK);
    pdf.text("Spares used", marginX, y);
    y += 8;
    const used = jobCard.spares_used || [];
    pdf.autoTable({
      startY: y,
      margin: { left: marginX, right: marginX },
      head: [["Description", "Qty"]],
      body: used.length ? used.map((it) => [it.desc, String(it.qty)]) : [["No spares recorded", ""]],
      theme: "plain",
      styles: { font: "helvetica", fontSize: 9.5, textColor: INK, cellPadding: { top: 8, bottom: 8, left: 10, right: 10 } },
      headStyles: { fontStyle: "bold", fontSize: 8.5, textColor: [255, 255, 255], fillColor: ACCENT },
      alternateRowStyles: { fillColor: PAPER_ALT },
      columnStyles: { 1: { halign: "right", cellWidth: 70 } },
      didParseCell: (data) => {
        if (data.section === "body") {
          data.cell.styles.lineColor = LINE;
          data.cell.styles.lineWidth = { bottom: 0.5 };
        }
      }
    });
    y = pdf.lastAutoTable.finalY + 26;

    section("Notes", jobCard.notes);
    if ((jobCard.photos || []).length) {
      section("Photos", `${jobCard.photos.length} photo(s) attached on the following page(s).`);
    }

    // Sign-off lines
    if (y + 70 > pageH - 40) {
      pdf.addPage();
      y = 60;
    }
    y = Math.max(y + 20, pageH - 120);
    const colW = (contentW - 40) / 2;
    pdf.setDrawColor(...LINE);
    pdf.setLineWidth(0.75);
    [["Technician signature", marginX], ["Client signature", marginX + colW + 40]].forEach(([label, x]) => {
      pdf.line(x, y, x + colW, y);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(8.5);
      pdf.setTextColor(...INK_SOFT);
      pdf.text(label, x, y + 13);
      pdf.text("Date:", x, y + 27);
    });

    // Photos: two per row on their own page(s) after the sign-off section.
    const photos = jobCard.photos || [];
    let photosIncludedCount = 0;
    if (photos.length) {
      const loaded = [];
      let lastPhotoError = "";
      for (const p of photos) {
        try {
          loaded.push(await loadImageForPdf(p));
        } catch (e) {
          console.warn("Skipped photo in PDF:", p.url, e);
          lastPhotoError = e?.message || String(e);
        }
      }
      if (loaded.length) {
        const gap = 16;
        const cellW = (contentW - gap) / 2;
        const cellH = 225;
        const topY = 60;
        let col = 0;
        let rowY = topY + 24;
        pdf.addPage();
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(9);
        pdf.setTextColor(...INK);
        pdf.text(`Photos (${loaded.length})`, marginX, topY);
        loaded.forEach((img) => {
          if (rowY + cellH > pageH - 40) {
            pdf.addPage();
            rowY = topY;
            col = 0;
          }
          const ratio = Math.min(cellW / img.w, cellH / img.h);
          const w = img.w * ratio;
          const h = img.h * ratio;
          const x = marginX + col * (cellW + gap) + (cellW - w) / 2;
          const yy = rowY + (cellH - h) / 2;
          pdf.setFillColor(...PAPER_ALT);
          pdf.rect(marginX + col * (cellW + gap), rowY, cellW, cellH, "F");
          pdf.addImage(img.data, "JPEG", x, yy, w, h, undefined, "FAST");
          col++;
          if (col === 2) {
            col = 0;
            rowY += cellH + gap;
          }
        });
      }
      photosIncludedCount = loaded.length;
      if (loaded.length < photos.length) {
        alert(
          `${photos.length - loaded.length} of ${photos.length} photo(s) couldn't be loaded and were left out of the PDF.` +
            (lastPhotoError ? `\n\nReason: ${lastPhotoError}` : "")
        );
      }
    }

    const safeClient = (jobCard.client_name || "job").replace(/[^a-zA-Z0-9_-]+/g, "_");
    pdf.save(`JobCard_${safeClient}_${loggedDate || todayISO()}.pdf`);
    return { ok: true, photosTotal: photos.length, photosIncluded: photosIncludedCount };
  } catch (err) {
    console.error(err);
    alert("Couldn't generate the job card PDF. Please try again.");
    return { ok: false, photosTotal: 0, photosIncluded: 0 };
  }
}

// ---------------- Retainer agreement PDF ----------------
function downloadRetainerPdf(r, company) {
  const ACCENT = [30, 58, 95];
  const GOLD = [156, 122, 46];
  const INK = [20, 26, 36];
  const INK_SOFT = [91, 100, 114];
  const LINE = [219, 223, 217];
  const PAPER_ALT = [228, 231, 225];
  try {
    const pdf = new jsPDF({ unit: "pt", format: "a4" });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const marginX = 54;
    const contentW = pageW - marginX * 2;
    const bottom = pageH - 56;

    pdf.setFillColor(...ACCENT);
    pdf.rect(0, 0, pageW * 0.82, 7, "F");
    pdf.setFillColor(...GOLD);
    pdf.rect(pageW * 0.82, 0, pageW * 0.18, 7, "F");

    let y = 46;
    let nameY = y;
    if (company.logo) {
      try {
        const fmt = company.logo.includes("image/png") ? "PNG" : "JPEG";
        pdf.addImage(company.logo, fmt, marginX, y - 8, 42, 42, undefined, "FAST");
        nameY = y + 50;
      } catch (e) {}
    }
    pdf.setFont("times", "bold");
    pdf.setFontSize(16);
    pdf.setTextColor(...INK);
    pdf.text(company.name || "", marginX, nameY);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9.5);
    pdf.setTextColor(...INK_SOFT);
    const addrLines = pdf.splitTextToSize([company.address, company.email, company.phone].filter(Boolean).join("\n"), 250);
    pdf.text(addrLines, marginX, nameY + 18);

    pdf.setFont("times", "bold");
    pdf.setFontSize(20);
    pdf.setTextColor(...ACCENT);
    pdf.text("Retainer Agreement", pageW - marginX, y + 6, { align: "right" });
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9.5);
    pdf.setTextColor(...INK_SOFT);
    if (r.title) pdf.text(pdf.splitTextToSize(r.title, 220), pageW - marginX, y + 24, { align: "right" });

    y = Math.max(nameY + 18 + addrLines.length * 11, y + 70) + 24;

    // Key terms box
    const clientLines = pdf.splitTextToSize([r.client_name, r.client_address, r.client_email].filter(Boolean).join("\n") || "—", contentW / 2 - 24);
    const terms = [
      ["Monthly fee", r.monthly_fee ? `R${money(Number(r.monthly_fee))}` : "—"],
      ["Start date", r.start_date ? fmtDate(r.start_date) : "—"],
      ["Term", r.term_months ? `${r.term_months} months` : "—"]
    ];
    const boxH = Math.max(28 + clientLines.length * 12, 28 + terms.length * 15) + 10;
    pdf.setFillColor(...PAPER_ALT);
    pdf.roundedRect(marginX, y - 16, contentW, boxH, 4, 4, "F");
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8.5);
    pdf.setTextColor(...INK_SOFT);
    pdf.text("CLIENT", marginX + 14, y);
    pdf.text("KEY TERMS", marginX + contentW / 2 + 6, y);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(10);
    pdf.setTextColor(...INK);
    pdf.text(clientLines, marginX + 14, y + 16);
    terms.forEach(([k, v], i) => {
      pdf.setTextColor(...INK_SOFT);
      pdf.text(k, marginX + contentW / 2 + 6, y + 16 + i * 15);
      pdf.setTextColor(...INK);
      pdf.text(v, pageW - marginX - 14, y + 16 + i * 15, { align: "right" });
    });
    y += boxH + 14;

    function ensure(h) {
      if (y + h > bottom) {
        pdf.addPage();
        y = 60;
      }
    }

    // Agreement body
    const lines = (r.agreement_text || "").replace(/\r/g, "").split("\n");
    for (const raw of lines) {
      const line = raw.trimEnd();
      if (!line.trim()) {
        y += 6;
        continue;
      }
      if (/^#{1,3}\s+/.test(line)) {
        const text = line.replace(/^#{1,3}\s+/, "");
        ensure(40);
        y += 8;
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(10.5);
        pdf.setTextColor(...ACCENT);
        const hl = pdf.splitTextToSize(text, contentW);
        pdf.text(hl, marginX, y);
        y += hl.length * 13 + 4;
        continue;
      }
      const clause = line.match(/^(\s*(?:\d+(?:\.\d+)*\.?|[a-z]\)|\([a-z0-9]+\)|-|•))\s+(.*)$/i);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(9.5);
      pdf.setTextColor(...INK);
      if (clause) {
        const label = clause[1].trim() === "-" ? "•" : clause[1].trim();
        const indent = label.length > 4 ? 34 : 26;
        const wrapped = pdf.splitTextToSize(clause[2], contentW - indent);
        for (let i = 0; i < wrapped.length; i++) {
          ensure(13);
          if (i === 0) pdf.text(label, marginX, y);
          pdf.text(wrapped[i], marginX + indent, y);
          y += 12.5;
        }
      } else {
        const wrapped = pdf.splitTextToSize(line.trim(), contentW);
        for (const w of wrapped) {
          ensure(13);
          pdf.text(w, marginX, y);
          y += 12.5;
        }
      }
      y += 2;
    }

    // Signatures
    ensure(170);
    y += 24;
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(10.5);
    pdf.setTextColor(...ACCENT);
    pdf.text("Signatures", marginX, y);
    y += 30;
    const colW = (contentW - 40) / 2;
    [
      ["For the Service Provider", company.name || "", marginX],
      ["For the Client", r.client_name || "", marginX + colW + 40]
    ].forEach(([heading, party, x]) => {
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(9);
      pdf.setTextColor(...INK);
      pdf.text(heading, x, y);
      pdf.setFont("helvetica", "normal");
      pdf.setTextColor(...INK_SOFT);
      pdf.text(pdf.splitTextToSize(party, colW)[0] || "", x, y + 13);
      pdf.setDrawColor(...LINE);
      pdf.setLineWidth(0.75);
      ["Signature", "Full name", "Date"].forEach((lbl, i) => {
        const ly = y + 50 + i * 34;
        pdf.line(x, ly, x + colW, ly);
        pdf.setFontSize(8.5);
        pdf.text(lbl, x, ly + 11);
      });
    });

    // Page numbers
    const pages = pdf.internal.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      pdf.setPage(i);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(8);
      pdf.setTextColor(...INK_SOFT);
      pdf.text(`Page ${i} of ${pages}   ·   Initials: ______  ______`, pageW / 2, pageH - 24, { align: "center" });
    }

    const safeClient = (r.client_name || "client").replace(/[^a-zA-Z0-9_-]+/g, "_");
    pdf.save(`Retainer_${safeClient}_${r.start_date || todayISO()}.pdf`);
  } catch (err) {
    console.error(err);
    alert("Couldn't generate the agreement PDF. Please try again.");
  }
}

// ---------------- Topbar ----------------
// ---------------- Jobflow brand ----------------
// Logo: a spark (electrical) and a water drop (plumbing). The spark flickers
// now and then and the drop gently bobs. Motion stops if the phone asks for
// reduced motion.
function JobflowLogo({ size = 40 }) {
  return (
    <svg className="jf-logo" viewBox="0 0 64 64" width={size} height={size} role="img" aria-label="Jobflow">
      <path
        className="jf-bolt"
        d="M22 6 L10 34 H22 L16 58 L38 26 H26 L32 6 Z"
        fill="#FFC300"
        stroke="#FF8A00"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <g className="jf-drop">
        <path d="M46 22 C46 22 56 34 56 42 a10 10 0 0 1 -20 0 C36 34 46 22 46 22 Z" fill="#3A86FF" />
        <circle cx="42" cy="42" r="2.5" fill="#fff" />
      </g>
    </svg>
  );
}

function JobflowWordmark({ big = false }) {
  return <span className={`jf-word${big ? " jf-word-big" : ""}`}>Jobflow</span>;
}

// ---------------- Light / dark theme ----------------
function getTheme() {
  try {
    const saved = localStorage.getItem("jf-theme");
    if (saved === "light" || saved === "dark") return saved;
  } catch (e) {}
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
function applyTheme(t) {
  document.documentElement.setAttribute("data-theme", t);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", t === "dark" ? "#0B1016" : "#1B2430");
}
if (typeof document !== "undefined") applyTheme(getTheme());

function ThemeToggle({ className = "tb-btn" }) {
  const [theme, setTheme] = useState(() => document.documentElement.getAttribute("data-theme") || getTheme());
  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    applyTheme(next);
    try {
      localStorage.setItem("jf-theme", next);
    } catch (e) {}
    setTheme(next);
  }
  return (
    <button className={`${className} theme-btn`} onClick={toggle} aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"} title={theme === "dark" ? "Light mode" : "Dark mode"}>
      <span className={`theme-ico ${theme}`} aria-hidden="true">
        {theme === "dark" ? "☀" : "☾"}
      </span>
    </button>
  );
}

// ---------------- Install the app (phone home screen / desktop) ----------------
let deferredInstall = null;
const installListeners = new Set();
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstall = e;
    installListeners.forEach((fn) => fn());
  });
  window.addEventListener("appinstalled", () => {
    deferredInstall = null;
    installListeners.forEach((fn) => fn());
  });
}
function isStandalone() {
  return (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || window.navigator.standalone === true;
}
function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function InstallButton({ className = "tb-btn", label = "Install app" }) {
  const [, force] = useState(0);
  const [help, setHelp] = useState(false);
  useEffect(() => {
    const fn = () => force((x) => x + 1);
    installListeners.add(fn);
    return () => installListeners.delete(fn);
  }, []);
  if (isStandalone()) return null;
  const ios = isIOS();
  if (!deferredInstall && !ios) return null;
  async function install() {
    if (deferredInstall) {
      deferredInstall.prompt();
      try {
        await deferredInstall.userChoice;
      } catch (e) {}
      deferredInstall = null;
      force((x) => x + 1);
    } else {
      setHelp(true);
    }
  }
  return (
    <>
      <button className={`${className} install-btn`} onClick={install} title="Install Jobflow on this device">
        <span aria-hidden="true">⬇</span> <span className="install-label">{label}</span>
      </button>
      {help && (
        <div className="install-help" role="dialog" aria-label="Install on iPhone" onClick={() => setHelp(false)}>
          <div className="install-card" onClick={(e) => e.stopPropagation()}>
            <JobflowLogo size={48} />
            <h3>Install Jobflow</h3>
            <ol>
              <li>Tap the <b>Share</b> button in Safari (the square with an arrow).</li>
              <li>Scroll down and tap <b>Add to Home Screen</b>.</li>
              <li>Tap <b>Add</b>. Jobflow appears on your home screen like a normal app.</li>
            </ol>
            <button className="btn btn-primary" onClick={() => setHelp(false)}>
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// ---------------- Sign-in layout: brand panel with rotating messages ----------------
const AUTH_SLIDES = [
  ["Quote, job, invoice — done", "Send professional quotes and invoices in minutes, and turn an accepted quote into an invoice with one tap."],
  ["Job cards from site", "Technicians log the work, spares, photos and hardware receipts on their phones. Download a clean PDF job card."],
  ["Retainers made easy", "The AI assistant prices monthly maintenance contracts and writes the agreement for you."]
];

// Live background for the sign-in panel: a cable with current pulsing along
// it and sparks flying off, plus water droplets falling and splashing.
// Drawn on a canvas; pauses when hidden and switches off for reduced motion.
function AuthFx() {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0, h = 0, dpr = 1, raf = 0, last = performance.now();
    let drops = [], parts = [], ripples = [], flashes = [], arcs = [], motes = [];
    let nextDrop = 0, nextSpark = 500, nextArc = 1200;
    const pulses = [0, 0.6];

    function resize() {
      const r = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = r.width; h = r.height;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // floating motes spread over the whole panel
      motes = Array.from({ length: Math.round((w * h) / 4200) }, () => newMote(true));
    }
    function newMote(anywhere) {
      const water = Math.random() < 0.5;
      return { x: Math.random() * w, y: anywhere ? Math.random() * h : h + 6, vy: 8 + Math.random() * 18, sway: Math.random() * 6.28, r: water ? 1 + Math.random() * 2.2 : 0.8 + Math.random() * 1.4, water, tw: Math.random() * 6.28 };
    }
    // Two cables: one hanging near the top, one near the bottom.
    function wire(i, t) {
      const c = i === 0
        ? { x0: -30, y0: 8, x2: w + 30, y2: 18, cx: w * 0.55, cy: 58 }
        : { x0: -30, y0: h - 34, x2: w + 30, y2: h - 52, cx: w * 0.45, cy: h + 6 };
      const u = 1 - t;
      return { x: u * u * c.x0 + 2 * u * t * c.cx + t * t * c.x2, y: u * u * c.y0 + 2 * u * t * c.cy + t * t * c.y2 };
    }
    function drawWires() {
      ctx.lineCap = "round";
      for (let i = 0; i < 2; i++) {
        ctx.beginPath();
        for (let k = 0; k <= 40; k++) { const p = wire(i, k / 40); k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }
        ctx.strokeStyle = "rgba(8,12,18,0.9)"; ctx.lineWidth = 6; ctx.stroke();
        ctx.strokeStyle = "rgba(120,135,155,0.35)"; ctx.lineWidth = 1.5; ctx.stroke();
      }
    }
    function spark() {
      const i = Math.random() < 0.55 ? 1 : 0, t = 0.15 + Math.random() * 0.7, p = wire(i, t);
      flashes.push({ x: p.x, y: p.y, life: 0, max: 0.35 });
      const n = 24 + Math.floor(Math.random() * 22);
      for (let k = 0; k < n; k++) {
        const a = i === 1 ? -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.3 : Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.4;
        const v = 90 + Math.random() * 260;
        parts.push({ x: p.x, y: p.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, max: 0.4 + Math.random() * 0.7, kind: "spark" });
      }
    }
    // Lightning arc jumping between two points anywhere on the panel.
    function arc() {
      const x1 = Math.random() * w, y1 = Math.random() * h * 0.9;
      const ang = Math.random() * Math.PI * 2, len = 60 + Math.random() * Math.min(w, h) * 0.6;
      const x2 = Math.max(0, Math.min(w, x1 + Math.cos(ang) * len)), y2 = Math.max(0, Math.min(h, y1 + Math.sin(ang) * len));
      const pts = [];
      const steps = 10 + Math.floor(len / 18);
      for (let k = 0; k <= steps; k++) {
        const t = k / steps, j = k === 0 || k === steps ? 0 : (Math.random() - 0.5) * 22;
        pts.push({ x: x1 + (x2 - x1) * t + j * Math.sin(ang), y: y1 + (y2 - y1) * t - j * Math.cos(ang) });
      }
      arcs.push({ pts, life: 0, max: 0.32, hue: Math.random() < 0.6 ? "blue" : "gold" });
    }
    function addDrop() {
      drops.push({ x: 10 + Math.random() * (w - 20), y: -12, vy: 40 + Math.random() * 60, r: 2.8 + Math.random() * 2.6 });
    }
    function splash(x, y, r) {
      ripples.push({ x, y, life: 0, max: 0.7, r });
      for (let k = 0; k < 6; k++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2, v = 40 + Math.random() * 70;
        parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, max: 0.45 + Math.random() * 0.3, kind: "water" });
      }
    }
    function frame(now) {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      ctx.clearRect(0, 0, w, h);

      // motes: tiny bubbles and embers drifting up across the whole background
      for (const m of motes) {
        m.y -= m.vy * dt; m.sway += dt * 1.4; m.tw += dt * 3;
        if (m.y < -8) Object.assign(m, newMote(false));
        const x = m.x + Math.sin(m.sway) * 6, a = 0.25 + 0.25 * Math.sin(m.tw);
        if (m.water) {
          ctx.strokeStyle = `rgba(140,190,255,${a + 0.1})`; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(x, m.y, m.r, 0, Math.PI * 2); ctx.stroke();
        } else {
          ctx.fillStyle = `rgba(255,200,80,${a + 0.15})`;
          ctx.beginPath(); ctx.arc(x, m.y, m.r, 0, Math.PI * 2); ctx.fill();
        }
      }

      drawWires();
      // current pulses travelling along both cables
      ctx.save(); ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < 2; i++) {
        pulses[i] += dt * (i ? 0.45 : 0.38); if (pulses[i] > 1.4) pulses[i] = 0;
        const pt = pulses[i];
        if (pt > 1) continue;
        for (let k = 0; k < 10; k++) {
          const tt = pt - k * 0.012; if (tt < 0) break;
          const p = wire(i, tt);
          ctx.fillStyle = `rgba(255,${210 - k * 8},${80 - k * 6},${0.75 - k * 0.07})`;
          ctx.beginPath(); ctx.arc(p.x, p.y, 3.2 - k * 0.22, 0, Math.PI * 2); ctx.fill();
        }
      }
      ctx.restore();

      nextDrop -= dt * 1000; if (nextDrop <= 0) { addDrop(); nextDrop = 220 + Math.random() * 360; }
      nextSpark -= dt * 1000; if (nextSpark <= 0) { spark(); nextSpark = 800 + Math.random() * 1400; }
      nextArc -= dt * 1000; if (nextArc <= 0) { arc(); nextArc = 1600 + Math.random() * 2600; }

      // falling drops
      for (let i = drops.length - 1; i >= 0; i--) {
        const d = drops[i];
        d.vy += 520 * dt; d.y += d.vy * dt;
        const tw = Math.max(0, Math.min(1, (d.x + 30) / (w + 60)));
        const wy = wire(1, tw).y;
        if (Math.abs(d.y - wy) < 4 && Math.random() < 0.35) { splash(d.x, wy, d.r); drops.splice(i, 1); continue; }
        if (d.y >= h - 4) { splash(d.x, h - 4, d.r); drops.splice(i, 1); continue; }
        ctx.fillStyle = "rgba(90,160,255,0.7)";
        ctx.beginPath();
        ctx.moveTo(d.x, d.y - d.r * 3);
        ctx.quadraticCurveTo(d.x + d.r * 1.4, d.y, d.x, d.y + d.r);
        ctx.quadraticCurveTo(d.x - d.r * 1.4, d.y, d.x, d.y - d.r * 3);
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.55)";
        ctx.beginPath(); ctx.arc(d.x - d.r * 0.35, d.y - d.r * 0.2, d.r * 0.3, 0, Math.PI * 2); ctx.fill();
      }
      for (let i = ripples.length - 1; i >= 0; i--) {
        const r = ripples[i]; r.life += dt; const k = r.life / r.max;
        if (k >= 1) { ripples.splice(i, 1); continue; }
        ctx.strokeStyle = `rgba(120,180,255,${0.45 * (1 - k)})`; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.ellipse(r.x, r.y, 4 + k * 18 * (r.r / 3), 1.5 + k * 4, 0, 0, Math.PI * 2); ctx.stroke();
      }

      ctx.save(); ctx.globalCompositeOperation = "lighter";
      // lightning arcs
      for (let i = arcs.length - 1; i >= 0; i--) {
        const A = arcs[i]; A.life += dt; const k = A.life / A.max;
        if (k >= 1) { arcs.splice(i, 1); continue; }
        if (Math.random() < 0.3) continue; // flicker
        const col = A.hue === "blue" ? "150,205,255" : "255,215,120";
        ctx.lineJoin = "round";
        [[7, 0.12], [3, 0.35], [1.3, 0.95]].forEach(([lw, al]) => {
          ctx.strokeStyle = `rgba(${col},${al * (1 - k)})`; ctx.lineWidth = lw;
          ctx.beginPath(); A.pts.forEach((p, n) => (n ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke();
        });
      }
      for (let i = flashes.length - 1; i >= 0; i--) {
        const f = flashes[i]; f.life += dt; const k = f.life / f.max;
        if (k >= 1) { flashes.splice(i, 1); continue; }
        const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, 46);
        g.addColorStop(0, `rgba(255,240,180,${0.8 * (1 - k)})`); g.addColorStop(1, "rgba(255,160,0,0)");
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(f.x, f.y, 46, 0, Math.PI * 2); ctx.fill();
      }
      for (let i = parts.length - 1; i >= 0; i--) {
        const q = parts[i]; q.life += dt; const k = q.life / q.max;
        if (k >= 1) { parts.splice(i, 1); continue; }
        q.vy += (q.kind === "spark" ? 420 : 380) * dt; q.vx *= 0.99;
        const px = q.x, py = q.y; q.x += q.vx * dt; q.y += q.vy * dt;
        if (q.kind === "spark") {
          ctx.strokeStyle = `rgba(255,${Math.round(230 - 120 * k)},${Math.round(120 - 110 * k)},${1 - k})`;
          ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(q.x, q.y); ctx.stroke();
        } else {
          ctx.fillStyle = `rgba(140,190,255,${0.7 * (1 - k)})`;
          ctx.beginPath(); ctx.arc(q.x, q.y, 1.3, 0, Math.PI * 2); ctx.fill();
        }
      }
      ctx.restore();
      raf = requestAnimationFrame(frame);
    }
    resize();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
    ro && ro.observe(canvas);
    if (reduce) { drawWires(); } else { raf = requestAnimationFrame(frame); }
    return () => { cancelAnimationFrame(raf); ro && ro.disconnect(); };
  }, []);
  return <canvas ref={ref} className="auth-fx" aria-hidden="true" />;
}

function AuthLayout({ children }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((x) => (x + 1) % AUTH_SLIDES.length), 5500);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="auth">
      <aside className="auth-brand">
        <div className="auth-glow" aria-hidden="true" />
        <AuthFx />
        <div className="auth-brand-top">
          <JobflowLogo size={48} />
          <JobflowWordmark />
          <div className="auth-theme">
            <InstallButton />
            <ThemeToggle />
          </div>
        </div>
        <div className="auth-hero">
          <div className="auth-kicker">By Kabir Singh</div>
          <p className="auth-lead">Your complete job platform — quotes, job cards, invoices, retainers and everything in between.</p>
          <div className="auth-slides">
            {AUTH_SLIDES.map(([title, text], k) => (
              <div key={k} className={`auth-slide${k === i ? " on" : ""}`} aria-hidden={k !== i}>
                <h3>{title}</h3>
                <p>{text}</p>
              </div>
            ))}
          </div>
          <div className="auth-dots">
            {AUTH_SLIDES.map((_, k) => (
              <button key={k} className={k === i ? "on" : ""} onClick={() => setI(k)} aria-label={`Show message ${k + 1}`} />
            ))}
          </div>
        </div>
        <div className="auth-foot">© {new Date().getFullYear()} Jobflow</div>
      </aside>
      <main className="auth-main">{children}</main>
    </div>
  );
}

// Navigation set by <App> on every render (Back / Home buttons in the top bar).
let appNav = { onBack: null, onHome: null, atHome: true };

function Topbar({ company, onLogout, onEdit, subtitle }) {
  const nav = appNav;
  const showNav = !!company && !nav.atHome;
  return (
    <header className="topbar">
      <div className="topbar-row">
        <button
          className="topbar-co"
          onClick={() => company && nav.onHome && nav.onHome()}
          aria-label="Jobflow home"
          title={company ? "Home" : undefined}
        >
          <JobflowLogo size={40} />
          <div className="topbar-names">
            <JobflowWordmark />
            <div className="topbar-sub">{company ? company.name + (subtitle ? ` · ${subtitle}` : "") : "Quotes, job cards & invoices"}</div>
          </div>
        </button>
        <div className="topbar-actions">
          <InstallButton label="Install" />
          <ThemeToggle />
          {company && onEdit && (
              <button className="tb-btn" onClick={onEdit}>
                Settings
              </button>
            )}
          {company && (
            <button className="tb-btn" onClick={onLogout}>
              Sign out
            </button>
          )}
        </div>
      </div>
      {showNav && (
        <nav className="topbar-nav">
          <button className="nav-btn" onClick={() => nav.onBack && nav.onBack()}>
            <span aria-hidden="true">←</span> Back
          </button>
          <button className="nav-btn" onClick={() => nav.onHome && nav.onHome()}>
            <span aria-hidden="true">⌂</span> Home
          </button>
        </nav>
      )}
    </header>
  );
}

// ---------------- Logo picker (shared by setup + settings) ----------------
function LogoPicker({ value, onChange }) {
  const fileRef = useRef(null);
  function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => onChange(reader.result);
    reader.readAsDataURL(file);
  }
  return (
    <div className="field">
      <label>Logo (optional)</label>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {value && (
          <img
            src={value}
            alt=""
            style={{ width: 44, height: 44, borderRadius: "50%", objectFit: "contain", border: "1px solid var(--line)" }}
          />
        )}
        <input ref={fileRef} type="file" accept="image/*" style={{ flex: 1 }} onChange={handleFile} />
      </div>
      <button type="button" className="btn btn-sm" style={{ marginTop: 8 }} onClick={() => onChange(boltLogoPNG())}>
        ⚡ Use lightning bolt icon
      </button>
      {value && (
        <button
          type="button"
          className="btn btn-sm btn-quiet"
          style={{ marginTop: 8, marginLeft: 8 }}
          onClick={() => onChange(null)}
        >
          Remove logo
        </button>
      )}
    </div>
  );
}

// ---------------- Setup screen (creates a company row) ----------------
function Setup({ which, existingUsernames, onCreated }) {
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [logo, setLogo] = useState(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleContinue() {
    if (!name.trim() || !username.trim() || !password) {
      setError("Company name, username and password are required.");
      return;
    }
    if (existingUsernames.some((u) => u.toLowerCase() === username.trim().toLowerCase())) {
      setError("That username is already used by the other company. Pick a different one.");
      return;
    }
    setSaving(true);
    const { error: insertError } = await supabase.from("companies").insert({
      name: name.trim(),
      address: address.trim(),
      email: email.trim(),
      phone: phone.trim(),
      logo,
      username: username.trim(),
      password,
      quote_counter: 1,
      invoice_counter: 1
    });
    setSaving(false);
    if (insertError) {
      setError("Couldn't save: " + insertError.message);
      return;
    }
    onCreated();
  }

  return (
    <>
      <Topbar company={null} />
      <div className="center-screen">
        <div className="panel" style={{ maxWidth: 440 }}>
          <h1>Set up your {which === "A" ? "first company" : "second company"}</h1>
          <p className="sub">
            {which === "A"
              ? "Let's get both companies set up. This takes a minute."
              : "Now the second company — its documents and login stay completely separate."}
          </p>
          <div className="field">
            <label>Company name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Alder & Co" />
          </div>
          <div className="field">
            <label>Address</label>
            <textarea rows={3} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street, city, postcode, country" />
          </div>
          <div className="field-row">
            <div className="field">
              <label>Email</label>
              <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="billing@company.com" />
            </div>
            <div className="field">
              <label>Phone</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Optional" />
            </div>
          </div>
          <LogoPicker value={logo} onChange={setLogo} />
          <p className="hint" style={{ marginTop: -8, marginBottom: 16 }}>
            You can add banking details after setup, from "Edit logo" in the top bar.
          </p>
          <div className="field">
            <label>Login username</label>
            <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="e.g. alder-admin" />
          </div>
          <div className="field">
            <label>Login password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Choose a password" />
          </div>
          <p className="hint">
            This keeps the two companies' data apart in the app — it isn't strong security (see the README), so don't reuse a sensitive password.
          </p>
          {error && <div className="error-msg">{error}</div>}
          <button className="btn btn-primary" style={{ width: "100%", marginTop: 10 }} disabled={saving} onClick={handleContinue}>
            {saving ? "Saving…" : which === "A" ? "Continue to second company" : "Finish setup"}
          </button>
        </div>
      </div>
    </>
  );
}

// ---------------- Login ----------------
function Login({ companies, technicians, onLoggedIn }) {
  const [picked, setPicked] = useState(null);
  const [role, setRole] = useState("admin");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  if (!picked) {
    return (
      <AuthLayout>
          <div className="auth-card">
            <h1 className="pick-title">Choose a company to sign in</h1>
            <div className="company-tiles">
              {companies.map((c) => (
                <button key={c.id} className="company-tile" style={{ cursor: "pointer" }} onClick={() => setPicked(c)}>
                  {c.logo ? (
                    <img src={c.logo} alt="" />
                  ) : (
                    <div className="logo-fallback">{c.name.slice(0, 1).toUpperCase()}</div>
                  )}
                  <div className="tname">{c.name}</div>
                </button>
              ))}
            </div>
          </div>
      </AuthLayout>
    );
  }

  function submit() {
    const u = username.trim();
    const match = technicians.find((t) => t.company_id === picked.id && t.username === u && t.password === password);
    const matchRole = match ? userRole(match) : null;
    if (role === "admin") {
      // The company's main login is always the super admin.
      if (u === picked.username && password === picked.password) {
        onLoggedIn({ role: "admin", superAdmin: true, company: picked, user: null });
        return;
      }
      if (match && (matchRole === "admin" || matchRole === "super_admin")) {
        onLoggedIn({ role: "admin", superAdmin: matchRole === "super_admin", company: picked, user: match });
        return;
      }
    } else if (match && matchRole === "technician") {
      onLoggedIn({ role: "technician", superAdmin: false, company: picked, technician: match, user: match });
      return;
    }
    setError("Incorrect username or password.");
  }

  return (
    <AuthLayout>
        <div className="panel auth-card">
          <h1>{picked.name}</h1>
          <p className="sub">Choose how you're signing in.</p>
          <div className="field">
            <label>Sign in as</label>
            <select
              value={role}
              onChange={(e) => {
                setRole(e.target.value);
                setError("");
              }}
            >
              <option value="admin">Admin</option>
              <option value="technician">Technician</option>
            </select>
          </div>
          <div className="field">
            <label>Username</label>
            <input value={username} onChange={(e) => setUsername(e.target.value)} />
          </div>
          <div className="field">
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
          </div>
          {error && <div className="error-msg">{error}</div>}
          <button className="btn btn-primary" style={{ width: "100%" }} onClick={submit}>
            Sign in
          </button>
          <button
            className="btn btn-quiet"
            style={{ width: "100%", marginTop: 8 }}
            onClick={() => {
              setPicked(null);
              setError("");
            }}
          >
            ← Choose a different company
          </button>
        </div>
    </AuthLayout>
  );
}

// ---------------- Settings (edit company / logo) ----------------
function Settings({ company, onSaved, onCancel, onLogout }) {
  const [name, setName] = useState(company.name);
  const [address, setAddress] = useState(company.address || "");
  const [email, setEmail] = useState(company.email || "");
  const [phone, setPhone] = useState(company.phone || "");
  const [logo, setLogo] = useState(company.logo || null);
  const [bankAccountHolder, setBankAccountHolder] = useState(company.bank_account_holder || "");
  const [bankName, setBankName] = useState(company.bank_name || "");
  const [bankAccountType, setBankAccountType] = useState(company.bank_account_type || "");
  const [bankBranchCode, setBankBranchCode] = useState(company.bank_branch_code || "");
  const [bankAccountNumber, setBankAccountNumber] = useState(company.bank_account_number || "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const { data, error } = await supabase
      .from("companies")
      .update({
        name: name.trim() || company.name,
        address: address.trim(),
        email: email.trim(),
        phone: phone.trim(),
        logo,
        bank_account_holder: bankAccountHolder.trim(),
        bank_name: bankName.trim(),
        bank_account_type: bankAccountType.trim(),
        bank_branch_code: bankBranchCode.trim(),
        bank_account_number: bankAccountNumber.trim()
      })
      .eq("id", company.id)
      .select()
      .single();
    setSaving(false);
    if (error) {
      alert("Couldn't save: " + error.message);
      return;
    }
    onSaved(data);
  }

  return (
    <>
      <Topbar company={company} onLogout={onLogout} />
      <div className="container" style={{ maxWidth: 520 }}>
        <h1 className="serif" style={{ fontSize: 21, margin: "0 0 20px" }}>
          Company details
        </h1>
        <LogoPicker value={logo} onChange={setLogo} />
        <div className="field">
          <label>Company name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label>Address</label>
          <textarea rows={3} value={address} onChange={(e) => setAddress(e.target.value)} />
        </div>
        <div className="field-row">
          <div className="field">
            <label>Email</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="field">
            <label>Phone</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
        </div>
        <h3 style={{ fontSize: "12.5px", textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--ink-soft)", margin: "22px 0 12px", fontWeight: 600 }}>
          Banking details (shown on every quote &amp; invoice)
        </h3>
        <div className="field-row">
          <div className="field">
            <label>Account Holder</label>
            <input value={bankAccountHolder} onChange={(e) => setBankAccountHolder(e.target.value)} placeholder="e.g. Kabir Singh" />
          </div>
          <div className="field">
            <label>Bank Name</label>
            <input value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="e.g. Nedbank" />
          </div>
        </div>
        <div className="field-row">
          <div className="field">
            <label>Account Type</label>
            <input value={bankAccountType} onChange={(e) => setBankAccountType(e.target.value)} placeholder="e.g. Current Account" />
          </div>
          <div className="field">
            <label>Branch Code</label>
            <input value={bankBranchCode} onChange={(e) => setBankBranchCode(e.target.value)} placeholder="e.g. 198765" />
          </div>
        </div>
        <div className="field">
          <label>Account Number</label>
          <input value={bankAccountNumber} onChange={(e) => setBankAccountNumber(e.target.value)} placeholder="e.g. 1342914503" />
        </div>
        <div className="form-actions">
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={saving} onClick={save}>
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </>
  );
}

// ---------------- Admin section tabs (shared by document/job-card/technician screens) ----------------
// ---------------- Roles ----------------
// technician  = job cards only
// admin       = everything, except managing users
// super_admin = everything, including creating users and setting passwords
// The company's main login (from setup) is always a super admin.
const ROLE_LABELS = { technician: "Technician", admin: "Admin", super_admin: "Super admin" };
function userRole(u) {
  return u?.role && ROLE_LABELS[u.role] ? u.role : "technician";
}
// Set by <App> on every render so the tabs know whether to show "Users".
let currentUserIsSuperAdmin = false;

function AdminTabs({ active, onChange }) {
  const tabs = [
    ["documents", "Quotes & Invoices"],
    ["jobcards", "Job Cards"],
    ["retainers", "Retainers"]
  ];
  if (currentUserIsSuperAdmin) tabs.push(["technicians", "Users"]);
  return (
    <div className="tabs">
      {tabs.map(([key, label]) => (
        <button key={key} className={`tab tab-${key} ${active === key ? "active" : ""}`} onClick={() => onChange(key)}>
          {label}
        </button>
      ))}
    </div>
  );
}

// ---------------- Dashboard ----------------
function Dashboard({ company, docs, onLogout, onEdit, onNew, onOpen, filter, setFilter, onSection }) {
  const filtered = docs.filter((d) => (filter === "all" ? true : d.type === filter));
  return (
    <>
      <Topbar company={company} onLogout={onLogout} onEdit={onEdit} />
      <div className="container">
        {onSection && <AdminTabs active="documents" onChange={onSection} />}
        <div className="toolbar">
          <div className="filters">
            {["all", "quote", "invoice"].map((f) => (
              <button key={f} className={`chip ${filter === f ? "active" : ""}`} onClick={() => setFilter(f)}>
                {f === "all" ? "All" : f === "quote" ? "Quotes" : "Invoices"}
              </button>
            ))}
          </div>
          <button className="btn btn-primary" onClick={onNew}>
            + New document
          </button>
        </div>
        {filtered.length === 0 ? (
          <div className="empty-state">
            <div className="big">Nothing here yet</div>
            <div>Create your first quote or invoice for {company.name}.</div>
          </div>
        ) : (
          <div className="doclist-wrap">
            <table className="doclist">
              <thead>
                <tr>
                  <th>Number</th>
                  <th>Type</th>
                  <th>Client</th>
                  <th>Date</th>
                  <th>Status</th>
                  <th style={{ textAlign: "right" }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {filtered
                  .slice()
                  .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
                  .map((d) => {
                    const t = computeTotals(d.items, d.tax_enabled ? d.tax_rate : 0);
                    return (
                      <tr key={d.id} className="row" onClick={() => onOpen(d)}>
                        <td className="num-cell">{d.number}</td>
                        <td>
                          <span className={`type-pill ${d.type === "quote" ? "type-quote" : "type-invoice"}`}>
                            {d.type === "quote" ? "Quote" : "Invoice"}
                          </span>
                        </td>
                        <td>{d.client_name}</td>
                        <td>{fmtDate(d.issue_date)}</td>
                        <td>
                          <span className={`status-pill status-${d.status}`}>{d.status}</span>
                        </td>
                        <td className="amt-cell">R{money(t.total)}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

// ---------------- New / edit document form ----------------
function DocumentForm({ company, initial, onCancel, onSaved, onUpdated, onLogout, onEdit }) {
  const isEditing = !!initial.editingId;
  const [type, setType] = useState(initial.type);
  const [clientName, setClientName] = useState(initial.client.name);
  const [clientEmail, setClientEmail] = useState(initial.client.email);
  const [clientAddress, setClientAddress] = useState(initial.client.address);
  const [issueDate, setIssueDate] = useState(initial.issueDate);
  const [dueDate, setDueDate] = useState(initial.dueDate);
  const [items, setItems] = useState(initial.items);
  const [taxEnabled, setTaxEnabled] = useState(initial.taxEnabled !== undefined ? initial.taxEnabled : true);
  const [taxRate, setTaxRate] = useState(initial.taxRate);
  const [notes, setNotes] = useState(initial.notes);
  const [terms, setTerms] = useState(initial.terms);
  const [saving, setSaving] = useState(false);

  const totals = computeTotals(items, taxEnabled ? taxRate : 0);

  function updateItem(idx, field, value) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, [field]: value } : it)));
  }
  function addRow() {
    setItems((prev) => [...prev, { desc: "", qty: 1, price: 0 }]);
  }
  function removeRow(idx) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  async function save() {
    if (!clientName.trim()) {
      alert("Please add a client name before saving.");
      return;
    }
    let cleanItems = items.filter((it) => it.desc.trim() !== "" || Number(it.price) > 0);
    if (cleanItems.length === 0) cleanItems = [{ desc: "Item", qty: 1, price: 0 }];
    cleanItems = cleanItems.map((it) => ({ desc: it.desc, qty: Number(it.qty) || 0, price: Number(it.price) || 0 }));

    setSaving(true);

    if (isEditing) {
      const { data: updatedDoc, error: updateError } = await supabase
        .from("documents")
        .update({
          client_name: clientName.trim(),
          client_address: clientAddress.trim(),
          client_email: clientEmail.trim(),
          issue_date: issueDate,
          due_date: dueDate,
          items: cleanItems,
          tax_enabled: taxEnabled,
          tax_rate: taxEnabled ? Number(taxRate) || 0 : 0,
          notes: notes.trim(),
          terms: terms.trim()
        })
        .eq("id", initial.editingId)
        .select()
        .single();

      setSaving(false);
      if (updateError) {
        alert("Couldn't save: " + updateError.message);
        return;
      }
      onUpdated(updatedDoc);
      return;
    }

    const number = nextNumber(company, type);

    const { data: newDoc, error: insertError } = await supabase
      .from("documents")
      .insert({
        company_id: company.id,
        type,
        number,
        status: "draft",
        client_name: clientName.trim(),
        client_address: clientAddress.trim(),
        client_email: clientEmail.trim(),
        issue_date: issueDate,
        due_date: dueDate,
        items: cleanItems,
        tax_enabled: taxEnabled,
        tax_rate: taxEnabled ? Number(taxRate) || 0 : 0,
        notes: notes.trim(),
        terms: terms.trim(),
        converted_from_id: initial.convertedFromId || null
      })
      .select()
      .single();

    if (insertError) {
      setSaving(false);
      alert("Couldn't save: " + insertError.message);
      return;
    }

    const counterField = type === "quote" ? "quote_counter" : "invoice_counter";
    const { data: updatedCompany } = await supabase
      .from("companies")
      .update({ [counterField]: (company[counterField] || 1) + 1 })
      .eq("id", company.id)
      .select()
      .single();

    if (initial.convertedFromId) {
      await supabase.from("documents").update({ status: "converted" }).eq("id", initial.convertedFromId);
    }

    setSaving(false);
    onSaved(newDoc, updatedCompany || company);
  }

  return (
    <>
      <Topbar company={company} onLogout={onLogout} onEdit={onEdit} />
      <div className="container">
        <div className="type-toggle">
          <button className={type === "quote" ? "active" : ""} disabled={isEditing} onClick={() => !isEditing && setType("quote")}>
            Quote
          </button>
          <button className={type === "invoice" ? "active" : ""} disabled={isEditing} onClick={() => !isEditing && setType("invoice")}>
            Invoice
          </button>
        </div>
        {isEditing && (
          <p className="hint" style={{ marginTop: -14, marginBottom: 18 }}>
            Editing {initial.number} — the type and number stay fixed once created.
          </p>
        )}

        <div className="form-section">
          <h3>Client</h3>
          <div className="field-row">
            <div className="field">
              <label>Client name</label>
              <input value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="e.g. Northwind Traders" />
            </div>
            <div className="field">
              <label>Client email</label>
              <input value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} placeholder="Optional" />
            </div>
          </div>
          <div className="field">
            <label>Client address</label>
            <textarea rows={2} value={clientAddress} onChange={(e) => setClientAddress(e.target.value)} />
          </div>
        </div>

        <div className="form-section">
          <h3>Dates</h3>
          <div className="field-row">
            <div className="field">
              <label>Issue date</label>
              <input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
            </div>
            <div className="field">
              <label>{type === "quote" ? "Valid until" : "Due date"}</label>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>
        </div>

        <div className="form-section">
          <h3>Line items</h3>
          <table className="items-table">
            <thead>
              <tr>
                <th>Description</th>
                <th>Qty</th>
                <th>Price</th>
                <th style={{ textAlign: "right" }}>Amount</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, idx) => (
                <tr key={idx}>
                  <td>
                    <input value={it.desc} placeholder="Description" onChange={(e) => updateItem(idx, "desc", e.target.value)} />
                  </td>
                  <td className="qty-col">
                    <input type="number" min="0" step="1" value={it.qty} onChange={(e) => updateItem(idx, "qty", e.target.value)} />
                  </td>
                  <td className="price-col">
                    <input type="number" min="0" step="0.01" value={it.price} onChange={(e) => updateItem(idx, "price", e.target.value)} />
                  </td>
                  <td className="amt-col">R{money((Number(it.qty) || 0) * (Number(it.price) || 0))}</td>
                  <td className="rm-col">
                    {items.length > 1 && (
                      <button className="rm-btn" onClick={() => removeRow(idx)}>
                        ×
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button className="add-row-btn" onClick={addRow}>
            + Add line
          </button>

          <div className="totals-box">
            <div className="field" style={{ marginBottom: taxEnabled ? 10 : 0 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  style={{ width: "auto" }}
                  checked={taxEnabled}
                  onChange={(e) => setTaxEnabled(e.target.checked)}
                />
                Apply tax
              </label>
            </div>
            {taxEnabled && (
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Tax rate (%)</label>
                <input type="number" min="0" step="0.1" value={taxRate} style={{ width: 100 }} onChange={(e) => setTaxRate(e.target.value)} />
              </div>
            )}
            <div className="totals-row">
              <span>Subtotal</span>
              <span>R{money(totals.subtotal)}</span>
            </div>
            {taxEnabled && (
              <div className="totals-row">
                <span>Tax</span>
                <span>R{money(totals.tax)}</span>
              </div>
            )}
            <div className="totals-row grand">
              <span>Total</span>
              <span>R{money(totals.total)}</span>
            </div>
          </div>
        </div>

        <div className="form-section">
          <h3>Notes &amp; terms</h3>
          <div className="field">
            <label>Notes (shown on document)</label>
            <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
          </div>
          <div className="field">
            <label>Terms</label>
            <textarea rows={2} value={terms} onChange={(e) => setTerms(e.target.value)} />
          </div>
        </div>

        <div className="form-actions">
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={saving} onClick={save}>
            {saving ? "Saving…" : isEditing ? "Save changes" : `Save ${type}`}
          </button>
        </div>
      </div>
    </>
  );
}

// ---------------- View document ----------------
function DocumentView({ company, doc, onBack, onLogout, onEdit, onEditDoc, onChanged, onDeleted, onConvert }) {
  const totals = computeTotals(doc.items, doc.tax_enabled ? doc.tax_rate : 0);
  const isQuote = doc.type === "quote";
  const statusOptions = isQuote ? ["draft", "sent", "accepted", "declined"] : ["draft", "sent", "paid"];

  async function changeStatus(status) {
    const { data, error } = await supabase.from("documents").update({ status }).eq("id", doc.id).select().single();
    if (!error) onChanged(data);
  }

  async function del() {
    if (!confirm(`Delete ${doc.number}? This can't be undone.`)) return;
    const { error } = await supabase.from("documents").delete().eq("id", doc.id);
    if (!error) onDeleted(doc.id);
  }

  return (
    <>
      <Topbar company={company} onLogout={onLogout} onEdit={onEdit} />
      <div className="container">
        <div className="doc-actions">
          <div className="doc-actions-left">
            <button className="btn btn-quiet" onClick={onBack}>
              ← Back
            </button>
            <select className="btn btn-sm" style={{ padding: "7px 10px" }} value={doc.status} onChange={(e) => changeStatus(e.target.value)}>
              {statusOptions.map((s) => (
                <option key={s} value={s}>
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </option>
              ))}
            </select>
            {isQuote && doc.status !== "converted" && (
              <button className="btn btn-sm" onClick={() => onConvert(doc)}>
                Convert to invoice
              </button>
            )}
            <button className="btn btn-sm" onClick={() => onEditDoc(doc)}>
              Edit
            </button>
          </div>
          <div className="doc-actions-left">
            <button className="btn btn-primary btn-sm" onClick={() => downloadPdf(doc, company)}>
              Download PDF
            </button>
            <button className="btn btn-sm btn-danger" onClick={del}>
              Delete
            </button>
          </div>
        </div>

        <div className="sheet">
          <div className="sheet-head">
            <div>
              {company.logo && <img src={company.logo} alt="" />}
              <p className="sheet-co-name">{company.name}</p>
              <p className="sheet-co-addr">
                {company.address}
                {company.email ? "\n" + company.email : ""}
                {company.phone ? "\n" + company.phone : ""}
              </p>
            </div>
            <div>
              <p className="sheet-doc-title">{isQuote ? "Quote" : "Invoice"}</p>
              <div className="sheet-doc-meta">
                <div>
                  Number: <b>{doc.number}</b>
                </div>
                <div>
                  Issued: <b>{fmtDate(doc.issue_date)}</b>
                </div>
                <div>
                  {isQuote ? "Valid until" : "Due"}: <b>{fmtDate(doc.due_date)}</b>
                </div>
              </div>
            </div>
          </div>

          <div className="sheet-billto">
            <div className="label">Billed to</div>
            <div className="name">{doc.client_name}</div>
            <div className="addr">
              {doc.client_address}
              {doc.client_email ? "\n" + doc.client_email : ""}
            </div>
          </div>

          <table className="sheet-items">
            <thead>
              <tr>
                <th>Description</th>
                <th className="num">Qty</th>
                <th className="num">Price</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {doc.items.map((it, idx) => (
                <tr key={idx}>
                  <td>{it.desc}</td>
                  <td className="num">{it.qty}</td>
                  <td className="num">R{money(it.price)}</td>
                  <td className="num">R{money(it.qty * it.price)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="totals-box">
            <div className="totals-row">
              <span>Subtotal</span>
              <span>R{money(totals.subtotal)}</span>
            </div>
            {doc.tax_enabled && (
              <div className="totals-row">
                <span>Tax ({doc.tax_rate}%)</span>
                <span>R{money(totals.tax)}</span>
              </div>
            )}
            <div className="totals-row grand">
              <span>Total</span>
              <span>R{money(totals.total)}</span>
            </div>
          </div>

          {(hasBankDetails(company) || doc.notes || doc.terms) && (
            <div className="sheet-notes">
              {hasBankDetails(company) && (
                <div>
                  <b>Banking details:</b>
                  <div>
                    {bankDetailsLines(company).map((line, i) => (
                      <div key={i}>{line}</div>
                    ))}
                  </div>
                </div>
              )}
              {doc.notes && (
                <div style={{ marginTop: 6 }}>
                  <b>Notes:</b> {doc.notes}
                </div>
              )}
              {doc.terms && (
                <div style={{ marginTop: 6 }}>
                  <b>Terms:</b> {doc.terms}
                </div>
              )}
            </div>
          )}
          <div className="sheet-footer">Thank you for the opportunity to work with you.</div>
        </div>
      </div>
    </>
  );
}

// ---------------- Reusable line-items editor (quote/invoice items, spares needed, spares used) ----------------
function LineItemsEditor({ items, onChange }) {
  function updateItem(idx, field, value) {
    onChange(items.map((it, i) => (i === idx ? { ...it, [field]: value } : it)));
  }
  function addRow() {
    onChange([...items, { desc: "", qty: 1, price: 0 }]);
  }
  function removeRow(idx) {
    onChange(items.filter((_, i) => i !== idx));
  }
  return (
    <>
      <table className="items-table">
        <thead>
          <tr>
            <th>Description</th>
            <th>Qty</th>
            <th>Price</th>
            <th style={{ textAlign: "right" }}>Amount</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, idx) => (
            <tr key={idx}>
              <td>
                <input value={it.desc} placeholder="Description" onChange={(e) => updateItem(idx, "desc", e.target.value)} />
              </td>
              <td className="qty-col">
                <input type="number" min="0" step="1" value={it.qty} onChange={(e) => updateItem(idx, "qty", e.target.value)} />
              </td>
              <td className="price-col">
                <input type="number" min="0" step="0.01" value={it.price} onChange={(e) => updateItem(idx, "price", e.target.value)} />
              </td>
              <td className="amt-col">R{money((Number(it.qty) || 0) * (Number(it.price) || 0))}</td>
              <td className="rm-col">
                {items.length > 1 && (
                  <button type="button" className="rm-btn" onClick={() => removeRow(idx)}>
                    ×
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="add-row-btn" onClick={addRow}>
        + Add line
      </button>
    </>
  );
}

// ---------------- Job card form (create/edit; used by technicians and admin) ----------------
function JobCardForm({ company, technician, initial, onCancel, onSaved, onLogout, subtitle }) {
  const isEditing = !!initial;
  const [id] = useState(() => initial?.id || crypto.randomUUID());
  const [clientName, setClientName] = useState(initial?.client_name || "");
  const [siteAddress, setSiteAddress] = useState(initial?.site_address || "");
  const [description, setDescription] = useState(initial?.description || "");
  const [sparesNeeded, setSparesNeeded] = useState(initial?.spares_needed?.length ? initial.spares_needed : [{ desc: "", qty: 1, price: 0 }]);
  const [sparesUsed, setSparesUsed] = useState(initial?.spares_used?.length ? initial.spares_used : [{ desc: "", qty: 1, price: 0 }]);
  const [notes, setNotes] = useState(initial?.notes || "");
  const [photos, setPhotos] = useState(initial?.photos || []);
  const [receipts, setReceipts] = useState(initial?.receipts || []);
  const [removedReceiptPaths, setRemovedReceiptPaths] = useState([]);
  const receiptCameraRef = useRef(null);
  const receiptFileRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleFiles(e) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setUploading(true);
    const uploaded = [];
    for (const rawFile of files) {
      const file = await prepareImageForUpload(rawFile);
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${company.id}/${id}/${Date.now()}-${safeName}`;
      const { error } = await supabase.storage.from("job-photos").upload(path, file, { contentType: file.type || undefined });
      if (!error) {
        const { data } = supabase.storage.from("job-photos").getPublicUrl(path);
        uploaded.push({ path, url: data.publicUrl, type: file.type });
      } else {
        alert("Upload failed for " + rawFile.name + ": " + error.message);
      }
    }
    setPhotos((prev) => [...prev, ...uploaded]);
    setUploading(false);
    e.target.value = "";
  }

  async function removePhoto(idx) {
    const photo = photos[idx];
    setPhotos((prev) => prev.filter((_, i) => i !== idx));
    if (photo?.path) {
      try {
        await supabase.storage.from("job-photos").remove([photo.path]);
      } catch (e) {}
    }
  }

  async function handleReceiptFiles(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (files.length === 0) return;
    setUploading(true);
    const uploaded = [];
    for (const rawFile of files) {
      const file = await prepareImageForUpload(rawFile);
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_") || "receipt.jpg";
      const path = `${company.id}/${id}/receipts/${Date.now()}-${safeName}`;
      const { error } = await supabase.storage.from("job-photos").upload(path, file, { contentType: file.type || undefined });
      if (error) {
        alert("Upload failed for " + file.name + ": " + error.message);
        continue;
      }
      const { data } = supabase.storage.from("job-photos").getPublicUrl(path);
      uploaded.push({
        path,
        url: data.publicUrl,
        name: file.name,
        type: file.type,
        uploaded_at: new Date().toISOString(),
        uploaded_by: technician ? technician.name : "Admin"
      });
    }
    setReceipts((prev) => [...prev, ...uploaded]);
    setUploading(false);
  }

  function removeReceipt(idx) {
    const r = receipts[idx];
    setReceipts((prev) => prev.filter((_, i) => i !== idx));
    // The file itself is only deleted once the job card is saved, so
    // pressing Cancel doesn't leave the saved card pointing at a missing file.
    if (r?.path) setRemovedReceiptPaths((prev) => [...prev, r.path]);
  }

  function cleanSpares(list) {
    return list
      .filter((it) => it.desc.trim() !== "" || Number(it.price) > 0)
      .map((it) => ({ desc: it.desc, qty: Number(it.qty) || 0, price: Number(it.price) || 0 }));
  }

  async function save() {
    if (!clientName.trim()) {
      alert("Please add a client / site name before saving.");
      return;
    }
    setSaving(true);
    const payload = {
      client_name: clientName.trim(),
      site_address: siteAddress.trim(),
      description: description.trim(),
      spares_needed: cleanSpares(sparesNeeded),
      spares_used: cleanSpares(sparesUsed),
      photos,
      receipts,
      notes: notes.trim()
    };

    let result;
    if (isEditing) {
      result = await supabase.from("job_cards").update(payload).eq("id", initial.id).select().single();
    } else {
      result = await supabase
        .from("job_cards")
        .insert({
          id,
          company_id: company.id,
          technician_id: technician ? technician.id : null,
          technician_name: technician ? technician.name : "",
          status: "open",
          ...payload
        })
        .select()
        .single();
    }
    setSaving(false);
    if (result.error) {
      alert("Couldn't save: " + result.error.message);
      return;
    }
    if (removedReceiptPaths.length) {
      try {
        await supabase.storage.from("job-photos").remove(removedReceiptPaths);
      } catch (e) {}
    }
    onSaved(result.data);
  }

  return (
    <>
      <Topbar company={company} onLogout={onLogout} subtitle={subtitle} />
      <div className="container">
        <div className="form-section">
          <h3>Job details</h3>
          <div className="field">
            <label>Client / site name</label>
            <input value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="e.g. Sonata Complex" />
          </div>
          <div className="field">
            <label>Site address</label>
            <textarea rows={2} value={siteAddress} onChange={(e) => setSiteAddress(e.target.value)} placeholder="Where the job is" />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Job description</label>
            <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What needs to be done" />
          </div>
        </div>

        <div className="form-section">
          <h3>Photos</h3>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
            {photos.map((p, idx) => (
              <div key={idx} style={{ position: "relative", width: 84, height: 84 }}>
                <StoredImage
                  item={p}
                  style={{ width: 84, height: 84, objectFit: "cover", borderRadius: 6, border: "1px solid var(--line)" }}
                />
                <button
                  type="button"
                  onClick={() => removePhoto(idx)}
                  style={{
                    position: "absolute",
                    top: -8,
                    right: -8,
                    width: 22,
                    height: 22,
                    borderRadius: "50%",
                    border: "1px solid var(--line)",
                    background: "#fff",
                    color: "var(--warn)",
                    fontSize: 14,
                    lineHeight: 1,
                    cursor: "pointer"
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <input type="file" accept="image/*" multiple onChange={handleFiles} disabled={uploading} />
          {uploading && <p className="hint">Uploading…</p>}
        </div>

        <div className="form-section">
          <h3>Spares needed (for the quote)</h3>
          <LineItemsEditor items={sparesNeeded} onChange={setSparesNeeded} />
        </div>

        <div className="form-section">
          <h3>Spares used (for the invoice)</h3>
          <LineItemsEditor items={sparesUsed} onChange={setSparesUsed} />
        </div>

        <div className="form-section">
          <h3>Receipts for spares bought</h3>
          <p className="hint" style={{ marginTop: 0, marginBottom: 12 }}>
            Scan the slip from the hardware store for any spares you bought for this job.
          </p>
          {receipts.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
              {receipts.map((r, idx) => {
                const isPdf = r.type === "application/pdf" || /\.pdf$/i.test(r.name || r.path || "");
                return (
                  <div key={r.path || idx} style={{ position: "relative", width: 84, height: 84 }}>
                    <a href={r.url} target="_blank" rel="noreferrer">
                      {isPdf ? (
                        <div style={{ width: 84, height: 84, borderRadius: 6, border: "1px solid var(--line)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 600, color: "var(--ink-soft)", background: "var(--paper-alt)" }}>
                          PDF
                        </div>
                      ) : (
                        <StoredImage item={r} alt="Receipt" style={{ width: 84, height: 84, objectFit: "cover", borderRadius: 6, border: "1px solid var(--line)" }} />
                      )}
                    </a>
                    <button
                      type="button"
                      onClick={() => removeReceipt(idx)}
                      style={{ position: "absolute", top: -8, right: -8, width: 22, height: 22, borderRadius: "50%", border: "1px solid var(--line)", background: "#fff", color: "var(--warn)", fontSize: 14, lineHeight: 1, cursor: "pointer" }}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="btn btn-sm btn-primary" disabled={uploading} onClick={() => receiptCameraRef.current?.click()}>
              Scan receipt
            </button>
            <button type="button" className="btn btn-sm" disabled={uploading} onClick={() => receiptFileRef.current?.click()}>
              Upload file
            </button>
          </div>
          <input ref={receiptCameraRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={handleReceiptFiles} />
          <input ref={receiptFileRef} type="file" accept="image/*,application/pdf" multiple style={{ display: "none" }} onChange={handleReceiptFiles} />
          {uploading && <p className="hint">Uploading…</p>}
        </div>

        <div className="form-section">
          <h3>Notes</h3>
          <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" style={{ width: "100%", padding: "10px 12px", border: "1px solid var(--line-strong)", borderRadius: 5, background: "var(--paper)" }} />
        </div>

        <div className="form-actions">
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={saving || uploading} onClick={save}>
            {saving ? "Saving…" : "Save job card"}
          </button>
        </div>
      </div>
    </>
  );
}

// ---------------- Job card list ----------------
function JobCardList({ company, jobCards, isAdmin, onLogout, onEdit, onNew, onOpen, onSection }) {
  return (
    <>
      <Topbar company={company} onLogout={onLogout} onEdit={isAdmin ? onEdit : undefined} />
      <div className="container">
        {isAdmin && <AdminTabs active="jobcards" onChange={onSection} />}
        <div className="toolbar">
          <div />
          <button className="btn btn-primary" onClick={onNew}>
            + New job card
          </button>
        </div>
        {jobCards.length === 0 ? (
          <div className="empty-state">
            <div className="big">No job cards yet</div>
            <div>Create the first one for {company.name}.</div>
          </div>
        ) : (
          <div className="doclist-wrap">
            <table className="doclist">
              <thead>
                <tr>
                  <th>Client / site</th>
                  <th>Technician</th>
                  <th>Date</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {jobCards
                  .slice()
                  .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
                  .map((jc) => (
                    <tr key={jc.id} className="row" onClick={() => onOpen(jc)}>
                      <td>{jc.client_name}</td>
                      <td>{jc.technician_name || "—"}</td>
                      <td>{fmtDate(jc.created_at ? jc.created_at.slice(0, 10) : "")}</td>
                      <td>
                        <span className={`status-pill status-${jc.status === "open" ? "draft" : jc.status === "quoted" ? "sent" : jc.status === "invoiced" ? "paid" : "draft"}`}>
                          {jc.status}
                        </span>
                      </td>
                      <td>{jc.photos?.length ? `${jc.photos.length} photo${jc.photos.length > 1 ? "s" : ""}` : ""}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

// ---------------- Receipts for spares bought (admin only) ----------------
function ReceiptsPanel({ company, jobCard, onChanged }) {
  const [busy, setBusy] = useState(false);
  const receipts = jobCard.receipts || [];
  const cameraRef = useRef(null);
  const fileRef = useRef(null);

  async function saveList(list) {
    const { data, error } = await supabase.from("job_cards").update({ receipts: list }).eq("id", jobCard.id).select().single();
    if (error) {
      alert("Couldn't save receipts: " + error.message);
      return false;
    }
    onChanged(data);
    return true;
  }

  async function handleFiles(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;
    setBusy(true);
    const added = [];
    for (const rawFile of files) {
      const file = await prepareImageForUpload(rawFile);
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_") || "receipt.jpg";
      const path = `${company.id}/${jobCard.id}/receipts/${Date.now()}-${safeName}`;
      const { error } = await supabase.storage.from("job-photos").upload(path, file, { contentType: file.type || undefined });
      if (error) {
        alert("Upload failed for " + file.name + ": " + error.message);
        continue;
      }
      const { data } = supabase.storage.from("job-photos").getPublicUrl(path);
      added.push({ path, url: data.publicUrl, name: file.name, type: file.type, uploaded_at: new Date().toISOString(), uploaded_by: "Admin" });
    }
    if (added.length) await saveList([...receipts, ...added]);
    setBusy(false);
  }

  async function remove(idx) {
    if (!confirm("Remove this receipt?")) return;
    const r = receipts[idx];
    setBusy(true);
    const ok = await saveList(receipts.filter((_, i) => i !== idx));
    if (ok && r?.path) {
      try {
        await supabase.storage.from("job-photos").remove([r.path]);
      } catch (e) {}
    }
    setBusy(false);
  }

  return (
    <div className="sheet" style={{ marginTop: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
        <div>
          <h3 style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--ink-soft)", margin: 0 }}>Receipts for spares bought</h3>
          <p className="hint" style={{ margin: "4px 0 0" }}>Added by technicians or admin. Not included on the job card PDF.</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => cameraRef.current?.click()}>
            Scan receipt
          </button>
          <button className="btn btn-sm" disabled={busy} onClick={() => fileRef.current?.click()}>
            Upload file
          </button>
        </div>
      </div>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={handleFiles} />
      <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple style={{ display: "none" }} onChange={handleFiles} />
      {busy && <p className="hint">Working…</p>}
      {receipts.length === 0 ? (
        <p className="hint">No receipts yet.</p>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          {receipts.map((r, idx) => {
            const isPdf = r.type === "application/pdf" || /\.pdf$/i.test(r.name || r.path);
            return (
              <div key={r.path || idx} style={{ position: "relative", width: 100 }}>
                <a href={r.url} target="_blank" rel="noreferrer">
                  {isPdf ? (
                    <div style={{ width: 100, height: 100, borderRadius: 6, border: "1px solid var(--line)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 600, color: "var(--ink-soft)", background: "var(--paper-alt)" }}>
                      PDF
                    </div>
                  ) : (
                    <StoredImage item={r} alt="Receipt" style={{ width: 100, height: 100, objectFit: "cover", borderRadius: 6, border: "1px solid var(--line)" }} />
                  )}
                </a>
                <div className="hint" style={{ fontSize: 11 }}>
                  {r.uploaded_at ? fmtDate(r.uploaded_at.slice(0, 10)) : ""}
                  {r.uploaded_by ? ` · ${r.uploaded_by}` : ""}
                </div>
                <button
                  type="button"
                  onClick={() => remove(idx)}
                  disabled={busy}
                  style={{ position: "absolute", top: -8, right: -8, width: 22, height: 22, borderRadius: "50%", border: "1px solid var(--line)", background: "#fff", color: "var(--warn)", fontSize: 14, lineHeight: 1, cursor: "pointer" }}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------- Job card detail view ----------------
function JobCardView({ company, jobCard, isAdmin, onBack, onLogout, onEdit, onEditCard, onDeleted, onConvert, onChanged, subtitle }) {
  const [pdfBusy, setPdfBusy] = useState(false);
  async function downloadPdfClick() {
    setPdfBusy(true);
    const result = await downloadJobCardPdf(jobCard, company);
    setPdfBusy(false);
    if (!isAdmin || !result.ok || result.photosTotal === 0) return;
    if (result.photosIncluded < result.photosTotal) {
      alert("Not every photo made it into the PDF, so the photos have been kept on the server. Try downloading again when your connection is better.");
      return;
    }
    const n = result.photosTotal;
    const ok = confirm(
      `The PDF was downloaded with all ${n} photo${n > 1 ? "s" : ""}.\n\n` +
        "First check the PDF saved to your phone and the photos look right.\n\n" +
        "Delete these photos from Supabase to free up space? This can't be undone, and later PDF downloads won't include them. Receipts are kept."
    );
    if (!ok) return;
    await deletePhotosFromServer();
  }

  async function deletePhotosFromServer() {
    const list = jobCard.photos || [];
    setPdfBusy(true);
    // Update the job card first: if that fails, no files get deleted.
    const { data, error } = await supabase
      .from("job_cards")
      .update({
        photos: [],
        photos_removed_at: new Date().toISOString(),
        photos_removed_count: (jobCard.photos_removed_count || 0) + list.length
      })
      .eq("id", jobCard.id)
      .select()
      .single();
    if (error) {
      setPdfBusy(false);
      alert("Couldn't remove the photos: " + error.message + "\n\nIf this mentions photos_removed_at, run the latest SQL migration in Supabase first.");
      return;
    }
    const paths = list.map((p) => p.path).filter(Boolean);
    if (paths.length) {
      const { error: storageError } = await supabase.storage.from("job-photos").remove(paths);
      if (storageError) console.warn("Some photo files may not have been deleted:", storageError);
    }
    setPdfBusy(false);
    onChanged(data);
  }
  async function del() {
    if (!confirm("Delete this job card? This can't be undone.")) return;
    const filePaths = [...(jobCard.photos || []), ...(jobCard.receipts || [])].map((p) => p.path).filter(Boolean);
    if (filePaths.length) {
      try {
        await supabase.storage.from("job-photos").remove(filePaths);
      } catch (e) {}
    }
    const { error } = await supabase.from("job_cards").delete().eq("id", jobCard.id);
    if (!error) onDeleted(jobCard.id);
  }

  return (
    <>
      <Topbar company={company} onLogout={onLogout} onEdit={isAdmin ? onEdit : undefined} subtitle={subtitle} />
      <div className="container">
        <div className="doc-actions">
          <div className="doc-actions-left">
            <button className="btn btn-quiet" onClick={onBack}>
              ← Back
            </button>
            <button className="btn btn-sm" onClick={() => onEditCard(jobCard)}>
              Edit
            </button>
            <button className="btn btn-sm" disabled={pdfBusy} onClick={downloadPdfClick}>
              {pdfBusy ? "Preparing PDF…" : "Download PDF"}
            </button>
            {isAdmin && jobCard.spares_needed?.length > 0 && (
              <button className="btn btn-sm" onClick={() => onConvert(jobCard, "quote")}>
                Create quote from spares needed
              </button>
            )}
            {isAdmin && jobCard.spares_used?.length > 0 && (
              <button className="btn btn-sm" onClick={() => onConvert(jobCard, "invoice")}>
                Create invoice from spares used
              </button>
            )}
          </div>
          <div className="doc-actions-left">
            <button className="btn btn-sm btn-danger" onClick={del}>
              Delete
            </button>
          </div>
        </div>

        <div className="sheet">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 22 }}>
            <div>
              <p className="sheet-co-name">{jobCard.client_name}</p>
              <p className="sheet-co-addr">{jobCard.site_address}</p>
            </div>
            <span className={`status-pill status-${jobCard.status === "open" ? "draft" : jobCard.status === "quoted" ? "sent" : jobCard.status === "invoiced" ? "paid" : "draft"}`}>
              {jobCard.status}
            </span>
          </div>

          {jobCard.description && (
            <div className="sheet-billto" style={{ marginBottom: 20 }}>
              <div className="label">Description</div>
              <div className="addr">{jobCard.description}</div>
            </div>
          )}

          <div style={{ fontSize: 12.5, color: "var(--ink-soft)", marginBottom: 22 }}>
            Technician: <b style={{ color: "var(--ink)" }}>{jobCard.technician_name || "—"}</b> · Logged: {fmtDate(jobCard.created_at ? jobCard.created_at.slice(0, 10) : "")}
            {jobCard.quote_id && <> · Quote created</>}
            {jobCard.invoice_id && <> · Invoice created</>}
          </div>

          {jobCard.photos_removed_at && (
            <div className="hint" style={{ marginBottom: 16 }}>
              {jobCard.photos_removed_count || ""} photo{jobCard.photos_removed_count === 1 ? "" : "s"} deleted from the server on{" "}
              {fmtDate(jobCard.photos_removed_at.slice(0, 10))} after the PDF was downloaded. They're only in that downloaded PDF now.
            </div>
          )}

          {jobCard.photos?.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, color: "var(--ink-soft)", fontWeight: 600, marginBottom: 8 }}>
                Photos
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                {jobCard.photos.map((p, idx) => (
                  <a key={idx} href={p.url} target="_blank" rel="noreferrer">
                    <StoredImage item={p} style={{ width: 100, height: 100, objectFit: "cover", borderRadius: 6, border: "1px solid var(--line)" }} />
                  </a>
                ))}
              </div>
            </div>
          )}

          {jobCard.spares_needed?.length > 0 && (
            <div style={{ marginBottom: 22 }}>
              <h3 style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--ink-soft)", marginBottom: 10 }}>Spares needed</h3>
              <table className="sheet-items">
                <thead>
                  <tr>
                    <th>Description</th>
                    <th className="num">Qty</th>
                    <th className="num">Price</th>
                    <th className="num">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {jobCard.spares_needed.map((it, idx) => (
                    <tr key={idx}>
                      <td>{it.desc}</td>
                      <td className="num">{it.qty}</td>
                      <td className="num">R{money(it.price)}</td>
                      <td className="num">R{money(it.qty * it.price)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {jobCard.spares_used?.length > 0 && (
            <div style={{ marginBottom: 22 }}>
              <h3 style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--ink-soft)", marginBottom: 10 }}>Spares used</h3>
              <table className="sheet-items">
                <thead>
                  <tr>
                    <th>Description</th>
                    <th className="num">Qty</th>
                    <th className="num">Price</th>
                    <th className="num">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {jobCard.spares_used.map((it, idx) => (
                    <tr key={idx}>
                      <td>{it.desc}</td>
                      <td className="num">{it.qty}</td>
                      <td className="num">R{money(it.price)}</td>
                      <td className="num">R{money(it.qty * it.price)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {jobCard.notes && (
            <div className="sheet-notes">
              <b>Notes:</b> {jobCard.notes}
            </div>
          )}
        </div>

        {isAdmin && <ReceiptsPanel company={company} jobCard={jobCard} onChanged={onChanged} />}
      </div>
    </>
  );
}

// ---------------- Technician management (admin only) ----------------
function TechnicianManager({ company, technicians, currentUser, onLogout, onEdit, onSection, onChanged }) {
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [newRole, setNewRole] = useState("technician");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const companyUsers = technicians
    .filter((t) => t.company_id === company.id)
    .sort((a, b) => a.name.localeCompare(b.name));

  function isSelf(u) {
    return currentUser && currentUser.id === u.id;
  }

  async function addUser() {
    if (!name.trim() || !username.trim() || !password) {
      setError("Name, username and password are required.");
      return;
    }
    if (username.trim() === company.username) {
      setError("That username is the company's main login. Pick a different one.");
      return;
    }
    setError("");
    setSaving(true);
    const { error: insertError } = await supabase.from("technicians").insert({
      company_id: company.id,
      name: name.trim(),
      username: username.trim(),
      password,
      role: newRole
    });
    setSaving(false);
    if (insertError) {
      if (insertError.message.includes("duplicate")) setError("That username is already taken.");
      else if (insertError.message.includes("role")) setError("Run the latest SQL migration in Supabase first (adds the role column).");
      else setError("Couldn't save: " + insertError.message);
      return;
    }
    setName("");
    setUsername("");
    setPassword("");
    setNewRole("technician");
    onChanged();
  }

  async function changeRole(u, role) {
    if (isSelf(u)) return;
    const { error } = await supabase.from("technicians").update({ role }).eq("id", u.id);
    if (error) alert("Couldn't change role: " + error.message);
    onChanged();
  }

  async function resetPassword(u) {
    const pw = prompt(`New password for ${u.name}:`);
    if (pw === null) return;
    if (!pw.trim()) {
      alert("Password can't be empty.");
      return;
    }
    const { error } = await supabase.from("technicians").update({ password: pw }).eq("id", u.id);
    if (error) alert("Couldn't change password: " + error.message);
    else alert(`Password updated for ${u.name}.`);
    onChanged();
  }

  async function removeUser(u) {
    if (isSelf(u)) return;
    if (!confirm(`Remove ${u.name}'s login?`)) return;
    const { error } = await supabase.from("technicians").delete().eq("id", u.id);
    if (error) alert("Couldn't remove: " + error.message);
    onChanged();
  }

  return (
    <>
      <Topbar company={company} onLogout={onLogout} onEdit={onEdit} />
      <div className="container">
        <AdminTabs active="technicians" onChange={onSection} />

        <div className="form-section" style={{ maxWidth: 440 }}>
          <h3>Add a user</h3>
          <div className="field">
            <label>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sipho Dlamini" />
          </div>
          <div className="field">
            <label>Username</label>
            <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="e.g. sipho" autoCapitalize="none" />
          </div>
          <div className="field">
            <label>Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Role</label>
            <select value={newRole} onChange={(e) => setNewRole(e.target.value)}>
              <option value="technician">Technician — job cards only</option>
              <option value="admin">Admin — full access, can't manage users</option>
              <option value="super_admin">Super admin — full access + manage users</option>
            </select>
          </div>
          {error && <div className="error-msg" style={{ marginTop: 12 }}>{error}</div>}
          <button className="btn btn-primary" style={{ marginTop: 16 }} disabled={saving} onClick={addUser}>
            {saving ? "Adding…" : "Add user"}
          </button>
        </div>

        <p className="hint" style={{ margin: "0 0 12px" }}>
          The company's main login ({company.username}) is always a super admin.
        </p>

        {companyUsers.length === 0 ? (
          <div className="empty-state">
            <div className="big">No users yet</div>
            <div>Add one above.</div>
          </div>
        ) : (
          <div className="doclist-wrap">
            <table className="doclist">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Username</th>
                  <th>Role</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {companyUsers.map((u) => (
                  <tr key={u.id}>
                    <td>
                      {u.name}
                      {isSelf(u) ? " (you)" : ""}
                    </td>
                    <td className="num-cell">{u.username}</td>
                    <td>
                      <select value={userRole(u)} disabled={isSelf(u)} onChange={(e) => changeRole(u, e.target.value)}>
                        {Object.entries(ROLE_LABELS).map(([k, label]) => (
                          <option key={k} value={k}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <button className="btn btn-sm" onClick={() => resetPassword(u)}>
                        Password
                      </button>{" "}
                      {!isSelf(u) && (
                        <button className="btn btn-sm btn-danger" onClick={() => removeUser(u)}>
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

// ---------------- Retainers (admin only) ----------------
const RETAINER_STATUS = { draft: "Draft", active: "Active", ended: "Ended" };
const RETAINER_PILL = { draft: "status-draft", active: "status-paid", ended: "status-declined" };

function newRetainer(companyId) {
  const id = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
  return {
    id,
    company_id: companyId,
    isNew: true,
    title: "",
    client_name: "",
    client_address: "",
    client_email: "",
    status: "draft",
    monthly_fee: 0,
    start_date: todayISO(),
    term_months: 12,
    agreement_text: "",
    chat: []
  };
}

function RetainerList({ company, retainers, onLogout, onEdit, onSection, onNew, onOpen }) {
  const list = retainers.slice().sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at));
  const activeTotal = retainers.filter((r) => r.status === "active").reduce((sum, r) => sum + Number(r.monthly_fee || 0), 0);
  return (
    <>
      <Topbar company={company} onLogout={onLogout} onEdit={onEdit} />
      <div className="container">
        <AdminTabs active="retainers" onChange={onSection} />
        <div className="toolbar">
          <div className="hint" style={{ margin: 0 }}>
            Active retainers: <b>R{money(activeTotal)}</b> per month
          </div>
          <button className="btn btn-primary" onClick={onNew}>
            + New retainer
          </button>
        </div>
        {list.length === 0 ? (
          <div className="empty-state">
            <div className="big">No retainers yet</div>
            <div>Tap “New retainer” and let the AI assistant help you price it and write the agreement.</div>
          </div>
        ) : (
          <div className="doclist-wrap">
            <table className="doclist">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Start</th>
                  <th>Status</th>
                  <th style={{ textAlign: "right" }}>Per month</th>
                </tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.id} className="row" onClick={() => onOpen(r)}>
                    <td>
                      {r.client_name || "(no client yet)"}
                      {r.title && <div className="hint" style={{ margin: 0, fontSize: 12 }}>{r.title}</div>}
                    </td>
                    <td>{r.start_date ? fmtDate(r.start_date) : "—"}</td>
                    <td>
                      <span className={`status-pill ${RETAINER_PILL[r.status] || "status-draft"}`}>{RETAINER_STATUS[r.status] || r.status}</span>
                    </td>
                    <td className="amt-cell">R{money(Number(r.monthly_fee || 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

function AgreementPreview({ text }) {
  const blocks = [];
  (text || "")
    .replace(/\r/g, "")
    .split("\n")
    .forEach((raw, i) => {
      const line = raw.trimEnd();
      if (!line.trim()) return;
      if (/^#{1,3}\s+/.test(line)) {
        blocks.push(
          <h4 key={i} className="agr-h">
            {line.replace(/^#{1,3}\s+/, "")}
          </h4>
        );
        return;
      }
      const m = line.match(/^\s*((?:\d+(?:\.\d+)*\.?)|[a-z]\)|\([a-z0-9]+\)|-|•)\s+(.*)$/i);
      if (m) {
        blocks.push(
          <div key={i} className="agr-clause">
            <span className="agr-num">{m[1] === "-" ? "•" : m[1]}</span>
            <span>{m[2]}</span>
          </div>
        );
      } else {
        blocks.push(
          <p key={i} className="agr-p">
            {line.trim()}
          </p>
        );
      }
    });
  return <div className="agr-body">{blocks}</div>;
}

function RetainerEditor({ company, initial, aiAuth, onLogout, onEdit, onBack, onSaved, onDeleted, onCreateInvoice }) {
  const [r, setR] = useState(initial);
  const [dirty, setDirty] = useState(!!initial.isNew);
  const [saving, setSaving] = useState(false);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [writing, setWriting] = useState(false);
  const [aiError, setAiError] = useState("");
  const [tab, setTab] = useState(initial.agreement_text && !(initial.chat || []).length ? "agreement" : "assistant");
  const [editingAgreement, setEditingAgreement] = useState(false);
  const [changeRequest, setChangeRequest] = useState("");
  const chatEndRef = useRef(null);
  const latest = useRef(r);
  latest.current = r;
  const chat = r.chat || [];
  const busy = thinking || writing;

  useEffect(() => {
    if (tab === "assistant") chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [chat.length, busy, tab]);

  function update(fields) {
    setR((prev) => ({ ...prev, ...fields }));
    setDirty(true);
  }

  async function save(record = latest.current, quiet = false) {
    setSaving(true);
    const payload = {
      id: record.id,
      company_id: company.id,
      title: record.title || "",
      client_name: record.client_name || "",
      client_address: record.client_address || "",
      client_email: record.client_email || "",
      status: record.status || "draft",
      monthly_fee: Number(record.monthly_fee) || 0,
      start_date: record.start_date || null,
      term_months: record.term_months ? parseInt(record.term_months, 10) : null,
      agreement_text: record.agreement_text || "",
      chat: record.chat || [],
      updated_at: new Date().toISOString()
    };
    const { data, error } = await supabase.from("retainers").upsert(payload).select().single();
    setSaving(false);
    if (error) {
      alert("Couldn't save: " + error.message + (error.message.includes("retainers") ? "\n\nRun the retainers SQL migration in Supabase first." : ""));
      return null;
    }
    setR((prev) => ({ ...prev, ...data, isNew: false }));
    setDirty(false);
    onSaved(data, quiet);
    return data;
  }

  async function callAi(payload, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch("/api/retainer-ai", {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          auth: aiAuth,
          company: { name: company.name, address: company.address, email: company.email, phone: company.phone },
          ...payload
        })
      });
      let data = null;
      try {
        data = await res.json();
      } catch (e) {
        throw new Error(res.status === 404 ? "The AI function isn't deployed (api/retainer-ai.js missing on Vercel)." : "Unexpected reply from the server (" + res.status + ").");
      }
      if (!res.ok) throw new Error(data?.error || "AI request failed (" + res.status + ")");
      return data;
    } catch (err) {
      if (err.name === "AbortError") throw new Error("The AI took too long to answer. Please try again.");
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  async function writeAgreement(instructions, base) {
    const current = base || latest.current;
    setWriting(true);
    setAiError("");
    try {
      const data = await callAi(
        {
          mode: "agreement",
          instructions,
          retainer: current,
          messages: (current.chat || []).map((m) => ({ role: m.role, content: m.content }))
        },
        180000
      );
      const hadOne = !!current.agreement_text;
      const note = {
        role: "assistant",
        content: hadOne ? "I've updated the agreement." : "Your agreement is ready.",
        note: "agreement",
        at: new Date().toISOString()
      };
      const updated = { ...latest.current, agreement_text: data.agreement_text, chat: [...(latest.current.chat || []), note] };
      setR(updated);
      latest.current = updated;
      await save(updated, true);
      return true;
    } catch (err) {
      setAiError((err.message || String(err)) + " You can try again with “Write with AI” on the Agreement tab.");
      return false;
    } finally {
      setWriting(false);
    }
  }

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setAiError("");
    const userMsg = { role: "user", content: text, at: new Date().toISOString() };
    const nextChat = [...chat, userMsg];
    const current = { ...latest.current, chat: nextChat };
    setR(current);
    latest.current = current;
    setInput("");
    setThinking(true);
    let follow = null;
    try {
      const data = await callAi({ retainer: current, messages: nextChat.map((m) => ({ role: m.role, content: m.content })) }, 120000);
      const changes = {};
      const f = data.fields || {};
      ["title", "client_name", "client_address", "client_email", "start_date"].forEach((k) => {
        if (typeof f[k] === "string" && f[k].trim()) changes[k] = f[k].trim();
      });
      if (typeof f.monthly_fee === "number" && f.monthly_fee >= 0) changes.monthly_fee = f.monthly_fee;
      if (Number.isInteger(f.term_months) && f.term_months > 0) changes.term_months = f.term_months;
      const aiMsg = {
        role: "assistant",
        content: data.reply || "(no reply)",
        note: Object.keys(changes).length ? "details" : "",
        at: new Date().toISOString()
      };
      const updated = { ...latest.current, ...changes, chat: [...nextChat, aiMsg] };
      setR(updated);
      latest.current = updated;
      await save(updated, true);
      if (data.write_agreement) follow = data.agreement_instructions || text;
    } catch (err) {
      setAiError(err.message || String(err));
      setDirty(true);
    } finally {
      setThinking(false);
    }
    if (follow) await writeAgreement(follow);
  }

  async function rewriteWithAi() {
    const req = changeRequest.trim();
    const ok = await writeAgreement(
      req ? `Update the current agreement: ${req}` : "Write the complete agreement based on the details and the conversation."
    );
    if (ok) setChangeRequest("");
  }

  async function handleDelete() {
    if (r.isNew) {
      onBack();
      return;
    }
    if (!confirm("Delete this retainer and its agreement?")) return;
    const { error } = await supabase.from("retainers").delete().eq("id", r.id);
    if (error) {
      alert("Couldn't delete: " + error.message);
      return;
    }
    onDeleted(r.id);
  }

  function back() {
    if (dirty && !confirm("You have unsaved changes. Leave without saving?")) return;
    onBack();
  }

  const starters = [
    "Work out a monthly retainer for a body corporate with 3 blocks",
    "Help me price maintenance for a small business",
    "Write the agreement using the details I've filled in"
  ];

  return (
    <>
      <Topbar company={company} onLogout={onLogout} onEdit={onEdit} />
      <div className="container">
        <div className="editor-head">
          <button className="btn btn-quiet btn-sm" onClick={back}>
            ← Retainers
          </button>
          <button className="btn btn-sm btn-primary" disabled={saving || !dirty} onClick={() => save()}>
            {saving ? "Saving…" : dirty ? "Save" : "Saved"}
          </button>
        </div>
        <div className="editor-title">
          <h2>{r.client_name || "New retainer"}</h2>
          <div className="editor-sub">
            <span className={`status-pill ${RETAINER_PILL[r.status] || "status-draft"}`}>{RETAINER_STATUS[r.status] || r.status}</span>
            {Number(r.monthly_fee) > 0 && <span className="editor-fee">R{money(Number(r.monthly_fee))} per month</span>}
          </div>
        </div>

        <div className="seg" role="tablist">
          {[
            ["assistant", "Assistant"],
            ["agreement", r.agreement_text ? "Agreement ✓" : "Agreement"],
            ["details", "Details"]
          ].map(([k, label]) => (
            <button key={k} role="tab" className={tab === k ? "active" : ""} onClick={() => setTab(k)}>
              {label}
            </button>
          ))}
        </div>

        {aiError && <div className="banner banner-warn">{aiError}</div>}
        {writing && <div className="banner">Writing the agreement… this can take up to a minute.</div>}

        {tab === "assistant" && (
          <div className="form-section">
            <p className="hint" style={{ marginTop: 0 }}>
              Tell the assistant about the client and the work. It asks what it needs, works out the monthly fee, and writes the agreement.
            </p>
            <div className="chat">
              {chat.map((m, i) => (
                <div key={i} className={`bubble ${m.role === "user" ? "bubble-me" : "bubble-ai"}`}>
                  {m.content}
                  {m.note === "details" && <div className="bubble-note">Details updated</div>}
                  {m.note === "agreement" && (
                    <button className="btn btn-sm btn-primary bubble-btn" onClick={() => setTab("agreement")}>
                      View agreement
                    </button>
                  )}
                  {m.note && m.note.startsWith("✓") && <div className="bubble-note">{m.note.replace("✓ ", "")}</div>}
                </div>
              ))}
              {thinking && <div className="bubble bubble-ai bubble-wait">Thinking…</div>}
              <div ref={chatEndRef} />
            </div>
            {chat.length === 0 && (
              <div className="starter-row">
                {starters.map((s) => (
                  <button key={s} className="chip" onClick={() => setInput(s)}>
                    {s}
                  </button>
                ))}
              </div>
            )}
            <div className="composer">
              <textarea
                rows={3}
                value={input}
                placeholder="e.g. Body corporate in Midrand, 40 units, 1 maintenance visit a month and up to 2 emergency call-outs"
                onChange={(e) => setInput(e.target.value)}
              />
              <button className="btn btn-primary" disabled={busy || !input.trim()} onClick={send}>
                {thinking ? "Thinking…" : "Send"}
              </button>
            </div>
          </div>
        )}

        {tab === "agreement" && (
          <>
            {!r.agreement_text && !editingAgreement ? (
              <div className="empty-state">
                <div className="big">No agreement yet</div>
                <div style={{ marginBottom: 18 }}>Let the assistant write it from the details and your conversation, or type your own.</div>
                <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
                  <button className="btn btn-primary" disabled={busy} onClick={rewriteWithAi}>
                    {writing ? "Writing…" : "Write with AI"}
                  </button>
                  <button className="btn" onClick={() => setEditingAgreement(true)}>
                    Type it myself
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="agr-toolbar">
                  <button className="btn btn-sm" onClick={() => setEditingAgreement((v) => !v)}>
                    {editingAgreement ? "Done editing" : "Edit"}
                  </button>
                  <button className="btn btn-sm" disabled={!r.agreement_text} onClick={() => downloadRetainerPdf(r, company)}>
                    Download PDF
                  </button>
                  <button className="btn btn-sm btn-primary" disabled={saving || !dirty} onClick={() => save()}>
                    {saving ? "Saving…" : dirty ? "Save" : "Saved"}
                  </button>
                </div>
                {editingAgreement ? (
                  <div className="form-section">
                    <p className="hint" style={{ marginTop: 0 }}>
                      Headings start with “## ”. Clauses like “3.1”. Tap Done editing to see how it looks.
                    </p>
                    <div className="field" style={{ marginBottom: 0 }}>
                      <textarea
                        className="agr-edit"
                        rows={22}
                        value={r.agreement_text || ""}
                        onChange={(e) => update({ agreement_text: e.target.value })}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="sheet agr-sheet">
                    <div className="agr-top">
                      <div>
                        <div className="sheet-co-name">{company.name}</div>
                        <div className="sheet-co-addr">{[company.address, company.email, company.phone].filter(Boolean).join("\n")}</div>
                      </div>
                      <div className="sheet-doc-title">Retainer Agreement</div>
                    </div>
                    <div className="sheet-billto">
                      <div className="label">Client</div>
                      <div className="name">{r.client_name || "—"}</div>
                      <div className="addr">{r.client_address}</div>
                      <div className="agr-terms">
                        <span>Monthly fee: <b>{Number(r.monthly_fee) ? `R${money(Number(r.monthly_fee))}` : "—"}</b></span>
                        <span>Start: <b>{r.start_date ? fmtDate(r.start_date) : "—"}</b></span>
                        <span>Term: <b>{r.term_months ? `${r.term_months} months` : "—"}</b></span>
                      </div>
                    </div>
                    <AgreementPreview text={r.agreement_text} />
                  </div>
                )}
                <div className="form-section" style={{ marginTop: 18 }}>
                  <h3>Change it with AI</h3>
                  <div className="composer">
                    <textarea
                      rows={2}
                      value={changeRequest}
                      placeholder="e.g. Add a clause that call-outs after 6pm are charged at R850"
                      onChange={(e) => setChangeRequest(e.target.value)}
                    />
                    <button className="btn btn-primary" disabled={busy || !changeRequest.trim()} onClick={rewriteWithAi}>
                      {writing ? "Updating…" : "Update"}
                    </button>
                  </div>
                  <p className="hint">Have your main template checked by a lawyer once before using it with clients.</p>
                </div>
              </>
            )}
          </>
        )}

        {tab === "details" && (
          <>
            <div className="form-section">
              <div className="field">
                <label>Title</label>
                <input value={r.title || ""} onChange={(e) => update({ title: e.target.value })} placeholder="e.g. Monthly electrical maintenance" />
              </div>
              <div className="field">
                <label>Client name</label>
                <input value={r.client_name || ""} onChange={(e) => update({ client_name: e.target.value })} />
              </div>
              <div className="field">
                <label>Client address</label>
                <textarea rows={2} value={r.client_address || ""} onChange={(e) => update({ client_address: e.target.value })} />
              </div>
              <div className="field">
                <label>Client email</label>
                <input type="email" value={r.client_email || ""} onChange={(e) => update({ client_email: e.target.value })} />
              </div>
              <div className="field-row">
                <div className="field">
                  <label>Monthly fee (R)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={r.monthly_fee ?? ""}
                    onChange={(e) => update({ monthly_fee: e.target.value === "" ? "" : Number(e.target.value) })}
                  />
                </div>
                <div className="field">
                  <label>Term (months)</label>
                  <input
                    type="number"
                    min="1"
                    value={r.term_months ?? ""}
                    onChange={(e) => update({ term_months: e.target.value === "" ? "" : parseInt(e.target.value, 10) })}
                  />
                </div>
              </div>
              <div className="field-row">
                <div className="field">
                  <label>Start date</label>
                  <input type="date" value={r.start_date || ""} onChange={(e) => update({ start_date: e.target.value })} />
                </div>
                <div className="field">
                  <label>Status</label>
                  <select value={r.status || "draft"} onChange={(e) => update({ status: e.target.value })}>
                    {Object.entries(RETAINER_STATUS).map(([k, label]) => (
                      <option key={k} value={k}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
            <div className="danger-row">
              <button className="btn" disabled={!r.client_name || !Number(r.monthly_fee)} onClick={() => onCreateInvoice(r)}>
                Create this month's invoice
              </button>
              <button className="btn btn-danger" onClick={handleDelete}>
                Delete retainer
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}

// ---------------- App ----------------
export default function App() {
  const [loading, setLoading] = useState(true);
  const [companies, setCompanies] = useState([]);
  const [technicians, setTechnicians] = useState([]);
  const [session, setSession] = useState(null); // { role: 'admin'|'technician', company, technician? }
  const [docs, setDocs] = useState([]);
  const [jobCards, setJobCards] = useState([]);
  const [retainers, setRetainers] = useState([]);
  const [currentRetainer, setCurrentRetainer] = useState(null);
  const [view, setViewState] = useState("login");
  // Remember where the user has been so the Back button works everywhere.
  const viewRef = useRef("login");
  const historyRef = useRef([]);
  function setView(next) {
    const prev = viewRef.current;
    if (prev !== next) {
      historyRef.current.push(prev);
      if (historyRef.current.length > 40) historyRef.current.shift();
    }
    viewRef.current = next;
    setViewState(next);
  }
  function resetView(next) {
    historyRef.current = [];
    viewRef.current = next;
    setViewState(next);
  }
  const [currentDoc, setCurrentDoc] = useState(null);
  const [formInitial, setFormInitial] = useState(null);
  const [currentJobCard, setCurrentJobCard] = useState(null);
  const [jobCardFormInitial, setJobCardFormInitial] = useState(null);
  const [filter, setFilter] = useState("all");
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    refreshCompanies();
    refreshTechnicians();
  }, []);

  async function refreshCompanies() {
    setLoading(true);
    const { data, error } = await supabase.from("companies").select("*").order("created_at", { ascending: true });
    if (error) {
      setLoadError(error.message);
      setLoading(false);
      return;
    }
    setCompanies(data || []);
    setLoading(false);
  }

  async function refreshTechnicians() {
    const { data } = await supabase.from("technicians").select("*");
    setTechnicians(data || []);
    // If the signed-in user's own record changed, keep the session up to date.
    setSession((prev) => {
      if (!prev?.user) return prev;
      const fresh = (data || []).find((t) => t.id === prev.user.id);
      return fresh ? { ...prev, user: fresh, technician: prev.technician ? fresh : prev.technician } : prev;
    });
  }

  async function loadDocs(companyId) {
    const { data, error } = await supabase.from("documents").select("*").eq("company_id", companyId);
    if (!error) setDocs(data || []);
  }

  async function loadRetainers(companyId) {
    const { data, error } = await supabase.from("retainers").select("*").eq("company_id", companyId);
    if (!error) setRetainers(data || []);
  }

  async function loadJobCards(companyId) {
    const { data, error } = await supabase.from("job_cards").select("*").eq("company_id", companyId);
    if (!error) setJobCards(data || []);
  }

  async function handleLoggedIn(sessionObj) {
    setSession(sessionObj);
    await loadJobCards(sessionObj.company.id);
    if (sessionObj.role === "admin") {
      await loadDocs(sessionObj.company.id);
      loadRetainers(sessionObj.company.id);
      setFilter("all");
      resetView("dashboard");
    } else {
      resetView("jobcards");
    }
  }

  function handleLogout() {
    setSession(null);
    setRetainers([]);
    setCurrentRetainer(null);
    setDocs([]);
    setJobCards([]);
    resetView("login");
  }

  const company = session?.company;
  const isAdmin = session?.role === "admin";
  const isSuperAdmin = isAdmin && !!session?.superAdmin;
  currentUserIsSuperAdmin = isSuperAdmin;
  const roleSubtitle = session?.user
    ? `${session.user.name} (${ROLE_LABELS[userRole(session.user)].toLowerCase()})`
    : null;

  function goSection(key) {
    if (key === "documents") setView("dashboard");
    else setView(key);
  }

  function docToFormInitial(d) {
    return {
      type: d.type,
      number: d.number,
      editingId: d.id,
      client: { name: d.client_name, address: d.client_address, email: d.client_email },
      issueDate: d.issue_date,
      dueDate: d.due_date,
      items: d.items.map((it) => ({ desc: it.desc, qty: it.qty, price: it.price })),
      taxEnabled: d.tax_enabled,
      taxRate: d.tax_rate,
      notes: d.notes,
      terms: d.terms
    };
  }

  function openNewDoc(type, prefill) {
    setFormInitial(
      prefill || {
        type,
        client: { name: "", address: "", email: "" },
        issueDate: todayISO(),
        dueDate: plusDays(todayISO(), 14),
        items: [{ desc: "", qty: 1, price: 0 }],
        taxRate: 0,
        notes: "",
        terms: type === "quote" ? "This quote is valid for 30 days." : "Payment due within 14 days."
      }
    );
    setView("newdoc");
  }

  function openJobCardForm(prefill) {
    setJobCardFormInitial(prefill || null);
    setView("jobcard-new");
  }

  if (loading) {
    return (
      <div className="center-screen">
        <div className="brand-hero">
          <JobflowLogo size={72} />
          <JobflowWordmark big />
          <p className="hint">Loading…</p>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="center-screen">
        <div className="panel">
          <h1>Couldn't connect</h1>
          <p className="sub">{loadError}</p>
          <p className="hint">Check that VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set correctly.</p>
        </div>
      </div>
    );
  }

  if (companies.length < 2) {
    const which = companies.length === 0 ? "A" : "B";
    return (
      <Setup
        which={which}
        existingUsernames={companies.map((c) => c.username)}
        onCreated={refreshCompanies}
      />
    );
  }

  if (!session) {
    return <Login companies={companies} technicians={technicians} onLoggedIn={handleLoggedIn} />;
  }

  // Technicians can only ever reach job-card screens, regardless of what
  // view state may have been left over from before.
  const effectiveView = isAdmin ? view : view.startsWith("jobcard") ? view : "jobcards";
  const homeView = isAdmin ? "dashboard" : "jobcards";
  const FORM_VIEWS = ["newdoc", "jobcard-new"];
  function confirmLeave() {
    return !FORM_VIEWS.includes(viewRef.current) || confirm("Leave this page? Anything you haven't saved will be lost.");
  }
  appNav = {
    atHome: effectiveView === homeView,
    onHome: () => {
      if (!confirmLeave()) return;
      resetView(homeView);
    },
    onBack: () => {
      if (!confirmLeave()) return;
      const h = historyRef.current;
      while (h.length) {
        const prev = h.pop();
        // Skip the login screen, half-filled forms and the page we're already on.
        if (prev === "login" || FORM_VIEWS.includes(prev) || prev === viewRef.current) continue;
        if (!isAdmin && !prev.startsWith("jobcard")) continue;
        viewRef.current = prev;
        setViewState(prev);
        return;
      }
      resetView(homeView);
    }
  };

  if (effectiveView === "retainers" && isAdmin) {
    return (
      <RetainerList
        company={company}
        retainers={retainers}
        onLogout={handleLogout}
        onEdit={() => setView("settings")}
        onSection={goSection}
        onNew={() => {
          setCurrentRetainer(newRetainer(company.id));
          setView("retainer-edit");
        }}
        onOpen={(r) => {
          setCurrentRetainer(r);
          setView("retainer-edit");
        }}
      />
    );
  }

  if (effectiveView === "retainer-edit" && currentRetainer && isAdmin) {
    const aiAuth = session.user
      ? { companyId: company.id, username: session.user.username, password: session.user.password }
      : { companyId: company.id, username: company.username, password: company.password };
    return (
      <RetainerEditor
        key={currentRetainer.id}
        company={company}
        initial={currentRetainer}
        aiAuth={aiAuth}
        onLogout={handleLogout}
        onEdit={() => setView("settings")}
        onBack={() => setView("retainers")}
        onSaved={(saved) => {
          setRetainers((prev) => (prev.some((x) => x.id === saved.id) ? prev.map((x) => (x.id === saved.id ? saved : x)) : [...prev, saved]));
          setCurrentRetainer(saved);
        }}
        onDeleted={(id) => {
          setRetainers((prev) => prev.filter((x) => x.id !== id));
          setCurrentRetainer(null);
          setView("retainers");
        }}
        onCreateInvoice={(r) => {
          const month = new Date().toLocaleDateString("en-ZA", { month: "long", year: "numeric" });
          openNewDoc("invoice", {
            type: "invoice",
            client: { name: r.client_name || "", address: r.client_address || "", email: r.client_email || "" },
            issueDate: todayISO(),
            dueDate: plusDays(todayISO(), 14),
            items: [{ desc: `${r.title || "Monthly retainer"} – ${month}`, qty: 1, price: Number(r.monthly_fee) || 0 }],
            taxRate: 0,
            notes: "",
            terms: "Payment due within 14 days."
          });
        }}
      />
    );
  }

  if (effectiveView === "settings" && isAdmin) {
    return (
      <Settings
        company={company}
        onLogout={handleLogout}
        onCancel={() => setView("dashboard")}
        onSaved={(updated) => {
          setSession({ ...session, company: updated });
          setCompanies((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
          setView("dashboard");
        }}
      />
    );
  }

  if (effectiveView === "technicians" && isSuperAdmin) {
    return (
      <TechnicianManager
        company={company}
        technicians={technicians}
        currentUser={session.user}
        onLogout={handleLogout}
        onEdit={() => setView("settings")}
        onSection={goSection}
        onChanged={refreshTechnicians}
      />
    );
  }

  if (effectiveView === "newdoc" && isAdmin) {
    return (
      <DocumentForm
        company={company}
        initial={formInitial}
        onLogout={handleLogout}
        onEdit={() => setView("settings")}
        onCancel={() => setView(formInitial.editingId ? "viewdoc" : "dashboard")}
        onSaved={async (newDoc, updatedCompany) => {
          setDocs((prev) => {
            const updated = prev.map((d) => (d.id === formInitial.convertedFromId ? { ...d, status: "converted" } : d));
            return [...updated, newDoc];
          });
          setSession({ ...session, company: updatedCompany });
          setCompanies((prev) => prev.map((c) => (c.id === updatedCompany.id ? updatedCompany : c)));

          if (formInitial.linkedJobCardId) {
            const statusField = formInitial.linkedJobCardField === "quote_id" ? "quoted" : "invoiced";
            const { data: updatedCard } = await supabase
              .from("job_cards")
              .update({ [formInitial.linkedJobCardField]: newDoc.id, status: statusField })
              .eq("id", formInitial.linkedJobCardId)
              .select()
              .single();
            if (updatedCard) setJobCards((prev) => prev.map((jc) => (jc.id === updatedCard.id ? updatedCard : jc)));
          }

          setCurrentDoc(newDoc);
          setFilter("all");
          setView("viewdoc");
        }}
        onUpdated={(updated) => {
          setDocs((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
          setCurrentDoc(updated);
          setView("viewdoc");
        }}
      />
    );
  }

  if (effectiveView === "viewdoc" && currentDoc && isAdmin) {
    return (
      <DocumentView
        company={company}
        doc={currentDoc}
        onLogout={handleLogout}
        onEdit={() => setView("settings")}
        onEditDoc={(d) => {
          setFormInitial(docToFormInitial(d));
          setView("newdoc");
        }}
        onBack={() => setView("dashboard")}
        onChanged={(updated) => {
          setDocs((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
          setCurrentDoc(updated);
        }}
        onDeleted={(id) => {
          setDocs((prev) => prev.filter((d) => d.id !== id));
          setView("dashboard");
        }}
        onConvert={(quote) =>
          openNewDoc("invoice", {
            type: "invoice",
            client: { name: quote.client_name, address: quote.client_address, email: quote.client_email },
            issueDate: todayISO(),
            dueDate: plusDays(todayISO(), 14),
            items: quote.items.map((it) => ({ desc: it.desc, qty: it.qty, price: it.price })),
            taxEnabled: quote.tax_enabled,
            taxRate: quote.tax_rate,
            notes: quote.notes,
            terms: "Payment due within 14 days.",
            convertedFromId: quote.id
          })
        }
      />
    );
  }

  if (effectiveView === "jobcard-new") {
    return (
      <JobCardForm
        company={company}
        technician={session.user || null}
        initial={jobCardFormInitial}
        subtitle={roleSubtitle}
        onLogout={handleLogout}
        onCancel={() => setView(jobCardFormInitial ? "jobcard-view" : "jobcards")}
        onSaved={(saved) => {
          setJobCards((prev) => {
            const exists = prev.some((jc) => jc.id === saved.id);
            return exists ? prev.map((jc) => (jc.id === saved.id ? saved : jc)) : [...prev, saved];
          });
          setCurrentJobCard(saved);
          setView("jobcard-view");
        }}
      />
    );
  }

  if (effectiveView === "jobcard-view" && currentJobCard) {
    return (
      <JobCardView
        company={company}
        jobCard={currentJobCard}
        isAdmin={isAdmin}
        subtitle={roleSubtitle}
        onLogout={handleLogout}
        onEdit={() => setView("settings")}
        onBack={() => setView("jobcards")}
        onEditCard={(jc) => openJobCardForm(jc)}
        onChanged={(updated) => {
          setCurrentJobCard(updated);
          setJobCards((prev) => prev.map((jc) => (jc.id === updated.id ? updated : jc)));
        }}
        onDeleted={(id) => {
          setJobCards((prev) => prev.filter((jc) => jc.id !== id));
          setView("jobcards");
        }}
        onConvert={(jobCard, type) => {
          const spares = type === "quote" ? jobCard.spares_needed : jobCard.spares_used;
          openNewDoc(type, {
            type,
            client: { name: jobCard.client_name, address: jobCard.site_address, email: "" },
            issueDate: todayISO(),
            dueDate: plusDays(todayISO(), 14),
            items: spares.map((it) => ({ desc: it.desc, qty: it.qty, price: it.price })),
            taxRate: 0,
            notes: jobCard.description || "",
            terms: type === "quote" ? "This quote is valid for 30 days." : "Payment due within 14 days.",
            linkedJobCardId: jobCard.id,
            linkedJobCardField: type === "quote" ? "quote_id" : "invoice_id"
          });
        }}
      />
    );
  }

  if (effectiveView === "jobcards") {
    return (
      <JobCardList
        company={company}
        jobCards={jobCards}
        isAdmin={isAdmin}
        onLogout={handleLogout}
        onEdit={() => setView("settings")}
        onSection={goSection}
        onNew={() => openJobCardForm(null)}
        onOpen={(jc) => {
          setCurrentJobCard(jc);
          setView("jobcard-view");
        }}
      />
    );
  }

  return (
    <Dashboard
      company={company}
      docs={docs}
      filter={filter}
      setFilter={setFilter}
      onLogout={handleLogout}
      onEdit={() => setView("settings")}
      onSection={goSection}
      onNew={() => openNewDoc("quote")}
      onOpen={(d) => {
        setCurrentDoc(d);
        setView("viewdoc");
      }}
    />
  );
}
