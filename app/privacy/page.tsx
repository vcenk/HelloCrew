import type { Metadata } from "next";

import { LEGAL_CONTACT, LegalPage } from "@/components/legal-page";

export const metadata: Metadata = { title: "Privacy policy · HelloCrew" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy policy">
      <p>
        HelloCrew is an AI front desk for small businesses, operated by AgentLand (“we”). This policy explains what
        we collect, why, and the choices you have. It covers business owners who use HelloCrew and the customers who
        message those businesses.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li><strong>Account details</strong>: your name, email and profile picture from Google sign-in, and your workspace settings.</li>
        <li><strong>Business knowledge</strong>: the services, prices, hours, files and web pages you add so the assistant can answer.</li>
        <li><strong>Conversations</strong>: messages customers send through your website chat, Facebook Messenger, Instagram or WhatsApp, and the replies sent to them.</li>
        <li><strong>Customer contact details</strong>: names, phone numbers or emails a customer chooses to share, for example when asking to be called back.</li>
        <li><strong>Reviews and comments</strong>: public Google reviews and Facebook or Instagram comments on accounts you connect, and the replies you approve.</li>
        <li><strong>Connection tokens</strong>: access tokens for the Facebook Pages, Instagram accounts, WhatsApp numbers and Google Business Profiles you connect. They are encrypted at rest.</li>
        <li><strong>Usage data</strong>: basic logs and AI usage counts used to run, secure and bill the service.</li>
      </ul>

      <h2>How we use it</h2>
      <ul>
        <li>To answer your customers on the channels you connect, using the knowledge you provide.</li>
        <li>To draft replies to reviews and comments. Public replies are only posted after you approve them.</li>
        <li>To show you conversations, leads and alerts, and to keep the service secure and within your budget.</li>
      </ul>
      <p>We do not sell personal data and we do not use your data to advertise.</p>

      <h2>Google user data</h2>
      <p>
        When you connect a Google Business Profile, HelloCrew reads the locations you manage and their reviews, and
        posts replies you approve. HelloCrew’s use and transfer of information received from Google APIs adheres to
        the{" "}
        <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">
          Google API Services User Data Policy
        </a>
        , including the Limited Use requirements. We do not use Google user data to train general AI models.
      </p>

      <h2>Meta platform data</h2>
      <p>
        When you connect a Facebook Page, Instagram account or WhatsApp number, HelloCrew receives messages and
        comments sent to that account so the assistant can reply. We use this data only to provide HelloCrew to the
        business that connected the account.
      </p>

      <h2>Service providers</h2>
      <p>
        We use trusted providers to run HelloCrew: Supabase (database and sign-in), Vercel (hosting), OpenAI (AI
        replies; data sent through its API is not used to train its models by default), Meta and Google (the channels
        you connect), and an email provider for alerts. They process data only on our behalf.
      </p>

      <h2>Retention and deletion</h2>
      <p>
        We keep your data while your workspace is active. Disconnecting an account deletes its stored tokens right
        away. You can delete knowledge and conversations in the app, or ask us to delete your whole workspace — see{" "}
        <a href="/data-deletion">Data deletion</a>. Customers of a business can ask that business, or us, to delete
        their messages.
      </p>

      <h2>Security</h2>
      <p>
        Data is encrypted in transit, connection tokens are encrypted at rest, and each business can only access its
        own workspace.
      </p>

      <h2>Your rights</h2>
      <p>
        You can ask to see, correct or delete your personal information by emailing{" "}
        <a href={`mailto:${LEGAL_CONTACT}`}>{LEGAL_CONTACT}</a>. We answer within 30 days.
      </p>

      <h2>Changes</h2>
      <p>If we change this policy we will update the date above and tell workspace owners about important changes.</p>
    </LegalPage>
  );
}
