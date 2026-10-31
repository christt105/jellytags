// Escape user-controlled strings before injecting into innerHTML. Media names,
// tags and library names can contain <, >, &, or quotes which otherwise break
// rendering and allow HTML injection.
export function escapeHtml(value: unknown): string {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
