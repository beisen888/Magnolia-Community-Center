/*
 * Magnolia Shift Board — settings you can edit.
 *
 * Supabase keys: on Vercel these come from environment variables automatically
 * (see /api/config.js). Only fill them in here for local testing without Vercel.
 * The anon key is safe to be public — the database rules in supabase/schema.sql protect the data.
 * Leave both blank to run in Preview mode (demo data saved only in your browser).
 */
window.MAGNOLIA = {
  supabaseUrl: "",
  supabaseAnonKey: "",

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
