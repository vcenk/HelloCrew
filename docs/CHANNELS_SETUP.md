# Connecting Facebook, Instagram, WhatsApp and Google

HelloCrew uses **one Meta app and one Google Cloud project** for all businesses.
Each business signs in with its own account and HelloCrew stores that
business's tokens, encrypted. The steps below are done once, by you.

## 1. Server settings (Vercel → Project → Settings → Environment Variables)

| Name | Where it comes from |
| --- | --- |
| `HELLOCREW_ENCRYPTION_KEY` | Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. Never change it after businesses connect. |
| `META_APP_ID`, `META_APP_SECRET` | Meta app → App settings → Basic |
| `META_WEBHOOK_VERIFY_TOKEN` | Any long random string you choose |
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` | Google Cloud → APIs & Services → Credentials |
| `CRON_SECRET` | Any long random string (Vercel Cron sends it automatically) |

Add the same values to `.env.local` to try locally. Redeploy after changing them.

## 2. Meta app (developers.facebook.com)

1. **Create app** → type **Business**. Connect it to your Meta Business portfolio.
2. Add products: **Facebook Login for Business**, **Messenger**, **Instagram** (API with Facebook Login), **WhatsApp**, **Webhooks**.
3. Facebook Login → Settings → **Valid OAuth Redirect URIs**:
   `https://agentland.app/api/connect/meta/callback`
   (add `http://localhost:3000/api/connect/meta/callback` for local tests).
4. Webhooks — callback URL `https://agentland.app/api/webhooks/meta`, verify token = `META_WEBHOOK_VERIFY_TOKEN`. Subscribe:
   - **Page**: `messages`, `feed`, `ratings`
   - **Instagram**: `messages`, `comments`
   - **WhatsApp Business Account**: `messages`
5. While the app is in **Development mode** only people with a role on the app
   (Admin/Developer/Tester) can connect and message it. That is enough to test
   with your own Page and Instagram account.

### WhatsApp test number
WhatsApp → API Setup gives a free test number. Copy the **Phone number ID**
and a **System user access token** (Business settings → System users →
generate token with `whatsapp_business_messaging`, `whatsapp_business_management`).
Add your own phone as a test recipient there. In HelloCrew:
**Crew → Receptionist → Channels → WhatsApp → paste both**.

### Test it
1. HelloCrew → Crew → Receptionist → Channels → **Connect Facebook & Instagram** → choose your Page.
   (The Instagram account must be a Professional account linked to that Page.)
2. Message the Page from another account (a tester) → the crew answers; the chat appears in Conversations.
3. Comment on a Page post or Instagram post → a draft appears in **Reputation manager** for you to approve.

### Going live (for real salons)
Submit **App Review** for: `pages_show_list`, `pages_messaging`,
`pages_manage_metadata`, `pages_read_engagement`, `pages_manage_engagement`,
`pages_read_user_content`, `instagram_basic`, `instagram_manage_messages`,
`instagram_manage_comments`, `business_management`, plus **Business
verification**. WhatsApp for customers' own numbers needs **Embedded Signup**
(tech provider onboarding) — tracked in `INTEGRATIONS_TODO.md`.

## 3. Google Business Profile (reviews)

1. Google Cloud console → new project → enable **My Business Account Management API**,
   **My Business Business Information API** and **Google My Business API**.
2. **OAuth consent screen** → External; add yourself as a test user; scope `business.manage`.
3. Credentials → **OAuth client ID** (Web) → redirect URI:
   `https://agentland.app/api/connect/google/callback`
4. **Request API access**: Business Profile APIs are off (quota 0) until Google
   approves the project — apply via the "GBP API contact form" (choose *Application for Basic API Access*). Until then HelloCrew shows “Google hasn’t approved…”.
5. After approval: Reputation manager → **Connect Google** → choose the location.
   New reviews are checked every 30 minutes and drafted for your approval.

Public replies (comments and reviews) are **never posted without your approval**.
