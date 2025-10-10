// Supabase project credentials and options
const CONFIG = {
  SUPABASE_URL: "https://zxxlqslwaqmvtdhczeor.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp4eGxxc2x3YXFtdnRkaGN6ZW9yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk5OTg2ODAsImV4cCI6MjA3NTU3NDY4MH0.0lB674bYoATPsVETgaqLdTBQ-5EiuTO6h4Y-MhnUMLw",
  // Open-Meteo base URL (no key required)
  OPEN_METEO_BASE: "https://api.open-meteo.com/v1/forecast",
  // example parameters
  OPEN_METEO_PARAMS: {
    hourly: "temperature_2m,precipitation,relativehumidity_2m,windspeed_10m",
    timezone: "Africa/Kigali"
  },
  // detection thresholds (example multipliers / values)
  THRESHOLDS: {
    RAINFALL_FLOOD_MULTIPLIER: 3.0, // rainfall > 3x baseline => high
    RAINFALL_WARNING_MULTIPLIER: 1.5,
    TEMPERATURE_HEAT_THRESHOLD: 35 // deg C
  }
};
