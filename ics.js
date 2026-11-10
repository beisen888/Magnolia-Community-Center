/* Calendar file (.ics) export — opens in Google Calendar, Apple Calendar or Outlook. */
function buildIcs(events, calName) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/[,;]/g, (c) => "\\" + c).replace(/\n/g, "\\n");
  const at = (date, h) => {
    const d = new Date(date + "T00:00:00"); d.setHours(h);
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}0000`;
  };
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Magnolia//DSP Schedule//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${esc(calName)}`];
  for (const e of events) {
    lines.push("BEGIN:VEVENT", `UID:${e.uid}@magnolia-dsp`, `DTSTAMP:${stamp}`, `DTSTART:${at(e.date, e.start)}`, `DTEND:${at(e.date, e.end)}`,
      `SUMMARY:${esc(e.title)}`, `DESCRIPTION:${esc(e.description || "")}`,
      "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Shift starts in 1 hour", "TRIGGER:-PT1H", "END:VALARM", "END:VEVENT");
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
