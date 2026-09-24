import React, { useState, useEffect, useRef } from "react";
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

// ---------------- Job card PDF export (spares used, no prices) ----------------
function downloadJobCardPdf(jobCard, company) {
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

    const safeClient = (jobCard.client_name || "job").replace(/[^a-zA-Z0-9_-]+/g, "_");
    pdf.save(`JobCard_${safeClient}_${loggedDate || todayISO()}.pdf`);
  } catch (err) {
    console.error(err);
    alert("Couldn't generate the job card PDF. Please try again.");
  }
}

// ---------------- Topbar ----------------
function Topbar({ company, onLogout, onEdit, subtitle }) {
  return (
    <div className="topbar">
      <div className="brand">
        <span className="wordmark">Twofold</span>
        <span className="tag">quotes &amp; invoices</span>
      </div>
      {company && (
        <div className="company-chip">
          {company.logo && <img src={company.logo} alt="" />}
          <span className="cname">
            {company.name}
            {subtitle && <span style={{ fontWeight: 400, color: "var(--ink-soft)" }}> — {subtitle}</span>}
          </span>
          {onEdit && (
            <button className="btn btn-quiet btn-sm" onClick={onEdit}>
              Edit logo
            </button>
          )}
          <button className="btn btn-quiet btn-sm" onClick={onLogout}>
            Sign out
          </button>
        </div>
      )}
    </div>
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
      <>
        <Topbar company={null} />
        <div className="center-screen">
          <div style={{ textAlign: "center", width: "100%" }}>
            <h1 className="serif" style={{ fontSize: 22, margin: "0 0 26px" }}>
              Choose a company to sign in
            </h1>
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
        </div>
      </>
    );
  }

  function submit() {
    if (role === "admin") {
      if (username === picked.username && password === picked.password) {
        onLoggedIn({ role: "admin", company: picked });
        return;
      }
    } else {
      const tech = technicians.find(
        (t) => t.company_id === picked.id && t.username === username && t.password === password
      );
      if (tech) {
        onLoggedIn({ role: "technician", company: picked, technician: tech });
        return;
      }
    }
    setError("Incorrect username or password.");
  }

  return (
    <>
      <Topbar company={null} />
      <div className="center-screen">
        <div className="panel">
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
      </div>
    </>
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
function AdminTabs({ active, onChange }) {
  return (
    <div className="tabs">
      {[
        ["documents", "Quotes & Invoices"],
        ["jobcards", "Job Cards"],
        ["technicians", "Technicians"]
      ].map(([key, label]) => (
        <button key={key} className={`tab ${active === key ? "active" : ""}`} onClick={() => onChange(key)}>
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
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleFiles(e) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setUploading(true);
    const uploaded = [];
    for (const file of files) {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${company.id}/${id}/${Date.now()}-${safeName}`;
      const { error } = await supabase.storage.from("job-photos").upload(path, file);
      if (!error) {
        const { data } = supabase.storage.from("job-photos").getPublicUrl(path);
        uploaded.push({ path, url: data.publicUrl });
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
                <img
                  src={p.url}
                  alt=""
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
    for (const file of files) {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_") || "receipt.jpg";
      const path = `${company.id}/${jobCard.id}/receipts/${Date.now()}-${safeName}`;
      const { error } = await supabase.storage.from("job-photos").upload(path, file);
      if (error) {
        alert("Upload failed for " + file.name + ": " + error.message);
        continue;
      }
      const { data } = supabase.storage.from("job-photos").getPublicUrl(path);
      added.push({ path, url: data.publicUrl, name: file.name, type: file.type, uploaded_at: new Date().toISOString() });
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
          <p className="hint" style={{ margin: "4px 0 0" }}>Admin only — not shown to technicians or on the job card PDF.</p>
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
                    <img src={r.url} alt="Receipt" style={{ width: 100, height: 100, objectFit: "cover", borderRadius: 6, border: "1px solid var(--line)" }} />
                  )}
                </a>
                <div className="hint" style={{ fontSize: 11 }}>{r.uploaded_at ? fmtDate(r.uploaded_at.slice(0, 10)) : ""}</div>
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
            <button className="btn btn-sm" onClick={() => downloadJobCardPdf(jobCard, company)}>
              Download PDF
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

          {jobCard.photos?.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, color: "var(--ink-soft)", fontWeight: 600, marginBottom: 8 }}>
                Photos
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                {jobCard.photos.map((p, idx) => (
                  <a key={idx} href={p.url} target="_blank" rel="noreferrer">
                    <img src={p.url} alt="" style={{ width: 100, height: 100, objectFit: "cover", borderRadius: 6, border: "1px solid var(--line)" }} />
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
function TechnicianManager({ company, technicians, onLogout, onEdit, onSection, onChanged }) {
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const companyTechs = technicians.filter((t) => t.company_id === company.id);

  async function addTechnician() {
    if (!name.trim() || !username.trim() || !password) {
      setError("Name, username and password are required.");
      return;
    }
    setError("");
    setSaving(true);
    const { error: insertError } = await supabase.from("technicians").insert({
      company_id: company.id,
      name: name.trim(),
      username: username.trim(),
      password
    });
    setSaving(false);
    if (insertError) {
      setError(insertError.message.includes("duplicate") ? "That username is already taken." : "Couldn't save: " + insertError.message);
      return;
    }
    setName("");
    setUsername("");
    setPassword("");
    onChanged();
  }

  async function removeTechnician(id) {
    if (!confirm("Remove this technician's login?")) return;
    const { error } = await supabase.from("technicians").delete().eq("id", id);
    if (!error) onChanged();
  }

  return (
    <>
      <Topbar company={company} onLogout={onLogout} onEdit={onEdit} />
      <div className="container">
        <AdminTabs active="technicians" onChange={onSection} />

        <div className="form-section" style={{ maxWidth: 440 }}>
          <h3>Add a technician</h3>
          <div className="field">
            <label>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Kabir Singh" />
          </div>
          <div className="field">
            <label>Username</label>
            <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="e.g. kabir-tech" />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {error && <div className="error-msg" style={{ marginTop: 12 }}>{error}</div>}
          <button className="btn btn-primary" style={{ marginTop: 16 }} disabled={saving} onClick={addTechnician}>
            {saving ? "Adding…" : "Add technician"}
          </button>
        </div>

        {companyTechs.length === 0 ? (
          <div className="empty-state">
            <div className="big">No technicians yet</div>
            <div>Add one above to give them job-card-only access.</div>
          </div>
        ) : (
          <div className="doclist-wrap">
            <table className="doclist">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Username</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {companyTechs.map((t) => (
                  <tr key={t.id}>
                    <td>{t.name}</td>
                    <td className="num-cell">{t.username}</td>
                    <td style={{ textAlign: "right" }}>
                      <button className="btn btn-sm btn-danger" onClick={() => removeTechnician(t.id)}>
                        Remove
                      </button>
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

// ---------------- App ----------------
export default function App() {
  const [loading, setLoading] = useState(true);
  const [companies, setCompanies] = useState([]);
  const [technicians, setTechnicians] = useState([]);
  const [session, setSession] = useState(null); // { role: 'admin'|'technician', company, technician? }
  const [docs, setDocs] = useState([]);
  const [jobCards, setJobCards] = useState([]);
  const [view, setView] = useState("login");
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
  }

  async function loadDocs(companyId) {
    const { data, error } = await supabase.from("documents").select("*").eq("company_id", companyId);
    if (!error) setDocs(data || []);
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
      setFilter("all");
      setView("dashboard");
    } else {
      setView("jobcards");
    }
  }

  function handleLogout() {
    setSession(null);
    setDocs([]);
    setJobCards([]);
    setView("login");
  }

  const company = session?.company;
  const isAdmin = session?.role === "admin";
  const roleSubtitle = session?.role === "technician" ? `${session.technician.name} (technician)` : null;

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
        <p className="serif" style={{ fontSize: 18, color: "var(--ink-soft)" }}>
          Loading Twofold…
        </p>
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

  if (effectiveView === "technicians" && isAdmin) {
    return (
      <TechnicianManager
        company={company}
        technicians={technicians}
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
        technician={session.role === "technician" ? session.technician : null}
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
