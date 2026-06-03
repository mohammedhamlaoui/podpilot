import { useEffect, useMemo, useState } from "react";
import ThemeToggle from "./ThemeToggle";
import { LogoMark, LandingButton, UserMenu } from "./LandingPage";
import { blogPosts, getBlogPost } from "../content/blogPosts";
import { useAuth } from "../auth/AuthContext";
import PublicHeader from "./PublicHeader";
import PublicFooter from "./PublicFooter";
import { useSeo } from "../utils/useSeo";

const categories = ["All", ...Array.from(new Set(blogPosts.map((post) => post.category)))];

const blogNavItems = [
  { label: "Home", href: "/" },
  { label: "Blog", href: "/blog" },
  { label: "Pricing", href: "/pricing" },
  { label: "Help", href: "/help" },
];



function renderContentWithLinks(text) {
  if (!text) return null;
  const regex = /\[([^\]]+)\]\(([^)]+)\)/g;
  const parts = [];
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    const linkText = match[1];
    const linkUrl = match[2];
    const index = match.index;

    if (index > lastIndex) {
      parts.push(text.substring(lastIndex, index));
    }

    parts.push(
      <a key={index} href={linkUrl} className="blog-internal-link">
        {linkText}
      </a>
    );

    lastIndex = index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex));
  }

  return parts.length > 0 ? parts : text;
}

function BlogShell({ theme, setTheme, children }) {
  return (
    <div className="blog-site">
      <PublicHeader theme={theme} setTheme={setTheme} />
      {children}
      <PublicFooter />
    </div>
  );
}

function BlogIndex({ theme, setTheme }) {
  const [activeCategory, setActiveCategory] = useState("All");
  const filteredPosts = useMemo(
    () => activeCategory === "All" ? blogPosts : blogPosts.filter((post) => post.category === activeCategory),
    [activeCategory],
  );
  const featured = blogPosts[6];

  useSeo({
    title: "POD Upload Automation Blog",
    description: "Practical guides for Redbubble and TeePublic sellers who want faster metadata prep, safer checks, and browser-based POD upload automation.",
    canonical: "/blog",
  });

  return (
    <BlogShell theme={theme} setTheme={setTheme}>
      <main className="blog-main">
        <section className="blog-hero">
          <span className="blog-badge">PODPILOT BLOG</span>
          <h1>POD Upload Automation Guides</h1>
          <p>
            Practical guides for Redbubble and TeePublic sellers who want faster metadata prep,
            safer checks, and browser-based upload automation.
          </p>
        </section>

        <section className="blog-featured" aria-label="Featured guide">
          <a className="blog-featured-image" href={`/blog/${featured.slug}`}>
            <img src={featured.image} alt={featured.imageAlt} loading="eager" decoding="async" />
          </a>
          <div className="blog-featured-copy">
            <span>{featured.category}</span>
            <h2>{featured.title}</h2>
            <p>{featured.metaDescription}</p>
            <a className="blog-text-link" href={`/blog/${featured.slug}`}>Read the guide</a>
          </div>
        </section>

        <div className="blog-category-pills" aria-label="Blog categories">
          {categories.map((category) => (
            <button
              type="button"
              key={category}
              className={activeCategory === category ? "is-active" : ""}
              onClick={() => setActiveCategory(category)}
            >
              {category}
            </button>
          ))}
        </div>

        <section className="blog-grid" aria-label="All blog guides">
          {filteredPosts.map((post) => (
            <article className="blog-card" key={post.slug}>
              <a className="blog-card-image" href={`/blog/${post.slug}`}>
                <img src={post.image} alt={post.imageAlt} loading="lazy" decoding="async" />
              </a>
              <div className="blog-card-body">
                <div className="blog-card-meta">
                  <span>{post.category}</span>
                  <span>{post.readTime}</span>
                </div>
                <h2><a href={`/blog/${post.slug}`}>{post.title}</a></h2>
                <p>{post.metaDescription}</p>
              </div>
            </article>
          ))}
        </section>

        <section className="blog-cta">
          <h2>Ready to upload your next POD batch faster?</h2>
          <p>Import designs, review metadata, check risk, and upload to Redbubble or TeePublic from one workflow.</p>
          <div className="blog-cta-actions">
            <LandingButton>Start Free</LandingButton>
            <LandingButton variant="secondary" href="/pricing">View Pricing</LandingButton>
          </div>
        </section>
      </main>
    </BlogShell>
  );
}

function BlogArticle({ post, theme, setTheme }) {
  useSeo({
    title: `${post.title}`,
    description: post.metaDescription,
    canonical: `/blog/${post.slug}`,
    ogImage: `https://podpilot.space${post.image}`,
    ogType: "article",
    jsonLd: [
      {
        "@type": "Article",
        "@id": `https://podpilot.space/blog/${post.slug}`,
        headline: post.title,
        description: post.metaDescription,
        image: `https://podpilot.space${post.image}`,
        author: {
          "@type": "Organization",
          name: "PodPilot",
          url: "https://podpilot.space",
        },
        publisher: {
          "@type": "Organization",
          "@id": "https://podpilot.space/#organization",
          name: "PodPilot",
        },
        url: `https://podpilot.space/blog/${post.slug}`,
        mainEntityOfPage: `https://podpilot.space/blog/${post.slug}`,
        keywords: post.secondaryKeywords?.join(", "),
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: "https://podpilot.space/" },
          { "@type": "ListItem", position: 2, name: "Blog", item: "https://podpilot.space/blog" },
          { "@type": "ListItem", position: 3, name: post.title, item: `https://podpilot.space/blog/${post.slug}` },
        ],
      },
      ...(post.faqs ? [{
        "@type": "FAQPage",
        "mainEntity": post.faqs.map(faq => ({
          "@type": "Question",
          "name": faq.q,
          "acceptedAnswer": {
            "@type": "Answer",
            "text": faq.a
          }
        }))
      }] : [])
    ],
  });

  const related = blogPosts.filter((item) => item.slug !== post.slug).slice(0, 3);

  return (
    <BlogShell theme={theme} setTheme={setTheme}>
      <main className="blog-article-main">
        <a className="blog-back-link" href="/blog">&larr; Back to Blog</a>
        <article className="blog-article">
          <header className="blog-article-header">
            <div className="blog-card-meta">
              <span>{post.category}</span>
              <span>{post.readTime}</span>
            </div>
            <h1>{post.title}</h1>
            <p>{post.metaDescription}</p>
          </header>

          <figure className="blog-article-hero-image">
            <img src={post.image} alt={post.imageAlt} loading="eager" decoding="async" />
          </figure>

          <div className="blog-article-content">
            <aside className="blog-seo-box">
              <strong>Target keyword</strong>
              <span>{post.targetKeyword}</span>
              <strong>Related searches</strong>
              <div>
                {post.secondaryKeywords.map((keyword) => (
                  <span className="blog-keyword-chip" key={keyword}>{keyword}</span>
                ))}
              </div>
            </aside>

            <p className="blog-intro">{renderContentWithLinks(post.intro)}</p>

            <nav className="blog-toc" aria-label="Table of contents">
              <strong>In this guide</strong>
              {post.comparisonTable && (
                <a href="#comparison-table">Quick Comparison Table</a>
              )}
              {post.sections.map((section) => (
                <a key={section.heading} href={`#${section.heading.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>
                  {section.heading}
                </a>
              ))}
              {post.faqs && (
                <a href="#faq">Frequently Asked Questions</a>
              )}
            </nav>

            {post.comparisonTable && (
              <section className="blog-comparison-section" id="comparison-table">
                <h2>Quick Comparison Table</h2>
                <div className="blog-comparison-table-wrapper">
                  <table className="blog-comparison-table">
                    <thead>
                      <tr>
                        {post.comparisonTable.headers.map((h) => <th key={h}>{h}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {post.comparisonTable.rows.map((row, i) => (
                        <tr key={i}>
                          <td><strong>{row.category}</strong></td>
                          <td>{row.redbubble}</td>
                          <td>{row.teepublic}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {post.sections.map((section) => (
              <section className="blog-article-section" id={section.heading.toLowerCase().replace(/[^a-z0-9]+/g, "-")} key={section.heading}>
                <h2>{section.heading}</h2>
                <p>{renderContentWithLinks(section.body)}</p>
                <ul>
                  {section.points.map((point) => <li key={point}>{renderContentWithLinks(point)}</li>)}
                </ul>
              </section>
            ))}

            {post.faqs && (
              <section className="blog-faq-section" id="faq">
                <h2>Frequently Asked Questions</h2>
                <div className="blog-faq-list">
                  {post.faqs.map((faq, i) => (
                    <div className="blog-faq-item" key={i}>
                      <h3>{faq.q}</h3>
                      <p>{faq.a}</p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section className="blog-note">
              <h2>Keep the workflow practical</h2>
              <p>
                PodPilot is built for Redbubble and TeePublic sellers who want fewer repeated upload steps.
                Trademark and AI risk checks are informational only, and you should review carefully before publishing.
              </p>
            </section>

            <section className="blog-article-cta">
              <h2>{renderContentWithLinks(post.cta)}</h2>
              <div className="blog-cta-actions">
                <LandingButton>Start Free</LandingButton>
                <LandingButton variant="secondary" href="/help">Learn More</LandingButton>
              </div>
            </section>
          </div>
        </article>

        <section className="blog-related">
          <h2>Related guides</h2>
          <div className="blog-related-grid">
            {related.map((item) => (
              <a className="blog-related-card" href={`/blog/${item.slug}`} key={item.slug}>
                <img src={item.image} alt={item.imageAlt} loading="lazy" decoding="async" />
                <span>{item.category}</span>
                <strong>{item.title}</strong>
              </a>
            ))}
          </div>
        </section>
      </main>
    </BlogShell>
  );
}

export default function BlogPage({ theme, setTheme, slug = "" }) {
  if (!slug) return <BlogIndex theme={theme} setTheme={setTheme} />;
  const post = getBlogPost(slug);
  if (!post) {
    return (
      <BlogShell theme={theme} setTheme={setTheme}>
        <main className="blog-main">
          <section className="blog-hero">
            <span className="blog-badge">Not found</span>
            <h1>Guide not found</h1>
            <p>This PodPilot guide is not available yet.</p>
            <a className="blog-text-link" href="/blog">Back to all guides</a>
          </section>
        </main>
      </BlogShell>
    );
  }
  return <BlogArticle post={post} theme={theme} setTheme={setTheme} />;
}
