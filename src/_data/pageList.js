import pages from './pages.json' with { type: 'json' };

// Pages maps page IDs to their corresponding meta attributes.
// This enables iteration over all pages rather than accessing one by ID.
export default function() {
    return Object.entries(pages).map(([id, p]) => ({
        nonLocalizedUri: p.slug ? `/${p.slug}/index.html` : '/index.html',
        ...p
    }));
}
