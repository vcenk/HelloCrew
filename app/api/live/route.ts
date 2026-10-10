// Deliberately fail closed. Do not enable by adding a key or toggling an environment flag.
// Required before activation: authenticated users, durable shared usage quotas,
// server-owned approval records, provider policy, PII retention controls, and real adapters.
export async function POST() {
  return Response.json(
    { error: "Live AI is not configured. Use the no-cost practice demo." },
    { status: 503 },
  );
}
