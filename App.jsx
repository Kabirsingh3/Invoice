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
  try {
    const pdf = new jsPDF({ unit: "pt", format: "a4" });
    const pageW = pdf.internal.pageSize.getWidth();
    const marginX = 48;
    let y = 56;

    // Logo sits above the company name on the left, so it never collides
    // with the title/number block on the right.
    let nameY = y;
    if (company.logo) {
      try {
        const fmt = company.logo.includes("image/png") ? "PNG" : "JPEG";
        pdf.addImage(company.logo, fmt, marginX, y - 10, 44, 44, undefined, "FAST");
        nameY = y + 50;
      } catch (e) {}
    }

    pdf.setFont("times", "bold");
    pdf.setFontSize(15);
    pdf.setTextColor(26, 31, 43);
    pdf.text(company.name || "", marginX, nameY);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9.5);
    pdf.setTextColor(90, 95, 110);
    const addrLines = pdf.splitTextToSize(
      [company.address, company.email, company.phone].filter(Boolean).join("\n"),
      260
    );
    pdf.text(addrLines, marginX, nameY + 18);

    pdf.setTextColor(26, 31, 43);
    pdf.setFont("times", "bold");
    pdf.setFontSize(20);
    pdf.text(doc.type === "quote" ? "Quote" : "Invoice", pageW - marginX, y, { align: "right" });
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9.5);
    pdf.setTextColor(90, 95, 110);
    pdf.text(`Number: ${doc.number}`, pageW - marginX, y + 18, { align: "right" });
    pdf.text(`Issued: ${fmtDate(doc.issue_date)}`, pageW - marginX, y + 31, { align: "right" });
    pdf.text(
      `${doc.type === "quote" ? "Valid until" : "Due"}: ${fmtDate(doc.due_date)}`,
      pageW - marginX,
      y + 44,
      { align: "right" }
    );

    y = Math.max(nameY + 18 + addrLines.length * 11, y + 60) + 30;
    pdf.setTextColor(26, 31, 43);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9);
    pdf.text("BILLED TO", marginX, y);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(11);
    pdf.text(doc.client_name || "", marginX, y + 15);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9.5);
    pdf.setTextColor(90, 95, 110);
    const clientLines = pdf.splitTextToSize(
      [doc.client_address, doc.client_email].filter(Boolean).join("\n"),
      300
    );
    pdf.text(clientLines, marginX, y + 29);

    y += 60;
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
      styles: { font: "helvetica", fontSize: 9.5, textColor: [26, 31, 43], cellPadding: { top: 7, bottom: 7, left: 4, right: 4 } },
      headStyles: { fontStyle: "bold", fontSize: 8.5, textColor: [91, 99, 118], lineWidth: { bottom: 1 }, lineColor: [26, 31, 43] },
      columnStyles: { 1: { halign: "right", cellWidth: 50 }, 2: { halign: "right", cellWidth: 80 }, 3: { halign: "right", cellWidth: 80 } },
      didParseCell: (data) => {
        if (data.section === "body") {
          data.cell.styles.lineColor = [218, 212, 197];
          data.cell.styles.lineWidth = { bottom: 0.5 };
        }
      }
    });

    let finalY = pdf.lastAutoTable.finalY + 18;
    const totalsX = pageW - marginX - 160;
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9.5);
    pdf.setTextColor(90, 95, 110);
    pdf.text("Subtotal", totalsX, finalY);
    pdf.text("R" + money(totals.subtotal), pageW - marginX, finalY, { align: "right" });
    let totalLineY = finalY + 16;
    if (doc.tax_enabled) {
      pdf.text(`Tax (${doc.tax_rate}%)`, totalsX, finalY + 16);
      pdf.text("R" + money(totals.tax), pageW - marginX, finalY + 16, { align: "right" });
      totalLineY = finalY + 26;
    } else {
      totalLineY = finalY + 10;
    }
    pdf.setDrawColor(26, 31, 43);
    pdf.line(totalsX, totalLineY, pageW - marginX, totalLineY);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(12);
    pdf.setTextColor(26, 31, 43);
    pdf.text("Total", totalsX, totalLineY + 16);
    pdf.text("R" + money(totals.total), pageW - marginX, totalLineY + 16, { align: "right" });

    let noteY = totalLineY + 44;
    if (hasBankDetails(company)) {
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(9);
      pdf.setTextColor(26, 31, 43);
      pdf.text("Banking details", marginX, noteY);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(9);
      pdf.setTextColor(90, 95, 110);
      const bankLines = bankDetailsLines(company);
      pdf.text(bankLines, marginX, noteY + 13);
      noteY += 13 + bankLines.length * 11 + 12;
    }
    if (doc.notes) {
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(9);
      pdf.setTextColor(26, 31, 43);
      pdf.text("Notes", marginX, noteY);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(9);
      pdf.setTextColor(90, 95, 110);
      const lines = pdf.splitTextToSize(doc.notes, pageW - marginX * 2);
      pdf.text(lines, marginX, noteY + 13);
      noteY += 13 + lines.length * 11 + 12;
    }
    if (doc.terms) {
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(9);
      pdf.setTextColor(26, 31, 43);
      pdf.text("Terms", marginX, noteY);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(9);
      pdf.setTextColor(90, 95, 110);
      pdf.text(pdf.splitTextToSize(doc.terms, pageW - marginX * 2), marginX, noteY + 13);
    }

    pdf.save(`${doc.number}.pdf`);
  } catch (err) {
    console.error(err);
    alert("Couldn't generate the PDF. Please try again.");
  }
}

// ---------------- Topbar ----------------
function Topbar({ company, onLogout, onEdit }) {
  return (
    <div className="topbar">
      <div className="brand">
        <span className="wordmark">Twofold</span>
        <span className="tag">quotes &amp; invoices</span>
      </div>
      {company && (
        <div className="company-chip">
          {company.logo && <img src={company.logo} alt="" />}
          <span className="cname">{company.name}</span>
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
function Login({ companies, onLoggedIn }) {
  const [picked, setPicked] = useState(null);
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
    if (username === picked.username && password === picked.password) {
      onLoggedIn(picked);
    } else {
      setError("Incorrect username or password.");
    }
  }

  return (
    <>
      <Topbar company={null} />
      <div className="center-screen">
        <div className="panel">
          <h1>{picked.name}</h1>
          <p className="sub">Sign in to view this company's quotes and invoices.</p>
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
          <button className="btn btn-quiet" style={{ width: "100%", marginTop: 8 }} onClick={() => setPicked(null)}>
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

// ---------------- Dashboard ----------------
function Dashboard({ company, docs, onLogout, onEdit, onNew, onOpen, filter, setFilter }) {
  const filtered = docs.filter((d) => (filter === "all" ? true : d.type === filter));
  return (
    <>
      <Topbar company={company} onLogout={onLogout} onEdit={onEdit} />
      <div className="container">
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
        )}
      </div>
    </>
  );
}

// ---------------- New / edit document form ----------------
function DocumentForm({ company, initial, onCancel, onSaved, onLogout, onEdit }) {
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
          <button className={type === "quote" ? "active" : ""} onClick={() => setType("quote")}>
            Quote
          </button>
          <button className={type === "invoice" ? "active" : ""} onClick={() => setType("invoice")}>
            Invoice
          </button>
        </div>

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
            {saving ? "Saving…" : `Save ${type}`}
          </button>
        </div>
      </div>
    </>
  );
}

// ---------------- View document ----------------
function DocumentView({ company, doc, onBack, onLogout, onEdit, onChanged, onDeleted, onConvert }) {
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
        </div>
      </div>
    </>
  );
}

// ---------------- App ----------------
export default function App() {
  const [loading, setLoading] = useState(true);
  const [companies, setCompanies] = useState([]);
  const [session, setSession] = useState(null); // logged-in company object
  const [docs, setDocs] = useState([]);
  const [view, setView] = useState("login"); // login | settings | newdoc | viewdoc | dashboard
  const [currentDoc, setCurrentDoc] = useState(null);
  const [formInitial, setFormInitial] = useState(null);
  const [filter, setFilter] = useState("all");
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    refreshCompanies();
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

  async function loadDocs(companyId) {
    const { data, error } = await supabase.from("documents").select("*").eq("company_id", companyId);
    if (!error) setDocs(data || []);
  }

  async function handleLoggedIn(company) {
    setSession(company);
    await loadDocs(company.id);
    setFilter("all");
    setView("dashboard");
  }

  function handleLogout() {
    setSession(null);
    setDocs([]);
    setView("login");
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
    return <Login companies={companies} onLoggedIn={handleLoggedIn} />;
  }

  if (view === "settings") {
    return (
      <Settings
        company={session}
        onLogout={handleLogout}
        onCancel={() => setView("dashboard")}
        onSaved={(updated) => {
          setSession(updated);
          setCompanies((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
          setView("dashboard");
        }}
      />
    );
  }

  if (view === "newdoc") {
    return (
      <DocumentForm
        company={session}
        initial={formInitial}
        onLogout={handleLogout}
        onEdit={() => setView("settings")}
        onCancel={() => setView("dashboard")}
        onSaved={(newDoc, updatedCompany) => {
          setDocs((prev) => {
            const withoutOld = prev.filter((d) => d.id !== formInitial.convertedFromId);
            const updated = prev.map((d) => (d.id === formInitial.convertedFromId ? { ...d, status: "converted" } : d));
            return [...updated, newDoc];
          });
          setSession(updatedCompany);
          setCompanies((prev) => prev.map((c) => (c.id === updatedCompany.id ? updatedCompany : c)));
          setCurrentDoc(newDoc);
          setFilter("all");
          setView("viewdoc");
        }}
      />
    );
  }

  if (view === "viewdoc" && currentDoc) {
    return (
      <DocumentView
        company={session}
        doc={currentDoc}
        onLogout={handleLogout}
        onEdit={() => setView("settings")}
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

  return (
    <Dashboard
      company={session}
      docs={docs}
      filter={filter}
      setFilter={setFilter}
      onLogout={handleLogout}
      onEdit={() => setView("settings")}
      onNew={() => openNewDoc("quote")}
      onOpen={(d) => {
        setCurrentDoc(d);
        setView("viewdoc");
      }}
    />
  );
}
