import type { Metadata } from "next";

import { LEGAL_CONTACT, LegalPage } from "@/components/legal-page";

export const metadata: Metadata = { title: "Data deletion · HelloCrew" };

export default function DataDeletionPage() {
  return (
    <LegalPage title="Data deletion">
      <h2>Business owners</h2>
      <ol>
        <li>
          <strong>Disconnect an account</strong>: in HelloCrew go to Crew → Receptionist → Channels (or Reputation
          manager) and choose Disconnect. Its access tokens are deleted immediately.
        </li>
        <li>
          <strong>Remove app access</strong>: you can also remove HelloCrew in Facebook (Settings → Business
          integrations) or in your Google Account (Security → Third-party connections).
        </li>
        <li>
          <strong>Delete everything</strong>: email <a href={`mailto:${LEGAL_CONTACT}`}>{LEGAL_CONTACT}</a> from your
          account email with the subject “Delete my HelloCrew data”. We delete your workspace, knowledge,
          conversations, leads and connections within 30 days and confirm by email.
        </li>
      </ol>

      <h2>Customers of a business</h2>
      <p>
        If you messaged a business that uses HelloCrew (on its website, Messenger, Instagram or WhatsApp) and want
        your messages deleted, email <a href={`mailto:${LEGAL_CONTACT}`}>{LEGAL_CONTACT}</a> with the business name,
        the channel, and the name or number you used. We will delete them within 30 days and confirm.
      </p>
    </LegalPage>
  );
}
