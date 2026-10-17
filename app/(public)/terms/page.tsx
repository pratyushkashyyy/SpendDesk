import type { Metadata } from "next";
import Link from "next/link";
import { PolicyPage, supportEmail } from "@/components/public-site";

export const metadata: Metadata = {
  alternates: { canonical: "/terms" },
  title: "Terms of service · SpendDesk",
  description:
    "Conditions for authorized use of SpendDesk, including connected account permissions, source reporting limits, privacy, and support.",
};

export default function Terms() {
  return (
    <PolicyPage
      title="Terms of service"
      introduction="These terms describe the conditions for using SpendDesk’s private reporting workspace. By using SpendDesk, you agree to these terms."
    >
      <section>
        <h2>1. The service</h2>
        <p>
          SpendDesk helps authorized store operators review Google Ads spending,
          campaign budgets, purchase conversions, Shopify order counts, and
          product reporting in one workspace. Features include saved reports,
          comparisons, history, and exports. SpendDesk is an independent
          application and is not affiliated with or endorsed by Google, Shopify,
          Railway, or OpenAI.
        </p>
      </section>
      <section>
        <h2>2. Authorized access</h2>
        <p>
          Use SpendDesk only for accounts and stores you own or are authorized
          to manage. This installation is intended for its owner and authorized
          users; access to a public information page does not grant access to
          the dashboard. You are responsible for keeping the dashboard password,
          API credentials, and any downloaded reports secure.
        </p>
        <p>
          You must provide accurate connection information and maintain the
          permissions needed to retrieve reports. Google’s authorization scope
          may permit broader account management, but SpendDesk uses its Google
          Ads integration for reporting reads. It does not change campaigns,
          bids, budgets, or Shopify orders.
        </p>
      </section>
      <section>
        <h2>3. Acceptable use</h2>
        <p>
          Do not use the service to access data without permission, share
          credentials with unauthorized people, bypass access controls or
          provider limits, interfere with service security or availability, or
          violate applicable law or third-party rights. Use of connected
          services must comply with their applicable terms and API policies.
        </p>
      </section>
      <section>
        <h2>4. Reporting limitations</h2>
        <p>
          Reports depend on Google, Shopify, saved snapshots, account time
          zones, provider attribution, API quotas, and granted permissions.
          Information may be delayed, incomplete, revised by a provider, or
          temporarily unavailable. Purchase conversions may be fractional, and
          current budget settings do not represent actual spending or
          necessarily the settings used on a historical date.
        </p>
        <p>
          Verify material decisions against the original provider. SpendDesk
          does not guarantee report completeness, uninterrupted hourly updates,
          advertising performance, profitability, or business results. A missing
          figure should not be interpreted as zero.
        </p>
      </section>
      <section>
        <h2>5. Your data and optional integrations</h2>
        <p>
          You retain your rights in the information you are authorized to
          connect. You authorize the processing needed to provide the reporting
          and export features you use. The{" "}
          <Link href="/privacy">privacy policy</Link> explains the information
          accessed, its uses, storage, sharing, retention, and deletion
          controls.
        </p>
        <p>
          Connecting an optional reporting assistant grants the permissions
          shown in its authorization flow. Review what it can read or refresh
          and the external provider’s policies. You are responsible for deciding
          which reports and exports to share.
        </p>
      </section>
      <section>
        <h2>6. Availability and changes</h2>
        <p>
          The service may change, be interrupted for maintenance, or pause
          provider requests because of rate limits, quota limits, expired
          permissions, or security concerns. Features may be updated or
          discontinued. Access may be suspended if it is unauthorized, unsafe,
          or inconsistent with these terms.
        </p>
        <p>
          You may stop using SpendDesk and revoke connected account permissions
          at any time. Revocation does not automatically erase stored reports;
          contact <a href={`mailto:${supportEmail}`}>{supportEmail}</a> to
          request deletion.
        </p>
      </section>
      <section>
        <h2>7. Warranties and responsibility</h2>
        <p>
          To the extent permitted by applicable law, SpendDesk is provided “as
          is” and “as available,” without warranties of uninterrupted
          availability, completeness, or fitness for a particular purpose. You
          remain responsible for your account administration, reporting checks,
          business decisions, and exports. Nothing in these terms excludes
          rights, remedies, or liability that cannot lawfully be excluded.
        </p>
      </section>
      <section>
        <h2>8. Updates and contact</h2>
        <p>
          Updates to these terms will be posted here with a revised date. Review
          the current terms when continuing to use the service. For support or
          questions about these terms, contact{" "}
          <a href={`mailto:${supportEmail}`}>{supportEmail}</a>.
        </p>
      </section>
    </PolicyPage>
  );
}
