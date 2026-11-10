/*
 * Magnolia DSP Schedule — settings.
 *
 * Supabase connection. The publishable key is MEANT to be public (it ships to every browser);
 * the row-level security rules in supabase/*.sql are what protect the data.
 * Blank both to run in Preview mode (demo data saved only in your browser).
 * NEVER put the sb_secret_ / service_role key here.
 *
 * Teams, homes, staffing needs and employees are edited by HR inside the app (HR tab), not here.
 */
window.MAGNOLIA = {
  supabaseUrl: "https://hxqgvmciigwyzeckbgys.supabase.co",
  supabaseAnonKey: "sb_publishable_dJv88wfXwYNijeHFx4KTSg_jzcx8uXg",

  orgName: "Magnolia Community Services",
  appName: "DSP Schedule",

  // 4-hour shift blocks around the clock (the database uses these index numbers 0–5).
  blocks: [
    { label: "12–4 AM", start: 0, end: 4, night: true },
    { label: "4–8 AM", start: 4, end: 8, night: true },
    { label: "8 AM–12 PM", start: 8, end: 12 },
    { label: "12–4 PM", start: 12, end: 16 },
    { label: "4–8 PM", start: 16, end: 20 },
    { label: "8 PM–12 AM", start: 20, end: 24, night: true },
  ],

  // Pay ladder from the proposal ($/hour).
  pay: { "DSP I": 16, "DSP II": 16.5, "Lead DSP": 17 },
  cnaBonus: 0.5,
  nightBonus: 0.5, // 8 PM – 8 AM

  weekStartsOn: 1, // 1 = Monday
  availabilityDueDay: 20, // DSPs pick next month's shifts by the 20th
  schedulePublishDay: 28, // HR locks/publishes next month by the 28th
  timezone: "America/Chicago",
};
