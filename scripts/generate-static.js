// scripts/generate-static.js
//
// Purpose: gives Google, AI chatbots, and any crawler that doesn't run
// JavaScript a real, fully-formed HTML page for every article — without
// touching the live SPA experience or the backend at all.
//
// How it works:
//   1. Asks the backend (already live on Render) for the full article list.
//   2. For every article that doesn't already have a static file, asks the
//      backend's existing /render/article/:id endpoint for real server-
//      rendered HTML (this endpoint already existed — this script is the
//      first thing that actually calls it).
//   3. Saves that HTML to news/<id>/index.html — a real, permanent URL any
//      crawler can fetch with zero JavaScript.
//   4. Regenerates sitemap.xml so both the static mirror and the live
//      article link are discoverable.
//
// The static pages are NOT the canonical URL — /article/?id=<id> (the live
// site) stays canonical, and every static page says so via <link
// rel="canonical">. This is a standard, safe pattern: it gives crawlers
// real content to read without creating duplicate-content problems or
// changing any link anyone has already shared.
//
// Runs incrementally: articles that already have a static file are
// skipped, so a normal run only does a few API calls, not thousands.

const fs = require('fs');
const path = require('path');

const API_BASE = 'https://newzyy.onrender.com';
const SITE_URL = 'https://newzyy.site';
const OUT_DIR = path.join(__dirname, '..', 'news');
const SITEMAP_PATH = path.join(__dirname, '..', 'sitemap.xml');
const STATIC_PAGES = [
    '', 'about/', 'contact/', 'privacy/', 'terms/', 'author/', 'search/',
    'account/', 'signup/', 'bookmarks/'
];
const LANG_CODES = ['ur', 'hi', 'ar', 'es', 'fr', 'bn', 'tr', 'id', 'pt'];

function log(msg) { console.log(`[generate-static] ${msg}`); }

async function fetchAllArticles() {
    const res = await fetch(`${API_BASE}/api/all-news?page=1&limit=3000`);
    const data = await res.json();
    return (data.success && data.news) ? data.news : [];
}

async function fetchRenderedArticle(id) {
    const res = await fetch(`${API_BASE}/render/article/${id}`);
    if (!res.ok) return null;
    return res.text();
}

// Injects a canonical tag pointing back to the live SPA article page — this
// is what keeps the static mirror safe from a duplicate-content standpoint.
function withCanonical(html, id) {
    const canonicalUrl = `${SITE_URL}/article/?id=${id}`;
    if (html.includes('rel="canonical"')) return html;
    return html.replace(
        '</head>',
        `  <link rel="canonical" href="${canonicalUrl}">\n</head>`
    );
}

async function generateArticles(articles) {
    if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
    let created = 0, skipped = 0, failed = 0;

    for (const article of articles) {
        const dir = path.join(OUT_DIR, article.id);
        const filePath = path.join(dir, 'index.html');
        if (fs.existsSync(filePath)) { skipped++; continue; }

        try {
            const html = await fetchRenderedArticle(article.id);
            if (!html) { failed++; continue; }
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(filePath, withCanonical(html, article.id), 'utf8');
            created++;
        } catch (e) {
            log(`  failed for ${article.id}: ${e.message}`);
            failed++;
        }
    }

    log(`articles: ${created} created, ${skipped} already existed, ${failed} failed`);
    return created;
}

function buildSitemap(articles) {
    const now = new Date().toISOString().split('T')[0];
    const urls = [];

    // static pages, English + every language
    for (const page of STATIC_PAGES) {
        urls.push(`  <url><loc>${SITE_URL}/${page}</loc><changefreq>daily</changefreq><priority>${page === '' ? '1.0' : '0.5'}</priority></url>`);
    }
    for (const lang of LANG_CODES) {
        urls.push(`  <url><loc>${SITE_URL}/${lang}/</loc><changefreq>daily</changefreq><priority>0.9</priority></url>`);
    }

    // every article: live SPA URL (canonical) + its static mirror
    for (const a of articles) {
        const lastmod = a.fetched_at ? new Date(a.fetched_at).toISOString().split('T')[0] : now;
        urls.push(`  <url><loc>${SITE_URL}/article/?id=${a.id}</loc><lastmod>${lastmod}</lastmod><changefreq>never</changefreq><priority>0.7</priority></url>`);
        urls.push(`  <url><loc>${SITE_URL}/news/${a.id}/</loc><lastmod>${lastmod}</lastmod><changefreq>never</changefreq><priority>0.6</priority></url>`);
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
    fs.writeFileSync(SITEMAP_PATH, xml, 'utf8');
    log(`sitemap.xml written with ${urls.length} URLs`);
}

async function main() {
    log('fetching article list from backend...');
    const articles = await fetchAllArticles();
    log(`backend returned ${articles.length} published articles`);

    if (!articles.length) {
        log('no articles returned — leaving existing static files and sitemap untouched');
        return;
    }

    await generateArticles(articles);
    buildSitemap(articles);
    log('done.');
}

main().catch(e => {
    console.error('[generate-static] fatal error:', e);
    process.exit(1);
});
