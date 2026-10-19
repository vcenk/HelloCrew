import type { Metadata } from "next";

import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = { title: "Terms of service · HelloCrew" };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of service">
      <p>
        These terms apply when you use HelloCrew, operated by AgentLand. By creating a workspace you agree to them.
      </p>

      <h2>The service</h2>
      <p>
        HelloCrew answers your customers with AI on the channels you connect, drafts replies to reviews and comments,
        and keeps conversations and leads in one place. HelloCrew is in early access, so features may change.
      </p>

      <h2>Your responsibilities</h2>
      <ul>
        <li>Only connect accounts you own or are authorized to manage.</li>
        <li>Keep the knowledge you provide accurate. The assistant answers from it and can still make mistakes.</li>
        <li>Review drafts before approving them. You are responsible for what is posted in your business’s name.</li>
        <li>Follow the rules of the platforms you connect, including Meta, WhatsApp and Google policies, and applicable privacy and anti-spam laws.</li>
        <li>Do not use HelloCrew for unlawful, deceptive or harmful purposes.</li>
      </ul>

      <h2>AI replies</h2>
      <p>
        AI replies can be wrong or incomplete. HelloCrew does not give medical, legal or financial advice. Bookings,
        prices and promises are only binding when you confirm them.
      </p>

      <h2>Your data</h2>
      <p>
        You own your business data. You let us process it to provide the service, as described in our{" "}
        <a href="/privacy">Privacy policy</a>. You can export or delete it at any time.
      </p>

      <h2>Fees</h2>
      <p>Early access is free unless we agree otherwise in writing. We will give notice before introducing paid plans.</p>

      <h2>Availability and liability</h2>
      <p>
        We work to keep HelloCrew available but cannot promise it will be uninterrupted. To the extent the law
        allows, HelloCrew is provided “as is” and our liability is limited to the amount you paid us in the past 12
        months.
      </p>

      <h2>Ending use</h2>
      <p>
        You can stop using HelloCrew and disconnect your accounts at any time. We may suspend workspaces that break
        these terms or the rules of connected platforms.
      </p>

      <h2>Governing law</h2>
      <p>These terms are governed by the laws of British Columbia, Canada.</p>
    </LegalPage>
  );
}
