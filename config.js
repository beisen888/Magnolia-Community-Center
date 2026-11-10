/*
 * Magnolia Shift Board — settings you can edit.
 *
 * Supabase connection. The publishable key is MEANT to be public (it ships to every browser);
 * the row-level security rules in supabase/schema.sql are what protect the data.
 * Vercel env vars SUPABASE_URL / SUPABASE_ANON_KEY (via /api/config.js) override these if set.
 * Blank both to run in Preview mode (demo data saved only in your browser).
 * NEVER put the sb_secret_ key here.
 */
window.MAGNOLIA = {
  supabaseUrl: "https://hxqgvmciigwyzeckbgys.supabase.co",
  supabaseAnonKey: "sb_publishable_dJv88wfXwYNijeHFx4KTSg_jzcx8uXg",

  orgName: "Magnolia",
  boardName: "Shift Board",

  // Shifts in 24-hour time. Each shift needs a short unique id.
  shifts: [
    { id: "am", label: "Morning", start: 9, end: 13 },
    { id: "pm", label: "Afternoon", start: 13, end: 17 },
  ],
  dayStart: 9,
  dayEnd: 17,
  workdays: [1, 2, 3, 4, 5], // 0 = Sunday … 6 = Saturday

  // Five groups (the colors and the database both assume exactly five).
  defaultGroups: ["Group A", "Group B", "Group C", "Group D", "Group E"],

  // How far ahead the "Open spots" tab looks.
  openSpotsDays: 21,
};
