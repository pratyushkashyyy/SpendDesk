import type { Metadata } from "next";
import Link from "next/link";
import { PolicyPage, supportEmail } from "@/components/public-site";

export const metadata: Metadata = {
  alternates: { canonical: "/privacy" },
  title: "Privacy policy · SpendDesk",
  description:
    "How SpendDesk accesses, uses, stores, and shares Google Ads and Shopify data, and how to request deletion or revoke access.",
};

export default function Privacy() {
  return (
    <PolicyPage
      title="Privacy policy"
      introduction="This policy explains how SpendDesk handles information used by its private Google Ads and Shopify reporting workspace."
    >
      <section>
        <h2>1. Who to contact</h2>
        <p>
          SpendDesk is a privately operated reporting application for connected
          stores and advertising accounts. The operator of this installation is
          responsible for its stored information. For privacy questions, access
          requests, or deletion requests, email{" "}
          <a href={`mailto:${supportEmail}`}>{supportEmail}</a>.
        </p>
      </section>
      <section>
        <h2>2. Information we access and store</h2>
        <ul>
          <li>
            <strong>Google account information:</strong> the email address of
            the Google account you authorize, used to identify the connection
            and associate the right advertising accounts.
          </li>
          <li>
            <strong>Google Ads reporting:</strong> account identifiers, currency
            and time zone, campaign names and status, spending, purchase
            conversions, budget settings, policy alerts, and available campaign
            and budget change history.
          </li>
          <li>
            <strong>Shopify reporting:</strong> connected store identifiers,
            aggregate order and sales reports, product catalog details, and
            product-to-campaign mappings. SpendDesk’s reporting queries use
            aggregate order counts rather than individual customer names,
            shipping addresses, or payment details.
          </li>
          <li>
            <strong>Connection and authentication information:</strong> OAuth
            authorization tokens, API credentials you supply, a hashed dashboard
            password, and temporary authorization and session records. Google
            refresh tokens and stored Shopify credentials are encrypted by the
            application.
          </li>
          <li>
            <strong>Technical information:</strong> request timestamps, errors,
            and connection health information. Hosting infrastructure may record
            IP addresses, browser information, and request logs for operation
            and security.
          </li>
        </ul>
        <p>
          We do not ask for your Google or Shopify account password. Google
          authorization takes place on Google’s own consent screen.
        </p>
      </section>
      <section>
        <h2>3. How information is used</h2>
        <p>
          We use this information to connect the accounts you authorize;
          retrieve, save, and refresh source reports; show order comparisons and
          budget history; generate requested exports; diagnose connection
          problems; and secure the workspace. SpendDesk reads reporting data and
          does not modify Google Ads campaigns, bids, or budgets, or Shopify
          orders.
        </p>
      </section>
      <section>
        <h2>4. Google user data and limited use</h2>
        <p>
          SpendDesk handles information received from Google APIs according to
          the{" "}
          <a
            href="https://developers.google.com/terms/api-services-user-data-policy"
            target="_blank"
            rel="noopener noreferrer"
          >
            Google API Services User Data Policy
          </a>
          , including its Limited Use requirements. Google user data is used to
          provide the reporting features you authorize.
        </p>
        <p>
          We do not sell Google user data, use it for advertising targeting, or
          use it to train or improve general-purpose artificial intelligence or
          machine-learning models. Human access is limited to authorized use of
          the workspace and circumstances permitted by Google’s policy, such as
          assistance you request, security investigations, or legal obligations.
        </p>
      </section>
      <section>
        <h2>5. Sharing and service providers</h2>
        <p>
          SpendDesk communicates with Google and Shopify to obtain the reports
          you request. The application and database are hosted on Railway, which
          processes stored information and technical logs as part of providing
          the hosting service. Authorized operators may access information
          needed to administer and support the installation. We may also
          disclose information when required by law or necessary to address
          abuse or security threats.
        </p>
        <p>
          If you explicitly connect an external reporting assistant such as
          ChatGPT, that service can receive the saved account and reporting
          information exposed by the permissions you approve. A separate refresh
          permission allows it to request report updates. The reporting tools do
          not return your stored Google or Shopify credentials. You control
          whether to enable this connection; review the external service’s
          terms, privacy policy, and data settings before doing so.
        </p>
        <p>We do not sell or rent your connected reporting information.</p>
      </section>
      <section>
        <h2>6. Storage, retention, and security</h2>
        <p>
          Reports, store mappings, product information, and budget histories are
          retained to support reporting and comparisons until the operator
          deletes them or removes the installation. Intraday observations are
          periodically pruned as reports sync. Authorization and session records
          have expiration periods. Technical logs and backups may remain
          according to hosting retention settings and applicable security or
          legal requirements.
        </p>
        <p>
          We use password-protected access, signed session cookies, encrypted
          stored connection credentials, and HTTPS on the deployed service. No
          online system can guarantee complete security. Revoking a provider
          connection stops future authorized access but does not automatically
          delete previously saved reports.
        </p>
      </section>
      <section>
        <h2>7. Your controls and deletion requests</h2>
        <p>
          You can revoke Google access through your{" "}
          <a
            href="https://myaccount.google.com/connections"
            target="_blank"
            rel="noopener noreferrer"
          >
            Google Account connections
          </a>
          , revoke Shopify app or API access through Shopify, and disconnect
          optional reporting assistants through their connection settings.
        </p>
        <p>
          To request access to, correction of, or deletion of data held by this
          installation, email{" "}
          <a href={`mailto:${supportEmail}`}>{supportEmail}</a>. Describe the
          connected account or store and the information concerned. We may
          verify your authority before acting. Do not send passwords, access
          tokens, or client secrets by email. Revoking permissions and
          requesting deletion are separate actions.
        </p>
      </section>
      <section>
        <h2>8. Cookies</h2>
        <p>
          SpendDesk uses essential cookies to maintain dashboard sessions and
          protect Google authorization. The application does not use advertising
          cookies. Blocking essential cookies may prevent sign-in or account
          connection.
        </p>
      </section>
      <section>
        <h2>9. Updates to this policy</h2>
        <p>
          Changes will be published on this page with a revised update date. Our{" "}
          <Link href="/terms">terms of service</Link> describe the conditions
          for using SpendDesk. Contact{" "}
          <a href={`mailto:${supportEmail}`}>{supportEmail}</a> with questions
          about either document.
        </p>
      </section>
    </PolicyPage>
  );
}
