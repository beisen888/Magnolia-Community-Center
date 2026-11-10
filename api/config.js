// Vercel serverless function: hands the browser the public Supabase settings
// from your Vercel environment variables, so keys never live in GitHub.
// Works with the variable names the Vercel ↔ Supabase integration creates.
module.exports = (req, res) => {
  const env = process.env;
  res.setHeader("Cache-Control", "public, max-age=300");
  res.status(200).json({
    supabaseUrl: env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || "",
    supabaseAnonKey: env.SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
  });
};
