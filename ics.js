/* Builds a calendar file (.ics) of your shifts — opens in Google Calendar, Apple Calendar or Outlook. */
function buildIcs({ orgName, shifts, groups, letters, groupAt }) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/[,;]/g, (c) => "\\" + c).replace(/\n/g, "\\n");
  const local = (date, h) => date.replace(/-/g, "") + "T" + String(h).padStart(2, "0") + "0000";
  const hr = (h) => `${h % 12 || 12} ${h >= 12 ? "PM" : "AM"}`;
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Magnolia//Shift Board//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  for (const s of shifts) {
    const plan = [];
    for (let h = s.start; h < s.end; h++) { const g = groupAt(s.lane, h); plan.push(`${hr(h)}: ${letters[g]} · ${groups[g]}`); }
    lines.push(
      "BEGIN:VEVENT",
      `UID:${s.date}-${s.id}-${s.lane}@magnolia-shift-board`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${local(s.date, s.start)}`,
      `DTEND:${local(s.date, s.end)}`,
      `SUMMARY:${esc(`${orgName} · ${s.label} shift (lane ${s.lane + 1})`)}`,
      `DESCRIPTION:${esc("Your rotation:\n" + plan.join("\n"))}`,
      "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Shift starts in 1 hour", "TRIGGER:-PT1H", "END:VALARM",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

function downloadFile(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
