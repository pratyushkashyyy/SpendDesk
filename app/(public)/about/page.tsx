import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  ChartNoAxesCombined,
  Clock3,
  History,
  Link2,
  LockKeyhole,
  ShoppingBag,
} from "lucide-react";
import { supportEmail } from "@/components/public-site";
import styles from "../public.module.css";

export const metadata: Metadata = {
  alternates: { canonical: "/about" },
  title: "SpendDesk · Google Ads and Shopify reporting",
  description:
    "SpendDesk brings Google Ads spending, campaign budgets, purchase conversions, and Shopify order counts into one private reporting workspace.",
};

export default function About() {
  return (
    <main id="main-content">
      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>
            <span /> A CLEARER DAILY OVERVIEW
          </p>
          <h1>
            Your stores. Your ads.
            <br />
            <em>One clear view.</em>
          </h1>
          <p>
            SpendDesk is a private reporting workspace for store operators.
            Review Google Ads spend, campaign budgets, and purchase conversions
            alongside Shopify order counts.
          </p>
          <div className={styles.actions}>
            <Link className={styles.primary} href="/">
              Open your workspace <ArrowRight size={17} aria-hidden="true" />
            </Link>
            <a className={styles.secondary} href={`mailto:${supportEmail}`}>
              Contact us
            </a>
          </div>
          <p className={styles.heroNote}>
            <LockKeyhole size={14} aria-hidden="true" /> Reporting reads only.
            Your connected reports require authorization.
          </p>
        </div>
        <div
          className={styles.overview}
          aria-label="Sources available in SpendDesk"
        >
          <div className={styles.overviewHeading}>
            <span className={styles.liveDot} /> YOUR REPORTING WORKSPACE{" "}
            <LayoutIcon />
          </div>
          <div className={styles.source}>
            <span className={styles.sourceIcon}>
              <BarChart3 size={23} aria-hidden="true" />
            </span>
            <div>
              <h2>Google Ads</h2>
              <p>Spend · Budgets · Purchase conversions</p>
            </div>
          </div>
          <div className={styles.source}>
            <span className={styles.shopIcon}>
              <ShoppingBag size={23} aria-hidden="true" />
            </span>
            <div>
              <h2>Shopify</h2>
              <p>Reported orders · Product catalog</p>
            </div>
          </div>
          <div className={styles.overviewFooter}>
            <History size={15} aria-hidden="true" />
            <span>Saved reports, order trends, and budget history</span>
          </div>
        </div>
      </section>
      <section className={styles.features} aria-label="SpendDesk features">
        {[
          {
            icon: Clock3,
            title: "Daily visibility",
            text: "Compare selected dates using saved source reports, with refreshes subject to provider availability and API limits.",
          },
          {
            icon: ChartNoAxesCombined,
            title: "Order trends",
            text: "Explore order comparisons and the intraday history collected as your stores sync.",
          },
          {
            icon: History,
            title: "Budget history",
            text: "Review daily budget settings, previous recorded amounts, and available campaign change history.",
          },
        ].map(({ icon: Icon, title, text }) => (
          <article key={title}>
            <Icon size={22} aria-hidden="true" />
            <h2>{title}</h2>
            <p>{text}</p>
          </article>
        ))}
      </section>
      <section className={styles.explainer}>
        <div>
          <p className={styles.eyebrow}>CONNECTED WITH YOUR PERMISSION</p>
          <h2>
            Your accounts.
            <br />A workspace you control.
          </h2>
          <p>
            SpendDesk is for the owner and people authorized to manage the
            connected stores. It is a reporting tool, and does not change Google
            Ads campaigns, bids, budgets, or Shopify orders.
          </p>
          <Link href="/privacy">
            Read how your data is handled{" "}
            <ArrowRight size={15} aria-hidden="true" />
          </Link>
        </div>
        <ol className={styles.steps}>
          <li>
            <span>
              <Link2 size={19} aria-hidden="true" />
            </span>
            <div>
              <h3>Connect your sources</h3>
              <p>
                Authorize Google access through Google’s consent screen and
                configure Shopify access for stores you manage.
              </p>
            </div>
          </li>
          <li>
            <span>
              <BarChart3 size={19} aria-hidden="true" />
            </span>
            <div>
              <h3>Read source reports</h3>
              <p>
                SpendDesk retrieves account and campaign reporting, budgets,
                order totals, and product information to display in your
                workspace.
              </p>
            </div>
          </li>
          <li>
            <span>
              <LockKeyhole size={19} aria-hidden="true" />
            </span>
            <div>
              <h3>Choose what to share</h3>
              <p>
                Your reports stay behind sign-in. An optional reporting
                assistant can access selected saved reports only after you
                authorize its connection.
              </p>
            </div>
          </li>
        </ol>
      </section>
      <section className={styles.disclosure}>
        <h2>Keep the source in view.</h2>
        <p>
          Figures reflect the dates, time zones, attribution, and last updates
          reported by each provider. Google Ads purchases can be fractional.
          Daily budgets are settings, not actual spending. SpendDesk keeps the
          sources separate rather than inventing blended results.
        </p>
      </section>
    </main>
  );
}

function LayoutIcon() {
  return (
    <span className={styles.overviewDots} aria-hidden="true">
      •••
    </span>
  );
}
