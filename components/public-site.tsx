import Link from "next/link";
import { ArrowUpRight, LayoutGrid } from "lucide-react";
import styles from "@/app/(public)/public.module.css";

export const supportEmail = "contact-us@unicornkart.us";
export const policyDate = "17 October 2026";

export function PublicSite({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.site}>
      <a className={styles.skip} href="#main-content">
        Skip to content
      </a>
      <header className={styles.header}>
        <Link
          className={styles.brand}
          href="/about"
          aria-label="SpendDesk home"
        >
          <span className={styles.mark}>
            <LayoutGrid size={20} aria-hidden="true" />
          </span>
          SpendDesk<span className={styles.brandDot}>.</span>
        </Link>
        <nav className={styles.nav} aria-label="Main navigation">
          <Link href="/about">About</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <Link className={styles.signIn} href="/login">
            Sign in <ArrowUpRight size={15} aria-hidden="true" />
          </Link>
        </nav>
      </header>
      {children}
      <footer className={styles.footer}>
        <div>
          <strong>SpendDesk</strong>
          <p>A private workspace for your stores and ads.</p>
        </div>
        <nav aria-label="Footer navigation">
          <Link href="/about">Home</Link>
          <Link href="/privacy">Privacy policy</Link>
          <Link href="/terms">Terms of service</Link>
          <a href={`mailto:${supportEmail}`}>{supportEmail}</a>
        </nav>
        <small>
          © 2026 SpendDesk. Independent of Google, Shopify, and Railway.
        </small>
      </footer>
    </div>
  );
}

export function PolicyPage({
  title,
  introduction,
  children,
}: {
  title: string;
  introduction: string;
  children: React.ReactNode;
}) {
  return (
    <main id="main-content" className={styles.policy}>
      <header className={styles.policyHeader}>
        <p className={styles.eyebrow}>SPENDDESK</p>
        <h1>{title}</h1>
        <p>{introduction}</p>
        <small>Effective and last updated: {policyDate}</small>
      </header>
      <article className={styles.prose}>{children}</article>
    </main>
  );
}
